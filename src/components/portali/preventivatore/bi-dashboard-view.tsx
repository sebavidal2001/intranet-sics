"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Eye,
  Grip,
  LayoutGrid,
  Loader2,
  Pencil,
  Plus,
  Save,
  Settings2,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { DEFAULT_BI_DASHBOARD, BI_FIELD_LABELS } from "@/lib/portali/preventivatore/bi/defaults";
import type {
  BiChartType,
  BiDashboardConfig,
  BiDashboardRow,
  BiDataset,
  BiField,
  BiMetricOp,
  BiScope,
  BiWidgetConfig,
  BiWidgetResult,
} from "@/lib/portali/preventivatore/bi/types";

const COLORS: Record<string, string> = {
  nastri: "#00a1be",
  scale: "#95c11f",
  protezioni: "#ee7326",
  strutture: "#747373",
  automazioni: "#c82381",
  altro: "#e73331",
  pending: "#ee7326",
  ordinato: "#95c11f",
  rifiutato: "#e73331",
  default: "#00a1be",
};

const CHART_TYPES: BiChartType[] = ["kpi", "bar", "stacked_bar", "line", "combo", "donut", "table"];
const DATASETS: BiDataset[] = ["documenti", "righe_distinta"];
const METRICS: BiMetricOp[] = ["count", "sum", "avg", "min", "max"];
const FIELDS = Object.keys(BI_FIELD_LABELS) as BiField[];

function fmtNumber(value: number) {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(value);
}

