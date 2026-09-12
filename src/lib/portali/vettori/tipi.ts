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
  idDocumento: number;
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
  | "misurata"
  | "volume_gestionale";

/** Testata gestionale esposta alla coda operativa delle bolle. */
export interface BollaDocumento {
  idDocumento: number;
  numeroDocumento: string | null;
  dataDocumento: string | null;
  dataCreazione: string | null;
  direzione: string | null;
  soggetto: string | null;
  destinazione: string | null;
  vettoreCodice: string | null;
  vettore: string | null;
  numColli: number | null;
  pesoLordoKg: number | null;
  pesoNettoKg: number | null;
  volumeGestionaleM3: number | null;
  divisoreVolumetrico: number | null;
  statoMisure: StatoMisureBolla;
  misure: BollaMisura[];
}

export interface BolleResponse {
  documenti: BollaDocumento[];
  pagina: number;
  perPagina: number;
  totale: number;
  altrePagine: boolean;
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
