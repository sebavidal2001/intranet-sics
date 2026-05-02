"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface TrendDataPoint {
  anno: number;
  autovalutazione: number;
  responsabile: number;
}

interface TrendChartProps {
  data: TrendDataPoint[];
  title?: string;
  description?: string;
}

export function TrendChart({
  data,
  title = "Trend Storico",
  description = "Andamento delle valutazioni negli anni",
}: TrendChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="anno"
              tick={{ fill: "var(--color-text)", fontSize: 12 }}
            />
            <YAxis
              tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
              domain={[0, 5]}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
                fontFamily: "system-ui",
              }}
              labelStyle={{
                color: "var(--color-text)",
                fontWeight: 600,
              }}
            />
            <Legend
              wrapperStyle={{
                paddingTop: "20px",
                fontFamily: "system-ui",
                fontSize: "14px",
              }}
            />
            <Line
              type="monotone"
              dataKey="autovalutazione"
              stroke="var(--color-primary)"
              strokeWidth={2}
              dot={{ fill: "var(--color-primary)", r: 4 }}
              name="Autovalutazione"
            />
            <Line
              type="monotone"
              dataKey="responsabile"
              stroke="var(--color-success)"
              strokeWidth={2}
              dot={{ fill: "var(--color-success)", r: 4 }}
              name="Responsabile"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
