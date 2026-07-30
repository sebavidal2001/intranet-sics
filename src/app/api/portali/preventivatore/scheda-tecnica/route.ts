import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
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

export const dynamic = "force-dynamic";

/**
 * POST /api/portali/preventivatore/scheda-tecnica
 *
 * Genera la scheda di descrizione tecnica per un preventivo in costruzione.
 *
 * Funziona a 2 fasi:
 *   - Fase 1 (no risposte): se l'AI ha info sufficienti → genera scheda.
 *                            Se no → restituisce `{ tipo: "domande", domande: [...] }`.
 *   - Fase 2 (con risposte_domande): l'AI ha le info → genera scheda finale.
 *
 * Output:
 *   { tipo: "scheda", contenuto_md: string, modello, provider, scheda_id }
 *   { tipo: "domande", motivo: string, domande: Array<{id, testo, tipo, opzioni?}> }
 */

type Domanda = {
  id: string;
  testo: string;
  tipo: "text" | "select" | "number";
  opzioni?: string[];
};

type RispostaDomanda = { id: string; risposta: string };

type RequestBody = {
  builder_state: BuilderStateForChat;
  risposte_domande?: RispostaDomanda[];
  /** Se true, forza la generazione anche se l'AI avrebbe voluto chiedere */
  forza_generazione?: boolean;
};

