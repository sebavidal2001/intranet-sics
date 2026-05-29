import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BiDashboardConfig,
  BiDataPoint,
  BiField,
  BiFilterConfig,
  BiMetricConfig,
  BiWidgetConfig,
  BiWidgetResult,
} from "./types";

type RawRow = Record<string, string | number | null>;

const DOC_FIELDS = [
  "id",
  "codice",
  "anno",
  "cliente",
  "categoria",
  "tipo_prodotto",
  "stato",
  "tipo",
  "numero_offerta",
  "data_offerta",
  "importo_preventivo",
  "importo_ordinato",
] as const;

const RIGA_FIELDS = [
  "codice_articolo",
  "descrizione",
  "quantita",
  "prezzo_unitario",
  "ricarico_pct",
  "totale_riga",
] as const;

// ─── Whitelist parametri (security) ────────────────────────────────────────────
// Tutti i campi/operatori validi. Qualsiasi cosa fuori da queste liste viene
// rigettata o ignorata, anche se Supabase SDK protegge da SQL injection.
const ALLOWED_FIELDS: ReadonlySet<string> = new Set([
  ...DOC_FIELDS,
  ...RIGA_FIELDS,
  "mese",
]);
const ALLOWED_METRIC_OPS: ReadonlySet<string> = new Set(["count", "sum", "avg", "min", "max"]);
const ALLOWED_FILTER_OPS: ReadonlySet<string> = new Set(["eq", "neq", "contains", "gte", "lte", "between", "in"]);
const ALLOWED_CHART_TYPES: ReadonlySet<string> = new Set(["kpi", "bar", "stacked_bar", "line", "combo", "donut", "table"]);
const ALLOWED_DATASETS: ReadonlySet<string> = new Set(["documenti", "righe_distinta"]);

const DOC_LIMIT = 5000;
const RIGA_LIMIT = 12000;

export function validateWidgetConfig(widget: unknown): { ok: boolean; reason?: string } {
  if (!widget || typeof widget !== "object") return { ok: false, reason: "Widget non valido" };
  const w = widget as Record<string, unknown>;
  if (!ALLOWED_DATASETS.has(String(w.dataset))) return { ok: false, reason: `dataset non ammesso: ${w.dataset}` };
  if (!ALLOWED_CHART_TYPES.has(String(w.type))) return { ok: false, reason: `chart type non ammesso: ${w.type}` };
  const metric = w.metric as Record<string, unknown> | undefined;
  if (!metric || !ALLOWED_METRIC_OPS.has(String(metric.op))) {
    return { ok: false, reason: `metric.op non ammesso: ${metric?.op}` };
  }
  if (metric.field !== undefined && metric.field !== null && !ALLOWED_FIELDS.has(String(metric.field))) {
    return { ok: false, reason: `metric.field non ammesso: ${metric.field}` };
  }
  if (w.groupBy !== undefined && w.groupBy !== null && !ALLOWED_FIELDS.has(String(w.groupBy))) {
    return { ok: false, reason: `groupBy non ammesso: ${w.groupBy}` };
  }
  if (w.stackBy !== undefined && w.stackBy !== null && !ALLOWED_FIELDS.has(String(w.stackBy))) {
    return { ok: false, reason: `stackBy non ammesso: ${w.stackBy}` };
  }
  if (Array.isArray(w.filters)) {
    for (const f of w.filters) {
      const fc = f as Record<string, unknown>;
      if (!ALLOWED_FIELDS.has(String(fc.field))) return { ok: false, reason: `filter.field non ammesso: ${fc.field}` };
      if (!ALLOWED_FILTER_OPS.has(String(fc.op))) return { ok: false, reason: `filter.op non ammesso: ${fc.op}` };
    }
  }
  return { ok: true };
}

