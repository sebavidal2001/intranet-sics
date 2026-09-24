/**
 * Tipi del Portale Controllo Vettori.
 *
 * Il modello segue l'ordine con cui il vettore compone la fattura, non l'ordine
 * con cui è comodo scriverlo: peso tassabile, nolo di fascia, supplementi,
 * adeguamento, carburante. Cambiare quell'ordine cambia il totale.
 */

/** Come si forma il prezzo di un vettore. */
export type ModelloTariffa = "scaglioni" | "quintale";

/** Come si calcola un supplemento. */
export type TipoCalcoloSupplemento =
  | "fisso_spedizione"
  | "per_kg"
  | "per_collo"
  | "percentuale_nolo";

/**
 * Condizioni della spedizione che attivano un supplemento. `sempre` è il caso
 * ordinario; le altre le dichiara chi registra l'arrivo o la partenza.
 */
export type CondizioneSpedizione =
  | "sempre"
  | "bancale"
  | "non_sovrapponibile"
  | "movimentazione_manuale"
  | "oversized"
  | "ztl"
  | "etichetta_manuale"
  | "triangolazione"
  | "fuori_provincia"
  | "giacenza"
  | "assegno";

export interface Vettore {
  id: string;
  codice: string;
  nome: string;
  modelloTariffa: ModelloTariffa;
  /** Kg per metro cubo. 300 per GLS e Trading Post, 250 per TNT e FedEx. */
  divisoreVolumetrico: number;
  /** Peso sotto il quale si fattura comunque questo peso. Trading Post: 3 kg. */
  pesoMinimoTassabile: number;
  /** 0 = nessun arrotondamento. */
  arrotondamentoKg: number;
  /** L'arrotondamento vale solo da questo peso in su. Trading Post: 100 kg. */
  arrotondamentoDaKg: number;
}

export interface Fascia {
  pesoDa: number;
  /** null = fascia finale, "oltre". */
  pesoA: number | null;
  importo: number;
  tipo: "fisso" | "quintale";
  /** Solo sulla fascia finale: ogni quanti kg si aggiunge `scattoImporto`. */
  scattoKg: number | null;
  scattoImporto: number | null;
}

export interface Supplemento {
  codice: string;
  nome: string;
  tipoCalcolo: TipoCalcoloSupplemento;
  valore: number;
  /**
   * Entra nella base su cui si calcolano adeguamento e carburante?
   * Sulla fattura GLS la voce "Nolo" comprende già handling, autostrade,
   * oversized, safety & energy e bollettazione; l'assicurazione no.
   */
  baseNolo: boolean;
  condizione: CondizioneSpedizione;
  importoMinimo: number | null;
  importoMassimo: number | null;
  /** Il supplemento si applica solo da questo peso in su. */
  sogliaKgDa: number | null;
  sogliaKgA: number | null;
}

/** Il listino di un vettore nella versione valida a una certa data. */
export interface ListinoRisolto {
  vettore: Vettore;
  zonaCodice: string;
  fasce: Fascia[];
  supplementi: Supplemento[];
  /** Percentuale sul nolo, es. 0.0721 per l'ISTAT GLS. Null se il vettore non lo applica. */
  adeguamento: number | null;
  /** Percentuale del mese, es. 0.243. Null se non ancora comunicata. */
  carburante: number | null;
}

/** I dati fisici di una spedizione, da cui si ricava il costo. */
export interface DatiSpedizione {
  colli: number;
  /** Peso rilevato o dichiarato in bolla, in kg. */
  pesoReale: number;
  /** Volume in metri cubi, se noto. Alternativo alle dimensioni. */
  volumeMc?: number | null;
  /** Dimensioni del collo in centimetri. Usate se `volumeMc` non c'è. */
  lunghezzaCm?: number | null;
  larghezzaCm?: number | null;
  altezzaCm?: number | null;
  /** Colli anche di dimensioni diverse: il volume è la somma dei singoli gruppi. */
  misureColli?: Array<{ quantita: number; lunghezzaCm: number; larghezzaCm: number; altezzaCm: number }>;
  /** Condizioni dichiarate che attivano i supplementi. */
  condizioni?: CondizioneSpedizione[];
}

export type FonteBollaMisura = "manuale" | "magazzino" | "vettore";

/** Un gruppo di colli omogenei associato a una testata di bolla. */
export interface BollaMisura {
  id: string;
  spedizioneId: string;
  quantita: number;
  lunghezzaCm: number;
  larghezzaCm: number;
  altezzaCm: number;
  pesoRealeKg: number | null;
  volumeM3: number;
  fonte: FonteBollaMisura;
  inseritoIl: string;
  modificatoIl: string;
}

