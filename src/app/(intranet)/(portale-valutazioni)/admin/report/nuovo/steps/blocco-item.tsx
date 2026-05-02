"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, ChevronUp, ChevronDown, BarChart2, TrendingUp, PieChart, Table2, Target, Activity } from "lucide-react";
import type {
  TipoBlocco, BloccoInput,
  BloccoRadarConfig, BloccoBarConfig, BloccoLineConfig,
  BloccoPieConfig, BloccoTableConfig, BloccoKpiCardConfig,
} from "@/lib/types";

// ── Helpers ──────────────────────────────────────────────────────────────────

export const TIPO_LABELS: Record<TipoBlocco, string> = {
  radar: "Radar", bar: "Barre", line: "Linee", pie: "Torta", donut: "Donut", table: "Tabella", kpi_card: "KPI Card",
};

export const TIPO_ICONS: Record<TipoBlocco, React.ReactNode> = {
  radar: <Activity className="w-4 h-4" />,
  bar: <BarChart2 className="w-4 h-4" />,
  line: <TrendingUp className="w-4 h-4" />,
  pie: <PieChart className="w-4 h-4" />,
  donut: <PieChart className="w-4 h-4" />,
  table: <Table2 className="w-4 h-4" />,
  kpi_card: <Target className="w-4 h-4" />,
};

// ── Color Picker ──────────────────────────────────────────────────────────────