function fmtEuro(value: number) {
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

function colorFor(label: string, index = 0) {
  return COLORS[label] ?? [COLORS.default, "#95c11f", "#ee7326", "#747373", "#c82381", "#e73331"][index % 6];
}

function normalizeConfig(config: BiDashboardConfig | null | undefined): BiDashboardConfig {
  if (!config || config.version !== 1 || !Array.isArray(config.widgets)) return DEFAULT_BI_DASHBOARD;
  return { version: 1, filters: config.filters ?? [], widgets: config.widgets };
}

interface BiMeta {
  datasets?: Record<string, { total_in_db: number; truncated: boolean; limit: number }>;
  rejected?: Array<{ widget_id: string; reason: string }>;
}

interface FiltroGlobaleOption {
  anni: number[];
  clienti: string[];
  categorie: string[];
}

export function BiDashboardView() {
  const [scope, setScope] = useState<BiScope>("user");
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [dashboard, setDashboard] = useState<BiDashboardRow | null>(null);
  const [config, setConfig] = useState<BiDashboardConfig>(DEFAULT_BI_DASHBOARD);
  const [results, setResults] = useState<Record<string, BiWidgetResult>>({});
  const [meta, setMeta] = useState<BiMeta>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchingData, setFetchingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FiltroGlobaleOption>({ anni: [], clienti: [], categorie: [] });

  // useMemo per evitare ricerca lineare su ogni render
  const selected = useMemo(
    () => config.widgets.find((w) => w.id === selectedId) ?? null,
    [config.widgets, selectedId]
  );

  // Carica opzioni filtri globali una volta sola al mount
  useEffect(() => {
    fetch("/api/portali/preventivatore/bi/filters-options", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setFilterOptions(j))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/portali/preventivatore/bi?scope=${scope}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => {
        if (!active) return;
        const row = json.dashboard as BiDashboardRow;
        setDashboard(row);
        const next = normalizeConfig(row.config);
        setConfig(next);
        setSelectedId(next.widgets[0]?.id ?? null);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [scope]);

  // Debounced fetch su config: aspetta 350ms di "quiete" prima di ricalcolare.
  // Evita refetch storm durante drag/resize widget e digitazione nell'editor.
  useEffect(() => {
    let active = true;
    const t = setTimeout(() => {
      setFetchingData(true);
      fetch("/api/portali/preventivatore/bi/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      })
        .then((r) => r.json())
        .then((json) => {
          if (!active) return;
          const map: Record<string, BiWidgetResult> = {};
          for (const item of (json.results ?? []) as BiWidgetResult[]) map[item.widget_id] = item;
          setResults(map);
          setMeta((json.meta as BiMeta) ?? {});
        })
        .catch(() => {
          if (!active) return;
          setResults({});
        })
        .finally(() => active && setFetchingData(false));
    }, 350);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [config]);

  const save = async () => {
    if (!dashboard) return;
    setSaving(true);
    try {
      const res = await fetch("/api/portali/preventivatore/bi", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, title: dashboard.title, config }),
      });
      const json = await res.json();
      setDashboard(json.dashboard);
    } finally {
      setSaving(false);
    }
  };

  const updateWidget = (id: string, patch: Partial<BiWidgetConfig>) => {
    setConfig((cur) => ({
      ...cur,
      widgets: cur.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
    }));
  };

  const addWidget = (widget?: Partial<BiWidgetConfig>) => {
    const id = `w-${Date.now()}`;
    const next: BiWidgetConfig = {
      id,
      title: widget?.title ?? "Nuovo grafico",
      type: widget?.type ?? "bar",
      dataset: widget?.dataset ?? "documenti",
      x: 0,
      y: Math.max(0, ...config.widgets.map((w) => w.y + w.h)),
      w: widget?.w ?? 4,
      h: widget?.h ?? 4,
      metric: widget?.metric ?? { op: "count", label: "Conteggio" },
      secondaryMetric: widget?.secondaryMetric,
      groupBy: widget?.groupBy ?? "categoria",
      stackBy: widget?.stackBy,
      filters: widget?.filters ?? [],
      ignoresGlobalFilters: widget?.ignoresGlobalFilters,
    };
    setConfig((cur) => ({ ...cur, widgets: [...cur.widgets, next] }));
    setSelectedId(id);
    setMode("edit");
  };

  const proposeAi = async () => {
    if (!aiPrompt.trim() || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/portali/preventivatore/bi/ai-propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt }),
      });
      const json = await res.json();
      if (json.widget) addWidget(json.widget);
      setAiPrompt("");
    } finally {
      setAiLoading(false);
    }
  };

  // ─── Filtri globali ─────────────────────────────────────────────────────────
  // Gestione UI dei filtri (anno/cliente/categoria) → salvati in config.filters
  const globalFilterValue = useCallback((field: BiField): string | string[] | null => {
    const f = (config.filters ?? []).find((x) => x.field === field);
    return (f?.value as string | string[]) ?? null;
  }, [config.filters]);

  const setGlobalFilter = (field: BiField, value: string | null) => {
    setConfig((cur) => {
      const others = (cur.filters ?? []).filter((x) => x.field !== field);
      if (!value) return { ...cur, filters: others };
      return { ...cur, filters: [...others, { field, op: "eq", value }] };
    });
  };

  // Memoized callbacks per stabilizzare props di WidgetCard
  const updateWidgetMemo = useCallback(updateWidget, []);
  const deleteWidgetMemo = useCallback((id: string) => {
    setConfig((cur) => ({ ...cur, widgets: cur.widgets.filter((w) => w.id !== id) }));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  // Truncation flags da meta
  const truncations = useMemo(() => {
    const out: Array<{ dataset: string; total: number; limit: number }> = [];
    for (const [name, m] of Object.entries(meta.datasets ?? {})) {
      if (m.truncated) out.push({ dataset: name, total: m.total_in_db, limit: m.limit });
    }
    return out;
  }, [meta]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-[#00a1be]" />
            <h1 className="text-2xl font-tenorite font-bold text-[#0f1720]">BI Preventivatore</h1>
          </div>
          <p className="mt-1 text-sm text-text-muted">Crea, modifica e salva dashboard personali o di team sui dati dei preventivi.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={scope} onChange={(v) => setScope(v as BiScope)} options={[
            { value: "user", label: "Personale" },
            { value: "team", label: "Team" },
          ]} />
          <Segmented value={mode} onChange={(v) => setMode(v as "view" | "edit")} options={[
            { value: "view", label: "Vista", icon: Eye },
            { value: "edit", label: "Modifica", icon: Pencil },
          ]} />
          <button onClick={save} disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#00a1be] px-3 text-sm font-semibold text-white disabled:opacity-60">
            <Save className="h-4 w-4" />
            {saving ? "Salvo..." : "Salva"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_320px]">
        <section className="space-y-4">
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-3 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Filtri globali</span>
              <GlobalFilterSelect
                label="Anno"
                value={(globalFilterValue("anno") as string) ?? ""}
                options={filterOptions.anni.map((a) => ({ value: String(a), label: String(a) }))}
                onChange={(v) => setGlobalFilter("anno", v || null)}
              />
              <GlobalFilterSelect
                label="Cliente"
                value={(globalFilterValue("cliente") as string) ?? ""}
                options={filterOptions.clienti.map((c) => ({ value: c, label: c }))}
                onChange={(v) => setGlobalFilter("cliente", v || null)}
              />
              <GlobalFilterSelect
                label="Categoria"
                value={(globalFilterValue("categoria") as string) ?? ""}
                options={filterOptions.categorie.map((c) => ({ value: c, label: c }))}
                onChange={(v) => setGlobalFilter("categoria", v || null)}
              />
              <FilterPill label="Scope" value={scope === "team" ? "Team" : "Personale"} />
              {fetchingData && (
                <span className="inline-flex items-center gap-1 text-[11px] text-text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" /> Aggiornamento…
                </span>
              )}
              <button
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-[#00a1be]/25 px-2.5 text-xs font-semibold text-[#007a91]"
                onClick={() => addWidget()}
              >
                <Plus className="h-3.5 w-3.5" />
                Widget
              </button>
            </div>
            {truncations.length > 0 && (
              <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-amber-900">
                  <strong>Dataset troncato:</strong>
                  {truncations.map((t) => (
                    <span key={t.dataset} className="ml-2">
                      {t.dataset}: caricate {t.limit}/{t.total} righe.
                    </span>
                  ))}
                  <span className="ml-1 text-amber-700">I risultati possono essere parziali.</span>
                </div>
              </div>
            )}
            {(meta.rejected ?? []).length > 0 && (
              <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs">
                <X className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                <div className="text-red-900">
                  <strong>Widget rifiutati ({(meta.rejected ?? []).length}):</strong>
                  {(meta.rejected ?? []).map((r) => (
                    <div key={r.widget_id} className="ml-1 mt-0.5">{r.reason}</div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {loading ? (
            <div className="h-96 rounded-2xl bg-white p-8 text-sm text-text-muted">Caricamento dashboard...</div>
          ) : (
            <DashboardGrid
              config={config}
              results={results}
              selectedId={selectedId}
              mode={mode}
              onSelect={setSelectedId}
              onUpdate={updateWidgetMemo}
              onDelete={deleteWidgetMemo}
            />
          )}
        </section>

        <aside className="space-y-4">
          <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
              <Bot className="h-4 w-4 text-[#00a1be]" />
              <h2 className="text-sm font-semibold text-[#0f1720]">AI proposta grafico</h2>
            </div>
            <textarea
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              rows={3}
              placeholder="Es. mostrami valore dei nastri per cliente"
              className="w-full resize-none rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#00a1be]/30"
            />
            <button
              onClick={proposeAi}
              disabled={aiLoading || !aiPrompt.trim()}
              className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[#ee7326] text-xs font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {aiLoading ? <><Loader2 className="h-3 w-3 animate-spin" /> Generazione…</> : "Genera proposta"}
            </button>
          </div>

          {mode === "edit" && selected ? (
            <WidgetEditor widget={selected} onChange={(patch) => updateWidget(selected.id, patch)} />
          ) : (
            <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 text-sm text-text-muted shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <Users className="h-4 w-4 text-[#00a1be]" />
                <span className="font-semibold text-[#0f1720]">Modalita vista</span>
              </div>
              Passa a Modifica e seleziona un widget per cambiare metrica, grafico, dimensione e comportamento dei filtri.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function DashboardGrid({
  config,
  results,
  selectedId,
  mode,
  onSelect,
  onUpdate,
  onDelete,
}: {
  config: BiDashboardConfig;
  results: Record<string, BiWidgetResult>;
  selectedId: string | null;
  mode: "view" | "edit";
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<BiWidgetConfig>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="grid auto-rows-[72px] grid-cols-12 gap-4">
      {config.widgets.map((widget) => (
        <WidgetCard
          key={widget.id}
          widget={widget}
          result={results[widget.id]}
          selected={selectedId === widget.id}
          mode={mode}
          onSelect={() => onSelect(widget.id)}
          onUpdate={(patch) => onUpdate(widget.id, patch)}
          onDelete={() => onDelete(widget.id)}
        />
      ))}
    </div>
  );
}

const WidgetCard = memo(function WidgetCard({
  widget,
  result,
  selected,
  mode,
  onSelect,
  onUpdate,
  onDelete,
}: {
  widget: BiWidgetConfig;
  result?: BiWidgetResult;
  selected: boolean;
  mode: "view" | "edit";
  onSelect: () => void;
  onUpdate: (patch: Partial<BiWidgetConfig>) => void;
  onDelete: () => void;
}) {
  const dragRef = useRef<{
    kind: "move" | "resize";
    startX: number;
    startY: number;
    startGridX: number;
    startGridY: number;
    startW: number;
    startH: number;
  } | null>(null);
  // Stato locale durante drag: commit-on-pointerup → niente refetch storm.
  const [previewPos, setPreviewPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const data = result?.data ?? [];

  const startMove = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "move",
      startX: e.clientX,
      startY: e.clientY,
      startGridX: widget.x,
      startGridY: widget.y,
      startW: widget.w,
      startH: widget.h,
    };
    setPreviewPos({ x: widget.x, y: widget.y, w: widget.w, h: widget.h });
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "resize",
      startX: e.clientX,
      startY: e.clientY,
      startGridX: widget.x,
      startGridY: widget.y,
      startW: widget.w,
      startH: widget.h,
    };
    setPreviewPos({ x: widget.x, y: widget.y, w: widget.w, h: widget.h });
  };

  const moveResize = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = Math.round((e.clientX - dragRef.current.startX) / 90);
    const dy = Math.round((e.clientY - dragRef.current.startY) / 72);
    if (dragRef.current.kind === "move") {
      const nextX = Math.min(12 - widget.w, Math.max(0, dragRef.current.startGridX + dx));
      const nextY = Math.max(0, dragRef.current.startGridY + dy);
      setPreviewPos((p) => ({ ...(p ?? widget), x: nextX, y: nextY }));
    } else {
      setPreviewPos((p) => ({
        ...(p ?? widget),
        w: Math.min(12, Math.max(3, dragRef.current!.startW + dx)),
        h: Math.min(8, Math.max(2, dragRef.current!.startH + dy)),
      }));
    }
  };

  const commitDrag = () => {
    if (dragRef.current && previewPos) {
      // Commit del cambio solo a pointerup → unica re-renderizzazione + 1 refetch debounced
      onUpdate(previewPos);
    }
    dragRef.current = null;
    setPreviewPos(null);
  };

  const display = previewPos ?? { x: widget.x, y: widget.y, w: widget.w, h: widget.h };

  return (
    <article
      onClick={onSelect}
      onPointerMove={moveResize}
      onPointerUp={commitDrag}
      onPointerCancel={commitDrag}
      className={`relative overflow-hidden rounded-xl border bg-white p-4 shadow-sm transition ${selected ? "border-[#00a1be] ring-2 ring-[#00a1be]/15" : "border-[#e2e8f0]"} ${previewPos ? "opacity-90 ring-2 ring-[#00a1be]/40" : ""}`}
      style={{
        gridColumn: `${Math.min(12, Math.max(1, display.x + 1))} / span ${Math.min(12, Math.max(1, display.w))}`,
        gridRow: `${Math.max(1, display.y + 1)} / span ${Math.min(8, Math.max(1, display.h))}`,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[#0f1720]">{widget.title}</h3>
          <p className="text-[10px] uppercase tracking-wide text-text-muted">{widget.dataset} · {widget.type}</p>
        </div>
        {mode === "edit" && (
          <div className="flex items-center gap-1">
            <button onPointerDown={startMove} className="cursor-grab rounded p-1 text-text-muted hover:bg-[#00a1be]/10 hover:text-[#007a91]" title="Sposta widget">
              <Grip className="h-4 w-4" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="rounded p-1 text-[#e73331] hover:bg-[#e73331]/10">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <WidgetRenderer widget={widget} data={data} />

      {mode === "edit" && (
        <div
          onPointerDown={startResize}
          className="absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize rounded border-b-2 border-r-2 border-[#00a1be]/70"
        />
      )}
    </article>
  );
});

function WidgetRenderer({ widget, data }: { widget: BiWidgetConfig; data: BiWidgetResult["data"] }) {
  const chartData = useMemo(() => data.map((d) => ({ ...d, ...d.stack })), [data]);
  const stackKeys = useMemo(() => Array.from(new Set(data.flatMap((d) => Object.keys(d.stack ?? {})))), [data]);

  if (widget.type === "kpi") {
    const value = data[0]?.value ?? 0;
    const isMoney = widget.metric.field?.includes("importo") || widget.metric.field === "totale_riga";
    return (
      <div className="flex h-[calc(100%-34px)] flex-col justify-end">
        <p className="text-3xl font-bold text-[#00a1be]">{isMoney ? fmtEuro(value) : fmtNumber(value)}</p>
        <p className="mt-1 text-xs text-text-muted">{widget.metric.label ?? "Totale"}</p>
      </div>
    );
  }

  if (widget.type === "table") {
    return (
      <div className="max-h-[calc(100%-38px)] overflow-auto">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-white text-[10px] uppercase text-text-muted">
            <tr><th className="py-1">Voce</th><th className="py-1 text-right">Valore</th></tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-t border-[#e2e8f0]">
                <td className="py-1.5 font-mono text-[#007a91]">{d.label}</td>
                <td className="py-1.5 text-right font-semibold">{fmtNumber(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (widget.type === "donut") {
    return (
      <ResponsiveContainer width="100%" height="78%">
        <PieChart>
          <Pie data={chartData} dataKey="value" nameKey="label" innerRadius="48%" outerRadius="78%" paddingAngle={2}>
            {chartData.map((d, i) => <Cell key={d.label} fill={colorFor(String(d.label), i)} />)}
          </Pie>
          <Tooltip formatter={(v) => fmtNumber(Number(v))} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (widget.type === "line") {
    return (
      <ResponsiveContainer width="100%" height="78%">
        <LineChart data={chartData}>
          <CartesianGrid stroke="#eef2f7" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Line type="monotone" dataKey="value" stroke="#00a1be" strokeWidth={2.5} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  if (widget.type === "combo") {
    return (
      <ResponsiveContainer width="100%" height="78%">
        <ComposedChart data={chartData}>
          <CartesianGrid stroke="#eef2f7" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Bar dataKey="value" fill="#00a1be" radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="secondaryValue" stroke="#ee7326" strokeWidth={2.4} />
        </ComposedChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="78%">
      <BarChart data={chartData}>
        <CartesianGrid stroke="#eef2f7" />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
        <YAxis tick={{ fontSize: 10 }} />
        <Tooltip />
        {widget.type === "stacked_bar" && stackKeys.length > 0 ? (
          stackKeys.map((key, i) => <Bar key={key} dataKey={key} stackId="a" fill={colorFor(key, i)} radius={i === stackKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />)
        ) : (
          <Bar dataKey="value" fill="#00a1be" radius={[4, 4, 0, 0]} />
        )}
        {widget.type === "stacked_bar" && <Legend wrapperStyle={{ fontSize: 10 }} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

function WidgetEditor({ widget, onChange }: { widget: BiWidgetConfig; onChange: (patch: Partial<BiWidgetConfig>) => void }) {
  return (
    <div className="rounded-xl border border-[#e2e8f0] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-[#00a1be]" />
        <h2 className="text-sm font-semibold text-[#0f1720]">Editor widget</h2>
      </div>
      <div className="space-y-3">
        <Field label="Titolo">
          <input value={widget.title} onChange={(e) => onChange({ title: e.target.value })} className="input-bi" />
        </Field>
        <Field label="Tipo grafico">
          <select value={widget.type} onChange={(e) => onChange({ type: e.target.value as BiChartType })} className="input-bi">
            {CHART_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Dataset">
          <select value={widget.dataset} onChange={(e) => onChange({ dataset: e.target.value as BiDataset })} className="input-bi">
            {DATASETS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Metrica">
          <div className="grid grid-cols-2 gap-2">
            <select value={widget.metric.op} onChange={(e) => onChange({ metric: { ...widget.metric, op: e.target.value as BiMetricOp } })} className="input-bi">
              {METRICS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={widget.metric.field ?? ""} onChange={(e) => onChange({ metric: { ...widget.metric, field: (e.target.value || undefined) as BiField | undefined } })} className="input-bi">
              <option value="">Conteggio</option>
              {FIELDS.map((f) => <option key={f} value={f}>{BI_FIELD_LABELS[f]}</option>)}
            </select>
          </div>
        </Field>
        <Field label="Raggruppa per">
          <select value={widget.groupBy ?? ""} onChange={(e) => onChange({ groupBy: (e.target.value || undefined) as BiField | undefined })} className="input-bi">
            <option value="">Nessuno</option>
            {FIELDS.map((f) => <option key={f} value={f}>{BI_FIELD_LABELS[f]}</option>)}
          </select>
        </Field>
        <Field label="Impila per">
          <select value={widget.stackBy ?? ""} onChange={(e) => onChange({ stackBy: (e.target.value || undefined) as BiField | undefined })} className="input-bi">
            <option value="">Nessuno</option>
            {FIELDS.map((f) => <option key={f} value={f}>{BI_FIELD_LABELS[f]}</option>)}
          </select>
        </Field>
        <label className="flex items-center justify-between rounded-lg bg-[#f8fafc] px-3 py-2 text-xs">
          <span className="font-medium text-[#0f1720]">Ignora filtri globali</span>
          <input type="checkbox" checked={Boolean(widget.ignoresGlobalFilters)} onChange={(e) => onChange({ ignoresGlobalFilters: e.target.checked })} className="accent-[#00a1be]" />
        </label>
      </div>
      <style jsx>{`
        .input-bi {
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          padding: 0.45rem 0.6rem;
          font-size: 0.8125rem;
          outline: none;
        }
        .input-bi:focus {
          box-shadow: 0 0 0 2px rgba(0, 161, 190, 0.24);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</span>
      {children}
    </label>
  );
}

function Segmented({ value, options, onChange }: { value: string; options: Array<{ value: string; label: string; icon?: React.ElementType }>; onChange: (value: string) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-[#dbe5ee] bg-white p-1">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition"
            style={{ backgroundColor: active ? "rgba(0,161,190,0.14)" : "transparent", color: active ? "#007a91" : "#64748b" }}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function FilterPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#00a1be]/10 px-2 py-1 text-[11px] font-medium text-[#007a91]">
      <span className="text-[#64748b]">{label}</span>
      {value}
    </span>
  );
}

function GlobalFilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1 rounded-full border border-[#e2e8f0] bg-white pl-2 pr-1 py-0.5 text-[11px]">
      <span className="text-[#64748b] font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-[11px] font-medium text-[#007a91] outline-none cursor-pointer max-w-[140px]"
      >
        <option value="">tutti</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {value && (
        <button
          onClick={() => onChange("")}
          className="ml-0.5 rounded-full p-0.5 text-text-muted hover:bg-bg-page"
          title="Rimuovi filtro"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </label>
  );
}
