export type BiScope = "user" | "team";

export type BiDataset = "documenti" | "righe_distinta";
export type BiChartType = "kpi" | "bar" | "stacked_bar" | "line" | "combo" | "donut" | "table";
export type BiMetricOp = "count" | "sum" | "avg" | "min" | "max";
export type BiFilterOp = "eq" | "neq" | "contains" | "gte" | "lte" | "between" | "in";

export type BiField =
  | "anno"
  | "mese"
  | "cliente"
  | "categoria"
  | "tipo_prodotto"
  | "stato"
  | "tipo"
  | "numero_offerta"
  | "importo_preventivo"
  | "importo_ordinato"
  | "codice_articolo"
  | "descrizione"
  | "quantita"
  | "prezzo_unitario"
  | "ricarico_pct"
  | "totale_riga";

export interface BiMetricConfig {
  op: BiMetricOp;
  field?: BiField;
  label?: string;
}

export interface BiFilterConfig {
  field: BiField;
  op: BiFilterOp;
  value?: string | number | Array<string | number>;
  value_to?: string | number;
}

export interface BiWidgetConfig {
  id: string;
  title: string;
  type: BiChartType;
  dataset: BiDataset;
  x: number;
  y: number;
  w: number;
  h: number;
  metric: BiMetricConfig;
  secondaryMetric?: BiMetricConfig;
  groupBy?: BiField;
  stackBy?: BiField;
  filters?: BiFilterConfig[];
  ignoresGlobalFilters?: boolean;
}

export interface BiDashboardConfig {
  version: 1;
  filters: BiFilterConfig[];
  widgets: BiWidgetConfig[];
}

export interface BiDashboardRow {
  id: string;
  scope: BiScope;
  user_id: string | null;
  title: string;
  config: BiDashboardConfig;
  updated_at: string;
}

export interface BiDataPoint {
  label: string;
  value: number;
  secondaryValue?: number;
  stack?: Record<string, number>;
  raw?: Record<string, unknown>;
}

export interface BiWidgetResult {
  widget_id: string;
  data: BiDataPoint[];
  total?: number;
}
