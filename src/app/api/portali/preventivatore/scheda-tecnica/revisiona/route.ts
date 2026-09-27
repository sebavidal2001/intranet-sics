import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { loadAiConfig } from "@/lib/portali/preventivatore/chat/config-cache";
import { chiamaOpenRouterChat, registraUsage, risolveModello, MAX_CARATTERI_SCHEDA, type ChatMsg } from "@/lib/portali/preventivatore/scheda-tecnica/ai";
import { logError, logWarn } from "@/lib/logger";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const requestSchema = z.object({
  scheda_corrente: z.string().trim().min(1, "scheda_corrente obbligatoria").max(MAX_CARATTERI_SCHEDA),
  istruzione: z.string().trim().min(1, "istruzione obbligatoria").max(2_000),
  storico: z.array(z.object({
    ruolo: z.enum(["utente", "ai"]),
    testo: z.string().max(MAX_CARATTERI_SCHEDA),
  })).max(20).optional(),
  scheda_id: z.string().uuid().nullable().optional(),
});

const SYSTEM_REVISIONE = [
  "Sei un redattore tecnico-commerciale SICS. Ricevi una DESCRIZIONE DI FORNITURA già redatta e una richiesta di modifica.",
  "REGOLE:",
  "- Restituisci SEMPRE la scheda COMPLETA e riscritta, in markdown, pronta da usare.",
  "- NON aggiungere commenti, premesse, spiegazioni o testo fuori dalla scheda.",
  "- Applica SOLO la modifica richiesta: tutto il resto deve restare IDENTICO parola per parola.",
  "- Non introdurre dati non presenti nella scheda o nella richiesta dell'utente.",
  "- Mantieni le regole SICS: niente prezzi, codici interni, lavorazioni/ore o tabelle.",
].join("\n");

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;
    const { user } = guard;
    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Payload non valido" }, { status: 400 });
    const body = parsed.data;
    const admin = createAdminClient();

    if (body.scheda_id) {
      const { data: owned, error } = await admin.schema("preventivatore").from("schede_generate")
        .select("id").eq("id", body.scheda_id).eq("user_id", user.id).maybeSingle();
      if (error) throw error;
      if (!owned) return NextResponse.json({ error: "Scheda non trovata" }, { status: 404 });
    }

    const rl = checkRateLimit(`ai-scheda-rev:${user.id}`, { limit: 20, windowMs: 60_000 });
    if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
    const cfg = await loadAiConfig();
    const { model } = risolveModello(cfg.modello_scheda_tecnica, cfg.modello_generazione);
    const temperature = Math.max(0, Math.min(1, parseFloat(cfg.temperatura_scheda_tecnica ?? "0.4") || 0.4));
    const messaggiStorico: ChatMsg[] = (body.storico ?? []).slice(-6).map((m) => ({
      role: m.ruolo === "utente" ? "user" : "assistant",
      content: m.testo,
    }));
    const messages: ChatMsg[] = [
      { role: "system", content: SYSTEM_REVISIONE },
      ...messaggiStorico,
      { role: "user", content: [
        "SCHEDA ATTUALE (fonte di verità):", "---", body.scheda_corrente, "---", "",
        `MODIFICA RICHIESTA: ${body.istruzione}`, "", "Rispondi con la scheda completa aggiornata, senza altro testo.",
      ].join("\n") },
    ];
    const risposta = await chiamaOpenRouterChat({ model, messages, temperature, maxTokens: 8192, title: "SICS Scheda Tecnica — revisione" });
    await registraUsage({ userId: user.id, model, modalita: "scheda_revisione", usage: risposta.usage });
    if (risposta.finishReason === "length") {
      return NextResponse.json({ error: "La scheda revisionata è stata troncata dall'AI, riprova" }, { status: 502 });
    }
    const nuovaScheda = risposta.content.trim();
    if (!nuovaScheda) return NextResponse.json({ error: "L'AI non ha restituito la scheda revisionata" }, { status: 502 });
    if (nuovaScheda.length > MAX_CARATTERI_SCHEDA) {
      return NextResponse.json({ error: `La scheda revisionata supera il limite di ${MAX_CARATTERI_SCHEDA.toLocaleString("it-IT")} caratteri` }, { status: 502 });
    }

    if (body.scheda_id) {
      try {
        const { data: row } = await admin.schema("preventivatore").from("schede_generate")
          .select("revisioni").eq("id", body.scheda_id).eq("user_id", user.id).maybeSingle();
        const precedenti = Array.isArray(row?.revisioni) ? row.revisioni as unknown[] : [];
        const revisione = {
          istruzione: body.istruzione,
          contenuto_precedente: body.scheda_corrente,
          contenuto_nuovo: nuovaScheda,
          at: new Date().toISOString(),
          costo: risposta.usage?.cost ?? null,
        };
        const { error: updateError } = await admin.schema("preventivatore").from("schede_generate").update({
          revisioni: [...precedenti, revisione].slice(-10),
          contenuto_md: nuovaScheda,
        }).eq("id", body.scheda_id).eq("user_id", user.id);
        if (updateError) throw updateError;
      } catch (error) {
        logWarn("preventivatore.scheda-tecnica", "salvataggio revisione fallito", { dettaglio: String(error) });
      }
    }
    return NextResponse.json({ contenuto_md: nuovaScheda, costo: risposta.usage?.cost ?? null, modello: model });
  } catch (err) {
    logError("preventivatore.scheda-tecnica", "revisione scheda error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Errore revisione scheda" }, { status: 500 });
  }
}
