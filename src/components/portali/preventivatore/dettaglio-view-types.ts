// Types per la scheda di dettaglio di un preventivo storico/generato.

export type StatoDocumento =
  // legacy (compat con vecchi import)
  | "pending" | "ordinato" | "rifiutato"
  // workflow nuovo (migration 039)
  | "storico" | "aperta" | "presa_in_carico" | "completato" | "inviata" | "ordinata" | "fallita";
export type TipoDocumento = "storico" | "generato";

export interface PreventivoDocumento {
  id: string;
  codice: string | null;
  cliente: string | null;
  tipo: TipoDocumento;
  categoria: string | null;
  tipo_prodotto: string | null;
  anno: number | null;
  stato: StatoDocumento;
  motivo_rifiuto_id: string | null;
  stato_note: string | null;
  numero_offerta: string | null;
  data_offerta: string | null;
  importo_preventivo: number | string | null;
  importo_ordinato: number | string | null;
  importo_finale_raw: number | string | null;
  importo_source: string | null;
  codici_articolo: string[] | null;
  tags: string[] | null;
  note: string | null;
  versione_ingest: string | null;
  consegna_settimane_min: number | null;
  consegna_settimane_max: number | null;
  margine_trattativa_pct: number | string | null;
  created_at: string;
  updated_at: string;
}

export interface TotaleValore {
  raw: number;
  ceil_2: number;
}

export interface LavorazioneVoce {
  voce: string;
  ore?: number | null;
  tariffa_oraria?: number | null;
  totale_raw?: number | null;
  totale_ceil_2?: number | null;
}

export interface ChunkMetadata {
  source_type?: "excel" | "word" | string;
  ruolo_file?: "preventivo_commerciale" | "note_preventivo" | string;
  sheet_name?: string | null;
  codice_blocco?: string | null;
  titolo_voce?: string | null;
  tipo_prodotto?: string | null;
  ingest_mode?: string | null;
  embedding_provider?: "gemini" | "openrouter" | string;
  totals?: Record<string, TotaleValore> | null;
  lavorazioni?: LavorazioneVoce[] | null;
  decision?: string | null;
  note_decisione?: string | null;
}

export interface PreventivoChunkRaw {
  id: string;
  chunk_index: number;
  contenuto: string;
  metadata: ChunkMetadata | null;
}

export interface PreventivoRigaRaw {
  id: string;
  sheet_name: string | null;
  codice_articolo: string | null;
  descrizione: string;
  quantita: number | string | null;
  prezzo_unitario: number | string | null;
  ricarico_pct: number | string | null;
  ricarico_coefficiente?: number | string | null;
  tipo_riga?: string | null; // "materiale" | "manodopera" (preventivi generati)
  scala_con_quantita?: boolean | null;
  totale_riga: number | string | null;
  codice_blocco: string | null;
}

// Blocco salvato dal builder (preventivi tipo='generato').
export interface PreventivoBloccoRaw {
  id: string;
  codice_blocco: string | null;
  sheet_name: string | null;
  totale_ceil_2: number | string | null;
  note: string | null;
  incluso_offerta: boolean | null;
  created_at: string;
  quantita_pezzi?: number | null;
  imballaggio_pct?: number | string | null;
  tempi_accessori_pct?: number | string | null;
  spese_generali_pct?: number | string | null;
  margine_trattativa_pct?: number | string | null;
  costo_complessivo?: number | string | null;
}

export interface PreventivoDettaglio {
  documento: PreventivoDocumento;
  chunks: PreventivoChunkRaw[];
  righe_distinta: PreventivoRigaRaw[];
  blocchi?: PreventivoBloccoRaw[];
  motivo_rifiuto_label: string | null;
}

// Etichette user-friendly per i totali chiave
export const TOTAL_LABELS: Record<string, string> = {
  totale_materiale: "Totale materiale",
  totale_manodopera: "Totale manodopera",
  imballo: "Imballaggio",
  tempi_accessori: "Tempi accessori",
  spese_generali: "Spese generali",
  variabili_progettuali: "Variabili progettuali",
  totale_costi: "Totale costi",
  totale: "Totale",
  prezzo_finale: "Prezzo finale",
  margine_trattativa: "Margine trattativa",
  ricarico_materiale: "Ricarico materiale",
  ricarico_manodopera: "Ricarico manodopera",
};

// Ordine di display dei totali (chiavi mancanti rimangono nascoste)
export const TOTAL_ORDER: string[] = [
  "totale_materiale",
  "ricarico_materiale",
  "totale_manodopera",
  "ricarico_manodopera",
  "imballo",
  "tempi_accessori",
  "spese_generali",
  "variabili_progettuali",
  "totale_costi",
  "totale",
  "margine_trattativa",
  "prezzo_finale",
];