function ColorSwatch({ color, onChange, onRemove }: { color: string; onChange: (c: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const openPicker = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const pickerH = 240;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < pickerH + 8
      ? rect.top + window.scrollY - pickerH - 8
      : rect.bottom + window.scrollY + 6;
    const left = Math.min(rect.left + window.scrollX, window.innerWidth - 220);
    setPos({ top, left });
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.closest("[data-color-picker]")?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="flex items-center gap-1" data-color-picker>
      <button
        ref={btnRef}
        type="button"
        className="w-6 h-6 rounded border border-border shadow-sm"
        style={{ background: color }}
        onClick={() => open ? setOpen(false) : openPicker()}
      />
      <button type="button" onClick={onRemove} className="text-text-muted hover:text-danger">
        <Trash2 className="w-3 h-3" />
      </button>
      {open && typeof window !== "undefined" && createPortal(
        <div
          data-color-picker
          className="fixed z-[9999] bg-bg border border-border rounded-lg shadow-xl p-3"
          style={{ top: pos.top, left: pos.left }}
        >
          <HexColorPicker color={color} onChange={onChange} />
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-xs text-text-muted select-none">#</span>
            <input
              type="text"
              maxLength={6}
              value={color.replace(/^#/, "")}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9a-fA-F]/g, "");
                if (val.length === 6) onChange("#" + val);
              }}
              className="flex-1 px-2 py-1 text-xs font-mono border border-border rounded bg-bg text-text focus:outline-none focus:border-primary uppercase"
              placeholder="00a1be"
            />
            <div className="w-5 h-5 rounded border border-border shrink-0" style={{ background: color }} />
          </div>
          <button
            type="button"
            className="mt-2 w-full text-xs text-center text-text-muted hover:text-primary"
            onClick={() => setOpen(false)}
          >
            Chiudi
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}

export function ColoriEditor({ colori, onChange }: { colori: string[]; onChange: (c: string[]) => void }) {
  return (
    <div>
      <label className="block text-xs text-text-muted mb-1.5">Colori personalizzati</label>
      <div className="flex flex-wrap gap-2 items-center">
        {colori.map((c, i) => (
          <ColorSwatch
            key={i}
            color={c}
            onChange={(nc) => { const a = [...colori]; a[i] = nc; onChange(a); }}
            onRemove={() => onChange(colori.filter((_, j) => j !== i))}
          />
        ))}
        <button
          type="button"
          onClick={() => onChange([...colori, "#00a1be"])}
          className="w-6 h-6 rounded border border-dashed border-border flex items-center justify-center text-text-muted hover:text-primary hover:border-primary"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

// ── Multi-select chips ────────────────────────────────────────────────────────

export function MultiSelect({
  label, items, selected, onChange,
}: {
  label: string;
  items: { id: string; nome: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  return (
    <div>
      <label className="block text-xs text-text-muted mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => toggle(item.id)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
              selected.includes(item.id)
                ? "bg-primary text-white border-primary"
                : "bg-bg border-border text-text-muted hover:border-primary"
            }`}
          >
            {item.nome}
          </button>
        ))}
      </div>
      {items.length === 0 && <p className="text-xs text-text-muted italic">Nessun elemento disponibile</p>}
    </div>
  );
}

// ── Config panels ─────────────────────────────────────────────────────────────

export function RadarConfigPanel({
  cfg, parametri, onChange,
}: { cfg: BloccoRadarConfig; parametri: { id: string; nome: string }[]; onChange: (c: BloccoRadarConfig) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Anno</label>
          <input type="number" value={cfg.anno ?? ""} onChange={(e) => onChange({ ...cfg, anno: e.target.value ? +e.target.value : null })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Valore massimo scala</label>
          <input type="number" min={1} max={10} value={cfg.max_value} onChange={(e) => onChange({ ...cfg, max_value: +e.target.value })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <input type="checkbox" id="mostra_storico" checked={cfg.mostra_storico}
          onChange={(e) => onChange({ ...cfg, mostra_storico: e.target.checked })}
          className="w-4 h-4 accent-primary" />
        <label htmlFor="mostra_storico" className="text-sm text-text">Mostra parametri storici</label>
      </div>
      <MultiSelect label="Parametri (tutti se vuoto)" items={parametri} selected={cfg.parametri_ids}
        onChange={(v) => onChange({ ...cfg, parametri_ids: v })} />
      <ColoriEditor colori={cfg.colori ?? []} onChange={(c) => onChange({ ...cfg, colori: c })} />
    </div>
  );
}

export function BarConfigPanel({
  cfg, parametri, onChange,
}: { cfg: BloccoBarConfig; parametri: { id: string; nome: string }[]; onChange: (c: BloccoBarConfig) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Anno</label>
          <input type="number" value={cfg.anno ?? ""} onChange={(e) => onChange({ ...cfg, anno: e.target.value ? +e.target.value : null })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Raggruppamento</label>
          <select value={cfg.raggruppamento} onChange={(e) => onChange({ ...cfg, raggruppamento: e.target.value as BloccoBarConfig["raggruppamento"] })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text">
            <option value="reparto">Reparto</option>
            <option value="parametro">Parametro</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Metrica</label>
          <select value={cfg.metrica} onChange={(e) => onChange({ ...cfg, metrica: e.target.value as BloccoBarConfig["metrica"] })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text">
            <option value="autovalutazione">Autovalutazione</option>
            <option value="responsabile">Responsabile</option>
            <option value="delta">Delta</option>
          </select>
        </div>
      </div>
      {cfg.raggruppamento === "parametro" && (
        <MultiSelect label="Parametri (tutti se vuoto)" items={parametri} selected={cfg.parametri_ids}
          onChange={(v) => onChange({ ...cfg, parametri_ids: v })} />
      )}
      <ColoriEditor colori={cfg.colori ?? []} onChange={(c) => onChange({ ...cfg, colori: c })} />
    </div>
  );
}

export function LineConfigPanel({
  cfg, parametri, onChange,
}: { cfg: BloccoLineConfig; parametri: { id: string; nome: string }[]; onChange: (c: BloccoLineConfig) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Anno da</label>
          <input type="number" value={cfg.anni_range[0]} onChange={(e) => onChange({ ...cfg, anni_range: [+e.target.value, cfg.anni_range[1]] })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Anno a</label>
          <input type="number" value={cfg.anni_range[1]} onChange={(e) => onChange({ ...cfg, anni_range: [cfg.anni_range[0], +e.target.value] })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Metrica</label>
          <select value={cfg.metrica} onChange={(e) => onChange({ ...cfg, metrica: e.target.value as BloccoLineConfig["metrica"] })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text">
            <option value="entrambi">Entrambi</option>
            <option value="autovalutazione">Autovalutazione</option>
            <option value="responsabile">Responsabile</option>
          </select>
        </div>
      </div>
      <MultiSelect label="Parametri (tutti se vuoto)" items={parametri} selected={cfg.parametri_ids}
        onChange={(v) => onChange({ ...cfg, parametri_ids: v })} />
      <ColoriEditor colori={cfg.colori ?? []} onChange={(c) => onChange({ ...cfg, colori: c })} />
    </div>
  );
}

export function PieConfigPanel({
  cfg, onChange,
}: { cfg: BloccoPieConfig; onChange: (c: BloccoPieConfig) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Distribuzione</label>
          <select value={cfg.distribuzione} onChange={(e) => onChange({ ...cfg, distribuzione: e.target.value as BloccoPieConfig["distribuzione"] })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text">
            <option value="punteggi_fasce">Fasce punteggio</option>
            <option value="stati_sessioni">Stati sessioni</option>
            <option value="reparti">Reparti</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Anno</label>
          <input type="number" value={cfg.anno ?? ""} onChange={(e) => onChange({ ...cfg, anno: e.target.value ? +e.target.value : null })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text" />
        </div>
      </div>
      <ColoriEditor colori={cfg.colori ?? []} onChange={(c) => onChange({ ...cfg, colori: c })} />
    </div>
  );
}

export function TableConfigPanel({
  cfg, onChange,
}: { cfg: BloccoTableConfig; onChange: (c: BloccoTableConfig) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-text-muted mb-1">Modalità</label>
          <select value={cfg.modalita} onChange={(e) => onChange({ ...cfg, modalita: e.target.value as BloccoTableConfig["modalita"] })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text">
            <option value="ranking_utenti">Ranking utenti</option>
            <option value="dettaglio_sessioni">Dettaglio sessioni</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Anno</label>
          <input type="number" value={cfg.anno ?? ""} onChange={(e) => onChange({ ...cfg, anno: e.target.value ? +e.target.value : null })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text" />
        </div>
        <div>
          <label className="block text-xs text-text-muted mb-1">Righe max</label>
          <input type="number" min={5} max={100} value={cfg.limit} onChange={(e) => onChange({ ...cfg, limit: +e.target.value })}
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-text-muted mb-1">Filtra reparto (opzionale)</label>
        <input type="text" value={cfg.reparto ?? ""} placeholder="es. Amministrazione"
          onChange={(e) => onChange({ ...cfg, reparto: e.target.value || null })}
          className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text" />
      </div>
    </div>
  );
}

export function KpiConfigPanel({
  cfg, kpis, onChange,
}: { cfg: BloccoKpiCardConfig; kpis: { id: string; nome: string }[]; onChange: (c: BloccoKpiCardConfig) => void }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-text-muted mb-1">Anno</label>
        <input type="number" value={cfg.anno ?? ""} onChange={(e) => onChange({ ...cfg, anno: e.target.value ? +e.target.value : null })}
          className="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-bg text-text max-w-[140px]" />
      </div>
      <MultiSelect label="KPI da mostrare (tutti se vuoto)" items={kpis} selected={cfg.kpi_ids}
        onChange={(v) => onChange({ ...cfg, kpi_ids: v })} />
      <div className="flex items-center gap-2">
        <input type="checkbox" id="mostra_trend" checked={cfg.mostra_trend}
          onChange={(e) => onChange({ ...cfg, mostra_trend: e.target.checked })}
          className="w-4 h-4 accent-primary" />
        <label htmlFor="mostra_trend" className="text-sm text-text">Mostra trend anno precedente</label>
      </div>
    </div>
  );
}

// ── BloccoItem ────────────────────────────────────────────────────────────────

interface BloccoItemProps {
  blocco: BloccoInput;
  index: number;
  total: number;
  parametri: { id: string; nome: string }[];
  kpis: { id: string; nome: string }[];
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onUpdate: (b: BloccoInput) => void;
}

export function BloccoItem({
  blocco, index, total, parametri, kpis,
  onMove, onRemove, onUpdate,
}: BloccoItemProps) {
  const [expanded, setExpanded] = useState(true);

  const updateCfg = (cfg: BloccoInput["configurazione"]) => onUpdate({ ...blocco, configurazione: cfg });

  return (
    <div className="border border-border rounded-xl bg-bg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-page">
        <div className="flex flex-col gap-0.5">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)}
            className="p-0.5 text-text-muted hover:text-primary disabled:opacity-30">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button type="button" disabled={index === total - 1} onClick={() => onMove(1)}
            className="p-0.5 text-text-muted hover:text-primary disabled:opacity-30">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-text-muted">{TIPO_ICONS[blocco.tipo]}</span>
          <Badge variant="outline" className="text-xs shrink-0">{TIPO_LABELS[blocco.tipo]}</Badge>
          <input
            value={blocco.titolo}
            onChange={(e) => onUpdate({ ...blocco, titolo: e.target.value })}
            placeholder="Titolo blocco (opzionale)"
            className="flex-1 min-w-0 bg-transparent text-sm text-text placeholder-text-muted outline-none border-none"
          />
        </div>

        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setExpanded((v) => !v)}
            className="p-1.5 text-text-muted hover:text-primary rounded-lg hover:bg-primary/5">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button type="button" onClick={onRemove}
            className="p-1.5 text-text-muted hover:text-danger rounded-lg hover:bg-danger/5">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 border-t border-border">
          {blocco.tipo === "radar" && (
            <RadarConfigPanel cfg={blocco.configurazione as BloccoRadarConfig} parametri={parametri} onChange={updateCfg} />
          )}
          {blocco.tipo === "bar" && (
            <BarConfigPanel cfg={blocco.configurazione as BloccoBarConfig} parametri={parametri} onChange={updateCfg} />
          )}
          {blocco.tipo === "line" && (
            <LineConfigPanel cfg={blocco.configurazione as BloccoLineConfig} parametri={parametri} onChange={updateCfg} />
          )}
          {(blocco.tipo === "pie" || blocco.tipo === "donut") && (
            <PieConfigPanel cfg={blocco.configurazione as BloccoPieConfig} onChange={updateCfg} />
          )}
          {blocco.tipo === "table" && (
            <TableConfigPanel cfg={blocco.configurazione as BloccoTableConfig} onChange={updateCfg} />
          )}
          {blocco.tipo === "kpi_card" && (
            <KpiConfigPanel cfg={blocco.configurazione as BloccoKpiCardConfig} kpis={kpis} onChange={updateCfg} />
          )}
        </div>
      )}
    </div>
  );
}
