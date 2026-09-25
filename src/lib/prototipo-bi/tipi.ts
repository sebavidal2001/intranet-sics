/**
 * Tipi condivisi del prototipo.
 */

import type { RigaAcquisto } from "./acquisti";

// ─────────────────────────────────────────────────────────────────────────────
// Sorgente dati (snapshot delle viste public.bi_* — sola lettura)
// ─────────────────────────────────────────────────────────────────────────────

export type ChiaveDataset =
  | "ordinato"
  | "fatturato"
  | "consegnato"
  | "portafoglio"
  | "preventivi_aperti"
  | "controllo_banco"
  | "consegnato_futuro_per_mese";

/** Riga normalizzata: le viste hanno tutte la stessa forma, salvo i preventivi. */
export interface RigaFatto {
  data: string; // ISO yyyy-mm-dd
  importo: number;
  bu: string; // Gruppo Descrizione
  categoria: string;
  agente: string;
  codiceAgente: string;
  cliente: string;
  codiceCliente: string;
  documento: string;
  articolo: string;
  descrizioneArticolo: string;
  quantita: number;
  causaleCodice?: string;
  causaleDescrizione?: string;
  rigaEvasa?: string;
  /** Solo sull'ordinato: data di consegna chiesta dal cliente. */
  dataConsegnaRichiesta?: string;
  /** Solo sull'ordinato: data di consegna confermata al cliente. */
  dataConsegnaConfermata?: string;

  /**
   * Costo unitario di acquisto VALIDO ALLA DATA DI QUESTA RIGA, dallo storico
   * del listino Ultimo Costo (`bi.costi_listino_storico`). Agganciato quando
   * lo snapshot viene costruito.
   *
   * `null` significa **costo sconosciuto**, e le metriche di margine devono
   * escludere la riga invece di trattare il costo come zero: un costo zero
   * darebbe margine 100% e sarebbe la stessa classe di bugia del BEP che
   * valeva l'ordinato.
   *
   * Quando `Snapshot.costiApprossimati` e' vero questo campo porta invece
   * l'ultimo costo noto, uguale per tutte le date.
   */
  costoUnitario?: number | null;
  /**
   * Data di inizio validita' della versione di costo APPLICATA a questa riga
   * (non l'ultima nota): dice a quando risale il costo usato. `null` quando si
   * e' ripiegato sull'ultimo costo noto.
   */
  dataCosto?: string | null;

  // ── Campi disponibili solo sui preventivi (dal run corrente) ─────────────
  /**
   * Valore TOTALE della riga. Nel gestionale la colonna si chiama
   * `importo_evaso`, ma non è l'evaso: verificato sui dati, vale il totale
   * anche quando la riga non è stata evasa affatto (riga_evasa='N',
   * quantita_evasa=0 e importo_evaso = importo inevaso).
   * Il valore convertito in ordine è quindi `valoreTotale - importo`.
   */
  valoreTotale?: number;
  /**
   * Quota della riga derivata in ordine, calcolata dalla vista come
   * `greatest(valore totale - inevaso, 0)`. Le 4 righe con inevaso maggiore
   * del totale (incoerenza del gestionale, -9.730 EUR) danno zero invece di
   * una conversione negativa, che non significherebbe nulla.
   */
  convertito?: number;
  /** Vero se la riga è stata interamente derivata in ordine. */
  evasa?: boolean;
  /** Addetto back office che ha creato il documento. */
  creatore?: string;
  /** Quando il preventivo è stato registrato a sistema. */
  dataCreazione?: string;
  /** Quando il cliente ha fatto la richiesta. */
  dataRichiesta?: string;
  /**
   * Giorni fra richiesta del cliente e registrazione.
   * null quando la data richiesta è assente o incoerente (successiva alla
   * registrazione, o fuori intervallo plausibile): meglio non calcolabile
   * che negativo.
   */
  giorniRisposta?: number | null;
  /**
   * Da quanti giorni la riga è aperta, contati dalla data del documento alla
   * data di riferimento dei dati (non all'orologio: così il numero non cambia
   * fra un aggiornamento e l'altro). null sulle righe interamente convertite,
   * che non sono più "aperte" da nessun tempo.
   */
  giorniAperto?: number | null;
}

