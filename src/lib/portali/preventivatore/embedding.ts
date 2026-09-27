import { loadAiConfig } from "./chat/config-cache";

export const DIMENSIONE_EMBEDDING = 3072;

// Tutta l'AI passa da OpenRouter (27/09/2026). Il modello è lo stesso
// gemini-embedding-2 di Google: verificato ricalcolando chunk già indicizzati
// via Google diretto, coseno 1,00000 — i vettori esistenti restano validi.
const MODELLO_DEFAULT = "google/gemini-embedding-2-preview";
const TIMEOUT_MS = 20_000;
const MAX_CARATTERI = 30_000;

export function validaVettoreEmbedding(valore: unknown): number[] {
  if (
    !Array.isArray(valore) ||
    valore.length !== DIMENSIONE_EMBEDDING ||
    !valore.every((numero): numero is number => typeof numero === "number" && Number.isFinite(numero))
  ) {
    const dimensione = Array.isArray(valore) ? valore.length : "non-array";
    throw new Error(
      `Embedding non valido: attesi ${DIMENSIONE_EMBEDDING} numeri finiti, ricevuti ${dimensione}`
    );
  }
  return valore;
}

async function calcolaConOpenRouter(testo: string, modello: string): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY non configurata");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://intranet.s-ics.com",
        "X-Title": "SICS preventivatore embedding",
      },
      body: JSON.stringify({ model: modello, input: testo }),
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`OpenRouter embedding HTTP ${response.status}`);
    }
    const vettore = (payload as { data?: Array<{ embedding?: unknown }> } | null)?.data?.[0]?.embedding;
    return validaVettoreEmbedding(vettore);
  } finally {
    clearTimeout(timer);
  }
}

/** ID OpenRouter dal valore di `ai_config.modello_embedding` (accetta il prefisso `openrouter:`). */
export function modelloEmbeddingOpenRouter(valore: string | null | undefined): string {
  const v = (valore ?? "").trim().replace(/^openrouter:/, "");
  // Il vecchio valore "gemini-embedding-2" era l'ID Google: su OpenRouter è lo stesso modello.
  if (!v || v === "gemini-embedding-2") return MODELLO_DEFAULT;
  return v;
}

export async function calcolaEmbedding(
  testo: string
): Promise<{ vettore: number[]; modello: string }> {
  const contenuto = testo.trim().slice(0, MAX_CARATTERI);
  if (!contenuto) throw new Error("Testo embedding vuoto");

  const config = await loadAiConfig();
  const modello = modelloEmbeddingOpenRouter(config.modello_embedding);
  // Prima Gemini diretto faceva da riserva: ora un 429/5xx momentaneo si ritenta.
  let ultimoErrore: unknown;
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      return { vettore: await calcolaConOpenRouter(contenuto, modello), modello };
    } catch (errore) {
      ultimoErrore = errore;
      const temporaneo = errore instanceof Error && /HTTP (429|5\d\d)|abort|fetch failed/i.test(errore.message);
      if (!temporaneo || tentativo === 3) break;
      await new Promise((r) => setTimeout(r, 800 * tentativo));
    }
  }
  throw ultimoErrore;
}
