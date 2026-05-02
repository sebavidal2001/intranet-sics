"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { RadarDataPoint } from "@/lib/types";

interface RadarChartComponentProps {
  data: RadarDataPoint[];
  title?: string;
  description?: string;
  showHistoric?: boolean;
  maxValue?: number;
}

export function RadarChartComponent({
  data,
  title = "Analisi Competenze",
  description,
  showHistoric = false,
  maxValue = 5,
}: RadarChartComponentProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <RadarChart data={data}>
            <PolarGrid stroke="var(--color-border)" />
            <PolarAngleAxis
              dataKey="parametro"
              tick={{ fill: "var(--color-text)", fontSize: 12, fontFamily: "Tenorite" }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, maxValue]}
              tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
            />

            {/* Serie Autovalutazione */}
            <Radar
              name="Autovalutazione"
              dataKey="autovalutazione"
              stroke="var(--color-primary)"
              fill="var(--color-primary)"
              fillOpacity={0.3}
              strokeWidth={2}
              isAnimationActive={true}
              animationDuration={800}
              animationEasing="ease-in-out"
            />

            {/* Serie Responsabile */}
            <Radar
              name="Responsabile"
              dataKey="responsabile"
              stroke="var(--color-success)"
              fill="var(--color-success)"
              fillOpacity={0.2}
              strokeWidth={2}
              isAnimationActive={true}
              animationDuration={800}
              animationEasing="ease-in-out"
            />

            {/* Serie Storico (se presente) */}
            {showHistoric && (
              <Radar
                name="Anno Precedente"
                dataKey="storico"
                stroke="var(--color-storico)"
                fill="transparent"
                strokeWidth={2}
                strokeDasharray="4 4"
                isAnimationActive={true}
                animationDuration={800}
                animationEasing="ease-in-out"
              />
            )}

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
                fontFamily: "Tenorite",
              }}
            />

            <Legend
              wrapperStyle={{
                paddingTop: "20px",
                fontFamily: "system-ui",
                fontSize: "14px",
              }}
              iconType="circle"
            />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
