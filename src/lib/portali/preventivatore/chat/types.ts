// ─── Shared types for the preventivatore chat route ──────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  messages: ChatMessage[];
  contesto?: "archivio" | "nuovo";
  modalita?: "preciso" | "creativo";
  sessione_id?: string | null;
}

export interface DocumentoRow {
  codice: string;
  cliente: string | null;
  stato: string | null;
  categoria: string | null;
  numero_offerta: string | null;
  data_offerta: string | null;
  importo_preventivo: number | null;
  importo_ordinato: number | null;
}

export interface ChunkRow {
  documento_id: string;
  similarity: number;
  contenuto: string;
  metadata: Record<string, unknown> | null;
}

export interface ChunkSearchRow {
  documento_id: string;
  contenuto: string;
  metadata: Record<string, unknown> | null;
}

export interface AggRow {
  gruppo: string;
  count: number;
  sum_importo: number;
  avg_importo: number;
  tasso_ordinato: number;
}

export interface TopArticoloRow {
  codice: string;
  n_preventivi: number;
  esempio_descrizione: string;
}

export interface RigaDistintaRow {
  codice_articolo: string | null;
  descrizione: string;
  prezzo_unitario: number | null;
  quantita: number | null;
  totale_riga: number | null;
  codice_preventivo: string | null;
  cliente: string | null;
  n_utilizzi: number;
}

export interface DettaglioRigaDistinta {
  sheet_name: string | null;
  codice_articolo: string | null;
  descrizione: string;
  quantita: number | null;
  prezzo_unitario: number | null;
  ricarico_pct: number | null;
  totale_riga: number | null;
}

export interface DettaglioRow {
  documento: {
    codice: string;
    cliente: string | null;
    stato: string | null;
    categoria: string | null;
    importo_preventivo: number | null;
    importo_ordinato: number | null;
    data_offerta: string | null;
  };
  testo_completo: string;
  righe_distinta: DettaglioRigaDistinta[];
  n_chunks: number;
}

export type ToolName =
  | "list_preventivi"
  | "cerca_simili"
  | "cerca_articolo"
  | "aggrega_preventivi"
  | "top_articoli"
  | "query_righe_distinta"
  | "dettaglio_preventivo";

export interface ChatHandlerResult {
  risposta: string;
  tool_usato: ToolName | null;
  risultati: unknown[] | null;
}
