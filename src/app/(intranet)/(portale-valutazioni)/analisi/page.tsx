import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import nextDynamic from "next/dynamic";
import { DeltaBadge } from "@/components/portali/valutazioni/analisi/delta-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRadarData } from "@/lib/portali/valutazioni/services/radar-service";
import { calcolaDelta } from "@/lib/utils";
import { getSessionUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// Dynamic import: recharts (~150KB) caricato solo sulla pagina analisi, non nel bundle principale
const RadarChartComponent = nextDynamic(
  () => import("@/components/portali/valutazioni/analisi/radar-chart").then((m) => m.RadarChartComponent),
  { ssr: false }
);
const TrendChart = nextDynamic(
  () => import("@/components/portali/valutazioni/analisi/trend-chart").then((m) => m.TrendChart),
  { ssr: false }
);
const StoricoTrendChart = nextDynamic(
  () => import("@/components/portali/valutazioni/analisi/storico-trend-chart"),
  { ssr: false }
);

export default async function AnalisiPage() {
  const user = await getSessionUser();
  if (!user) redirect("/auth/login");

  const supabase = await createClient();
  const annoCorrente = new Date().getFullYear();

  // Lancia in parallelo: anno corrente (con storico), anno precedente e storico punteggi
  const [radarData, radarDataPrecedente, radarAnno2fa, storicoPunteggi] = await Promise.all([
    getRadarData(user.id, annoCorrente, true),
    getRadarData(user.id, annoCorrente - 1, false),
    getRadarData(user.id, annoCorrente - 2, false),
    supabase
      .from("storico_punteggi")
      .select("id, data_valutazione, anno, punteggio, note")
      .eq("utente_id", user.id)
      .order("data_valutazione", { ascending: true })
      .then((r) => r.data ?? []),
  ]);

  // KPI
  const mediaAutoCorrente =
    radarData.length > 0
      ? radarData.reduce((sum, d) => sum + d.autovalutazione, 0) / radarData.length
      : 0;

  const mediaRespCorrente =
    radarData.length > 0
      ? radarData.reduce((sum, d) => sum + d.responsabile, 0) / radarData.length
      : 0;

  const mediaRespPrecedente =
    radarDataPrecedente.length > 0
      ? radarDataPrecedente.reduce((sum, d) => sum + d.responsabile, 0) / radarDataPrecedente.length
      : 0;

  const delta = mediaRespPrecedente > 0
    ? calcolaDelta(mediaRespCorrente, mediaRespPrecedente)
    : 0;

  // Trend: riutilizza i dati già caricati senza query aggiuntive
  const trendData = [
    { anno: annoCorrente - 2, data: radarAnno2fa },
    { anno: annoCorrente - 1, data: radarDataPrecedente },
    { anno: annoCorrente, data: radarData },
  ]
    .filter(({ data }) => data.length > 0)
    .map(({ anno, data }) => ({
      anno,
      autovalutazione: Math.round(data.reduce((s, d) => s + d.autovalutazione, 0) / data.length * 10) / 10,
      responsabile: Math.round(data.reduce((s, d) => s + d.responsabile, 0) / data.length * 10) / 10,
    }));

  const storicoPunteggiData = (storicoPunteggi as Array<{
    data_valutazione: string; anno: number; punteggio: number; note: string | null;
  }>).map((s) => ({
    data_valutazione: s.data_valutazione,
    anno: s.anno,
    punteggio: s.punteggio,
    note: s.note,
  }));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-tenorite text-3xl font-bold text-text">
            Analisi Personale
          </h1>
          <p className="text-text-muted mt-1">
            Visualizza le tue competenze e i progressi nel tempo
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-text-muted">
                Autovalutazione Media
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-tenorite text-3xl font-bold text-text">
                {mediaAutoCorrente.toFixed(1)}
              </p>
              <p className="text-xs text-text-muted mt-1">Su scala 1-5</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-text-muted">
                Valutazione Responsabile
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-tenorite text-3xl font-bold text-text">
                {mediaRespCorrente.toFixed(1)}
              </p>
              <p className="text-xs text-text-muted mt-1">Su scala 1-5</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm text-text-muted">
                Trend vs Anno Precedente
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeltaBadge delta={delta} showPercentage />
              <p className="text-xs text-text-muted mt-2">
                {delta > 0 ? "In crescita" : delta < 0 ? "In calo" : "Stabile"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Radar Chart */}
        {radarData.length > 0 && (
          <RadarChartComponent
            data={radarData}
            title="Radar Competenze"
            description={`Confronto autovalutazione e valutazione responsabile - Anno ${annoCorrente}`}
            showHistoric={radarData.some((d) => d.storico !== undefined)}
          />
        )}

        {/* Trend Chart */}
        {trendData.length > 0 && (
          <TrendChart
            data={trendData}
            title="Trend Storico"
            description="Andamento delle tue valutazioni negli ultimi anni"
          />
        )}

        {/* Storico punteggi */}
        <StoricoTrendChart data={storicoPunteggiData} />

        {/* Nessun Dato */}
        {radarData.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-text-muted">
                Nessuna valutazione disponibile per l&apos;anno {annoCorrente}.
              </p>
              <p className="text-sm text-text-muted mt-2">
                Completa la tua autovalutazione per visualizzare i dati.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
