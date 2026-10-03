/**
 * Tipi del Portale Campagne Marketing (migration 131).
 *
 * Sono la forma delle RISPOSTE delle route: le schermate le leggono tali e quali.
 * Cambiare un campo qui significa cercare tutti i chiamanti, perché il `fetch`
 * non è tipizzato e type-check e test non vedono una schermata rotta.
 */

export type StatoCampagna = "attiva" | "sospesa" | "terminata";

export type StatoInvio =
  | "preparata"
  | "da_spedire"
  | "consegnata"
  | "consegnata_banco"
  | "annullata";

export type FonteConsegna = "ddt" | "banco" | "manuale" | "import_excel";

export interface Cliente {
  codice_cliente: string;
  ragione_sociale: string;
  agente_nome: string | null;
  cat_commerciale: string | null;
  cat_attivita: string | null;
  rivenditore: boolean;
}

export interface Campagna {
  id: string;
  codice: string;
  nome: string;
  note: string | null;
  articolo_codice: string;
  testo_riconoscimento: string[];
  marchio: string | null;
  articoli_promossi: string[];
  stato: StatoCampagna;
  ordine: number;
  stato_cambiato_il: string;
  created_at: string;
}

export interface CampagnaRiepilogo extends Campagna {
  destinatari: number;
  preparate: number;
  da_spedire: number;
  consegnate: number;
  consegnate_banco: number;
}

export interface Invio {
  id: string;
  campagna_id: string;
  codice_cliente: string;
  ragione_sociale: string;
  stato: StatoInvio;
  referente: string | null;
  ordine_numero: string | null;
  ordine_anno: number | null;
  assegnata_il: string;
  data_consegna: string | null;
  consegna_registrata_il: string | null;
  fonte_consegna: FonteConsegna | null;
  origine: "app" | "import_excel";
  note: string | null;
  annullata_il: string | null;
  motivo_annullo: string | null;
  campagna: { codice: string; nome: string } | null;
  // Fase 2: cosa ha trovato il controllo contro Impresa.
  ordine_profilo: string | null;
  ordine_data: string | null;
  ordine_data_consegna: string | null;
  riga_vista_il: string | null;
  ddt_numero: string | null;
  ddt_metodo: "provenienza" | "euristico" | null;
  ultimo_controllo_il: string | null;
  controllo_esito: EsitoControlloInvio | null;
}

export type EsitoControlloInvio =
  | "attesa_dati"
  | "riga_trovata"
  | "consegnata"
  | "ordine_non_trovato"
  | "riga_mancante"
  | "campagna_incoerente"
  | "evasa_senza_ddt";

export type TipoAnomalia =
  | "ordine_non_trovato"
  | "riga_mancante"
  | "campagna_incoerente"
  | "riga_senza_campagna"
  | "evasa_senza_ddt"
  | "documentazione_senza_busta"
  | "ordine_invertito";

export interface Anomalia {
  id: string;
  tipo: TipoAnomalia;
  gravita: "errore" | "avviso";
  codice_cliente: string;
  ragione_sociale: string | null;
  invio_id: string | null;
  campagna_id: string | null;
  ordine_numero: string | null;
  ordine_anno: number | null;
  dettaglio: Record<string, unknown>;
  stato: "aperta" | "risolta" | "ignorata";
  aperta_il: string;
  ultima_vista_il: string;
  risolta_il: string | null;
  risolta_con: "automatica" | "manuale" | "scambio" | null;
  nota: string | null;
}

/** Un ordine aperto di un cliente, per scegliere a quale allegare la busta. */
export interface OrdineAperto {
  profilo: string;
  numero: string;
  anno: number;
  data_ordine: string;
  consegna_prevista: string | null;
  /** L'invio già legato a questo ordine, se c'è. */
  invio_id: string | null;
  /** L'ordine ha già la riga con l'articolo di una campagna. */
  ha_documentazione: boolean;
}

