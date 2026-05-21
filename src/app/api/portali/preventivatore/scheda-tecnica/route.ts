import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { loadAiConfig } from "@/lib/portali/preventivatore/chat/config-cache";
import { formatBuilderStateForPrompt } from "@/lib/portali/preventivatore/chat/builder-state-prompt";
import type { BuilderStateForChat } from "@/lib/portali/preventivatore/chat/types";

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
  | { tipo: "scheda"; contenuto_md: string; modello: string; provider: string; scheda_id: string }
  | { tipo: "domande"; motivo: string; domande: Domanda[] };

// ─── Helpers OpenRouter ──────────────────────────────────────────────────────

async function chiamaOpenRouter(opts: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
}): Promise<{ content: string; usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurata");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://intranet-sics.vercel.app",
      "X-Title": "SICS Scheda Tecnica",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userPrompt },
      ],
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `OpenRouter HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  return { content, usage: data.usage };
}

// ─── Recupera schede storiche simili dal RAG ─────────────────────────────────
// Strategia: prendiamo i primi N chunks (chunk_index = 0, contenente la "descrizione
// principale" del preventivo) di documenti della stessa categoria/cliente.

async function recuperaEsempiStorici(
  builderState: BuilderStateForChat,
  maxEsempi: number
): Promise<Array<{ codice: string; cliente: string | null; contenuto: string }>> {
  const admin = createAdminClient();
  const tipiBlocco = [...new Set(builderState.blocchi.map((b) => b.tipo))];
  const cliente = builderState.cliente?.ragione_sociale;

  // Heuristica: cerchiamo chunk_index=0 con metadata.categoria o cliente affine
  // (semplice ILIKE; il fine-tune semantico via embedding lo faremo se serve)
  let query = admin
    .schema("preventivatore")
    .from("chunks")
    .select("contenuto, documento_id, chunk_index, documenti!inner(codice, cliente, categoria)")
    .eq("chunk_index", 0)
    .limit(maxEsempi);

  if (cliente) {
    // Prima prova: stesso cliente
    const { data: byClient } = await query.eq("documenti.cliente", cliente);
    if (byClient && byClient.length > 0) {
      return byClient.map((c) => ({
        codice: (c.documenti as unknown as { codice: string }).codice,
        cliente: (c.documenti as unknown as { cliente: string | null }).cliente,
        contenuto: c.contenuto?.slice(0, 1500) ?? "",
      }));
    }
  }
  // Fallback: per categoria/tipo
  if (tipiBlocco.length > 0) {
    const tipoLike = tipiBlocco[0].toLowerCase();
    const { data: byCat } = await admin
      .schema("preventivatore")
      .from("chunks")
      .select("contenuto, documento_id, chunk_index, documenti!inner(codice, cliente, categoria)")
      .eq("chunk_index", 0)
      .ilike("documenti.categoria", `%${tipoLike}%`)
      .limit(maxEsempi);
    if (byCat && byCat.length > 0) {
      return byCat.map((c) => ({
        codice: (c.documenti as unknown as { codice: string }).codice,
        cliente: (c.documenti as unknown as { cliente: string | null }).cliente,
        contenuto: c.contenuto?.slice(0, 1500) ?? "",
      }));
    }
  }
  return [];
}

/**
 * Risolve il modello da usare per la scheda tecnica.
 *
 * Priorità:
 *   1. `modello_scheda_tecnica` (specifico, se valorizzato)
 *   2. `modello_generazione`    (lo stesso modello della chat — default sensato)
 *   3. Fallback hard-coded a `anthropic/claude-haiku-4.5`
 *
 * Formato accettato (entrambi i campi):
 *   - `openrouter:provider/modello`
 *   - `provider/modello`           (auto-OpenRouter se contiene "/")
 *   - `gemini-...`                 (Gemini)
 */
function risolveModello(
  configSpecific: string | undefined,
  configFallback: string | undefined
): { provider: "openrouter" | "gemini"; model: string } {
  const candidate = configSpecific?.trim() || configFallback?.trim() || "openrouter:anthropic/claude-haiku-4.5";
  if (candidate.startsWith("openrouter:")) return { provider: "openrouter", model: candidate.slice("openrouter:".length) };
  if (candidate.includes("/")) return { provider: "openrouter", model: candidate };
  return { provider: "gemini", model: candidate };
}

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
    const systemSchedaTecnica = cfg.system_prompt_scheda_tecnica ?? "Sei un redattore tecnico SICS. Genera la scheda tecnica del preventivo.";
    const systemDomande = cfg.system_prompt_domande_scheda ?? "Formula domande JSON per raccogliere info mancanti.";

    // ─── Fase 1: decidiamo se servono domande o no ───────────────────────────
    const haRisposte = Array.isArray(body.risposte_domande) && body.risposte_domande.length > 0;
    const articoliCount = body.builder_state.totali.n_articoli;
    const isVuoto = articoliCount === 0 && body.builder_state.blocchi.length <= 1;

    // Triggers per Fase 1 "ask questions":
    //  - preventivo molto scarno (< 3 articoli, nessuna nota)
    //  - utente non ha ancora risposto e non forza
    const noteRicche = body.builder_state.blocchi.some((b) => b.note && b.note.length > 20);
    const dovrebbeChiedere = !haRisposte && !body.forza_generazione && (isVuoto || (articoliCount < 3 && !noteRicche));

    // Recupera esempi storici (per arricchire entrambe le fasi)
    const esempi = await recuperaEsempiStorici(body.builder_state, maxEsempi);

    if (dovrebbeChiedere) {
      // ─── Fase 1: chiedo domande ─────────────────────────────────────────────
      const userPrompt = [
        "Analizza questo stato del preventivo e i preventivi storici simili (se presenti).",
        "Decidi se le informazioni sono sufficienti per scrivere una scheda tecnica seria.",
        "Se NON sono sufficienti, restituisci il JSON con le domande mancanti come da istruzioni.",
        "",
        formatBuilderStateForPrompt(body.builder_state),
        "",
        esempi.length > 0
          ? `\nPreventivi storici simili (${esempi.length}):\n` +
            esempi.map((e) => `--- ${e.codice} (${e.cliente ?? "n/d"}) ---\n${e.contenuto}`).join("\n\n")
          : "Nessun preventivo storico simile trovato.",
      ].join("\n");

      const { content, usage } = await chiamaOpenRouter({
        model,
        systemPrompt: systemDomande,
        userPrompt,
        temperature: 0.2,
        maxTokens: 1024,
      });

      // Estraggo il JSON dalla risposta (anche se l'LLM dovesse aver aggiunto testo extra)
      let parsed: { tipo?: string; motivo?: string; domande?: Domanda[] } | null = null;
      try {
        const match = content.match(/\{[\s\S]*\}/);
        if (match) parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
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
      "Genera la SCHEDA TECNICA per il seguente preventivo, seguendo lo stile delle schede storiche fornite.",
      "Usa markdown ben strutturato (heading #/##, **grassetto**, tabelle | colonne | quando opportuno).",
      "",
      formatBuilderStateForPrompt(body.builder_state),
      "",
      haRisposte
        ? "\nINFORMAZIONI AGGIUNTIVE FORNITE DALL'UTENTE:\n" +
          body.risposte_domande!.map((r) => `- ${r.id}: ${r.risposta}`).join("\n")
        : "",
      esempi.length > 0
        ? `\nPREVENTIVI STORICI SIMILI (${esempi.length}) — usali come riferimento di stile:\n` +
          esempi.map((e) => `### ESEMPIO ${e.codice} (${e.cliente ?? "n/d"})\n${e.contenuto}`).join("\n\n")
        : "Nessun preventivo storico simile disponibile: basati ESCLUSIVAMENTE sui dati del builder.",
    ].join("\n");

    const { content: schedaMd, usage } = await chiamaOpenRouter({
      model,
      systemPrompt: systemSchedaTecnica,
      userPrompt: userPromptScheda,
      temperature,
      maxTokens: 4096,
    });

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
      console.warn("scheda-tecnica: insert audit fallito:", insErr);
    }

    return NextResponse.json({
      tipo: "scheda",
      contenuto_md: schedaMd,
      modello: model,
      provider: "openrouter",
      scheda_id: insertRow?.id ?? "",
    } satisfies SchedaResponse);
  } catch (err) {
    console.error("scheda-tecnica error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Errore generazione scheda tecnica" },
      { status: 500 }
    );
  }
}
