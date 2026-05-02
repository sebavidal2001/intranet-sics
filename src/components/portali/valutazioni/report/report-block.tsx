"use client";

import dynamic from "next/dynamic";
import type {
  ReportBlocco, BloccoBarConfig, BloccoLineConfig, BloccoPieConfig,
  BloccoKpiCardConfig, BloccoTableConfig,
  RadarDataPoint, BarDataPoint, LineDataPoint, PieDataPoint, TableRow, KpiCardData,
} from "@/lib/types";

const RadarChartComponent = dynamic(
  () => import("@/components/portali/valutazioni/analisi/radar-chart").then((m) => m.RadarChartComponent),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
const ReportBarChart = dynamic(
  () => import("./bar-chart").then((m) => m.ReportBarChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
const ReportLineChart = dynamic(
  () => import("./line-chart").then((m) => m.ReportLineChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
const ReportPieChart = dynamic(
  () => import("./pie-chart").then((m) => m.ReportPieChart),
  { ssr: false, loading: () => <ChartSkeleton /> }
);
const ReportKpiCard = dynamic(
  () => import("./kpi-card").then((m) => m.ReportKpiCard),
  { ssr: false }
);
const ReportTable = dynamic(
  () => import("./report-table").then((m) => m.ReportTable),
  { ssr: false }
);

function ChartSkeleton() {
  return (
    <div className="w-full h-[300px] bg-bg-page rounded-lg animate-pulse" />
  );
}

interface Props {
  blocco: ReportBlocco;
  dati: unknown;
}

export function ReportBlock({ blocco, dati }: Props) {
  const { tipo, titolo, configurazione } = blocco;

  return (
    <div className="bg-bg rounded-xl border border-border p-5">
      {titolo && (
        <h3 className="font-tenorite text-base text-text mb-4">{titolo}</h3>
      )}

      {tipo === "radar" && (
        <RadarChartComponent
          data={dati as RadarDataPoint[]}
          showHistoric={(configurazione as { mostra_storico?: boolean }).mostra_storico}
          maxValue={(configurazione as { max_value?: number }).max_value ?? 5}
        />
      )}

      {tipo === "bar" && (
        <ReportBarChart
          data={dati as BarDataPoint[]}
          metrica={(configurazione as BloccoBarConfig).metrica}
          colori={(configurazione as BloccoBarConfig).colori}
        />
      )}

      {tipo === "line" && (
        <ReportLineChart
          data={dati as LineDataPoint[]}
          metrica={(configurazione as BloccoLineConfig).metrica}
          colori={(configurazione as BloccoLineConfig).colori}
        />
      )}

      {(tipo === "pie" || tipo === "donut") && (
        <ReportPieChart
          data={dati as PieDataPoint[]}
          tipo={tipo}
          colori={(configurazione as BloccoPieConfig).colori}
        />
      )}

      {tipo === "kpi_card" && (
        <ReportKpiCard
          items={dati as KpiCardData[]}
        />
      )}

      {tipo === "table" && (
        <ReportTable
          rows={dati as TableRow[]}
          colonne={(configurazione as BloccoTableConfig).colonne}
        />
      )}
    </div>
  );
}