export interface Snapshot {
  generatoIl: string;
  runCorrente: string | null;
  runRicevutoIl: string | null;
  /** Ultimo giorno con movimenti reali: è il "oggi" del sistema. */
  dataMassima: string | null;
  /** Ultimo giorno presente in assoluto, comprese le consegne future. */
  dataMassimaAssoluta?: string | null;
  dataMinima: string | null;
  dataset: Record<ChiaveDataset, RigaFatto[]>;
  conteggi: Record<string, number>;
  /**
   * Esito del controllo sulle business unit: `coerente: false` significa che
   * e' comparso un valore non previsto e i grafici per BU vanno guardati con
   * sospetto.
   */
  tassonomiaBu?: {
    coerente: boolean;
    estranei: string[];
    sistemiResidua: boolean;
  };
  /**
   * Serie budget/BEP per anno, agganciate allo snapshot all'ingresso della
   * richiesta.
   *
   * Budget e BEP non sono nel gestionale: vengono dal file importato o dalla
   * distribuzione generata. Senza questa mappa `esegui()` non puo' calcolarli
   * e lo dice, invece di restituire l'ordinato al posto loro — che e' quello
   * che faceva prima, silenziosamente.
   */
  serieBudget?: Record<number, SerieBudget | null>;
  /**
   * Forma dei campi di riga presenti in questo snapshot. Una cache su file
   * scritta con una forma piu' vecchia viene scartata invece di essere usata
   * con campi mancanti.
   */
  versioneForma?: number;
  /**
   * Vero se i costi NON sono quelli validi alla data di vendita ma l'ultimo
   * costo noto: lo storico non era disponibile e si e' ripiegato su
   * `preventivatore.prodotti`.
   *
   * Cambia il significato del margine — da "al costo di allora" a "al costo di
   * oggi" — quindi deve finire negli avvisi di ogni risultato che lo usa. Un
   * margine che cambia senso in silenzio e' peggio di un margine assente.
   */
  costiApprossimati?: boolean;
  /**
   * Righe d'ordine a fornitore (`public.bi_acquisti`). Assente se la vista non
   * e' raggiungibile: il resto del BI deve continuare a funzionare. Vuoto per
   * chi ha un perimetro ristretto — gli acquisti non hanno ne' agente ne'
   * business unit, quindi non c'e' una parte che gli spetti.
   */
  acquisti?: RigaAcquisto[];
  /** Giorno in cui gli ordini di acquisto sono stati estratti: il loro "oggi". */
  acquistiAl?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Configurazione Budget / BEP / calendario aziendale
// ─────────────────────────────────────────────────────────────────────────────

export interface Chiusura {
  id: string;
  dal: string; // ISO yyyy-mm-dd
  al: string; // ISO yyyy-mm-dd (inclusivo)
  descrizione: string;
}

export interface IncidenzaBU {
  bu: string;
  pesoPct: number; // somma attesa 100
}

export interface BudgetCommerciale {
  codiceAgente: string;
  agente: string;
  /** Quota sul budget annuo totale, in percentuale. */
  quotaPct: number;
  /** Se valorizzato, prevale sulla quota percentuale. */
  importoAnnuo?: number | null;
  /** BU di riferimento del commerciale (facoltativa, solo informativa). */
  bu?: string | null;
}

export type ModalitaDistribuzione = "giorni_lavorativi" | "lineare_mese";

export interface ConfigurazioneAnno {
  anno: number;
  budgetAnnuo: number;
  bepAnnuo: number;
  modalita: ModalitaDistribuzione;
  /** Sabato e domenica esclusi dai giorni lavorativi. */
  escludiWeekend: boolean;
  chiusure: Chiusura[];
  incidenzeBU: IncidenzaBU[];
  commerciali: BudgetCommerciale[];
  aggiornatoIl: string;
}


// ── Serie budget importata dagli Excel aziendali ────────────────────────────

export interface RigaSerieBudget {
  data: string;            // ISO yyyy-mm-dd
  area: string;            // business unit
  agente: string | null;   // null = riga di livello area
  codiceAgente: string | null;
  budget: number;
  bep: number;
  granularita: "giorno" | "settimana";
}

export interface SerieBudget {
  origine: "importato" | "generato";
  formato: string;
  importatoIl: string;
  anni: number[];
  totaliPerAnno: Record<number, { budget: number; bep: number }>;
  righe: RigaSerieBudget[];
}

/** Riga della distribuzione giornaliera generata (equivalente del vecchio Excel). */
export interface RigaBudgetGiorno {
  data: string;
  anno: number;
  mese: number;
  settimanaIso: string; // 2026-W01
  lavorativo: boolean;
  budget: number;
  bep: number;
}

export interface RigaBudgetDimensione {
  data: string;
  chiave: string; // nome BU o nome agente
  budget: number;
  bep: number;
}

export interface DistribuzioneBudget {
  anno: number;
  giorniLavorativi: number;
  budgetGiornaliero: number;
  bepGiornaliero: number;
  giorni: RigaBudgetGiorno[];
  perBU: RigaBudgetDimensione[];
  perAgente: RigaBudgetDimensione[];
  avvisi: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Strato semantico
// ─────────────────────────────────────────────────────────────────────────────

export type ChiaveMetrica =
  | "ordinato"
  | "fatturato"
  | "consegnato"
  | "portafoglio"
  | "preventivi_aperti"
  | "banco"
  | "consegnato_futuro"
  | "n_ordini"
  | "ordine_medio"
  | "n_preventivi"
  | "budget"
  | "bep"
  // ── Esito dei preventivi ────────────────────────────────────────────────
  | "preventivi_valore"
  | "preventivi_convertito"
  | "tasso_conversione"
  | "valore_medio_preventivo"
  // ── Carico e tempi del back office ──────────────────────────────────────
  | "preventivi_creati"
  | "righe_preventivo"
  | "giorni_risposta"
  | "quota_stesso_giorno"
  // ── Anzianità dei preventivi ancora aperti ──────────────────────────────
  | "giorni_apertura"
  | "preventivi_aperti_oltre_90"
  | "eta_massima_apertura"
  // ── Margine (a ultimo costo di acquisto) ────────────────────────────────
  | "costo_venduto"
  | "margine"
  | "margine_pct"
  | "copertura_costi_pct";

export type Modificatore =
  | "corrente"
  | "anno_precedente"
  | "progressivo"
  | "progressivo_ap";

export type Granularita = "giorno" | "settimana" | "mese" | "anno";

export type Dimensione =
  | "bu"
  | "agente"
  | "cliente"
  | "categoria"
  | "causale"
  | "articolo"
  /**
   * Il singolo documento: fattura, ordine, preventivo.
   *
   * Cardinalita' alta per costruzione — migliaia di valori — quindi ha senso
   * solo con un `limite` o dentro una tabella che cerca e pagina. E' pero' il
   * livello a cui si valuta un'operazione: un margine per business unit dice
   * dove guardare, un margine per documento dice quale trattativa ha marginato
   * male.
   */
  | "documento"
  /** Addetto back office che ha creato il preventivo. */
  | "creatore"
  /** Esito del preventivo: convertito, parziale, aperto. */
  | "esito"
  /** Fascia di anzianità del preventivo ancora aperto. */
  | "fascia_eta"
  /**
   * Coppia «business unit › categoria». Serve ai filtri a matrioska: scegliere
   * dentro COMPONENTI solo «AUTOMAZIONE pneumatica» non si puo' dire con due
   * filtri separati, perche' la categoria «-» esiste sotto piu' business unit.
   */
  | "bu_categoria";

/** Separatore dei valori di `bu_categoria`: `${bu}${SEPARATORE_RAMO}${categoria}`. */
export const SEPARATORE_RAMO = " › ";

export type OperatoreFiltro = "eq" | "neq" | "in" | "contiene";

export interface Filtro {
  campo: Dimensione;
  op: OperatoreFiltro;
  valore: string | string[];
}

export interface Periodo {
  dal?: string;
  al?: string;
  anno?: number;
}

export interface SpecQuery {
  metrica: ChiaveMetrica;
  modificatore?: Modificatore;
  granularita?: Granularita;
  raggruppa?: Dimensione[];
  filtri?: Filtro[];
  periodo?: Periodo;
  ordina?: "valore_desc" | "valore_asc" | "etichetta";
  limite?: number;
}

export type RuoloSerie = "principale" | "confronto" | "obiettivo" | "soglia";

/** Una misura conserva la propria domanda perché confronti e obiettivi possono avere periodi diversi. */
export interface SerieAnalisi {
  ruolo: RuoloSerie;
  /** Etichetta mostrata in legenda, per esempio "Ordinato", "2025" o "Budget". */
  nome: string;
  /** Colore SVG esadecimale; se assente viene usata la palette attiva. */
  colore?: string;
  spec: SpecQuery;
}

export interface RigaRisultato {
  etichetta: string;
  chiavi: Record<string, string>;
  valore: number;
  conteggio: number;
}

export type UnitaMisura = "euro" | "numero" | "percentuale" | "giorni";

export interface RisultatoQuery {
  spec: SpecQuery;
  metrica: ChiaveMetrica;
  unita: UnitaMisura;
  righe: RigaRisultato[];
  totale: number;
  certificata: true;
  avvisi: string[];
}

/** Serie e risultato viaggiano insieme fino al componente che compone il riquadro. */
export interface SerieAnalisiEseguita extends SerieAnalisi {
  risultato: RisultatoQuery;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analista: segnali e briefing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unico elenco delle famiglie: il tipo ne deriva, e chi deve conoscerle tutte
 * (l'analista, le etichette dell'interfaccia) lo importa invece di ricopiarlo.
 * Una lista ricopiata resta valida anche quando e' incompleta.
 */
export const FAMIGLIE_RILEVATORI = [
  "scostamento_budget",
  "rottura_serie",
  "clienti_dormienti",
  "concentrazione",
  "pipeline",
  "portafoglio",
  "qualita_dato",
  "margine",
  "clienti_ritornati",
  "consegne",
  "costi_acquisto",
  "fornitori",
  "carico_acquisti",
] as const;

export type FamigliaRilevatore = (typeof FAMIGLIE_RILEVATORI)[number];

export interface Segnale {
  id: string;
  famiglia: FamigliaRilevatore;
  titolo: string;
  /** Testo fattuale generato dal rilevatore, senza interpretazione. */
  descrizione: string;
  /** Impatto economico assoluto in euro, usato per il punteggio. */
  magnitudineEuro: number;
  /** 0..1 — quanto il segnale persiste nel tempo. */
  persistenza: number;
  /** 0..1 — quanto è azionabile (ha un soggetto e un destinatario). */
  azionabilita: number;
  direzione: "positivo" | "negativo" | "neutro";
  punteggio: number;
  /** Query certificate che dimostrano il segnale: sempre rieseguibili. */
  prove: { descrizione: string; spec: SpecQuery }[];
  /** Dati di supporto per la scomposizione (già calcolati, non inventati). */
  dettaglio?: Record<string, unknown>;
}

export interface VoceBriefing {
  ordine: number;
  segnaleId: string;
  famiglia: FamigliaRilevatore;
  testo: string;
  azioneSuggerita: string | null;
  certificata: boolean;
  prove: { descrizione: string; spec: SpecQuery }[];
}

export interface Briefing {
  generatoIl: string;
  dataRiferimento: string;
  runRicevutoIl: string | null;
  destinatario: string;
  ruolo: RuoloBriefing;
  voci: VoceBriefing[];
  segnaliValutati: number;
  segnaliScartati: number;
  motoreAI: "openrouter" | "deterministico";
  nota: string | null;
}

export type RuoloBriefing = "direzione" | "responsabile" | "agente";
