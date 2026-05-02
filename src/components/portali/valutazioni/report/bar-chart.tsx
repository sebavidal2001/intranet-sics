"use client";

import {
  BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { BarDataPoint } from "@/lib/types";

interface Props {
  data: BarDataPoint[];
  metrica: "autovalutazione" | "responsabile" | "delta";
  colori?: string[];
  maxValue?: number;
}

const DEFAULT_COLORS = ["var(--color-primary)", "var(--color-success)", "#f59e0b"];

export function ReportBarChart({ data, metrica, colori, maxValue = 5 }: Props) {
  const colors = colori?.length ? colori : DEFAULT_COLORS;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ReBarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="gruppo" tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} />
        <YAxis domain={[0, maxValue]} tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} />
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
          <Bar dataKey="autovalutazione" name="Autovalutazione" fill={colors[0]} radius={[4, 4, 0, 0]} />
        )}
        {metrica !== "autovalutazione" && metrica !== "delta" && (
          <Bar dataKey="responsabile" name="Responsabile" fill={colors[1]} radius={[4, 4, 0, 0]} />
        )}
        {metrica === "delta" && (
          <Bar dataKey="delta" name="Delta (resp - auto)" fill={colors[2]} radius={[4, 4, 0, 0]} />
        )}
      </ReBarChart>
    </ResponsiveContainer>
  );
}
