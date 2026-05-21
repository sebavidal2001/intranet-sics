import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import nextDynamic from "next/dynamic";
import { AlertTriangle } from "lucide-react";

// Dynamic import: RisultatiClient include recharts (~150KB), caricato solo su questa pagina
const RisultatiClient = nextDynamic(
  () => import("./risultati-client").then((m) => m.RisultatiClient),
  { ssr: false }
);
import type { StatoSessioneUtente, RadarDataPoint } from "@/lib/types";
import { STATO_SESSIONE_LABELS } from "@/lib/types";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

interface VoceConParametro {
  id: string;
  testo: string;
  ordine: number;
  parametro_radar: { id: string; nome: string; colore: string } | null;
}

interface RispostaRaw {
  mansione_id: string | null;
  skill_id: string | null;
  punteggio: number;
  tipo: "responsabile" | "autovalutazione";
  note: string | null;
}

interface ConfrontoRow {
  id: string;
  testo: string;
  parametro: string | null;
  parametroColore: string | null;
  auto: number | null;
  responsabile: number | null;
  delta: number | null;
  noteAuto: string | null;
  noteResp: string | null;
}

export default async function RisultatiPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  // Carica profilo utente
  const { data: userProfile } = await supabase
    .from("utenti")
    .select("id, ruolo, ruoli_aggiuntivi")
    .eq("id", user.id)
    .single();

  if (!userProfile) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);

  // Carica sessione con utente e responsabile
  const { data: sessione, error: errSessione } = await supabase
    .from("sessioni_utente")
    .select(
      `
      id,
      anno,
      stato,
      tipo_valutazione,
      utente_id,
      responsabile_id,
      scala_id,
      certificato_url,
      utente:utenti!sessioni_utente_utente_id_fkey(id, nome, cognome, reparto),
      responsabile:utenti!sessioni_utente_responsabile_id_fkey(id, nome, cognome)
    `
    )
    .eq("id", id)
    .single() as unknown as {
      data: {
        id: string;
        anno: number;
        stato: string;
        tipo_valutazione: string | null;
        utente_id: string;
        responsabile_id: string | null;
        scala_id: string | null;
        certificato_url: string | null;
        utente: { id: string; nome: string; cognome: string; reparto: string } | null;
        responsabile: { id: string; nome: string; cognome: string } | null;
      } | null;
      error: unknown;
    };

  if (errSessione || !sessione) redirect("/valutazioni");

  // Verifica accesso: collaboratore, responsabile o admin
  const isCollaboratore = sessione.utente_id === user.id;
  const isResponsabile = sessione.responsabile_id === user.id;

  if (!isAdmin && !isCollaboratore && !isResponsabile) {
    redirect("/valutazioni");
  }

  const stato = sessione.stato as StatoSessioneUtente;

  // Carica scala
  let scala = null;
  if (sessione.scala_id) {
    const { data } = await supabase
      .from("scale_valutazione")
      .select("id, nome, min, max, labels")
      .eq("id", sessione.scala_id)
      .single();
    scala = data;
  }

  if (!scala) redirect("/valutazioni");

  const utente = sessione.utente as { id: string; nome: string; cognome: string; reparto: string };

  // Carica mansioni attive dell'utente
  const { data: utenteMansioni } = await supabase
    .from("utente_mansioni")
    .select(
      `
      mansione_id,
      mansione:mansioni!utente_mansioni_mansione_id_fkey(
        id,
        testo,
        ordine,
        parametro_radar:parametri_radar!mansioni_parametro_radar_id_fkey(id, nome, colore)
      )
    `
    )
    .eq("utente_id", utente.id);

  const mansioni: VoceConParametro[] = (utenteMansioni ?? [])
    .map((um) => (um as unknown as { mansione: VoceConParametro | null }).mansione)
    .filter((m): m is VoceConParametro => m !== null)
    .sort((a, b) => a.ordine - b.ordine);

  // Carica skill della sessione
  const { data: sessioneSkills } = await supabase
    .from("sessione_skills")
    .select(
      `
      skill_id,
      skill:skills!sessione_skills_skill_id_fkey(
        id,
        nome,
        ordine,
        parametro_radar:parametri_radar(id, nome, colore)
      )
    `
    )
    .eq("sessione_id", id) as unknown as {
      data: Array<{ skill_id: string; skill: {
        id: string;
        nome: string;
        ordine: number;
        parametro_radar: { id: string; nome: string; colore: string } | null;
      } | null }> | null;
    };

  const skills: VoceConParametro[] = (sessioneSkills ?? [])
    .map((ss) => ss.skill)
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .map((s) => ({ id: s.id, testo: s.nome, ordine: s.ordine, parametro_radar: s.parametro_radar }))
    .sort((a, b) => a.ordine - b.ordine);

  // Carica tutte le risposte per questa sessione (mansioni + skill)
  const { data: risposte } = await supabase
    .from("risposte_valutazione")
    .select("mansione_id, skill_id, punteggio, tipo, note")
    .eq("sessione_utente_id", id);

  const risposteRaw: RispostaRaw[] = (risposte ?? []) as RispostaRaw[];

  // Map indicizzate per voce (sia mansioni sia skill: gli id UUID non collidono)
  const buildMap = (tipo: "autovalutazione" | "responsabile", chiave: "mansione_id" | "skill_id") =>
    risposteRaw
      .filter((r) => r.tipo === tipo && r[chiave])
      .reduce<Record<string, { punteggio: number; note: string | null }>>((acc, r) => {
        acc[r[chiave]!] = { punteggio: r.punteggio, note: r.note };
        return acc;
      }, {});

  const autoMansMap = buildMap("autovalutazione", "mansione_id");
  const respMansMap = buildMap("responsabile", "mansione_id");
  const autoSkillMap = buildMap("autovalutazione", "skill_id");
  const respSkillMap = buildMap("responsabile", "skill_id");

  // Costruisce le righe di confronto per una lista di voci
  function buildConfronto(
    voci: VoceConParametro[],
    autoMap: Record<string, { punteggio: number; note: string | null }>,
    respMap: Record<string, { punteggio: number; note: string | null }>
  ): ConfrontoRow[] {
    return voci.map((v) => {
      const auto = autoMap[v.id]?.punteggio ?? null;
      const resp = respMap[v.id]?.punteggio ?? null;
      return {
        id: v.id,
        testo: v.testo,
        parametro: v.parametro_radar?.nome ?? null,
        parametroColore: v.parametro_radar?.colore ?? null,
        auto,
        responsabile: resp,
        delta: auto !== null && resp !== null ? auto - resp : null,
        noteAuto: autoMap[v.id]?.note ?? null,
        noteResp: respMap[v.id]?.note ?? null,
      };
    });
  }

  const confrontoMansioni = buildConfronto(mansioni, autoMansMap, respMansMap);
  const confrontoSkills = buildConfronto(skills, autoSkillMap, respSkillMap);

  // Radar: raggruppa per parametro_radar la media di mansioni + skill insieme
  const parametriMap: Record<
    string,
    { nome: string; autoVals: number[]; respVals: number[] }
  > = {};

  function accumulaRadar(
    voci: VoceConParametro[],
    autoMap: Record<string, { punteggio: number; note: string | null }>,
    respMap: Record<string, { punteggio: number; note: string | null }>
  ) {
    for (const v of voci) {
      if (!v.parametro_radar) continue;
      const pid = v.parametro_radar.id;
      if (!parametriMap[pid]) {
        parametriMap[pid] = { nome: v.parametro_radar.nome, autoVals: [], respVals: [] };
      }
      const autoVal = autoMap[v.id]?.punteggio;
      const respVal = respMap[v.id]?.punteggio;
      if (autoVal !== undefined) parametriMap[pid].autoVals.push(autoVal);
      if (respVal !== undefined) parametriMap[pid].respVals.push(respVal);
    }
  }
  accumulaRadar(mansioni, autoMansMap, respMansMap);
  accumulaRadar(skills, autoSkillMap, respSkillMap);

  const radarData: RadarDataPoint[] = Object.values(parametriMap).map((p) => ({
    parametro: p.nome,
    autovalutazione:
      p.autoVals.length > 0
        ? Math.round((p.autoVals.reduce((a, b) => a + b, 0) / p.autoVals.length) * 10) / 10
        : 0,
    responsabile:
      p.respVals.length > 0
        ? Math.round((p.respVals.reduce((a, b) => a + b, 0) / p.respVals.length) * 10) / 10
        : 0,
  }));

  // Media finale responsabile — su mansioni + skill
  const respTutti = [...Object.values(respMansMap), ...Object.values(respSkillMap)];
  const mediaResponsabile =
    respTutti.length > 0
      ? Math.round(
          (respTutti.reduce((acc, r) => acc + r.punteggio, 0) / respTutti.length) * 10
        ) / 10
      : null;

  const responsabile = sessione.responsabile as { id: string; nome: string; cognome: string } | null;

  const statoBadgeVariant: Record<
    StatoSessioneUtente,
    "default" | "secondary" | "success" | "warning" | "danger" | "outline"
  > = {
    programmata: "secondary",
    resp_in_corso: "warning",
    resp_completata: "default",
    collab_in_corso: "warning",
    completata: "success",
    certificata: "success",
  };

  // ── Render di una tabella di confronto (riusata per mansioni e skill) ────────
  function TabellaConfronto({
    titolo,
    colonnaVoce,
    rows,
  }: {
    titolo: string;
    colonnaVoce: string;
    rows: ConfrontoRow[];
  }) {
    if (rows.length === 0) return null;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-tenorite text-xl">{titolo}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 pr-4 font-tenorite text-text font-semibold">
                  {colonnaVoce}
                </th>
                <th className="text-center py-3 px-3 font-tenorite text-text font-semibold whitespace-nowrap">
                  Autoval.
                </th>
                <th className="text-center py-3 px-3 font-tenorite text-text font-semibold whitespace-nowrap">
                  Responsabile
                </th>
                <th className="text-center py-3 px-3 font-tenorite text-text font-semibold">
                  Delta
                </th>
                <th className="text-center py-3 pl-3 font-tenorite text-text font-semibold">
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const absDelta = row.delta !== null ? Math.abs(row.delta) : null;

                let deltaBadge: React.ReactNode = <span className="text-text-muted">—</span>;
                if (row.delta === 0) {
                  deltaBadge = (
                    <Badge variant="secondary" className="font-tenorite">=</Badge>
                  );
                } else if (absDelta === 1) {
                  deltaBadge = (
                    <Badge variant="warning" className="font-tenorite">
                      {row.delta! > 0 ? "+" : ""}
                      {row.delta}
                    </Badge>
                  );
                } else if (absDelta !== null && absDelta >= 2) {
                  deltaBadge = (
                    <Badge variant="danger" className="font-tenorite gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {row.delta! > 0 ? "+" : ""}
                      {row.delta}
                    </Badge>
                  );
                }

                const hasAlert = absDelta !== null && absDelta >= 2;

                return (
                  <tr
                    key={row.id}
                    className={`border-b border-border last:border-0 ${
                      hasAlert ? "bg-danger/5" : ""
                    }`}
                  >
                    <td className="py-3 pr-4 text-text leading-snug">
                      <div className="flex items-start gap-2">
                        {hasAlert && (
                          <AlertTriangle className="h-4 w-4 text-danger mt-0.5 shrink-0" />
                        )}
                        <div>
                          <span>{row.testo}</span>
                          {row.parametro && (
                            <div className="mt-0.5">
                              <Badge
                                className="text-white text-xs"
                                style={{
                                  backgroundColor: row.parametroColore ?? "#747373",
                                  borderColor: row.parametroColore ?? "#747373",
                                }}
                              >
                                {row.parametro}
                              </Badge>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {row.auto !== null ? (
                        <span className="font-tenorite font-semibold text-primary">
                          {row.auto}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">
                      {row.responsabile !== null ? (
                        <span className="font-tenorite font-semibold text-warning">
                          {row.responsabile}
                        </span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">{deltaBadge}</td>
                    <td className="py-3 pl-3 text-center">
                      {(row.noteAuto || row.noteResp) ? (
                        <div className="text-xs text-text-muted space-y-1 text-left max-w-48">
                          {row.noteResp && (
                            <p>
                              <span className="font-medium text-text">R:</span>{" "}
                              {row.noteResp}
                            </p>
                          )}
                          {row.noteAuto && (
                            <p>
                              <span className="font-medium text-text">A:</span>{" "}
                              {row.noteAuto}
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <Breadcrumbs items={[
        { label: "Valutazioni", href: "/valutazioni" },
        { label: "Risultati" },
      ]} />
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-tenorite text-3xl font-bold text-text">
            Risultati: {utente.nome} {utente.cognome}
          </h1>
          <p className="text-text-muted mt-1">
            {utente.reparto} &middot; Anno {sessione.anno}
            {responsabile && (
              <>
                {" "}
                &middot; Responsabile: {responsabile.nome} {responsabile.cognome}
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Badge variant={statoBadgeVariant[stato]}>
            {STATO_SESSIONE_LABELS[stato]}
          </Badge>

          {isAdmin && (stato === "completata" || stato === "certificata") && (
            <Button asChild variant="default" className="bg-primary hover:bg-primary-dark">
              <a href={`/api/portali/valutazioni/certificato/${id}`}>
                {stato === "certificata" ? "Scarica certificato" : "Genera certificato"}
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Media finale */}
      {mediaResponsabile !== null && (
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center gap-6">
              <div>
                <p className="text-sm text-text-muted uppercase tracking-wide font-medium">
                  Punteggio valutazione
                </p>
                <p className="font-tenorite text-5xl font-bold text-primary mt-1">
                  {mediaResponsabile}
                  <span className="text-xl text-text-muted font-normal ml-1">
                    / {scala.max}
                  </span>
                </p>
              </div>
              <div className="flex-1">
                <div className="h-3 w-full rounded-full bg-secondary-light overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-700"
                    style={{
                      width: `${
                        ((mediaResponsabile - scala.min) /
                          (scala.max - scala.min)) *
                        100
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Radar chart — client component (mansioni + skill aggregate per parametro) */}
      {radarData.length > 0 && (
        <RisultatiClient radarData={radarData} scalaMax={scala.max} />
      )}

      {/* Tabella confronto mansioni */}
      <TabellaConfronto
        titolo="Confronto per mansione"
        colonnaVoce="Mansione"
        rows={confrontoMansioni}
      />

      {/* Tabella confronto skill */}
      <TabellaConfronto
        titolo="Confronto per skill"
        colonnaVoce="Skill"
        rows={confrontoSkills}
      />
    </div>
  );
}
