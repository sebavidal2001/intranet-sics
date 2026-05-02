"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface StoricoPunto {
  data_valutazione: string;
  anno: number;
  punteggio: number;
  note: string | null;
}

interface Props {
  data: StoricoPunto[];
}

interface TooltipPayloadItem {
  value: number;
  payload: StoricoPunto;
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: TooltipPayloadItem[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const d = item.payload;
  return (
    <div className="bg-bg border border-border rounded-lg px-3 py-2.5 text-xs shadow-sm">
      <p className="font-tenorite text-text">
        {new Date(d.data_valutazione + "T00:00:00").toLocaleDateString("it-IT", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}
      </p>
      <p className="text-primary font-tenorite mt-0.5">
        Punteggio: <span className="text-xl">{item.value}</span>
      </p>
      {d.note && <p className="text-text-muted mt-1 max-w-[200px]">{d.note}</p>}
    </div>
  );
}

export default function StoricoTrendChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <div className="bg-bg rounded-xl border border-border p-6 text-center py-12">
        <p className="text-text-muted text-sm">Nessun dato storico disponibile.</p>
        <p className="text-text-muted text-xs mt-1">
          I dati storici vengono importati dall&apos;amministratore.
        </p>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    label: new Date(d.data_valutazione + "T00:00:00").toLocaleDateString("it-IT", {
      month: "short",
      year: "2-digit",
    }),
  }));

  const maxPunteggio = Math.max(...data.map((d) => d.punteggio), 10);

  return (
    <div className="bg-bg rounded-xl border border-border p-5">
      <div className="mb-4">
        <h3 className="font-tenorite text-base text-text">Trend punteggi storici</h3>
        <p className="text-xs text-text-muted mt-0.5">
          Andamento dei punteggi nel tempo ({data.length} rilevazioni)
        </p>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
          />
          <YAxis
            domain={[0, maxPunteggio]}
            tick={{ fill: "var(--color-text-muted)", fontSize: 11 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="punteggio"
            stroke="#00a1be"
            strokeWidth={2.5}
            dot={{ fill: "#00a1be", r: 4, strokeWidth: 0 }}
            activeDot={{ r: 6, fill: "#00a1be" }}
            name="Punteggio"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