export type StatoMisureBolla =
  | "da_misurare"
  | "misurata";

export type CampoBollaForzabile =
  | "direzione"
  | "numero_riferimento"
  | "data_documento"
  | "controparte_nome"
  | "vettore_id"
  | "colli_bolla"
  | "peso_bolla";

export interface CampoBollaForzato {
  valorePrecedente: string | number | boolean | null;
  forzatoDa: string;
  forzatoIl: string;
}

export type CampiBollaForzati = Partial<
  Record<CampoBollaForzabile, CampoBollaForzato>
>;

export interface BollaFattura {
  controlloId: string;
  numero: string;
  data: string;
}

export interface BollaScostamento {
  id: string;
  idDocumento: number;
  differenze: Record<
    string,
    { spedizione: string | number | boolean | null; gestionale: string | number | boolean | null }
  >;
  rilevatoIl: string;
}

export interface BollaVettoreOpzione {
  id: string;
  codice: string;
  nome: string;
  divisoreVolumetrico: number;
}

export type VettoreEsito =
  | "assegnato"
  | "regola"
  | "esterno"
  | "da_classificare"
  | "assente";

/** Testata gestionale esposta alla coda operativa delle bolle. */
export interface BollaDocumento {
  idSpedizione: string;
  idDocumenti: number[];
  numeroDocumento: string | null;
  /** Nostro protocollo BF sugli arrivi; sulle partenze coincide col numero e resta null. */
  numeroProtocollo: string | null;
  dataDocumento: string;
  dataCreazione: string | null;
  direzione: "entrata" | "uscita";
  soggetto: string | null;
  destinazione: string | null;
  vettoreId: string | null;
  vettoreCodice: string | null;
  vettore: string | null;
  vettoreCodiceGestionale: string | null;
  vettoreEsito: VettoreEsito;
  vettoreRegola: string | null;
  numColli: number | null;
  /** Porto del gestionale e se la spedizione la paghiamo noi (null = non deducibile). */
  porto: string | null;
  aNostroCarico: boolean | null;
  /** Addebito al cliente fissato dalla simulazione. */
  riaddebitoPrevisto: number | null;
  pesoLordoKg: number | null;
  pesoNettoKg: number | null;
  divisoreVolumetrico: number | null;
  statoMisure: StatoMisureBolla;
  origine: OrigineSpedizione;
  campiForzati: CampiBollaForzati;
  congelata: boolean;
  fattura: BollaFattura | null;
  scostamenti: BollaScostamento[];
  misure: BollaMisura[];
}

export interface BolleResponse {
  documenti: BollaDocumento[];
  vettori: BollaVettoreOpzione[];
  puoScongelare: boolean;
  pagina: number;
  perPagina: number;
  totale: number;
  altrePagine: boolean;
  /** Bolle escluse perche' il trasporto non e' a nostro carico (0 con «mostra tutte»). */
  nonANostroCarico: number;
}

/* ------------------------------------------------------------------ */
/*  Storico spedizioni                                                */
/* ------------------------------------------------------------------ */

export type DirezioneStorico = "entrata" | "uscita";

export type OrigineSpedizione =
  | "gestionale"
  | "manuale"
  | "excel_storico"
  | "simulazione";

/** Stato editoriale della fatturazione, distinto dallo stato DB del documento. */
export type StatoFatturazione = "fatturata" | "bozza" | "non_fatturata";

export type EsitoControllo =
  | "in_linea"
  | "da_verificare"
  | "anomalia"
  | "non_valutabile";

export type TipoAbbinamento = "numero" | "assistito" | "manuale" | "nessuno";

