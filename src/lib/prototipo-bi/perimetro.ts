/**
 * PERIMETRO DEI DATI — chi vede quali righe.
 *
 * Il principio, che vale la pena enunciare perché tutto il resto ne discende:
 * **il perimetro si applica al dato, non alla domanda.**
 *
 * L'alternativa sarebbe filtrare ogni query. Ma `esegui()` è chiamata da 65
 * punti diversi — rilevatori, briefing, documenti, export, analista — e ognuno
 * sarebbe un'occasione per dimenticarsene. Peggio: l'analista AI compone le
 * proprie query, quindi il filtro andrebbe difeso contro qualcosa che scrive
 * query da solo.
 *
 * Qui invece si filtra lo SNAPSHOT una volta sola, all'ingresso della richiesta.
 * Chi riceve lo snapshot perimetrato non può leggere righe fuori perimetro
 * perché quelle righe non esistono nell'oggetto che ha in mano. Non c'è un
 * controllo da aggirare: c'è un dato che non c'è.
 *
 * Sul perimetro per agente si filtra per CODICE, non per nome: i nomi si
 * scrivono in modi diversi nel gestionale, i codici no.
 */

import type { ChiaveDataset, RigaFatto, Snapshot } from "./tipi";

export type Perimetro =
  /** Nessuna restrizione: vede tutta l'azienda. */
  | { tipo: "tutto" }
  /** Vede solo le righe dei codici agente elencati. */
  | { tipo: "agente"; codici: string[] }
  /** Vede solo le righe delle business unit elencate. */
  | { tipo: "business_unit"; unita: string[] }
  /**
   * Non vede niente. È il default quando il perimetro non è configurato:
   * un utente senza riga di perimetro non deve vedere tutto per sbaglio.
   */
  | { tipo: "nessuno" };

export const PERIMETRO_TUTTO: Perimetro = { tipo: "tutto" };
export const PERIMETRO_NESSUNO: Perimetro = { tipo: "nessuno" };

/** Descrizione leggibile, da mostrare in interfaccia e scrivere nell'audit. */
export function descriviPerimetro(p: Perimetro): string {
  switch (p.tipo) {
    case "tutto":
      return "Tutta l'azienda";
    case "agente":
      return p.codici.length === 1
        ? `Solo agente ${p.codici[0]}`
        : `Solo agenti ${p.codici.join(", ")}`;
    case "business_unit":
      return `Solo ${p.unita.join(", ")}`;
    case "nessuno":
      return "Nessun dato";
  }
}

/** Vero se il perimetro lascia passare tutto: permette di saltare la copia. */
export function perimetroAperto(p: Perimetro): boolean {
  return p.tipo === "tutto";
}

/**
 * Predicato di riga. Restituisce `null` quando non c'è niente da filtrare,
 * così il chiamante può evitare di scorrere i dataset per nulla.
 */
export function predicatoPerimetro(p: Perimetro): ((r: RigaFatto) => boolean) | null {
  switch (p.tipo) {
    case "tutto":
      return null;

    case "nessuno":
      return () => false;

    case "agente": {
      // Confronto normalizzato: nel gestionale lo stesso codice compare con
      // spazi in coda e con maiuscole diverse.
      const ammessi = new Set(p.codici.map((c) => c.trim().toUpperCase()));
      return (r) => ammessi.has(String(r.codiceAgente ?? "").trim().toUpperCase());
    }

    case "business_unit": {
      const ammesse = new Set(p.unita.map((u) => u.trim().toUpperCase()));
      return (r) => ammesse.has(String(r.bu ?? "").trim().toUpperCase());
    }
  }
}

/**
 * Restituisce uno snapshot che contiene SOLO le righe del perimetro.
 *
 * Con perimetro aperto restituisce l'oggetto originale senza copiarlo: è il
 * caso della direzione, e non deve costare niente.
 *
 * I conteggi vengono ricalcolati sulle righe rimaste: lasciare i conteggi
 * originali farebbe dire all'interfaccia "18.000 righe" a chi ne vede 400, e
 * il numero sbagliato è peggio di nessun numero.
 */
export function applicaPerimetro(snapshot: Snapshot, perimetro: Perimetro): Snapshot {
  const predicato = predicatoPerimetro(perimetro);
  if (!predicato) return snapshot;

  const dataset = {} as Snapshot["dataset"];
  const conteggi: Record<string, number> = {};

  for (const chiave of Object.keys(snapshot.dataset) as ChiaveDataset[]) {
    const filtrate = (snapshot.dataset[chiave] ?? []).filter(predicato);
    dataset[chiave] = filtrate;
    conteggi[chiave] = filtrate.length;
  }

  // Gli acquisti non hanno agente ne' business unit: con un perimetro ristretto
  // non c'e' una parte che spetti, e il default sicuro e' niente.
  return { ...snapshot, dataset, conteggi, acquisti: snapshot.acquisti ? [] : undefined };
}

/**
 * Il perimetro di un utente.
 *
 * Oggi la fonte è il livello sul portale: la direzione vede tutto, gli altri
 * vedono il proprio codice agente. Quando arriverà la tabella
 * `bi.perimetro_utente` (migration 103) questa funzione diventerà una lettura
 * da database e nessun chiamante se ne accorgerà.
 *
 * Regola che non va allentata: **in assenza di informazioni si restituisce
 * `nessuno`**, mai `tutto`. Un perimetro mancante è un errore di
 * configurazione, e un errore di configurazione non deve aprire i dati.
 */
export function risolviPerimetro(opzioni: {
  livello: "direzione" | "responsabile" | "operativo";
  /** Codici agente associati all'utente. Vuoto se non è un commerciale. */
  codiciAgente?: string[];
  /** Business unit di competenza, per i responsabili di BU. */
  businessUnit?: string[];
}): Perimetro {
  if (opzioni.livello === "direzione") return PERIMETRO_TUTTO;

  const codici = (opzioni.codiciAgente ?? []).filter((c) => c.trim() !== "");
  if (codici.length > 0) return { tipo: "agente", codici };

  const unita = (opzioni.businessUnit ?? []).filter((u) => u.trim() !== "");
  if (unita.length > 0) return { tipo: "business_unit", unita };

  // Nessun perimetro configurato: chiuso, non aperto.
  return PERIMETRO_NESSUNO;
}
