// Main application types

export type Ruolo =
  | "superadmin"
  | "amministratore"
  | "responsabile"
  | "responsabile_intermedio"
  | "collaboratore";

export type TipoRisposta = "autovalutazione" | "responsabile";
export type Operatore = ">" | "<" | ">=" | "<=" | "=";
export type StatoSessioneUtente =
  | "programmata"
  | "resp_in_corso"
  | "resp_completata"
  | "collab_in_corso"
  | "completata"
  | "certificata";

export type TipoValutazione =
  | "mensile"
  | "trimestrale"
  | "quadrimestrale"
  | "semestrale"
  | "annuale"
  | "straordinaria";

export type StatoUtente = "attivo" | "inattivo";

export interface Utente {
  id: string;
  nome: string;
  cognome: string;
  email: string;
  ruolo: string; // testo libero, validato da ruoli_config
  ruoli_aggiuntivi: string[];
  reparto: string;
  responsabile_id: string | null;
  stato: StatoUtente;
  created_at: string;
  updated_at: string;
}

// Etichette e colori ruoli (default — sovrascrivibili da ruoli_config DB)
export const RUOLO_LABELS: Record<string, string> = {
  superadmin:              "Superadmin",
  amministratore:          "Amministratore",
  responsabile:            "Responsabile",
  responsabile_intermedio: "Responsabile Intermedio",
  collaboratore:           "Collaboratore",
  // backward compat
  admin:                   "Amministratore",
};

export const RUOLO_COLORS: Record<string, string> = {
  superadmin:              "#c82381",
  amministratore:          "#00a1be",
  responsabile:            "#ee7326",
  responsabile_intermedio: "#f59e0b",
  collaboratore:           "#95c11f",
  // backward compat
  admin:                   "#00a1be",
};

export const TIPO_VALUTAZIONE_LABELS: Record<TipoValutazione, string> = {
  mensile:         "Mensile",
  trimestrale:     "Trimestrale",
  quadrimestrale:  "Quadrimestrale",
  semestrale:      "Semestrale",
  annuale:         "Annuale",
  straordinaria:   "Straordinaria",
};

export const STATO_SESSIONE_LABELS: Record<StatoSessioneUtente, string> = {
  programmata:      "Programmata",
  resp_in_corso:    "In attesa responsabile",
  resp_completata:  "Responsabile completato",
  collab_in_corso:  "In attesa collaboratore",
  completata:       "Completata",
  certificata:      "Certificata",
};

export const STATO_SESSIONE_COLORS: Record<StatoSessioneUtente, string> = {
  programmata:      "#747373",
  resp_in_corso:    "#f59e0b",
  resp_completata:  "#00a1be",
  collab_in_corso:  "#f59e0b",
  completata:       "#22c55e",
  certificata:      "#c82381",
};

// Configurazione ruoli (da DB ruoli_config)
export interface RuoloConfig {
  id: string;
  nome: string;
  slug: string;
  colore: string;
  ordine: number;
  is_system: boolean;
  created_at: string;
}

// Reparto (da DB reparti)
export interface Reparto {
  id: string;
  nome: string;
  descrizione: string | null;
  ordine: number;
  attivo: boolean;
  created_at: string;
}

