/**
 * Listini fornitore: tracciati rigidi, validazione del file e parsing.
 *
 * Scelta di fondo: il formato di ogni fornitore è **fissato qui nel codice**, non
 * configurabile da chi carica. Un listino sbagliato non dà errore — dà prezzi
 * sbagliati, silenziosamente, su tutti i preventivi. Meglio rifiutare un file che
 * non corrisponde al tracciato atteso che lasciare scegliere le colonne a mano.
 *
 * Aggiungere un fornitore = aggiungere una voce a TRACCIATI, dopo aver visto il
 * suo file reale. Finché il file non c'è, il fornitore resta `null` (dichiarato
 * ma non configurato) e il caricamento viene rifiutato con un messaggio chiaro.
 *
 * Nessuna dipendenza da React/Supabase: la stessa validazione gira nel browser
 * (per mostrare il rapporto) e nel route handler (che non si fida del client).
 */

export interface TracciatoListino {
  /** Etichetta mostrata nella UI. */
  etichetta: string;
  /** Colonna (lettera Excel) con il codice articolo. */
  colonnaCodice: string;
  /** Colonna con la descrizione. Stringa vuota = il file non la porta. */
  colonnaDescrizione: string;
  /** Colonna con il prezzo da cui si ricava il costo. */
  colonnaPrezzo: string;
  /** Divisore applicato al prezzo per ottenere il costo di preventivazione. */
  divisore: number;
  /**
   * Testi che devono comparire da qualche parte nelle prime righe del foglio.
   * È il controllo che distingue "il file giusto" da "un altro Excel qualsiasi":
   * confronto senza maiuscole/spazi.
   */
  intestazioniAttese: string[];
  /** Sotto questo numero di voci il file è considerato incompleto o sbagliato. */
  minVociAttese: number;
  /** Come descrivere il file atteso quando la validazione fallisce. */
  descrizioneFormato: string;
}

/**
 * Fornitori gestiti. `null` = il fornitore esiste ma il suo tracciato non è
 * ancora stato definito (manca il file di riferimento): il caricamento si
 * rifiuta invece di indovinare le colonne.
 */
export const TRACCIATI: Record<string, TracciatoListino | null> = {
  DORNER: {
    etichetta: "Dorner (FlexMove)",
    colonnaCodice: "B",
    colonnaDescrizione: "C",
    colonnaPrezzo: "R",
    divisore: 2,
    intestazioniAttese: ["FlexMove Part #", "Item Description"],
    minVociAttese: 100,
    descrizioneFormato:
      "listino Dorner/FlexMove: codice in colonna B, descrizione in C, prezzo in R (diviso 2)",
  },
  // Alusic usa un tracciato diverso da Dorner e il file non è ancora arrivato.
  // Finché resta null il caricamento viene bloccato con un messaggio esplicito.
  ALUSIC: null,
};

export const FORNITORI_DISPONIBILI = Object.keys(TRACCIATI);

export interface VoceListino {
  codice: string;
  descrizione: string | null;
  prezzo_origine: number;
  costo: number;
  riga_file: number;
}

export type GravitaProblema = "errore" | "avviso";

export interface Problema {
  gravita: GravitaProblema;
  /** Codice stabile del controllo, utile nei log e nei test. */
  codice: string;
  messaggio: string;
  /** Cosa fare per risolvere, quando c'è una risposta utile. */
  azione?: string;
}

export interface EsitoValidazione {
  /** true solo se non c'è nessun problema di gravità "errore". */
  ok: boolean;
  fornitore: string | null;
  nomeFoglio: string | null;
  problemi: Problema[];
  /** Passi eseguiti, in ordine: è il log che l'utente vede prima di confermare. */
  log: string[];
  voci: VoceListino[];
  righe_lette: number;
  righe_scartate: number;
  /** Codici presenti più volte nel file con prezzi diversi: vince l'ultima riga. */
  codici_in_conflitto: string[];
}

/**
 * UPPER(codice) senza spazi e punteggiatura — stessa regola di
 * `prodotti.codice_norm`, così il match col listino funziona anche quando il
 * fornitore scrive "FAHBS-40" e il gestionale "FAHBS 40".
 */
export function normalizzaCodice(codice: string): string {
  return codice.trim().replace(/[\s.\-_/\\*?]+/g, "").toUpperCase();
}

/** "A" → 0, "B" → 1, "R" → 17, "AA" → 26. */
export function letteraToIndice(lettera: string): number {
  const s = lettera.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(s)) return -1;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Converte in numero un valore di cella: accetta già-numeri, "1.234,56",
 * "€ 12,50", "1,234.56". Restituisce null se non è un numero utilizzabile.
 */
