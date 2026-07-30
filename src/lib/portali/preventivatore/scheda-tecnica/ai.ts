// ─── Logica AI condivisa della scheda tecnica ────────────────────────────────
// Usata da: generazione (`/scheda-tecnica`), revisione in chat
// (`/scheda-tecnica/revisiona`) e approvazione (`/scheda-tecnica/approva`).

import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedEmbedding } from "@/lib/portali/preventivatore/chat/embedding-cache";
import type { BuilderStateForChat } from "@/lib/portali/preventivatore/chat/types";
import { logWarn } from "@/lib/logger";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

export type UsageAI = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
};

/** Modalità tracciate in `ai_usage_events` (CHECK esteso dalla migration 072). */
export type ModalitaUsage = "scheda_tecnica" | "scheda_domande" | "scheda_revisione";

/** Chiamata a OpenRouter con storico messaggi completo (supporta la chat di revisione). */
export async function chiamaOpenRouterChat(opts: {
  model: string;
  messages: ChatMsg[];
  temperature: number;
  maxTokens: number;
  title?: string;
}): Promise<{ content: string; usage: UsageAI | undefined }> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurata");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(120_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://intranet-sics.vercel.app",
      "X-Title": opts.title ?? "SICS Scheda Tecnica",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
      // Chiede a OpenRouter il costo reale della chiamata (contatore spesa AI).
      usage: { include: true },
    }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `OpenRouter HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    choices: Array<{ message: { content: string }; finish_reason?: string }>;
    usage?: UsageAI;
  };
  return { content: data.choices?.[0]?.message?.content ?? "", usage: data.usage };
}

/**
 * Registra la spesa in `ai_usage_events` così il contatore "Oggi / 30 gg"
 * include anche scheda tecnica e revisioni. Best-effort: non blocca mai la
 * risposta all'utente.
 */
export async function registraUsage(opts: {
  userId: string;
  model: string;
  modalita: ModalitaUsage;
  usage: UsageAI | undefined;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.schema("preventivatore").from("ai_usage_events").insert({
      user_id: opts.userId,
      sessione_id: null, // le schede non appartengono a una sessione di chat
      provider: "openrouter",
      model: opts.model,
      modalita: opts.modalita,
      prompt_tokens: opts.usage?.prompt_tokens ?? null,
      completion_tokens: opts.usage?.completion_tokens ?? null,
      total_tokens: opts.usage?.total_tokens ?? null,
      cost_amount: opts.usage?.cost ?? 0,
      currency: "usd",
      cost_source: opts.usage?.cost != null ? "exact" : "estimated",
    });
  } catch (e) {
    logWarn("preventivatore.scheda-tecnica", "registrazione usage fallita", { dettaglio: String(e) });
  }
}

/**
 * Risolve il modello da usare.
 * Priorità: `modello_scheda_tecnica` → `modello_generazione` → fallback.
 */
export function risolveModello(
  configSpecific: string | undefined,
  configFallback: string | undefined
): { provider: "openrouter" | "gemini"; model: string } {
  const candidate = configSpecific?.trim() || configFallback?.trim() || "openrouter:anthropic/claude-haiku-4.5";
  if (candidate.startsWith("openrouter:")) return { provider: "openrouter", model: candidate.slice("openrouter:".length) };
  if (candidate.includes("/")) return { provider: "openrouter", model: candidate };
  return { provider: "gemini", model: candidate };
}

/** Testo di ricerca che caratterizza il tipo di fornitura del preventivo corrente. */
export function queryRicercaDaBuilder(state: BuilderStateForChat): string {
  const tipi = [...new Set(state.blocchi.map((b) => b.tipo).filter(Boolean))];
  const descr = state.blocchi
    .flatMap((b) => b.articoli.map((a) => a.descrizione))
    .filter(Boolean)
    .slice(0, 30);
  return [state.titolo ?? "", tipi.join(", "), descr.join("; ")].filter(Boolean).join(". ").trim();
}

export type EsempioScheda = {
  etichetta: string;
  contenuto: string;
  /** true = scheda già approvata dall'utente (stile-target più affidabile). */
  approvata: boolean;
};

type MatchChunkRow = {
  documento_id: string;
  contenuto: string;
  metadata: Record<string, unknown> | null;
  similarity: number;
};

type MatchSchedaRow = {
  id: string;
  contenuto_md: string;
  titolo: string | null;
  cliente: string | null;
  n_revisioni: number;
  similarity: number;
};

/**
 * Esempi di riferimento per la generazione, in ordine di autorevolezza:
 *   1. schede APPROVATE dall'utente (loop di apprendimento, migration 072)
 *   2. schede storiche dai Word importati (`chunks` con ruolo_file=preventivo_commerciale)
 *
 * Le approvate hanno priorità: sono lo stile che l'azienda ha validato davvero.
 */
export async function recuperaEsempi(
  builderState: BuilderStateForChat,
  maxEsempi: number,
  soglia: number
): Promise<EsempioScheda[]> {
  const admin = createAdminClient();
  const queryText = queryRicercaDaBuilder(builderState);
  if (!queryText) return [];

  let queryEmbedding: number[];
  try {
    queryEmbedding = await getCachedEmbedding(queryText);
  } catch (e) {
    logWarn("preventivatore.scheda-tecnica", "embedding query fallito → nessun esempio", { dettaglio: String(e) });
    return [];
  }

  const esempi: EsempioScheda[] = [];

  // 1) Schede approvate (max metà dei posti, per non perdere varietà di stile)
  const quotaApprovate = Math.max(1, Math.ceil(maxEsempi / 2));
  try {
    const { data: approvate, error } = await admin
      .schema("preventivatore")
      .rpc("match_schede_approvate", {
        query_embedding: queryEmbedding,
        match_threshold: soglia,
        match_count: quotaApprovate,
      });
    if (error) throw new Error(error.message);
    for (const r of (approvate ?? []) as MatchSchedaRow[]) {
      esempi.push({
        etichetta: `SCHEDA APPROVATA${r.titolo ? ` — ${r.titolo}` : ""}${r.cliente ? ` (${r.cliente})` : ""}`,
        contenuto: (r.contenuto_md ?? "").slice(0, 6000),
        approvata: true,
      });
    }
  } catch (e) {
    logWarn("preventivatore.scheda-tecnica", "match_schede_approvate fallita", { dettaglio: String(e) });
  }

  // 2) Schede storiche dai Word (completano fino a maxEsempi)
  const restanti = maxEsempi - esempi.length;
  if (restanti > 0) {
    const { data, error } = await admin
      .schema("preventivatore")
      .rpc("match_chunks", { query_embedding: queryEmbedding, match_threshold: soglia, match_count: 30 });
    if (error) {
      logWarn("preventivatore.scheda-tecnica", "match_chunks fallito", { dettaglio: error.message });
    } else {
      const rows = (data ?? []) as MatchChunkRow[];
      const schede = rows.filter((r) => (r.metadata?.["ruolo_file"] as string | undefined) === "preventivo_commerciale");
      const scelti = (schede.length > 0 ? schede : rows).slice(0, restanti);

      const docIds = [...new Set(scelti.map((r) => r.documento_id))];
      const docMap = new Map<string, { codice: string; cliente: string | null }>();
      if (docIds.length > 0) {
        const { data: docs } = await admin
          .schema("preventivatore")
          .from("documenti")
          .select("id, codice, cliente")
          .in("id", docIds);
        for (const d of (docs ?? []) as Array<{ id: string; codice: string; cliente: string | null }>) {
          docMap.set(d.id, { codice: d.codice, cliente: d.cliente });
        }
      }

      for (const r of scelti) {
        const doc = docMap.get(r.documento_id);
        esempi.push({
          etichetta: `STORICO ${doc?.codice ?? "n/d"}${doc?.cliente ? ` (${doc.cliente})` : ""}`,
          contenuto: (r.contenuto ?? "").slice(0, 6000),
          approvata: false,
        });
      }
    }
  }

  return esempi;
}

/** Blocco testuale degli esempi da iniettare nel prompt utente. */
export function formattaEsempi(esempi: EsempioScheda[]): string {
  if (esempi.length === 0) return "Nessun esempio disponibile: basati ESCLUSIVAMENTE sui dati del builder.";
  const approvate = esempi.filter((e) => e.approvata).length;
  const intro =
    approvate > 0
      ? `ESEMPI DI RIFERIMENTO (${esempi.length}, di cui ${approvate} già APPROVATE dall'azienda: seguile con priorità):`
      : `ESEMPI DI RIFERIMENTO (${esempi.length}) — usali come riferimento di stile:`;
  return [intro, ...esempi.map((e) => `### ${e.etichetta}\n${e.contenuto}`)].join("\n\n");
}