// Nuove entità sistema valutazioni
export interface RuoloProfessionale {
  id: string;
  nome: string;
  descrizione: string | null;
  portale_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Mansione {
  id: string;
  ruolo_professionale_id: string;
  testo: string;
  parametro_radar_id: string | null;
  ordine: number;
  created_at: string;
}

export interface Skill {
  id: string;
  ruolo_professionale_id: string | null;
  nome: string;
  descrizione: string | null;
  ordine: number;
  created_at: string;
}

export interface SessioneUtente {
  id: string;
  utente_id: string;
  responsabile_id: string | null;
  scala_id: string | null;
  anno: number;
  data_programmata: string | null;
  orario: string | null;
  stato: StatoSessioneUtente;
  tipo_valutazione: TipoValutazione;
  note_admin: string | null;
  certificato_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface RispostaValutazione {
  id: string;
  sessione_utente_id: string;
  mansione_id: string;
  valutatore_id: string;
  punteggio: number;
  tipo: TipoRisposta;
  note: string | null;
  created_at: string;
}

export interface StoricoPunteggio {
  id: string;
  utente_id: string;
  data_valutazione: string;
  anno: number;
  punteggio: number;
  note: string | null;
  tipo_fonte: "import" | "sessione";
  sessione_id: string | null;
  created_at: string;
}

// Tipi legacy (mantenuti per compatibilità)
export interface Mansionario {
  id: string;
  utente_id: string;
  anno: number;
  mansione: string;
  competenze: string[];
  created_at: string;
  updated_at: string;
}

export interface SessioneValutazione {
  id: string;
  anno: number;
  is_aperta: boolean;
  scala_id: string;
  created_at: string;
  updated_at: string;
}

export interface Domanda {
  id: string;
  sessione_id: string;
  testo: string;
  parametro_id: string;
  ordine: number;
  created_at: string;
}

export interface Risposta {
  id: string;
  domanda_id: string;
  utente_id: string;
  valutatore_id: string | null;
  punteggio: number;
  tipo: TipoRisposta;
  created_at: string;
  updated_at: string;
}

export interface ParametroRadar {
  id: string;
  nome: string;
  descrizione: string | null;
  colore: string;
  ordine: number;
  is_storico: boolean;
  created_at: string;
  updated_at: string;
}

export interface KPIConfig {
  id: string;
  nome: string;
  parametro_id: string;
  operatore: Operatore;
  soglia: number;
  anno: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScalaValutazione {
  id: string;
  nome: string;
  min: number;
  max: number;
  labels: Record<number, string>;
  created_at: string;
  updated_at: string;
}

// Radar Chart Data
export interface RadarDataPoint {
  parametro: string;
  autovalutazione: number;
  responsabile: number;
  storico?: number;
}

// Trend chart (grafico a linee analisi dipendente)
export interface TrendDataPoint {
  anno: number;
  data: string;
  punteggio: number;
  tipo_fonte: "import" | "sessione";
}

// Export Power BI
export interface ExportRow {
  anno: number;
  utente_email: string;
  utente_nome: string;
  utente_cognome: string;
  reparto: string;
  parametro: string;
  punteggio_auto: number;
  punteggio_responsabile: number;
  delta: number;
}

// Import storici
export interface ImportStoricRow {
  anno: number;
  utente_email: string;
  parametro: string;
  punteggio: number;
  tipo: TipoRisposta;
}

// Import storico punteggi (media finale)
export interface ImportStoricoPunteggiRow {
  data_valutazione: string; // YYYY-MM-DD o DD/MM/YYYY
  utente_email: string;
  punteggio: number;
  note?: string;
}

export interface ImportResult {
  success: number;
  errors: { row: number; reason: string }[];
  warnings: { row: number; reason: string }[];
}

// ============================================================
// Report Builder
// ============================================================

export type TipoBlocco = "radar" | "bar" | "line" | "pie" | "donut" | "table" | "kpi_card";

export interface ReportConfig {
  id: string;
  nome: string;
  descrizione: string | null;
  visibilita_ruoli: string[];
  created_by: string | null;
  is_attivo: boolean;
  ordine: number;
  created_at: string;
  updated_at: string;
}

// Configurazioni per tipo blocco
export interface BloccoRadarConfig {
  anno: number | null;
  reparti: string[];
  parametri_ids: string[];
  mostra_storico: boolean;
  max_value: number;
  colori?: string[];
}

export interface BloccoBarConfig {
  anno: number | null;
  raggruppamento: "reparto" | "parametro";
  metrica: "autovalutazione" | "responsabile" | "delta";
  reparti: string[];
  parametri_ids: string[];
  colori?: string[];
}

export interface BloccoLineConfig {
  parametri_ids: string[];
  anni_range: [number, number];
  metrica: "autovalutazione" | "responsabile" | "entrambi";
  colori?: string[];
}

export interface BloccoPieConfig {
  distribuzione: "punteggi_fasce" | "stati_sessioni" | "reparti";
  anno: number | null;
  reparti: string[];
  colori?: string[];
}

export interface BloccoTableConfig {
  modalita: "ranking_utenti" | "dettaglio_sessioni";
  anno: number | null;
  reparto: string | null;
  limit: number;
  colonne: string[];
}

export interface BloccoKpiCardConfig {
  kpi_ids: string[];
  anno: number | null;
  mostra_trend: boolean;
}

export type BloccoConfigurazione =
  | BloccoRadarConfig
  | BloccoBarConfig
  | BloccoLineConfig
  | BloccoPieConfig
  | BloccoTableConfig
  | BloccoKpiCardConfig;

export interface ReportBlocco {
  id: string;
  report_id: string;
  ordine: number;
  tipo: TipoBlocco;
  titolo: string | null;
  configurazione: BloccoConfigurazione;
  created_at: string;
}

// Input per wizard (senza id/created_at)
export interface BloccoInput {
  tipo: TipoBlocco;
  titolo: string;
  configurazione: BloccoConfigurazione;
  ordine: number;
}

// Dati calcolati per ogni tipo blocco
export interface BarDataPoint {
  gruppo: string;
  autovalutazione?: number;
  responsabile?: number;
  delta?: number;
}

export interface LineDataPoint {
  anno: number;
  autovalutazione?: number;
  responsabile?: number;
}

export interface PieDataPoint {
  nome: string;
  valore: number;
  colore?: string;
}

export interface TableRow {
  [key: string]: string | number | null;
}

export interface KpiCardData {
  id: string;
  nome: string;
  valore: number | null;
  soglia: number;
  operatore: Operatore;
  status: "ok" | "ko" | "nd";
  trend?: number | null;
}

// Shared server action result type
export type ActionResult = { success: true } | { success: false; error: string };
