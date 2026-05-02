"use client";

import {
  PieChart as RePieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import type { PieDataPoint } from "@/lib/types";

const DEFAULT_COLORS = [
  "var(--color-primary)", "#22c55e", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#f97316", "#84cc16",
];

interface Props {
  data: PieDataPoint[];
  tipo: "pie" | "donut";
  colori?: string[];
}

export function ReportPieChart({ data, tipo, colori }: Props) {
  const colors = colori?.length ? colori : DEFAULT_COLORS;
  const innerRadius = tipo === "donut" ? "55%" : 0;

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RePieChart>
        <Pie
          data={data}
          dataKey="valore"
          nameKey="nome"
          cx="50%"
          cy="50%"
          innerRadius={innerRadius}
          outerRadius="70%"
          paddingAngle={2}
          label={({ nome, percent }) => `${nome} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: "var(--color-bg)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Legend />
      </RePieChart>
    </ResponsiveContainer>
  );
}
