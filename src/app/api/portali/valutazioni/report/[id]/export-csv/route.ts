import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import {
  getReport, getDatiBar, getDatiLine, getDatiPie, getDatiTable,
  getDatiKpiCard, getDatiRadar,
} from "@/lib/portali/valutazioni/services/report-service";
import type {
  ReportBlocco, BloccoRadarConfig, BloccoBarConfig, BloccoLineConfig,
  BloccoPieConfig, BloccoTableConfig, BloccoKpiCardConfig,
  RadarDataPoint, BarDataPoint, LineDataPoint, PieDataPoint, TableRow, KpiCardData,
} from "@/lib/types";

function rowsToCSV(headers: string[], rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}

async function bloccoToCSV(blocco: ReportBlocco): Promise<string> {
  const titolo = blocco.titolo ?? blocco.tipo;
  const header = `\n### ${titolo} (${blocco.tipo})\n`;

  switch (blocco.tipo) {
    case "radar": {
      const dati = await getDatiRadar(blocco.configurazione as BloccoRadarConfig) as RadarDataPoint[];
      const csv = rowsToCSV(
        ["Parametro", "Autovalutazione", "Responsabile"],
        dati.map((d) => [d.parametro, String(d.autovalutazione), String(d.responsabile)])
      );
      return header + csv;
    }
    case "bar": {
      const dati = await getDatiBar(blocco.configurazione as BloccoBarConfig) as BarDataPoint[];
      const csv = rowsToCSV(
        ["Gruppo", "Autovalutazione", "Responsabile", "Delta"],
        dati.map((d) => [d.gruppo, String(d.autovalutazione ?? ""), String(d.responsabile ?? ""), String(d.delta ?? "")])
      );
      return header + csv;
    }
    case "line": {
      const dati = await getDatiLine(blocco.configurazione as BloccoLineConfig) as LineDataPoint[];
      const csv = rowsToCSV(
        ["Anno", "Autovalutazione", "Responsabile"],
        dati.map((d) => [String(d.anno), String(d.autovalutazione ?? ""), String(d.responsabile ?? "")])
      );
      return header + csv;
    }
    case "pie":
    case "donut": {
      const dati = await getDatiPie(blocco.configurazione as BloccoPieConfig) as PieDataPoint[];
      const csv = rowsToCSV(["Categoria", "Valore"], dati.map((d) => [d.nome, String(d.valore)]));
      return header + csv;
    }
    case "table": {
      const dati = await getDatiTable(blocco.configurazione as BloccoTableConfig) as TableRow[];
      if (dati.length === 0) return header + "(nessun dato)\n";
      const keys = Object.keys(dati[0]);
      const csv = rowsToCSV(keys, dati.map((r) => keys.map((k) => String(r[k] ?? ""))));
      return header + csv;
    }
    case "kpi_card": {
      const dati = await getDatiKpiCard(blocco.configurazione as BloccoKpiCardConfig) as KpiCardData[];
      const csv = rowsToCSV(
        ["Nome", "Valore", "Operatore", "Soglia", "Status"],
        dati.map((d) => [d.nome, String(d.valore ?? ""), d.operatore, String(d.soglia), d.status])
      );
      return header + csv;
    }
    default:
      return header + "(tipo non supportato)\n";
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

  const result = await getReport(id);
  if (!result) return NextResponse.json({ error: "Report non trovato" }, { status: 404 });

  const { report, blocchi } = result;
  const sections = await Promise.all(blocchi.map(bloccoToCSV));

  const csv = `# Report: ${report.nome}\n# Esportato il: ${new Date().toLocaleString("it-IT")}\n${sections.join("\n")}`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="report-${id}.csv"`,
    },
  });
}
