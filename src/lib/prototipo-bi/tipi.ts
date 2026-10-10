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
  | "consegnato_futuro_per_mese"
  /** Righe d'ordine a fornitore (migration 118), viste come fatti del motore. */
  | "acquisti"
  /** Visite dei commerciali (migration 145), una riga per visita. */
  | "visite"
  /** Righe di fattura e nota di credito fornitore (migration 150). */
  | "fatture_fornitore"
  /** Una riga per documento con condizione di pagamento e giorni medi (migration 150). */
  | "pagamenti"
  /** Scadenze aperte, incassi attesi e pagamenti dovuti (migration 150). */
  | "scadenze"
  /** Una riga per documento con l'utente che l'ha creato: il carico di lavoro (migration 151). */
  | "documenti_utente"
  /** Anagrafica dei clienti: categorie, zona, agente (migration 140). */
  | "clienti"
  /** Articoli per magazzino: esistenza, impegni, ordinato, ultimo costo (migration 152). */
  | "articoli"
  /** Variazioni dell'ultimo costo di acquisto (migration 152). */
  | "variazioni_costo"
  /** Documenti di trasporto: vettore, colli, peso, destinazione (migration 152). */
  | "spedizioni";

/** I dataset che vengono dalle viste delle vendite: tutti sempre presenti. */
export type ChiaveDatasetVendite = Exclude<
  ChiaveDataset,
  "acquisti" | "visite" | "fatture_fornitore" | "pagamenti" | "scadenze" | "documenti_utente" | "clienti" | "articoli" | "variazioni_costo" | "spedizioni"
