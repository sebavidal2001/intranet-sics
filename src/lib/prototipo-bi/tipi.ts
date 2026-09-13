/**
 * Tipi condivisi del prototipo.
 */

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
  | "eta_massima_apertura";

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
  /** Addetto back office che ha creato il preventivo. */
  | "creatore"
  /** Esito del preventivo: convertito, parziale, aperto. */
  | "esito"
  /** Fascia di anzianità del preventivo ancora aperto. */
  | "fascia_eta";

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

export type FamigliaRilevatore =
  | "scostamento_budget"
  | "rottura_serie"
  | "clienti_dormienti"
  | "concentrazione"
  | "pipeline"
  | "portafoglio"
  | "qualita_dato";

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
