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

/**
 * Listini che riportano il prezzo di LISTINO lordo e lasciano lo sconto di
 * acquisto alla categoria commerciale del gestionale (Alusic). Il costo è
 * prezzo × Π(1 − sconto/100); le fasce stanno qui, nel codice, perché cambiarle è
 * una decisione di acquisto, non un'impostazione da pannello.
 */
export interface ScontoPerCategoria {
  /** Colonna con il codice della categoria commerciale (es. "ALUS/100"). */
  colonnaCategoria: string;
  /** Colonna con la descrizione della categoria, che porta la fascia scritta a parole. */
  colonnaDescrizioneCategoria: string;
  /**
   * Sconti a cascata in % per categoria: [30, 10] = 30% poi 10%. Lista vuota =
   * prezzo già netto. Una categoria assente da qui blocca il caricamento.
   */
  fasce: Record<string, number[]>;
}

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
  /** Se presente, il costo è il prezzo scontato secondo la categoria della riga. */
  sconto?: ScontoPerCategoria;
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
  // Alusic: esportazione del listino del gestionale (26/10/2026). "Prezzo" (G) è il
  // listino lordo; la fascia di sconto non è una colonna ma sta nel nome della
  // categoria commerciale (J/K). Verificato sull'UC del gestionale: il rapporto
  // UC/prezzo non supera mai la fascia (es. ALUS/004 max 0,551 contro 0,55).
  // ALUS/001 «60% (ex 60+5%)»: vale 60, il «ex» indica la fascia precedente.
  ALUSIC: {
    etichetta: "Alusic",
    colonnaCodice: "B",
    colonnaDescrizione: "C",
    colonnaPrezzo: "G",
    divisore: 1,
    sconto: {
      colonnaCategoria: "J",
      colonnaDescrizioneCategoria: "K",
      fasce: {
        "ALUS/001": [60],
        "ALUS/003": [50],
        "ALUS/004": [45],
        "ALUS/005": [60],
        "ALUS/100": [50],
        "ALUS/200": [50],
        "ALUS/400": [30, 10],
        "ALUS/600": [50],
        "WURT/001": [], // «WURTH netto»: prezzo già netto
      },
    },
    intestazioniAttese: ["Codice Cat.Comm.", "Descrizione Cat. Comm.", "Prezzo Minimo"],
    minVociAttese: 300,
    descrizioneFormato:
      "listino Alusic esportato dal gestionale: codice in colonna B, descrizione in C, prezzo di listino in G, categoria commerciale in J/K (la fascia di sconto si ricava dalla categoria)",
  },
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

/** Fattore di costo di una fascia a cascata: [30, 10] → 0,63. */
export function fattoreSconto(fascia: number[]): number {
  return fascia.reduce((f, pct) => f * (1 - pct / 100), 1);
}

/**
 * Fascia scritta nel nome della categoria: "ALUSIC acessori (50%)" → [50],
 * "(30+10%)" → [30, 10], "60% (ex 60+5%)" → [60] (vale la prima), "WURTH netto" → [].
 * Serve da controllo incrociato con le fasce fissate nel tracciato: se Alusic
 * cambia lo sconto di una categoria il nome cambia e il caricamento si ferma.
 */
export function fasciaDaDescrizione(desc: string): number[] {
  const m = desc.match(/(\d+(?:[.,]\d+)?(?:\s*\+\s*\d+(?:[.,]\d+)?)*)\s*%/);
  if (!m) return [];
  return m[1].split("+").map((n) => Number(n.replace(",", ".")));
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
  const categorieIgnote = new Map<string, number>();
  const categorieCambiate = new Map<string, string>();
  const categorieViste = new Map<string, { fascia: number[]; n: number }>();
  const sconto = tracciato.sconto;
  const iCat = sconto ? letteraToIndice(sconto.colonnaCategoria) : -1;
  const iDesCat = sconto ? letteraToIndice(sconto.colonnaDescrizioneCategoria) : -1;
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
    let costo = prezzo / tracciato.divisore;
    if (sconto) {
      const cat = String(riga?.[iCat] ?? "").trim();
      const nomeCat = String(riga?.[iDesCat] ?? "").trim();
      const fascia = sconto.fasce[cat];
      if (!fascia) {
        const k = cat || "(vuota)";
        categorieIgnote.set(k, (categorieIgnote.get(k) ?? 0) + 1);
        scartate++;
        return;
      }
      if (fasciaDaDescrizione(nomeCat).join("+") !== fascia.join("+")) {
        categorieCambiate.set(cat, `${nomeCat} (nel codice: ${fascia.join("+") || "netto"}%)`);
        scartate++;
        return;
      }
      costo *= fattoreSconto(fascia);
      categorieViste.set(cat, { fascia, n: (categorieViste.get(cat)?.n ?? 0) + 1 });
    }
    costo = Math.round(costo * 10000) / 10000;

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
      (tracciato.divisore !== 1 ? ` — prezzo diviso ${tracciato.divisore}` : "") +
      (sconto ? " — prezzo di listino scontato per categoria" : "")
  );
  if (sconto) {
    const righeCat = Array.from(categorieViste.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([c, v]) => `${c}: ${v.fascia.length ? v.fascia.join("+") + "%" : "netto"} (${v.n})`);
    log.push(`Sconto per categoria — ${righeCat.join(" · ")}`);
  }
  log.push(`${voci.length} codici estratti · ${scartate} righe ignorate (intestazioni e titoli di sezione)`);

  if (categorieIgnote.size > 0) {
    problemi.push({
      gravita: "errore",
      codice: "categoria_senza_sconto",
      messaggio: `Categorie commerciali senza fascia di sconto nel tracciato: ${Array.from(categorieIgnote.entries()).map(([c, n]) => `${c} (${n} righe)`).join(", ")}.`,
      azione: "Il costo di questi articoli non si può ricavare: aggiungi la fascia in TRACCIATI (listini.ts) dopo averla confermata con l'ufficio acquisti.",
    });
  }
  if (categorieCambiate.size > 0) {
    problemi.push({
      gravita: "errore",
      codice: "sconto_categoria_cambiato",
      messaggio: `Il nome della categoria non coincide con la fascia fissata nel tracciato: ${Array.from(categorieCambiate.entries()).map(([c, d]) => `${c} → ${d}`).join("; ")}.`,
      azione: "Probabilmente Alusic ha cambiato lo sconto di quella categoria: aggiorna la fascia in TRACCIATI dopo averla verificata, poi ricarica.",
    });
  }

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
