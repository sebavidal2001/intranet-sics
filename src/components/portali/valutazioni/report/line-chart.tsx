"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { LineDataPoint } from "@/lib/types";

interface Props {
  data: LineDataPoint[];
  metrica: "autovalutazione" | "responsabile" | "entrambi";
  colori?: string[];
}

const DEFAULT_COLORS = ["var(--color-primary)", "#22c55e"];

export function ReportLineChart({ data, metrica, colori }: Props) {
  const colors = colori?.length ? colori : DEFAULT_COLORS;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="anno" tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} />
        <YAxis domain={[0, 5]} tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} />
        <Tooltip
          contentStyle={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Legend />
        {metrica !== "responsabile" && (
          <Line
            type="monotone"
            dataKey="autovalutazione"
            name="Autovalutazione"
            stroke={colors[0]}
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
        )}
        {metrica !== "autovalutazione" && (
          <Line
            type="monotone"
            dataKey="responsabile"
            name="Responsabile"
            stroke={colors[1]}
            strokeWidth={2}
            dot={{ r: 4 }}
            connectNulls
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