type SchedaResponse =
  | { tipo: "scheda"; contenuto_md: string; modello: string; provider: string; scheda_id: string; costo?: number | null }
  | { tipo: "domande"; motivo: string; domande: Domanda[] };

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = (await request.json()) as RequestBody;
    if (!body?.builder_state) {
      return NextResponse.json({ error: "builder_state obbligatorio" }, { status: 400 });
    }

    const cfg = await loadAiConfig();
    // Fallback al modello della chat (modello_generazione) se non c'è uno specifico per la scheda
    const { provider, model } = risolveModello(cfg.modello_scheda_tecnica, cfg.modello_generazione);
    if (provider !== "openrouter") {
      return NextResponse.json(
        { error: `Provider Gemini per scheda tecnica non ancora supportato (config: ${cfg.modello_scheda_tecnica})` },
        { status: 500 }
      );
    }

    const temperature = Math.max(0, Math.min(1, parseFloat(cfg.temperatura_scheda_tecnica ?? "0.4") || 0.4));
    const maxEsempi = parseInt(cfg.max_esempi_scheda ?? "4", 10) || 4;
    const sogliaEsempi = parseFloat(cfg.soglia_similarity_scheda ?? "0.35") || 0.35;
    const systemSchedaTecnica = cfg.system_prompt_scheda_tecnica ?? "Sei un redattore tecnico SICS. Genera la scheda tecnica del preventivo.";
    const systemDomande = cfg.system_prompt_domande_scheda ?? "Formula domande JSON per raccogliere info mancanti.";

    // ─── Fase 1: decidiamo se servono domande o no ───────────────────────────
    const haRisposte = Array.isArray(body.risposte_domande) && body.risposte_domande.length > 0;
    const articoliCount = body.builder_state.totali.n_articoli;
    const isVuoto = articoliCount === 0 && body.builder_state.blocchi.length <= 1;

    // Triggers per Fase 1 "ask questions":
    // Il builder contiene solo materiali/lavorazioni grezzi: da soli NON bastano
    // per una scheda di fornitura esaustiva (mancano prodotti finiti, sviluppo
    // geometrico, materiali/finiture, formati, scope). Quindi di DEFAULT chiediamo
    // sempre chiarimenti, a meno che l'utente abbia già risposto o forzi la
    // generazione. (`isVuoto`/`articoliCount` restano informativi nel prompt.)
    void isVuoto;
    const dovrebbeChiedere = !haRisposte && !body.forza_generazione;

    // Esempi di riferimento: schede APPROVATE (prioritarie) + storiche dai Word.
    const esempi = await recuperaEsempi(body.builder_state, maxEsempi, sogliaEsempi);

    if (dovrebbeChiedere) {
      // ─── Fase 1: chiedo domande ─────────────────────────────────────────────
      const userPrompt = [
        "Analizza questo stato del preventivo e i preventivi storici simili (se presenti).",
        "Decidi se le informazioni sono sufficienti per scrivere una scheda tecnica seria.",
        "Se NON sono sufficienti, restituisci il JSON con le domande mancanti come da istruzioni.",
        "",
        formatBuilderStateForPrompt(body.builder_state),
        "",
        formattaEsempi(esempi),
      ].join("\n");

      const { content, usage } = await chiamaOpenRouterChat({
        model,
        messages: [
          { role: "system", content: systemDomande },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        // 1024 era troppo poco: con gli esempi storici il JSON delle domande veniva
        // TRONCATO (finish_reason=length) → il parse falliva e la fase 1 saltava,
        // generando subito la scheda senza mai chiedere nulla.
        maxTokens: 4096,
      });
      await registraUsage({ userId: user.id, model, modalita: "scheda_domande", usage });

      // Estraggo il JSON dalla risposta (anche se l'LLM dovesse aver aggiunto testo extra)
      let parsed: { tipo?: string; motivo?: string; domande?: Domanda[] } | null = null;
      try {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
      // Recupero di un JSON troncato: tengo le domande complete già chiuse.
      if (!parsed && content.includes('"domande"')) {
        const domande: Domanda[] = [];
        for (const m of content.matchAll(/\{[^{}]*"id"[^{}]*\}/g)) {
          try {
            const d = JSON.parse(m[0]) as Domanda;
            if (d?.id && d?.testo) domande.push({ ...d, tipo: d.tipo ?? "text" });
          } catch { /* frammento incompleto: lo salto */ }
        }
        if (domande.length > 0) {
          const motivoMatch = content.match(/"motivo"\s*:\s*"((?:[^"\\]|\\.)*)"/);
          parsed = { tipo: "domande", motivo: motivoMatch?.[1], domande };
          logWarn("preventivatore.scheda-tecnica", "JSON domande troncato: recuperate parzialmente", { n: domande.length });
        }
      }

      if (parsed?.tipo === "domande" && Array.isArray(parsed.domande) && parsed.domande.length > 0) {
        return NextResponse.json({
          tipo: "domande",
          motivo: parsed.motivo ?? "Servono alcune informazioni aggiuntive per scrivere una scheda tecnica accurata.",
          domande: parsed.domande,
          _usage: usage,
        } satisfies SchedaResponse & { _usage?: unknown });
      }
      // Se l'LLM ha invece risposto direttamente con la scheda, proseguiamo
    }

    // ─── Fase 2: generazione scheda definitiva ───────────────────────────────
    const userPromptScheda = [
      "Genera la DESCRIZIONE DI FORNITURA per il seguente preventivo, imitando FEDELMENTE struttura e stile delle schede storiche allegate (sono lo stile-target).",
      "Struttura attesa: intestazione (Spett.le <cliente> / Alla c.a. / Oggetto), poi 'Descrizione fornitura:' con un breve paragrafo discorsivo su scopo e dimensioni principali, poi una o più sezioni 'CARATTERISTICHE TECNICHE <TIPO>:' con elenco puntato (una caratteristica per riga, con serie/codici COMMERCIALI), infine 'Compreso nella fornitura:' ed 'Escluso dalla fornitura:'.",
      "NON elencare lavorazioni, ore o fasi di officina. Rispetta le regole inviolabili del system prompt: niente prezzi, niente codici interni SICS, niente tabelle.",
      "",
      formatBuilderStateForPrompt(body.builder_state),
      "",
      haRisposte
        ? "\nINFORMAZIONI AGGIUNTIVE FORNITE DALL'UTENTE:\n" +
          body.risposte_domande!.map((r) => `- ${r.id}: ${r.risposta}`).join("\n")
        : "",
      formattaEsempi(esempi),
    ].join("\n");

    const { content: schedaMd, usage } = await chiamaOpenRouterChat({
      model,
      messages: [
        { role: "system", content: systemSchedaTecnica },
        { role: "user", content: userPromptScheda },
      ],
      temperature,
      maxTokens: 8192,
    });
    await registraUsage({ userId: user.id, model, modalita: "scheda_tecnica", usage });

    // Salva l'audit
    const admin = createAdminClient();
    const { data: insertRow, error: insErr } = await admin
      .schema("preventivatore")
      .from("schede_generate")
      .insert({
        user_id: user.id,
        builder_state: body.builder_state,
        domande: null,
        risposte: haRisposte ? body.risposte_domande : null,
        contenuto_md: schedaMd,
        modello: model,
        provider: "openrouter",
        tokens_input: usage?.prompt_tokens ?? null,
        tokens_output: usage?.completion_tokens ?? null,
        costo_stimato: usage?.cost ?? null,
      })
      .select("id")
      .single();

    if (insErr) {
      logWarn("preventivatore.scheda-tecnica", "scheda-tecnica: insert audit fallito", { dettaglio: insErr });
    }

    return NextResponse.json({
      tipo: "scheda",
      contenuto_md: schedaMd,
      modello: model,
      provider: "openrouter",
      scheda_id: insertRow?.id ?? "",
      costo: usage?.cost ?? null,
    } satisfies SchedaResponse);
  } catch (err) {
    logError("preventivatore.scheda-tecnica", "scheda-tecnica error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore generazione scheda tecnica" },
      { status: 500 }
    );
  }
}