export function cellaToNumero(valore: unknown): number | null {
  if (typeof valore === "number") return Number.isFinite(valore) ? valore : null;
  if (typeof valore !== "string") return null;

  let s = valore.replace(/[€$\s ]/g, "").trim();
  if (!s) return null;

  const virgola = s.lastIndexOf(",");
  const punto = s.lastIndexOf(".");
  if (virgola > -1 && punto > -1) {
    // Il separatore decimale è quello più a destra; l'altro è delle migliaia.
    if (virgola > punto) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (virgola > -1) {
    s = s.replace(",", ".");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Confronto "morbido" per le intestazioni: ignora maiuscole, spazi e simboli. */
function appiattisci(v: unknown): string {
  return String(v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Valida un foglio contro il tracciato del fornitore e, se regge, ne estrae le
 * voci. Restituisce SEMPRE un esito completo (problemi + log), anche quando
 * fallisce: è il rapporto che l'utente legge prima di confermare.
 *
 * @param righe      righe grezze del foglio (array di array, SheetJS `header: 1`)
 * @param fornitore  chiave di TRACCIATI, oppure "" se non è stato scelto
 * @param nomeFoglio nome del foglio letto, solo per il log
 */
export function validaEParsa(
  righe: unknown[][],
  fornitore: string,
  nomeFoglio: string | null = null
): EsitoValidazione {
  const problemi: Problema[] = [];
  const log: string[] = [];
  const vuoto = (p: Problema[]): EsitoValidazione => ({
    ok: false,
    fornitore: fornitore || null,
    nomeFoglio,
    problemi: p,
    log,
    voci: [],
    righe_lette: righe.length,
    righe_scartate: righe.length,
    codici_in_conflitto: [],
  });

  // ── 1) Fornitore scelto e configurato ──────────────────────────────────────
  const chiave = fornitore.trim().toUpperCase();
  if (!chiave) {
    problemi.push({
      gravita: "errore",
      codice: "fornitore_mancante",
      messaggio: "Non hai selezionato il fornitore.",
      azione: "Scegli il fornitore dall'elenco: ogni fornitore ha un formato di file diverso.",
    });
    return vuoto(problemi);
  }
  if (!(chiave in TRACCIATI)) {
    problemi.push({
      gravita: "errore",
      codice: "fornitore_sconosciuto",
      messaggio: `Fornitore "${fornitore}" non gestito.`,
      azione: `Fornitori disponibili: ${FORNITORI_DISPONIBILI.join(", ")}.`,
    });
    return vuoto(problemi);
  }
  const tracciato = TRACCIATI[chiave];
  if (!tracciato) {
    problemi.push({
      gravita: "errore",
      codice: "tracciato_non_configurato",
      messaggio: `Il formato del listino ${chiave} non è ancora configurato.`,
      azione:
        "Serve prima un file di esempio del fornitore per fissare le colonne. Finché non c'è, il caricamento resta bloccato: importarlo alla cieca produrrebbe costi sbagliati.",
    });
    return vuoto(problemi);
  }
  log.push(`Fornitore: ${tracciato.etichetta}`);
  log.push(`Formato atteso: ${tracciato.descrizioneFormato}`);
  if (nomeFoglio) log.push(`Foglio letto: "${nomeFoglio}" — ${righe.length} righe`);

  // ── 2) Il foglio contiene qualcosa ─────────────────────────────────────────
  if (righe.length === 0) {
    problemi.push({
      gravita: "errore",
      codice: "foglio_vuoto",
      messaggio: "Il foglio è vuoto.",
      azione: "Controlla di aver salvato il file con i dati nel primo foglio.",
    });
    return vuoto(problemi);
  }

  // ── 3) Le intestazioni sono quelle del listino atteso ──────────────────────
  // Guardo solo le prime 15 righe: le intestazioni stanno lì, e questo evita che
  // un file completamente diverso passi solo perché contiene quelle parole più giù.
  const testa = righe.slice(0, 15).flat().map(appiattisci);
  const mancanti = tracciato.intestazioniAttese.filter(
    (att) => !testa.some((c) => c.includes(appiattisci(att)))
  );
  if (mancanti.length > 0) {
    problemi.push({
      gravita: "errore",
      codice: "struttura_diversa",
      messaggio: `Il foglio non ha la struttura del listino ${tracciato.etichetta}: mancano le intestazioni ${mancanti.map((m) => `"${m}"`).join(", ")}.`,
      azione: `Attese nelle prime righe: ${tracciato.intestazioniAttese.map((i) => `"${i}"`).join(", ")}. Verifica di aver scelto il fornitore giusto e di non aver caricato un file di un altro marchio o un foglio rielaborato.`,
    });
    return vuoto(problemi);
  }
  log.push(`Intestazioni riconosciute: ${tracciato.intestazioniAttese.join(", ")}`);

  // ── 4) Estrazione voci ─────────────────────────────────────────────────────
  const iCod = letteraToIndice(tracciato.colonnaCodice);
  const iDes = tracciato.colonnaDescrizione ? letteraToIndice(tracciato.colonnaDescrizione) : -1;
  const iPre = letteraToIndice(tracciato.colonnaPrezzo);

  const perCodice = new Map<string, VoceListino>();
  const conflitti = new Set<string>();
  let scartate = 0;

  righe.forEach((riga, idx) => {
    const rawCodice = riga?.[iCod];
    const codice = rawCodice == null ? "" : String(rawCodice).trim();
    const prezzo = cellaToNumero(riga?.[iPre]);

    // Righe senza codice o senza prezzo numerico: intestazioni e titoli di
    // sezione. Si saltano, così non serve dichiarare la prima riga di dati.
    if (!codice || prezzo == null || prezzo <= 0) {
      scartate++;
      return;
    }
    const chiaveCod = normalizzaCodice(codice);
    if (!chiaveCod) {
      scartate++;
      return;
    }

    const rawDesc = iDes >= 0 ? riga?.[iDes] : null;
    const descrizione = rawDesc == null ? null : String(rawDesc).trim() || null;
    const costo = Math.round((prezzo / tracciato.divisore) * 10000) / 10000;

    const esistente = perCodice.get(chiaveCod);
    if (esistente && Math.abs(esistente.costo - costo) > 0.0001) conflitti.add(codice);

    perCodice.set(chiaveCod, {
      codice,
      descrizione,
      prezzo_origine: prezzo,
      costo,
      riga_file: idx + 1,
    });
  });

  const voci = Array.from(perCodice.values());
  log.push(
    `Colonne ${tracciato.colonnaCodice} / ${tracciato.colonnaDescrizione || "—"} / ${tracciato.colonnaPrezzo}` +
      (tracciato.divisore !== 1 ? ` — prezzo diviso ${tracciato.divisore}` : "")
  );
  log.push(`${voci.length} codici estratti · ${scartate} righe ignorate (intestazioni e titoli di sezione)`);

  // ── 5) Il risultato è plausibile ───────────────────────────────────────────
  if (voci.length === 0) {
    problemi.push({
      gravita: "errore",
      codice: "nessuna_voce",
      messaggio: "Nessun codice valido trovato nel foglio.",
      azione: `Le intestazioni corrispondono ma le colonne ${tracciato.colonnaCodice}/${tracciato.colonnaPrezzo} sono vuote o non numeriche: probabilmente il file è stato rielaborato o filtrato.`,
    });
    return { ...vuoto(problemi), righe_scartate: scartate };
  }
  if (voci.length < tracciato.minVociAttese) {
    problemi.push({
      gravita: "errore",
      codice: "troppe_poche_voci",
      messaggio: `Solo ${voci.length} codici validi: un listino ${tracciato.etichetta} completo ne ha almeno ${tracciato.minVociAttese}.`,
      azione: "Sembra un estratto parziale. Carica il listino completo, altrimenti gli articoli mancanti resterebbero al costo del gestionale.",
    });
  }

  // ── 6) Avvisi: non bloccano, ma vanno visti prima di confermare ────────────
  if (conflitti.size > 0) {
    problemi.push({
      gravita: "avviso",
      codice: "codici_duplicati",
      messaggio: `${conflitti.size} codici compaiono più volte con prezzi diversi: ${Array.from(conflitti).slice(0, 5).join(", ")}${conflitti.size > 5 ? "…" : ""}.`,
      azione: "Per ognuno viene tenuto il prezzo dell'ultima riga del file.",
    });
  }
  const quotaScartata = righe.length > 0 ? scartate / righe.length : 0;
  if (quotaScartata > 0.5) {
    problemi.push({
      gravita: "avviso",
      codice: "molte_righe_ignorate",
      messaggio: `Ignorata più della metà delle righe (${scartate} su ${righe.length}).`,
      azione: "Normale se il file ha molte righe di sezione, sospetto se ti aspettavi più codici.",
    });
  }

  const ok = !problemi.some((p) => p.gravita === "errore");
  if (ok) log.push("Controlli superati: il file corrisponde al tracciato.");

  return {
    ok,
    fornitore: chiave,
    nomeFoglio,
    problemi,
    log,
    voci,
    righe_lette: righe.length,
    righe_scartate: scartate,
    codici_in_conflitto: Array.from(conflitti),
  };
}