>;

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
  // ── Solo sugli acquisti (righe d'ordine a fornitore) ─────────────────────
  fornitore?: string;
  /** Utente del gestionale che ha emesso l'ordine. */
  buyer?: string;
  /** Data promessa dal fornitore (confermata, o prevista se manca). */
  promessa?: string | null;
  /** Primo arrivo (DDT del fornitore). */
  dataArrivo?: string | null;
  /** Arrivata entro la promessa; null se non ancora arrivata o senza promessa. */
  puntuale?: boolean | null;
  /** Aperta, con la promessa passata al giorno dell'estrazione. */
  scaduta?: boolean;
  /** Valore ancora da ricevere. */
  valoreResiduo?: number;
  /** Giorni dall'ordine al primo arrivo. */
  giorniConsegna?: number | null;
  /** Giorni oltre la promessa, per le righe arrivate in ritardo (non puntuali); null altrimenti. */
  giorniRitardo?: number | null;
  /**
   * Vero se la business unit non e' quella del gestionale (la riga non aveva
   * gruppo) ma quella del documento a cui appartiene. Vedi
   * `ricollocaNonAssegnate` in business-unit.ts.
   */
  buDedotta?: boolean;
  // ── Solo sulle visite dei commerciali ────────────────────────────────────
  /** CAP della visita (destinazione, altrimenti anagrafica): la mappa si regge su questo. */
  cap?: string;
  localita?: string;
  provincia?: string;
  /** Grado della visita (es. "conoscitiva"). */
  grado?: string;
  /** Tipo di visita (es. "presentazione preventivo"). */
  tipoVisita?: string;
  /** Profilo del documento nel gestionale (OC ordine cliente, FC fattura, BC bolla…). */
  profilo?: string;
  // ── Solo su fatture fornitore, pagamenti e scadenze (migration 150) ──────
  /** Soggetto del documento: il cliente per le fatture di vendita, il fornitore per quelle di acquisto. */
  soggetto?: string;
  /** Condizione di pagamento scritta sul documento, per esteso («RB 60 ggfm»). */
  condizione?: string;
  /** Numero della fattura com'e' scritto dal fornitore. */
  numeroDocumentoOrigine?: string;
  /** A cosa punta la riga di fattura fornitore: OF, OFT, OFR, RECLAVES… vuoto = nessun legame. */
  profiloOrdine?: string;
  /** Pagamenti: giorni medi fra documento e scadenze, pesati sull'importo di ciascuna rata. */
  giorniMedi?: number | null;
  /** Pagamenti: importo delle scadenze (peso dei giorni medi). */
  importoScadenze?: number;
  /** Scadenze: A = incasso atteso dal cliente, P = pagamento dovuto al fornitore. */
  tipoScadenza?: "A" | "P";
  /** Scadenze: quanto resta da incassare o pagare, sempre positivo. */
  saldoAperto?: number;
  // ── Anagrafica del cliente, agganciata a ogni riga che ha un codice cliente ──
  catAttivita?: string;
  catCommerciale?: string;
  zonaCliente?: string;
  tipoCliente?: string;
  clienteAttivo?: string;
  // ── Documenti per utente (carico di lavoro) ──────────────────────────────
  /** Ora di creazione del documento, «09»: per vedere a che ora si lavora. */
  oraCreazione?: string;
  // ── Articoli (fotografia per magazzino) ──────────────────────────────────
  magazzino?: string;
  reparto?: string;
  esistenza?: number;
  disponibilita?: number;
  qtaOrdClienti?: number;
  qtaOrdFornitori?: number;
  qtaImpProduzione?: number;
  qtaOrdProduzione?: number;
  ultimoCosto?: number | null;
  /** Esistenza per ultimo costo, dove il costo e' noto. */
  valoreGiacenza?: number;
  // ── Variazioni di costo ──────────────────────────────────────────────────
  variazionePct?: number | null;
  // ── Spedizioni ───────────────────────────────────────────────────────────
  vettore?: string;
  tipoTrasporto?: string;
  causaleTrasporto?: string;
  /** Merce in entrata (acquisti) o in uscita (vendite). */
  direzioneMerce?: string;
  provinciaDestinazione?: string;
  zonaSpedizione?: string;
  mezzoTrasporto?: string;
  colli?: number;
  pallet?: number;
  pesoLordo?: number;
  volume?: number;
  speseTrasporto?: number;
  /** Solo sulle visite: esito registrato e data della prossima visita. */
  esitoVisita?: string;
  prossimaVisita?: string;
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
  dataset: Record<ChiaveDatasetVendite, RigaFatto[]> & {
    /** Assente se la vista bi_acquisti non e' raggiungibile. */
    acquisti?: RigaFatto[];
    /** Assente se la vista bi_visite non e' raggiungibile. */
    visite?: RigaFatto[];
    /** Assenti se le viste della migration 150 non sono raggiungibili. */
    fatture_fornitore?: RigaFatto[];
    pagamenti?: RigaFatto[];
    scadenze?: RigaFatto[];
    documenti_utente?: RigaFatto[];
    clienti?: RigaFatto[];
    articoli?: RigaFatto[];
    variazioni_costo?: RigaFatto[];
    spedizioni?: RigaFatto[];
  };
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
  // ── Documenti: quanti e di che valore medio ─────────────────────────────
  | "n_fatture"
  | "fattura_media"
  | "n_consegne"
  | "consegna_media"
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
  | "copertura_costi_pct"
  // ── Acquisti: ordini a fornitore ────────────────────────────────────────
  | "acquisti_valore"
  | "acquisti_righe"
  | "acquisti_ordini"
  | "puntualita_fornitori"
  | "giorni_consegna_fornitori"
  | "ritardo_medio_fornitori"
  | "acquisti_da_sollecitare"
  | "acquisti_valore_da_sollecitare"
  // ── Visite dei commerciali ──────────────────────────────────────────────
  | "visite_numero"
  // ── Fatture fornitore, pagamenti e scadenze (migration 150) ─────────────
  | "fatturato_fornitore"
  | "n_fatture_fornitore"
  | "giorni_incasso"
  | "giorni_pagamento"
  // ── Carico di lavoro: documenti creati dagli utenti (migration 151) ─────
  | "documenti_vendita_creati"
  | "righe_vendita_inserite"
  | "documenti_acquisto_creati"
  | "righe_acquisto_inserite"
  // ── Clienti, articoli, spedizioni (migration 152) ───────────────────────
  | "clienti_numero"
  | "articoli_numero"
  | "articoli_esistenza"
  | "articoli_disponibilita"
  | "articoli_qta_ord_clienti"
  | "articoli_qta_ord_fornitori"
  | "articoli_qta_imp_produzione"
  | "articoli_qta_ord_produzione"
  | "articoli_valore_giacenza"
  | "articoli_ultimo_costo"
  | "variazioni_costo_numero"
  | "variazioni_costo_pct_media"
  | "spedizioni_numero"
  | "spedizioni_colli"
  | "spedizioni_pallet"
  | "spedizioni_peso_lordo"
  | "spedizioni_volume"
  | "spedizioni_spese"
  | "incassi_attesi"
  | "pagamenti_dovuti"
  | "saldo_cassa"
  /** Inevaso dei preventivi di ogni causale: non solo quelli in corso. */
  | "preventivi_inevaso"
  // ── Quantita' (pezzi) ───────────────────────────────────────────────────
  | "quantita_ordinata"
  | "quantita_fatturata"
  | "quantita_consegnata"
  | "acquisti_quantita";

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
  /** Il codice della causale (PIC, POR, PF4…), come lo scrive il gestionale. */
  | "causale_codice"
  /**
   * Il codice dell'articolo, com'e' nel gestionale: e' quello che si cerca,
   * si incolla in un foglio, si confronta con il listino.
   */
  | "codice_articolo"
  /** La descrizione dell'articolo (o il codice, se la descrizione manca). */
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
  /**
   * Numero del documento con l'anno («1264/2026»). Il numero riparte ogni anno:
   * il solo numero fonde documenti di anni diversi, questo no. Per gli ordini a
   * fornitore coincide con `documento`, che l'anno lo porta gia'.
   */
  | "documento_anno"
  /** Profilo del documento nel gestionale (OC, FC, BC…): il tipo di documento. */
  | "profilo"
  /** Codice del cliente nel gestionale, e il codice dell'agente. */
  | "codice_cliente"
  | "codice_agente"
  /** Date di consegna chiesta e confermata al cliente (vendite). */
  | "data_consegna_richiesta"
  | "data_consegna_confermata"
  /** Data promessa dal fornitore (acquisti). */
  | "data_promessa"
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
  | "bu_categoria"
  /** Fornitore della riga d'ordine d'acquisto. */
  | "fornitore"
  /** Chi ha emesso l'ordine a fornitore. */
  | "buyer"
  // ── Solo sulle visite ───────────────────────────────────────────────────
  /** CAP della visita: la dimensione della mappa. */
  | "cap"
  | "provincia"
  /** Grado della visita. */
  | "grado"
  | "tipo_visita"
  /** Esito della visita e data della prossima visita, come registrati. */
  | "esito_visita"
  | "prossima_visita"
  // ── Fatture fornitore, pagamenti e scadenze ─────────────────────────────
  /** Cliente o fornitore del documento. */
  | "soggetto"
  /** Condizione di pagamento del documento. */
  | "condizione_pagamento"
  /** Incasso atteso (cliente) o pagamento dovuto (fornitore). */
  | "tipo_scadenza"
  /** Numero della fattura come l'ha scritto il fornitore. */
  | "numero_fattura_fornitore"
  /** A cosa punta la fattura fornitore: ordine, reclamo, niente. */
  | "profilo_ordine"
  // ── Anagrafica clienti ──────────────────────────────────────────────────
  | "categoria_attivita"
  | "categoria_commerciale"
  | "zona_cliente"
  | "tipo_cliente"
  | "cliente_attivo"
  // ── Carico di lavoro ────────────────────────────────────────────────────
  /** L'ora del giorno in cui il documento e' stato creato. */
  | "ora_creazione"
  // ── Articoli ────────────────────────────────────────────────────────────
  | "magazzino"
  | "reparto"
  // ── Spedizioni ──────────────────────────────────────────────────────────
  | "vettore"
  | "tipo_trasporto"
  | "causale_trasporto"
  | "direzione_merce"
  | "provincia_destinazione"
  | "zona_spedizione"
  | "mezzo_trasporto";

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
  /** Un anno solo: la forma storica, ancora valida. */
  anno?: number;
  /**
   * Più anni, anche non contigui. Se presente prevale su `anno`; si combina
   * con `dal`/`al` (devono valere entrambi). Regole in `periodo.ts`.
   */
  anni?: number[];
}

