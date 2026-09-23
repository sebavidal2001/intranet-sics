/**
 * Il minimo che serve per parlare con OpenRouter da server.
 *
 * Il portale ci passa già per la chat del Preventivatore; qui c'è la parte
 * multimodale — immagini dentro, JSON fuori — e le due letture di servizio che
 * la pagina del superadmin mostra: quali modelli esistono e quanto credito
 * resta. Sapere il credito prima di lanciare trenta fatture evita di scoprire a
 * metà lavoro che si è esaurito.
 */

const BASE = "https://openrouter.ai/api/v1";

export class ErroreOpenRouter extends Error {
  constructor(
    message: string,
    readonly stato: number,
    readonly ripetibile: boolean
  ) {
    super(message);
    this.name = "ErroreOpenRouter";
  }
}

function chiave(): string {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) {
    throw new ErroreOpenRouter(
      "OPENROUTER_API_KEY non è configurata sul server.",
      0,
      false
    );
  }
  return k;
}

export function chiaveConfigurata(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export interface ModelloOpenRouter {
  id: string;
  nome: string;
  vedeImmagini: boolean;
  /** Dollari per milione di token, come li espone OpenRouter. */
  prezzoIngresso: number | null;
  prezzoUscita: number | null;
  contesto: number | null;
}

/**
 * L'elenco dei modelli è pubblico e non consuma credito: la pagina del
 * superadmin lo usa per proporre una scelta fra quello che esiste davvero
 * oggi, invece di un campo di testo in cui sbagliare a scrivere l'identificativo.
 */
export async function elencoModelli(): Promise<ModelloOpenRouter[]> {
  const risposta = await fetch(`${BASE}/models`, {
    headers: { "Content-Type": "application/json" },
    next: { revalidate: 3600 },
  });
  if (!risposta.ok) {
    throw new ErroreOpenRouter(
      `Elenco modelli non disponibile (${risposta.status}).`,
      risposta.status,
      risposta.status >= 500
    );
  }
  const corpo = (await risposta.json()) as {
    data?: Array<{
      id: string;
      name?: string;
      context_length?: number;
      architecture?: { input_modalities?: string[] };
      pricing?: { prompt?: string; completion?: string };
    }>;
  };

  const perMilione = (v: string | undefined): number | null => {
    const n = Number(v);
    // OpenRouter usa -1 per i modelli a prezzo variabile (come «auto»).
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000 * 1000) / 1000 : null;
  };

  return (corpo.data ?? []).map((m) => ({
    id: m.id,
    nome: m.name ?? m.id,
    vedeImmagini: (m.architecture?.input_modalities ?? []).includes("image"),
    prezzoIngresso: perMilione(m.pricing?.prompt),
    prezzoUscita: perMilione(m.pricing?.completion),
    contesto: m.context_length ?? null,
  }));
}

export interface CreditoOpenRouter {
  totale: number;
  usato: number;
  residuo: number;
}

export async function credito(): Promise<CreditoOpenRouter> {
  const risposta = await fetch(`${BASE}/credits`, {
    headers: { Authorization: `Bearer ${chiave()}` },
    cache: "no-store",
  });
  if (!risposta.ok) {
    throw new ErroreOpenRouter(
      `Credito non leggibile (${risposta.status}).`,
      risposta.status,
      risposta.status >= 500
    );
  }
  const corpo = (await risposta.json()) as {
    data?: { total_credits?: number; total_usage?: number };
  };
  const totale = corpo.data?.total_credits ?? 0;
  const usato = corpo.data?.total_usage ?? 0;
  return { totale, usato, residuo: Math.round((totale - usato) * 1e6) / 1e6 };
}

export interface RispostaVisione {
  /** Il JSON restituito dal modello, già interpretato. */
  contenuto: unknown;
  modello: string;
  tokenIngresso: number | null;
  tokenUscita: number | null;
  /** Dollari, quando OpenRouter li dichiara. */
  costo: number | null;
  millisecondi: number;
}