export interface RigaStorico {
  id: string;
  fattura_id: string | null;
  direzione: DirezioneStorico | null;
  vettore_codice: string | null;
  vettore_nome: string | null;
  fattura_numero: string | null;
  data_fattura: string | null;
  anno: number | null;
  mese: number | null;
  stato_fattura: "bozza" | "confermata" | "chiusa" | null;
  stato_fatturazione: StatoFatturazione;
  origine: OrigineSpedizione | null;
  riga_numero: number | null;
  data_spedizione: string | null;
  numero_spedizione: string | null;
  riferimento: string | null;
  controparte: string | null;
  controparte_codice: string | null;
  provincia: string | null;
  cap: string | null;
  porto_descrizione: string | null;
  a_nostro_carico: boolean | null;
  colli: number | null;
  peso: number | null;
  peso_volumetrico: number | null;
  peso_tassato: number | null;
  nolo: number | null;
  supplementi: number | null;
  adeguamento: number | null;
  carburante: number | null;
  fatturato: number | null;
  atteso: number | null;
  scostamento: number | null;
  /** NULL significa che la fattura non esiste ancora, non "non valutabile". */
  esito: EsitoControllo | null;
  abbinamento: TipoAbbinamento | null;
  listino: string | null;
  zona: string | null;
  peso_applicato: string | null;
  avvertenze: string[] | null;
  anomalie: number;
  anomalie_aperte: number;
  /** Dalla 117. NULL sulle righe di fattura che non hanno trovato la bolla. */
  spedizione_id: string | null;
  porto_codice: string | null;
  /** Sugli arrivi: il nostro protocollo BF (la bolla e' il DDT del fornitore). */
  numero_protocollo: string | null;
  riaddebito_previsto: number | null;
  riaddebito_verificato_il: string | null;
  /** false = la fattura e' stata acquisita senza quadratura. NULL senza fattura. */
  fattura_quadrata: boolean | null;
  /** Calcolato dal server, non dal database: vedi `addebitoCliente`. */
  addebito_cliente?: AddebitoCliente | null;
}

/**
 * Quanto si addebita al cliente per il trasporto di una partenza.
 *
 * `simulazione`: l'importo fissato al banco quando e' stato scelto il vettore.
 * `scaglioni`: calcolato dalla tabella di riaddebito (e dagli accordi cliente)
 * col peso della spedizione. `importo` null = la tabella non risponde.
 */
export interface AddebitoCliente extends EsitoRiaddebito {
  fonte: "simulazione" | "scaglioni";
}

export interface TotaliStorico {
  /** Righe fattura più spedizioni non ancora fatturate. */
  righe: number;
  /** Sole righe di fatture confermate o chiuse. */
  righe_valide: number;
  righe_bozza: number;
  spedizioni_non_fatturate: number;
  /** Colli e kg includono le spedizioni non fatturate, ma non le bozze. */
  colli: number;
  kg: number;
  /** Gli importi includono soltanto fatture confermate o chiuse. */
  fatturato: number;
  atteso: number;
  anomalie: number;
  con_anomalie_aperte: number;
}

export interface EsitoStorico {
  righe: RigaStorico[];
  totali: TotaliStorico;
  /** Quante righe per direzione, calcolate ignorando il filtro di direzione. */
  per_direzione: Record<string, number> | null;
  pagina: number;
  per_pagina: number;
}

export interface FiltriStorico {
  direzione?: DirezioneStorico | null;
  vettori?: string[] | null;
  da?: string | null;
  a?: string | null;
  anno?: number | null;
  mese?: number | null;
  esiti?: string[] | null;
  abbinamenti?: string[] | null;
  province?: string[] | null;
  cerca?: string | null;
  soloAnomalie?: boolean;
  pesoMin?: number | null;
  pesoMax?: number | null;
  importoMin?: number | null;
  importoMax?: number | null;
  scostamentoMin?: number | null;
  ordine?: string | null;
  pagina?: number;
  perPagina?: number;
}

export interface ValoriFiltroStorico {
  vettori: Array<{ codice: string; nome: string }>;
  province: string[];
  periodi: Array<{ anno: number; mese: number }>;
  anni: number[];
}

export interface VoceCalcolo {
  codice: string;
  descrizione: string;
  importo: number;
}

/**
 * Esito del calcolo. È volutamente verboso: la schermata di controllo mostra
 * queste voci affiancate a quelle della fattura, ed è così che l'addetta vede
 * *da dove* nasce la differenza invece di leggere due totali diversi.
 */
export interface CostoAtteso {
  pesoReale: number;
  pesoVolumetrico: number;
  /** Il maggiore fra i due, dopo minimo tassabile e arrotondamento. */
  pesoTassabile: number;
  /** Quale dei due pesi ha fatto prezzo. */
  pesoApplicato: "reale" | "volumetrico" | "minimo";
  nolo: number;
  fasciaDescrizione: string;
  supplementi: VoceCalcolo[];
  /** Nolo + supplementi che fanno base. È la cifra su cui si applicano adeguamento e carburante. */
  imponibileNolo: number;
  adeguamento: number;
  carburante: number;
  /** Supplementi fuori base, tipicamente l'assicurazione. */
  fuoriBase: number;
  totale: number;
  /** Note su cosa non si è potuto calcolare, e perché. */
  avvertenze: string[];
}