// ── Misure personalizzate ───────────────────────────────────────────────────
//
// Una misura personalizzata e' una DEFINIZIONE DICHIARATIVA composta da metriche
// del catalogo, mai una formula libera: ogni operando e' una metrica certificata
// (con eventuali filtri incorporati) e l'unico modo di combinarli e' uno dei
// cinque operatori qui sotto. Niente ricorsione: un solo livello di operatori.
// Regole in `misure.ts`.

/** Una metrica del catalogo, con filtri incorporati nella misura. */
export interface OperandoMisura {
  metrica: ChiaveMetrica;
  filtri?: Filtro[];
}

export type EspressioneMisura =
  /** La metrica stessa, con filtri incorporati (es. fatturato dei soli COMPONENTI). */
  | ({ tipo: "metrica" } & OperandoMisura)
  /**
   * Numeratore diviso denominatore. Stessa unita' (euro/euro, numero/numero) =
   * percentuale; euro/numero = euro per unita' (es. fatturato per ordine).
   */
  | { tipo: "rapporto"; numeratore: OperandoMisura; denominatore: OperandoMisura }
  /** `da` meno `sottrai`, nella stessa unita'. */
  | { tipo: "differenza"; da: OperandoMisura; sottrai: OperandoMisura }
  /** Somma di 2-4 operandi nella stessa unita'. */
  | { tipo: "somma"; addendi: OperandoMisura[] }
  /**
   * Quota: la metrica con i filtri incorporati sulla stessa metrica SENZA quei
   * filtri (restano quelli della spec e della dashboard), in percentuale.
   */
  | { tipo: "quota"; metrica: ChiaveMetrica; filtri: Filtro[] };

