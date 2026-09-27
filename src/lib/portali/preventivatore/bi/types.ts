export type BiScope = "user" | "team";

export type BiDataset = "documenti" | "righe_distinta";
export type BiChartType = "kpi" | "bar" | "stacked_bar" | "line" | "combo" | "donut" | "table";
export type BiMetricOp = "count" | "sum" | "avg" | "min" | "max";
export type BiFilterOp = "eq" | "neq" | "contains" | "gte" | "lte" | "between" | "in";

export type BiField =
  | "anno"
  | "mese"
  | "cliente"
  | "cliente_testo"
  | "cliente_codice"
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
  incompleto?: boolean;
}

const BiFieldSchema = z.enum([
  "anno", "mese", "cliente", "cliente_testo", "cliente_codice", "categoria",
  "tipo_prodotto", "stato", "tipo", "numero_offerta", "importo_preventivo",
  "importo_ordinato", "codice_articolo", "descrizione", "quantita",
  "prezzo_unitario", "ricarico_pct", "totale_riga",
]);
const BiValueSchema = z.union([
  z.string().max(200),
  z.number().finite(),
  z.array(z.union([z.string().max(200), z.number().finite()])).max(100),
]);
const BiFilterSchema = z.object({
  field: BiFieldSchema,
  op: z.enum(["eq", "neq", "contains", "gte", "lte", "between", "in"]),
  value: BiValueSchema.optional(),
  value_to: z.union([z.string().max(200), z.number().finite()]).optional(),
});
const BiMetricSchema = z.object({
  op: z.enum(["count", "sum", "avg", "min", "max"]),
  field: BiFieldSchema.optional(),
  label: z.string().max(200).optional(),
});
const BiWidgetSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(120),
  type: z.enum(["kpi", "bar", "stacked_bar", "line", "combo", "donut", "table"]),
  dataset: z.enum(["documenti", "righe_distinta"]),
  x: z.number().int().min(0).max(1000),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1).max(100),
  metric: BiMetricSchema,
  secondaryMetric: BiMetricSchema.optional(),
  groupBy: BiFieldSchema.optional(),
  stackBy: BiFieldSchema.optional(),
  filters: z.array(BiFilterSchema).max(20).optional(),
  ignoresGlobalFilters: z.boolean().optional(),
});

export const BiDashboardConfigSchema = z.object({
  version: z.literal(1),
  filters: z.array(BiFilterSchema).max(20),
  widgets: z.array(BiWidgetSchema).max(40),
});

export const BiDashboardRequestSchema = z.object({
  scope: z.enum(["user", "team"]).optional(),
  title: z.string().trim().min(1).max(120).optional(),
  config: BiDashboardConfigSchema,
});
import { z } from "zod";
