/**
 *
 * SCELTA DEL MODELLO E COSTI.
 *
 * Prezzi verificati sull'API di OpenRouter (dollari per milione di token,
 * ingresso/uscita). Non sono a memoria: vengono dal listino pubblico, e la
 * funzione `aggiornaPrezzi` li rilegge quando serve.
 *
 * Perché instradare invece di usare sempre il modello grande: la maggior parte
 * delle domande a un cruscotto sono lookup ("quanto ho fatturato a marzo"), su
 * cui un modello piccolo è indistinguibile e costa cinque volte meno. Le
 * domande che meritano il modello grande sono quelle in cui serve decidere
 * *come* analizzare, non solo leggere un numero.
 */

export interface Modello {
  id: string;
  nome: string;
  /** Dollari per milione di token in ingresso. */
  ingresso: number;
  /** Dollari per milione di token in uscita. */
  uscita: number;
  note: string;
}

/** Listino al 17/09/2026, letto da https://openrouter.ai/api/v1/models. */
export const MODELLI: Record<string, Modello> = {
  leggero: {
    id: "anthropic/claude-haiku-4.5",
    nome: "Haiku 4.5",
    ingresso: 1.0,
    uscita: 5.0,
    note: "Veloce ed economico. Adatto a letture dirette e riassunti.",
  },
  standard: {
    // Era Sonnet 4.5 (3,00 / 15,00). Sonnet 5 costa un terzo meno ED e' piu'
    // recente: restare sul 4.5 non aveva giustificazione ne' di prezzo ne' di
    // qualita'. Verificato sul listino OpenRouter il 17/09/2026.
    id: "anthropic/claude-sonnet-5",
    nome: "Sonnet 5",
    ingresso: 2.0,
    uscita: 10.0,
    note: "Ragionamento multi-passo: scomposizioni, confronti, previsioni.",
  },
  /**
   * NON COLLEGATO. Nessun punto del codice lo usa: `instrada()` sceglie fra
   * `leggero` e `standard`, e il briefing usa `leggero` (`analista.ts`).
   *
   * Resta qui perche' e' il candidato naturale del livello leggero — costa un
   * terzo di Haiku 4.5 — ma collegarlo e' una decisione da MISURARE, non da
   * prendere sul prezzo: nel confronto del 17/09/2026 Haiku ha prodotto cifre
   * non verificate su tutte e quattro le domande, e un modello piu' economico
   * che sbaglia di piu' non e' un risparmio. Il banco e'
   * `prototipo-bi/confronto-modelli-dal-vivo.ts`.
   */
  economico: {
    id: "google/gemini-2.5-flash",
    nome: "Gemini 2.5 Flash",
    ingresso: 0.3,
    uscita: 2.5,
    note: "Non collegato: candidato per il livello leggero, da misurare prima.",
  },
};

export type Complessita = "semplice" | "analitica" | "profonda";

export interface Instradamento {
  complessita: Complessita;
  modello: Modello;
  motivo: string;
  /** Passi massimi del ciclo di interrogazione concessi. */
  massimoPassi: number;
}

/**
 * Le radici coprono flessioni e plurali senza trasformare il routing in un
 * dizionario fragile: "andamenti" deve valere quanto "andamento".
 *
 * Si confrontano a INIZIO PAROLA, non ovunque nel testo. Con un semplice
 * `includes` la radice "cal" scattava dentro "fiscale", "locale" e
 * "calendario": non sbagliava le risposte — nel dubbio si sale — ma faceva
 * pagare il modello grande per domande che chiedono un numero solo. Le forme
 * di "calare" sono quindi elencate per esteso, che è meno elegante e più
 * onesto.
 */
const RADICI_ANALITICHE = [
  "andament",
  "anomal",
  "confront",
  "scostament",
  "variazion",
  "concentr",
  "evoluz",
  "trend",
  "crescit",
  "calo",
  "cali",
  "calat",
  "calan",
  "perdit",
  "perdend",
  "spieg",
  "analizz",
  "differenz",
  "rispetto a",
  "come mai",
  "perch",
];

const MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

function almenoDueCorrispondenze(testo: string, espressione: RegExp): boolean {
  return (testo.match(espressione) ?? []).length >= 2;
}

function haSegnaleStrutturale(domanda: string): boolean {
  const dueAnni = almenoDueCorrispondenze(domanda, /\b(?:19|20)\d{2}\b/gu);
  const dueMesi = MESI.filter((mese) => domanda.includes(mese)).length >= 2;
  const negazioneConAcquisto =
    /\b(?:non|senza|mai)\b/u.test(domanda) &&
    /\b(?:acquist\w*|compr\w*|ordin(?:ano|ava|avano|ato|ati|are|ato))\b/u.test(domanda);
  const superlativo =
    /(?:^|\s)(?:più|meno)(?=\s|$|[,.?!])/u.test(domanda) ||
    /\b(?:peggior\w*|miglior\w*|top|primi?\w*|ultimi?\w*)\b/u.test(domanda);
  const dimensioniNominate = [
    /\bclient\w*/u,
    /\bagent\w*/u,
    /\b(?:business unit|bu)\b/u,
    /\barticol\w*/u,
    /\bmes[ei]\b/u,
  ].filter((segnale) => segnale.test(domanda)).length;

  return dueAnni || dueMesi || negazioneConAcquisto || superlativo || dimensioniNominate > 1;
}