export interface MisuraDefinita {
  /** Id della misura salvata da cui questa copia deriva (assente se creata al volo). */
  id?: string;
  /** Versione della misura salvata al momento della copia. */
  versione?: number;
  nome: string;
  espressione: EspressioneMisura;
}

export interface SpecQuery {
  metrica: ChiaveMetrica;
  /**
   * Se presente, la spec calcola questa misura personalizzata e `metrica` e'
   * soltanto l'operando rappresentativo (lo riscrive il validatore, mai l'input).
   */
  misura?: MisuraDefinita;
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

// ── Aspetto di un riquadro ──────────────────────────────────────────────────

export type PosizioneLegenda = "sotto" | "sopra" | "destra" | "nascosta";

/** Come si riassume una colonna numerica nella riga dei totali. */
export type AggregazioneTotale =
  | "automatico"
  | "somma"
  | "media"
  | "minimo"
  | "massimo"
  | "conteggio"
  | "nessuno";

export interface AspettoAsse {
  visibile?: boolean;
  titolo?: string;
  /** Solo per l'asse dei valori: estremi fissati a mano. */
  minimo?: number;
  massimo?: number;
}

/**
 * Le scelte di resa di un riquadro: colori, legenda, assi, totali.
 *
 * Tutto facoltativo. Un campo assente segue le impostazioni generali dei
 * grafici (il pannello con l'ingranaggio), così un riquadro senza aspetto si
 * comporta esattamente come prima. Non entra mai nella query: cambiarlo non
 * rilancia il calcolo.
 */
export interface AspettoGrafico {
  /**
   * Colore per nome di serie o di categoria («COMPONENTI», «Budget»…).
   * Prevale sui colori predefiniti delle business unit.
   */
  colori?: Record<string, string>;
  legenda?: PosizioneLegenda;
  griglia?: boolean;
  etichetteValori?: boolean;
  /** Asse delle categorie o del tempo. */
  asseX?: AspettoAsse;
  /** Asse dei valori. */
  asseY?: AspettoAsse;
  tabella?: {
    totale?: AggregazioneTotale;
    /** Chiave della colonna su cui ordinare; "voce" per l'etichetta. */
    ordinaPer?: string;
    verso?: "asc" | "desc";
    /**
     * Le colonne di differenza scelte a mano.
     *
     * `da` e `con` sono posizioni nell'elenco delle misure del riquadro
     * (0 = la prima): la colonna mostra `da − con`, in valore o in percentuale
     * su `con`.
     *
     * Assente = comportamento storico: se c'e' una misura con ruolo
     * «confronto», una differenza fra la principale e quella. Presente, anche
     * vuoto, = si mostrano ESATTAMENTE queste e nessuna in automatico.
     */
    differenze?: DifferenzaTabella[];
  };
}

export interface DifferenzaTabella {
  da: number;
  con: number;
  /** Default: assoluta (nell'unita' della misura). */
  modo?: "assoluta" | "percentuale";
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
