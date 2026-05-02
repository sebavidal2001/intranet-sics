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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RadarDataPoint } from "@/lib/types";

interface RisultatiClientProps {
  radarData: RadarDataPoint[];
  scalaMax: number;
}

export function RisultatiClient({ radarData, scalaMax }: RisultatiClientProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-tenorite text-xl">
          Radar delle competenze
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <RadarChart data={radarData}>
            <PolarGrid stroke="var(--color-border)" />
            <PolarAngleAxis
              dataKey="parametro"
              tick={{
                fill: "var(--color-text)",
                fontSize: 12,
                fontFamily: "Tenorite",
              }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, scalaMax]}
              tick={{ fill: "var(--color-text-muted)", fontSize: 10 }}
            />
            <Radar
              name="Autovalutazione"
              dataKey="autovalutazione"
              stroke="#00a1be"
              fill="#00a1be"
              fillOpacity={0.3}
              strokeWidth={2}
              isAnimationActive={true}
              animationDuration={800}
              animationEasing="ease-in-out"
            />
            <Radar
              name="Responsabile"
              dataKey="responsabile"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.2}
              strokeWidth={2}
              isAnimationActive={true}
              animationDuration={800}
              animationEasing="ease-in-out"
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
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