/** Un ordine recente che aspetta la sua busta: il rosso della dashboard. */
export interface DaPreparare {
  codice_cliente: string;
  ragione_sociale: string;
  profilo: string;
  ordine_numero: string;
  ordine_anno: number;
  data_ordine: string;
  consegna_prevista: string | null;
  campagna_id: string;
  campagna_codice: string;
  campagna_nome: string;
}

export interface ControlloEseguito {
  id: string;
  origine: "notturno" | "manuale";
  iniziato_il: string;
  finito_il: string | null;
  esito: "in_corso" | "ok" | "errore";
  dati_del: string | null;
  invii_controllati: number | null;
  invii_aggiornati: number | null;
  anomalie_aperte: number | null;
  anomalie_risolte: number | null;
  errore: string | null;
}

/** Tutto ciò che serve alla scheda di un cliente, in una risposta. */
export interface SchedaCliente {
  cliente: Cliente;
  invii: Invio[];
  /** Campagne assegnabili, dalla più vecchia: la prima è la suggerita. */
  assegnabili: Campagna[];
  /** Ordini aperti del cliente (da Impresa, aggiornati ogni notte). Vuoto se non leggibili. */
  ordini_aperti: OrdineAperto[];
  /** Anomalie aperte del cliente. */
  anomalie: Anomalia[];
}

export interface DashboardCampagne {
  preparate: number;
  da_spedire: number;
  consegnate_30_giorni: number;
  da_preparare: number;
  anomalie: number;
  ultimo_controllo: ControlloEseguito | null;
}

export interface PubblicoStandard {
  /** Agenti presi con tutti i loro clienti (che rientrano nei filtri). */
  agenti: string[];
  categorie_commerciali: string[];
  /** Categorie di attività dei clienti (`COSTR. macch.automatiche`...). Vuoto = tutte. */
  categorie_attivita: string[];
  /** Clienti scelti a mano, fuori dai filtri. */
  clienti_extra: string[];
  aggiornato_il: string;
}

/** Un cliente non rivenditore, con quanto serve a scegliere il pubblico. */
export interface ClientePubblicoRiga {
  codice_cliente: string;
  ragione_sociale: string;
  agente_nome: string | null;
  cat_commerciale: string | null;
  cat_attivita: string | null;
}

export interface PubblicoStandardResponse {
  config: PubblicoStandard;
  /** Quanti clienti raggiunge la regola salvata, secondo il database. */
  raggiunti: number;
  /** Tutti i clienti non rivenditori: la pagina ci calcola in tempo reale quanti ne raggiunge la regola in modifica. */
  clienti: ClientePubblicoRiga[];
}

/** Una campagna ricevuta (o in lavorazione) da un cliente, per i chip dell'elenco. */
export interface CampagnaDelCliente {
  codice: string;
  nome: string;
  stato: StatoInvio;
  data: string | null;
  /** Fa parte delle campagne scelte nel filtro. */
  selezionata: boolean;
}

export interface ClienteConCampagne {
  codice_cliente: string;
  ragione_sociale: string;
  agente_nome: string | null;
  cat_attivita: string | null;
  /** Campagne effettivamente RICEVUTE (consegnate o al banco). */
  n_ricevute: number;
  campagne: CampagnaDelCliente[];
}

export interface ElencoClientiCampagne {
  clienti: ClienteConCampagne[];
  totale: number;
}

export interface CategoriaClienti {
  categoria: string;
  totale: number;
  selezionati: number;
}

export interface ClienteSelezione {
  codice_cliente: string;
  ragione_sociale: string;
  agente_nome: string | null;
  cat_commerciale: string | null;
  selezionato: boolean;
  /** Ha già un invio per la campagna: non si può togliere dai destinatari. */
  ha_invio: boolean;
}

export interface InvioElenco extends Omit<Invio, "campagna"> {
  campagna: { codice: string; nome: string } | null;
}

export interface ElencoInvii {
  invii: InvioElenco[];
  totale: number;
}
