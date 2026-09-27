// ─── Shared types for the preventivatore chat route ──────────────────────────

import type { TOOL_DEFINITIONS } from "./tool-definitions";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Snapshot dello stato builder, inviato solo quando contesto="nuovo".
 * Il route handler lo serializza nel system prompt per chat builder-aware.
 */
export interface BuilderStateForChat {
  titolo: string | null;
  cliente: {
    /** clienti_master.id: serve allo scope commerciale degli esempi di scheda. */
    id?: string | null;
    ragione_sociale: string;
    piva: string | null;
    citta: string | null;
    provincia: string | null;
  } | null;
  data_consegna: string | null;
  blocchi: Array<{
    numero: number;
    tipo: string;
    nome: string;
    note: string;
    articoli: Array<{
      codice: string;
      descrizione: string;
      qty: number;
      ult_costo: number;
      coeff_ricarico: number;
      netto: number;
    }>;
    lavorazioni: Array<{
      nome: string;
      categoria: string;
      ore: number;
      tariffa_ora: number;
      markup_pct: number;
      totale: number;
    }>;
    totale_materiali: number;
    totale_servizi: number;
    totale_blocco: number;
  }>;
  totali: {
    materiali: number;
    servizi: number;
    netto_totale: number;
    n_blocchi: number;
    n_articoli: number;
    ore_totali: number;
    coeff_ricarico_medio: number;
  };
}

export interface ChatRequestBody {
  messages: ChatMessage[];
  contesto?: "archivio" | "nuovo";
  modalita?: "preciso" | "creativo";
  sessione_id?: string | null;
  builder_state?: BuilderStateForChat;
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
  data_consegna_richiesta?: string | null;
  data_consegna_confermata?: string | null;
  data_consegna_effettiva?: string | null;
  giorni_consegna_offerti?: number | null;
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

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export interface FonteTool {
  tool: ToolName;
  n: number;
}

export interface ChatUsage {
  provider: "openrouter";
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  cost: number | null;
  currency: "usd";
  source: "exact" | "estimated";
}

export interface ChatHandlerResult {
  risposta: string;
  tool_usato: ToolName | null;
  risultati: unknown;
  fonti: FonteTool[];
  provider: "openrouter";
  modello: string;
  fallback: boolean;
  usage?: ChatUsage | null;
}