const SEGNALI_PROFONDI = [
  "previsione", "prevedi", "previsto", "stima", "stimi", "proiezione",
  "chiudere l'anno", "chiuderemo", "fine anno", "forecast",
  "scenario", "simula", "se ", "cosa succederebbe",
  "raccomanda", "consiglia", "cosa dovrei", "strategia",
  "report", "relazione", "documento",
];

/**
 * Sceglie il modello in base alla domanda.
 *
 * La classificazione è a parole chiave, non affidata a un modello: farla
 * decidere a un LLM significherebbe pagare una chiamata per decidere quanto
 * spendere nella chiamata successiva. Nel dubbio si sale di livello: sbagliare
 * verso il modello piccolo produce un'analisi debole, sbagliare verso quello
 * grande costa qualche centesimo.
 */
export function instrada(domanda: string, forzato?: Complessita): Instradamento {
  const d = domanda.toLowerCase();

  let complessita: Complessita = "semplice";
  // Confine di parola davanti alla radice: le espressioni con lo spazio
  // ("rispetto a", "come mai") restano cercate come sono.
  const colpita = (radice: string) =>
    radice.includes(" ") ? d.includes(radice) : new RegExp(`\\b${radice}`, "u").test(d);

  if (RADICI_ANALITICHE.some(colpita) || haSegnaleStrutturale(d)) {
    complessita = "analitica";
  }
  if (SEGNALI_PROFONDI.some((s) => d.includes(s))) complessita = "profonda";

  // Una domanda lunga contiene quasi sempre più richieste insieme.
  if (domanda.length > 220 && complessita === "semplice") complessita = "analitica";

  if (forzato) complessita = forzato;

  switch (complessita) {
    case "semplice":
      return {
        complessita,
        modello: MODELLI.leggero,
        motivo: "Lettura diretta di uno o due numeri: basta il modello veloce.",
        massimoPassi: 4,
      };
    case "analitica":
      return {
        complessita,
        modello: MODELLI.standard,
        motivo: "Richiede confronti e scomposizioni: serve ragionamento multi-passo.",
        massimoPassi: 8,
      };
    case "profonda":
      return {
        complessita,
        modello: MODELLI.standard,
        motivo:
          "Previsione, scenario o documento: il modello deve scegliere il metodo e giustificarlo.",
        massimoPassi: 12,
      };
  }
}

export interface Consumo {
  tokenIngresso: number;
  tokenUscita: number;
  costoUsd: number;
  /** Token d'ingresso serviti dalla cache, che si pagano un decimo. */
  tokenCache?: number;
  /** `true` se `costoUsd` e' l'importo addebitato da OpenRouter, non una stima. */
  costoDichiarato?: boolean;
}

/**
 * Costo di una domanda.
 *
 * Se OpenRouter dichiara il costo (`usage.cost`), si usa quello: e' l'importo
 * davvero addebitato. La moltiplicazione qui sotto resta come ripiego, ma e'
 * una STIMA PER ECCESSO da quando la cache del prompt e' accesa, perche'
 * `prompt_tokens` comprende anche i token riletti dalla cache, che costano un
 * decimo. Mostrare all'utente un numero calcolato da noi quando il fornitore ci
 * dice quello vero e' lo stesso errore del BEP che valeva l'ordinato: un numero
 * plausibile al posto di quello giusto.
 */
export function calcolaCosto(
  modello: Modello,
  ingresso: number,
  uscita: number,
  dichiarato?: number | null,
  tokenCache = 0
): Consumo {
  const stima = (ingresso / 1e6) * modello.ingresso + (uscita / 1e6) * modello.uscita;
  const costo = dichiarato != null && dichiarato > 0 ? dichiarato : stima;
  return {
    tokenIngresso: ingresso,
    tokenUscita: uscita,
    tokenCache,
    costoDichiarato: dichiarato != null && dichiarato > 0,
    // Sei decimali: una domanda singola costa frazioni di centesimo e
    // arrotondare a due la farebbe sembrare gratis.
    costoUsd: Math.round(costo * 1e6) / 1e6,
  };
}

/**
 * Rilegge i prezzi dal listino OpenRouter.
 * Da chiamare quando servono numeri aggiornati: i prezzi cambiano.
 */
export async function aggiornaPrezzi(): Promise<{ aggiornati: string[]; errore?: string }> {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models");
    if (!r.ok) return { aggiornati: [], errore: `OpenRouter ${r.status}` };
    const j = (await r.json()) as {
      data?: { id: string; pricing?: { prompt?: string; completion?: string } }[];
    };
    const aggiornati: string[] = [];
    for (const m of Object.values(MODELLI)) {
      const trovato = j.data?.find((x) => x.id === m.id);
      if (!trovato?.pricing) continue;
      m.ingresso = Number(trovato.pricing.prompt ?? 0) * 1e6;
      m.uscita = Number(trovato.pricing.completion ?? 0) * 1e6;
      aggiornati.push(m.id);
    }
    return { aggiornati };
  } catch (e) {
    return { aggiornati: [], errore: e instanceof Error ? e.message : "errore" };
  }
}
