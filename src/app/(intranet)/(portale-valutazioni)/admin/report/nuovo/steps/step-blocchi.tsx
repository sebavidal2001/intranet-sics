"use client";

import { BloccoItem, TIPO_ICONS, TIPO_LABELS } from "./blocco-item";
import type { TipoBlocco, BloccoInput } from "@/lib/types";
import type {
  BloccoRadarConfig, BloccoBarConfig, BloccoLineConfig,
  BloccoPieConfig, BloccoTableConfig, BloccoKpiCardConfig,
} from "@/lib/types";

const CURRENT_YEAR = new Date().getFullYear();

export function defaultConfig(tipo: TipoBlocco): BloccoInput["configurazione"] {
  switch (tipo) {
    case "radar": return { anno: CURRENT_YEAR, reparti: [], parametri_ids: [], mostra_storico: false, max_value: 5, colori: [] } satisfies BloccoRadarConfig;
    case "bar": return { anno: CURRENT_YEAR, raggruppamento: "reparto", metrica: "autovalutazione", reparti: [], parametri_ids: [], colori: [] } satisfies BloccoBarConfig;
    case "line": return { anni_range: [CURRENT_YEAR - 2, CURRENT_YEAR], parametri_ids: [], metrica: "entrambi", colori: [] } satisfies BloccoLineConfig;
    case "pie":
    case "donut": return { distribuzione: "punteggi_fasce", anno: CURRENT_YEAR, reparti: [], colori: [] } satisfies BloccoPieConfig;
    case "table": return { modalita: "ranking_utenti", anno: CURRENT_YEAR, reparto: null, limit: 10, colonne: [] } satisfies BloccoTableConfig;
    case "kpi_card": return { kpi_ids: [], anno: CURRENT_YEAR, mostra_trend: false } satisfies BloccoKpiCardConfig;
  }
}

const TIPI_BLOCCO: TipoBlocco[] = ["radar", "bar", "line", "pie", "donut", "table", "kpi_card"];

interface Props {
  blocchi: BloccoInput[];
  parametri: { id: string; nome: string }[];
  kpis: { id: string; nome: string }[];
  onChange: (b: BloccoInput[]) => void;
}

export function StepBlocchi({ blocchi, parametri, kpis, onChange }: Props) {
  const addBlocco = (tipo: TipoBlocco) => {
    onChange([...blocchi, { tipo, titolo: "", configurazione: defaultConfig(tipo), ordine: blocchi.length }]);
  };

  const moveBlock = (i: number, dir: -1 | 1) => {
    const arr = [...blocchi];
    const j = i + dir;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange(arr.map((b, idx) => ({ ...b, ordine: idx })));
  };

  const removeBlock = (i: number) => onChange(blocchi.filter((_, j) => j !== i).map((b, idx) => ({ ...b, ordine: idx })));
  const updateBlock = (i: number, b: BloccoInput) => { const arr = [...blocchi]; arr[i] = b; onChange(arr); };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-text-muted mb-3">Aggiungi blocchi al report:</p>
        <div className="flex flex-wrap gap-2">
          {TIPI_BLOCCO.map((tipo) => (
            <button
              key={tipo}
              type="button"
              onClick={() => addBlocco(tipo)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:border-primary hover:text-primary transition-colors"
            >
              {TIPO_ICONS[tipo]}
              {TIPO_LABELS[tipo]}
            </button>
          ))}
        </div>
      </div>

      {blocchi.length === 0 ? (
        <div className="border-2 border-dashed border-border rounded-xl p-8 text-center">
          <p className="text-text-muted text-sm">Nessun blocco ancora. Aggiungi un tipo di grafico sopra.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {blocchi.map((b, i) => (
            <BloccoItem
              key={i}
              blocco={b}
              index={i}
              total={blocchi.length}
              parametri={parametri}
              kpis={kpis}
              onMove={(dir) => moveBlock(i, dir)}
              onRemove={() => removeBlock(i)}
              onUpdate={(nb) => updateBlock(i, nb)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
