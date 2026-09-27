import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { builderStateSchema } from "@/lib/portali/preventivatore/chat/builder-state-schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { getPreventivatoreScope } from "@/lib/portali/preventivatore/ruoli";
import { loadAiConfig } from "@/lib/portali/preventivatore/chat/config-cache";
import { formatBuilderStateForPrompt } from "@/lib/portali/preventivatore/chat/builder-state-prompt";
import type { BuilderStateForChat } from "@/lib/portali/preventivatore/chat/types";
import {
  chiamaOpenRouterChat,
  recuperaEsempi,
  formattaEsempi,
  registraUsage,
  risolveModello,
} from "@/lib/portali/preventivatore/scheda-tecnica/ai";
import { logError, logWarn } from "@/lib/logger";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const domandaSchema = z.object({
  id: z.string().trim().min(1).max(100),
  testo: z.string().trim().min(1).max(2_000),
  // Un tipo inatteso non deve far scartare tutte le domande: diventa testo libero.
  tipo: z.enum(["text", "select", "number"]).catch("text"),
  opzioni: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
});
const rispostaSchema = z.object({
  id: z.string().trim().min(1).max(100),
  risposta: z.string().trim().min(1).max(10_000),
});
// Stesso schema tollerante della chat: il builder e il dettaglio mandano campi
// calcolati (anche NaN) e `coeff_ricarico` sulle lavorazioni.
const requestSchema = z.object({
  builder_state: builderStateSchema,
  risposte_domande: z.array(rispostaSchema).max(50).optional(),
  domande_poste: z.array(domandaSchema).max(50).optional(),
  forza_generazione: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (Buffer.byteLength(JSON.stringify(value.builder_state), "utf8") > 200_000) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["builder_state"], message: "builder_state supera 200 KB" });
  }
});

type Domanda = z.infer<typeof domandaSchema>;

function estraiDomande(content: string): { motivo: string; domande: Domanda[] } | null {
  try {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = z.object({
      tipo: z.literal("domande"),
      motivo: z.string().max(4_000).optional(),
      domande: z.array(domandaSchema).min(1).max(20),
    }).safeParse(JSON.parse(match[0]));
    if (!parsed.success) return null;
    return {
      motivo: parsed.data.motivo ?? "Servono alcune informazioni aggiuntive per scrivere una scheda tecnica accurata.",
      domande: parsed.data.domande.slice(0, 8),
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;
    const { user, ctx } = guard;
    const parsedBody = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? "Payload non valido" }, { status: 400 });
    }
    const body = parsedBody.data;
    const builderState = body.builder_state as BuilderStateForChat;

    const rl = checkRateLimit(`ai-scheda:${user.id}`, { limit: 20, windowMs: 60_000 });
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
    const cfg = await loadAiConfig();
    const { model } = risolveModello(cfg.modello_scheda_tecnica, cfg.modello_generazione);

    const temperature = Math.max(0, Math.min(1, parseFloat(cfg.temperatura_scheda_tecnica ?? "0.4") || 0.4));
    const maxEsempi = parseInt(cfg.max_esempi_scheda ?? "4", 10) || 4;
    const sogliaEsempi = parseFloat(cfg.soglia_similarity_scheda ?? "0.35") || 0.35;
    const systemSchedaTecnica = cfg.system_prompt_scheda_tecnica ?? "Sei un redattore tecnico SICS.";
    const systemDomande = cfg.system_prompt_domande_scheda ?? "Formula domande JSON per raccogliere info mancanti.";
    const haRisposte = (body.risposte_domande?.length ?? 0) > 0;
    const scope = await getPreventivatoreScope(user.id, ctx.livello);
    const esempi = await recuperaEsempi(builderState, maxEsempi, sogliaEsempi, {
      utenteId: user.id,
      clienteIds: scope.restricted ? scope.clienteIds : null,
    });

    if (!haRisposte && !body.forza_generazione) {
      const userPrompt = [
        "Analizza questo stato del preventivo e gli esempi simili.",
        "Restituisci il JSON con le sole domande mancanti come da istruzioni.", "",
        formatBuilderStateForPrompt(builderState), "", formattaEsempi(esempi),
      ].join("\n");
      for (let tentativo = 0; tentativo < 2; tentativo += 1) {
        const risposta = await chiamaOpenRouterChat({
          model,
          messages: [{ role: "system", content: systemDomande }, { role: "user", content: userPrompt }],
          temperature: 0.2,
          maxTokens: 4096,
        });
        await registraUsage({ userId: user.id, model, modalita: "scheda_domande", usage: risposta.usage });
        const domande = risposta.finishReason === "length" ? null : estraiDomande(risposta.content);
        if (domande) return NextResponse.json({ tipo: "domande", ...domande, _usage: risposta.usage });
        logWarn("preventivatore.scheda-tecnica", "risposta domande non leggibile", { tentativo: tentativo + 1 });
      }
      return NextResponse.json({ error: "L'AI non ha formulato le domande in modo leggibile, riprova" }, { status: 502 });
    }

    const userPromptScheda = [
      "Genera la DESCRIZIONE DI FORNITURA per il seguente preventivo.",
      "Le schede di esempio servono esclusivamente per stile e struttura: non trasferire dati tecnici da altri clienti o macchine.", "",
      formatBuilderStateForPrompt(builderState),
      haRisposte ? "\nINFORMAZIONI AGGIUNTIVE FORNITE DALL'UTENTE:\n" + body.risposte_domande!.map((r) => `- ${r.id}: ${r.risposta}`).join("\n") : "",
      formattaEsempi(esempi),
    ].join("\n");
    const risposta = await chiamaOpenRouterChat({
      model,
      messages: [{ role: "system", content: systemSchedaTecnica }, { role: "user", content: userPromptScheda }],
      temperature,
      maxTokens: 8192,
    });
    await registraUsage({ userId: user.id, model, modalita: "scheda_tecnica", usage: risposta.usage });
    if (risposta.finishReason === "length") {
      return NextResponse.json({ error: "La scheda è stata troncata dall'AI, riprova" }, { status: 502 });
    }
    const schedaMd = risposta.content.trim();
    if (!schedaMd) return NextResponse.json({ error: "L'AI non ha restituito la scheda" }, { status: 502 });

    const admin = createAdminClient();
    const { data: insertRow, error: insErr } = await admin.schema("preventivatore").from("schede_generate").insert({
      user_id: user.id,
      builder_state: body.builder_state,
      domande: body.domande_poste ?? null,
      risposte: haRisposte ? body.risposte_domande : null,
      contenuto_md: schedaMd,
      modello: model,
      provider: "openrouter",
      tokens_input: risposta.usage?.prompt_tokens ?? null,
      tokens_output: risposta.usage?.completion_tokens ?? null,
      costo_stimato: risposta.usage?.cost ?? null,
    }).select("id").single();
    if (insErr) logWarn("preventivatore.scheda-tecnica", "insert audit fallito", { dettaglio: insErr.message });

    return NextResponse.json({
      tipo: "scheda", contenuto_md: schedaMd, modello: model, provider: "openrouter",
      scheda_id: insertRow?.id ?? "", costo: risposta.usage?.cost ?? null,
    });
  } catch (err) {
    logError("preventivatore.scheda-tecnica", "scheda-tecnica error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Errore generazione scheda tecnica" }, { status: 500 });
  }
}