/**
 * Manda immagini a un modello e si fa restituire JSON conforme allo schema.
 *
 * Lo schema non è un vezzo: senza, un modello che non trova un valore tende a
 * scrivere una frase al posto del numero, e il chiamante deve indovinare. Con
 * lo schema o arriva un numero o arriva `null`.
 */
export async function chiediVisione(opzioni: {
  modello: string;
  istruzioni: string;
  immagini: Uint8Array[];
  schema: Record<string, unknown>;
  timeoutMs?: number;
  massimoToken?: number;
}): Promise<RispostaVisione> {
  const inizio = Date.now();
  const controllo = new AbortController();
  const scadenza = setTimeout(() => controllo.abort(), opzioni.timeoutMs ?? 120_000);

  try {
    const risposta = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: controllo.signal,
      headers: {
        Authorization: `Bearer ${chiave()}`,
        "Content-Type": "application/json",
        // OpenRouter li usa per le statistiche di consumo del portale. Solo
        // ASCII: un header HTTP è una ByteString, e un trattino lungo fa
        // fallire la richiesta prima ancora di partire — con un messaggio che
        // parla di «character at index 14» e non somiglia alla sua causa.
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://intranet.sics.local",
        "X-Title": "Intranet SICS - lettura fatture vettori",
      },
      body: JSON.stringify({
        model: opzioni.modello,
        temperature: 0,
        /**
         * Un tetto ai token della risposta, e non è solo igiene.
         *
         * OpenRouter riserva il credito per il **massimo** che la richiesta
         * potrebbe consumare: senza questo limite chiede quanto il modello sa
         * produrre — 65.536 token — e rifiuta la chiamata se sul conto non c'è
         * abbastanza da coprirli, anche quando la risposta vera ne userà tremila.
         * Con un credito piccolo è la differenza fra funzionare e non partire.
         */
        max_tokens: opzioni.massimoToken ?? 8000,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: opzioni.istruzioni },
              ...opzioni.immagini.map((png) => ({
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
                },
              })),
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "fattura", strict: true, schema: opzioni.schema },
        },
        usage: { include: true },
      }),
    });

    const corpo = (await risposta.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      error?: { message?: string };
    };

    if (!risposta.ok) {
      const messaggio = corpo.error?.message ?? `errore ${risposta.status}`;
      throw new ErroreOpenRouter(
        `Il modello ${opzioni.modello} non ha risposto: ${messaggio}`,
        risposta.status,
        risposta.status === 429 || risposta.status >= 500
      );
    }

    const testo = corpo.choices?.[0]?.message?.content;
    if (!testo) {
      throw new ErroreOpenRouter(
        `Il modello ${opzioni.modello} ha risposto senza contenuto.`,
        risposta.status,
        true
      );
    }

    let contenuto: unknown;
    try {
      contenuto = JSON.parse(testo);
    } catch {
      throw new ErroreOpenRouter(
        `Il modello ${opzioni.modello} ha risposto qualcosa che non è JSON.`,
        risposta.status,
        true
      );
    }

    return {
      contenuto,
      modello: opzioni.modello,
      tokenIngresso: corpo.usage?.prompt_tokens ?? null,
      tokenUscita: corpo.usage?.completion_tokens ?? null,
      costo: corpo.usage?.cost ?? null,
      millisecondi: Date.now() - inizio,
    };
  } catch (e) {
    if (e instanceof ErroreOpenRouter) throw e;
    if (e instanceof Error && e.name === "AbortError") {
      throw new ErroreOpenRouter(
        `Il modello ${opzioni.modello} non ha risposto entro il tempo previsto.`,
        0,
        true
      );
    }
    throw new ErroreOpenRouter(
      `Chiamata a ${opzioni.modello} fallita: ${e instanceof Error ? e.message : String(e)}`,
      0,
      true
    );
  } finally {
    clearTimeout(scadenza);
  }
}