/* ------------------------------------------------------------------ */
/*  Simulazione: CAP, gruppi di colli, riaddebito                      */
/* ------------------------------------------------------------------ */

/**
 * Da dove viene la provincia usata per scegliere la zona tariffaria.
 *
 * Non e' un dettaglio da nascondere: `prefisso` significa che il CAP non era in
 * elenco e la provincia e' stata dedotta dalle prime tre cifre. La differenza fra
 * un dato e una deduzione va davanti a chi decide il vettore, non in un log.
 */
export type FonteProvincia = "cap" | "prefisso" | "manuale";

export interface EsitoCap {
  cap: string;
  /** Piu' di una: il CAP sta a cavallo e va chiesto quale. Vuota se estero. */
  province: string[];
  comuni: string[];
  /** `anci_istat`, `gestionale`, `manuale` o `prefisso`. */
  fonte: string;
  /** Una sola provincia italiana certa: si puo' procedere senza chiedere. */
  certo: boolean;
  /** San Marino e simili: CAP di forma italiana, destinazione internazionale. */
  estero: boolean;
}

/**
 * Un gruppo di colli con le stesse misure.
 *
 * Una bolla con sei colli di tre formati diversi sono tre gruppi, non sei righe:
 * e' cosi' che si inserisce al banco e cosi' che il volume torna.
 */
export interface GruppoColli {
  quantita: number;
  lunghezzaCm: number;
  larghezzaCm: number;
  altezzaCm: number;
  /** Peso del singolo collo, se pesato. Facoltativo: fa fede il peso totale. */
  pesoRealeKg?: number | null;
}

export type BasePesoRiaddebito = "reale" | "tassabile";

export interface ScaglioneRiaddebito {
  pesoDa: number;
  /** null = scaglione finale aperto. */
  pesoA: number | null;
  /** null = nessun importo automatico, va chiesta un'offerta. */
  importo: number | null;
  nota: string | null;
}

export type ModalitaRiaddebitoCliente =
  | "tabella"
  | "importo_fisso"
  | "nessun_addebito";

export interface AccordoRiaddebitoCliente {
  id: string;
  codiceCliente: string;
  ragioneSociale: string | null;
  validoDal: string;
  validoAl: string | null;
  modalita: ModalitaRiaddebitoCliente;
  importo: number | null;
  nota: string | null;
}

export interface VersioneRiaddebito {
  validoDal: string;
  validoAl: string | null;
  basePeso: BasePesoRiaddebito;
  scaglioni: ScaglioneRiaddebito[];
}

/**
 * Quanto si addebita al cliente per questa spedizione.
 *
 * `importo` null non e' zero: significa che la tabella non risponde e serve
 * un'offerta. Mostrarlo come 0,00 produrrebbe un margine inventato.
 */
export interface EsitoRiaddebito {
  importo: number | null;
  /** Il peso su cui e' stato letto lo scaglione, e quale peso era. */
  pesoUsato: number;
  basePeso: BasePesoRiaddebito;
  /** 'scaglione 10-30 kg', 'accordo cliente: importo fisso', ... */
  regola: string;
  /** Perche' non c'e' un importo, quando manca. */
  avvertenza: string | null;
}

/** Una voce del confronto fra vettori. */
export interface EsitoSimulazione {
  vettoreId: string;
  vettoreCodice: string;
  vettoreNome: string;
  disponibile: boolean;
  motivoIndisponibilita?: string;
  listino?: { id?: string; etichetta: string; validoDal: string; validoAl: string | null } | null;
  calcolo?: CostoAtteso;
  /** Differenza in euro rispetto alla soluzione piu' conveniente. */
  differenzaDalMigliore?: number;
  /** Quanto si addebita al cliente scegliendo questo vettore. */
  riaddebito?: EsitoRiaddebito;
  /** Riaddebito meno costo. null quando uno dei due non e' calcolabile. */
  margine?: number | null;
}

export interface RispostaSimulazione {
  data: string;
  cap: string | null;
  provincia: string | null;
  fonteProvincia: FonteProvincia | null;
  /** Presente quando il CAP non basta a decidere: l'interfaccia deve chiedere. */
  capDaChiarire?: EsitoCap | null;
  risultati: EsitoSimulazione[];
}

/** Conferma di una simulazione: diventa una spedizione da misurare o gia misurata. */
export interface ConfermaSimulazione {
  simulazioneId: string;
  spedizioneId: string | null;
  /** true = manca il numero di bolla e la spedizione e' in coda `da_numerare`. */
  daNumerare: boolean;
}