function parseDate(value: string | number | null | undefined): Date | null {
  if (!value || typeof value !== "string") return null;
  const m2 = value.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (m2) return new Date(Date.UTC(2000 + Number(m2[3]), Number(m2[2]) - 1, Number(m2[1])));
  const m4 = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m4) return new Date(Date.UTC(Number(m4[3]), Number(m4[2]) - 1, Number(m4[1])));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function monthKey(row: RawRow) {
  const d = parseDate(row.data_offerta);
  if (!d) return "N/D";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function valueForField(row: RawRow, field: BiField | undefined): string | number | null {
  if (!field) return null;
  if (field === "mese") return monthKey(row);
  return row[field] ?? null;
}

function labelFor(value: string | number | null) {
  if (value == null || value === "") return "N/D";
  return String(value);
}

function metricValue(row: RawRow, metric: BiMetricConfig): number {
  if (metric.op === "count") return 1;
  const value = Number(valueForField(row, metric.field));
  return Number.isFinite(value) ? value : 0;
}

function aggregate(rows: RawRow[], metric: BiMetricConfig): number {
  if (metric.op === "count") return rows.length;
  const values = rows.map((row) => metricValue(row, metric)).filter((v) => Number.isFinite(v));
  if (!values.length) return 0;
  if (metric.op === "sum") return values.reduce((sum, v) => sum + v, 0);
  if (metric.op === "avg") return values.reduce((sum, v) => sum + v, 0) / values.length;
  if (metric.op === "min") return Math.min(...values);
  if (metric.op === "max") return Math.max(...values);
  return 0;
}

function matchesFilter(row: RawRow, filter: BiFilterConfig): boolean {
  const raw = valueForField(row, filter.field);
  const value = typeof raw === "string" ? raw.toLowerCase() : raw;
  const target = typeof filter.value === "string" ? filter.value.toLowerCase() : filter.value;

  if (filter.op === "eq") return value === target;
  if (filter.op === "neq") return value !== target;
  if (filter.op === "contains") return String(value ?? "").includes(String(target ?? ""));
  if (filter.op === "in") {
    const list = Array.isArray(filter.value) ? filter.value.map((v) => String(v).toLowerCase()) : [];
    return list.includes(String(raw ?? "").toLowerCase());
  }

  const n = Number(raw);
  const a = Number(filter.value);
  const b = Number(filter.value_to);
  if (!Number.isFinite(n)) return false;
  if (filter.op === "gte") return n >= a;
  if (filter.op === "lte") return n <= a;
  if (filter.op === "between") return n >= a && n <= b;
  return true;
}

function applyFilters(rows: RawRow[], filters: BiFilterConfig[] | undefined) {
  if (!filters?.length) return rows;
  return rows.filter((row) => filters.every((filter) => matchesFilter(row, filter)));
}

function computeWidget(rows: RawRow[], widget: BiWidgetConfig, globalFilters: BiFilterConfig[]): BiWidgetResult {
  const scopedRows = applyFilters(
    rows,
    [...(widget.ignoresGlobalFilters ? [] : globalFilters), ...(widget.filters ?? [])]
  );

  if (widget.type === "kpi" || !widget.groupBy) {
    const value = aggregate(scopedRows, widget.metric);
    return { widget_id: widget.id, total: scopedRows.length, data: [{ label: widget.metric.label ?? "Totale", value }] };
  }

  const groups = new Map<string, RawRow[]>();
  for (const row of scopedRows) {
    const key = labelFor(valueForField(row, widget.groupBy));
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  let data: BiDataPoint[] = Array.from(groups.entries()).map(([label, groupRows]) => {
    const point: BiDataPoint = {
      label,
      value: aggregate(groupRows, widget.metric),
    };
    if (widget.secondaryMetric) point.secondaryValue = aggregate(groupRows, widget.secondaryMetric);
    if (widget.stackBy) {
      const stack: Record<string, number> = {};
      for (const row of groupRows) {
        const stackKey = labelFor(valueForField(row, widget.stackBy));
        stack[stackKey] = (stack[stackKey] ?? 0) + metricValue(row, widget.metric);
      }
      point.stack = stack;
    }
    return point;
  });

  data = data.sort((a, b) => {
    if (widget.groupBy === "mese" || widget.groupBy === "anno") return a.label.localeCompare(b.label);
    return b.value - a.value;
  });

  if (widget.type !== "line" && widget.type !== "stacked_bar" && widget.groupBy !== "mese") {
    data = data.slice(0, widget.type === "table" ? 20 : 12);
  }

  return { widget_id: widget.id, total: scopedRows.length, data };
}

export interface LoadedDataset {
  rows: RawRow[];
  total_in_db: number;
  truncated: boolean;
  limit: number;
}

export async function loadBiRows(
  admin: SupabaseClient,
  dataset: "documenti" | "righe_distinta",
  clienteIds?: string[] | null,
): Promise<LoadedDataset> {
  // Scope commerciale: se clienteIds è un array, limita ai cliente_master_id visibili
  // (lista vuota → nessun record, via UUID impossibile).
  const scopeIds = Array.isArray(clienteIds)
    ? (clienteIds.length > 0 ? clienteIds : ["00000000-0000-0000-0000-000000000000"])
    : null;

  if (dataset === "documenti") {
    let q = admin
      .schema("preventivatore")
      .from("documenti")
      .select(DOC_FIELDS.join(","), { count: "exact" })
      .limit(DOC_LIMIT);
    if (scopeIds) q = q.in("cliente_master_id", scopeIds);
    const { data, count, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as unknown as RawRow[];
    return {
      rows,
      total_in_db: count ?? rows.length,
      truncated: (count ?? 0) > DOC_LIMIT,
      limit: DOC_LIMIT,
    };
  }

  let rq = admin
    .schema("preventivatore")
    .from("righe_distinta")
    .select(`${RIGA_FIELDS.join(",")}, documenti!inner(${DOC_FIELDS.join(",")})`, { count: "exact" })
    .limit(RIGA_LIMIT);
  if (scopeIds) rq = rq.in("documenti.cliente_master_id", scopeIds);
  const { data, count, error } = await rq;
  if (error) throw error;

  const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const doc = row.documenti as RawRow | undefined;
    const flat: RawRow = {};
    for (const field of RIGA_FIELDS) flat[field] = row[field] as string | number | null;
    for (const field of DOC_FIELDS) flat[field] = doc?.[field] ?? null;
    return flat;
  });
  return {
    rows,
    total_in_db: count ?? rows.length,
    truncated: (count ?? 0) > RIGA_LIMIT,
    limit: RIGA_LIMIT,
  };
}

export interface ComputeBiResult {
  results: BiWidgetResult[];
  meta: {
    datasets: Record<string, { total_in_db: number; truncated: boolean; limit: number }>;
    rejected: Array<{ widget_id: string; reason: string }>;
  };
}

export async function computeBiDashboardData(admin: SupabaseClient, config: BiDashboardConfig, clienteIds?: string[] | null): Promise<ComputeBiResult> {
  const byDataset = new Map<string, LoadedDataset>();
  const results: BiWidgetResult[] = [];
  const rejected: Array<{ widget_id: string; reason: string }> = [];

  for (const widget of config.widgets) {
    // ─── Validazione strict: rigetta widget con campi non in whitelist ─────
    const valid = validateWidgetConfig(widget);
    if (!valid.ok) {
      rejected.push({ widget_id: widget.id, reason: valid.reason ?? "validation failed" });
      results.push({ widget_id: widget.id, data: [], total: 0 });
      continue;
    }

    if (!byDataset.has(widget.dataset)) {
      byDataset.set(widget.dataset, await loadBiRows(admin, widget.dataset, clienteIds));
    }
    const ds = byDataset.get(widget.dataset)!;
    results.push(computeWidget(ds.rows, widget, config.filters ?? []));
  }

  const datasets: ComputeBiResult["meta"]["datasets"] = {};
  for (const [name, ds] of byDataset) {
    datasets[name] = { total_in_db: ds.total_in_db, truncated: ds.truncated, limit: ds.limit };
  }

  return { results, meta: { datasets, rejected } };
}
