import { createClient } from "@/lib/supabase/server";
import type {
  ReportConfig, ReportBlocco, BloccoInput,
  BloccoRadarConfig, BloccoBarConfig, BloccoLineConfig,
  BloccoPieConfig, BloccoTableConfig, BloccoKpiCardConfig,
  RadarDataPoint, BarDataPoint, LineDataPoint, PieDataPoint, TableRow, KpiCardData,
} from "@/lib/types";

type RispostaRaw = { mansione_id: string | null; skill_id: string | null; punteggio: number; tipo: string };

// Carica parametri attivi e mappa risposte → parametro_id
async function buildParametroMaps(supabase: Awaited<ReturnType<typeof createClient>>, risposte: RispostaRaw[]) {
  const mansioneIds = [...new Set(risposte.filter((r) => r.mansione_id).map((r) => r.mansione_id as string))];
  const skillIds = [...new Set(risposte.filter((r) => r.skill_id).map((r) => r.skill_id as string))];

  const [mansioni, skills] = await Promise.all([
    mansioneIds.length > 0
      ? supabase.from("mansioni").select("id, parametro_radar_id").in("id", mansioneIds).then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; parametro_radar_id: string | null }[]),
    skillIds.length > 0
      ? supabase.from("skills").select("id, parametro_radar_id").in("id", skillIds).then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; parametro_radar_id: string | null }[]),
  ]);

  const mansioneMap: Record<string, string | null> = {};
  mansioni.forEach((m) => { mansioneMap[m.id] = m.parametro_radar_id ?? null; });
  const skillMap: Record<string, string | null> = {};
  skills.forEach((s) => { skillMap[s.id] = s.parametro_radar_id ?? null; });

  return { mansioneMap, skillMap };
}

function getParametroId(r: RispostaRaw, mansioneMap: Record<string, string | null>, skillMap: Record<string, string | null>) {
  return r.mansione_id ? mansioneMap[r.mansione_id] : r.skill_id ? skillMap[r.skill_id] : null;
}

function mediaArr(arr: number[]) {
  return arr.length > 0 ? Math.round((arr.reduce((s, v) => s + v, 0) / arr.length) * 10) / 10 : 0;
}

// ─── getReport ───────────────────────────────────────────────────────────────

export async function getReport(reportId: string): Promise<{ report: ReportConfig; blocchi: ReportBlocco[] } | null> {
  const supabase = await createClient();
  const [{ data: report }, { data: blocchi }] = await Promise.all([
    supabase.from("report_config").select("id, nome, descrizione, visibilita_ruoli, created_by, is_attivo, ordine, created_at, updated_at").eq("id", reportId).single(),
    supabase.from("report_blocchi").select("id, report_id, ordine, tipo, titolo, configurazione, created_at").eq("report_id", reportId).order("ordine"),
  ]);
  if (!report) return null;
  return { report: report as ReportConfig, blocchi: (blocchi ?? []) as unknown as ReportBlocco[] };
}

export async function getReportVisibili(): Promise<ReportConfig[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("report_config")
    .select("id, nome, descrizione, visibilita_ruoli, created_by, is_attivo, ordine, created_at, updated_at")
    .eq("is_attivo", true)
    .order("ordine");
  return (data ?? []) as ReportConfig[];
}

export async function getTuttiReport(): Promise<ReportConfig[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("report_config").select("id, nome, descrizione, visibilita_ruoli, created_by, is_attivo, ordine, created_at, updated_at").order("ordine");
  return (data ?? []) as ReportConfig[];
}

// ─── getDatiRadar ─────────────────────────────────────────────────────────────

export async function getDatiRadar(config: BloccoRadarConfig): Promise<RadarDataPoint[]> {
  const supabase = await createClient();
  const anno = config.anno ?? new Date().getFullYear();

  let sessioniQuery = supabase
    .from("sessioni_utente")
    .select("id, utente_id, utenti!inner(reparto)")
    .eq("anno", anno)
    .in("stato", ["completata", "certificata"]);

  if (config.reparti.length > 0) {
    sessioniQuery = sessioniQuery.in("utenti.reparto", config.reparti);
  }

  const { data: sessioni } = await sessioniQuery;
  if (!sessioni || sessioni.length === 0) return [];

  const sessioneIds = sessioni.map((s) => s.id);

  const [parametriResult, { data: risposteDati }] = await Promise.all([
    supabase.from("parametri_radar")
      .select("id, nome")
      .eq("is_storico", false)
      .order("ordine")
      .then((r) => r),
    (supabase.from("risposte_valutazione")
      .select("mansione_id, skill_id, punteggio, tipo")
      .in("sessione_utente_id", sessioneIds) as unknown as Promise<{ data: RispostaRaw[] | null }>),
  ]);

  const parametri = parametriResult.data ?? [];
  const risposte = risposteDati ?? [];
  if (risposte.length === 0) return [];

  const { mansioneMap, skillMap } = await buildParametroMaps(supabase, risposte);

  return parametri
    .filter((p) => config.parametri_ids.length === 0 || config.parametri_ids.includes(p.id))
    .map((p) => {
      const del = risposte.filter((r) => getParametroId(r, mansioneMap, skillMap) === p.id);
      return {
        parametro: p.nome,
        autovalutazione: mediaArr(del.filter((r) => r.tipo === "autovalutazione").map((r) => r.punteggio)),
        responsabile: mediaArr(del.filter((r) => r.tipo === "responsabile").map((r) => r.punteggio)),
      };
    })
    .filter((d) => d.autovalutazione > 0 || d.responsabile > 0);
}

// ─── getDatiBar ──────────────────────────────────────────────────────────────

export async function getDatiBar(config: BloccoBarConfig): Promise<BarDataPoint[]> {
  const supabase = await createClient();
  const anno = config.anno ?? new Date().getFullYear();

  const { data: sessioni } = await (supabase
    .from("sessioni_utente")
    .select("id, utenti!inner(reparto)")
    .eq("anno", anno)
    .in("stato", ["completata", "certificata"]) as unknown as Promise<{
      data: Array<{ id: string; utenti: { reparto: string } }> | null;
    }>);

  if (!sessioni || sessioni.length === 0) return [];

  const { data: risposteDati } = await (supabase
    .from("risposte_valutazione")
    .select("sessione_utente_id, mansione_id, skill_id, punteggio, tipo")
    .in("sessione_utente_id", sessioni.map((s) => s.id)) as unknown as Promise<{
      data: Array<RispostaRaw & { sessione_utente_id: string }> | null;
    }>);

  if (!risposteDati || risposteDati.length === 0) return [];

  const sessioneRepartoMap: Record<string, string> = {};
  sessioni.forEach((s) => { sessioneRepartoMap[s.id] = s.utenti.reparto; });

  if (config.raggruppamento === "reparto") {
    const gruppi: Record<string, { auto: number[]; resp: number[] }> = {};
    risposteDati.forEach((r) => {
      const reparto = sessioneRepartoMap[r.sessione_utente_id] ?? "N/D";
      if (config.reparti.length > 0 && !config.reparti.includes(reparto)) return;
      if (!gruppi[reparto]) gruppi[reparto] = { auto: [], resp: [] };
      if (r.tipo === "autovalutazione") gruppi[reparto].auto.push(r.punteggio);
      else if (r.tipo === "responsabile") gruppi[reparto].resp.push(r.punteggio);
    });

    return Object.entries(gruppi).map(([gruppo, { auto, resp }]) => {
      const a = mediaArr(auto);
      const rv = mediaArr(resp);
      return {
        gruppo,
        autovalutazione: config.metrica !== "responsabile" ? a : undefined,
        responsabile: config.metrica !== "autovalutazione" ? rv : undefined,
        delta: config.metrica === "delta" ? Math.round((rv - a) * 10) / 10 : undefined,
      };
    });
  }

  // raggruppamento === "parametro"
  const [{ mansioneMap, skillMap }, { data: parametri }] = await Promise.all([
    buildParametroMaps(supabase, risposteDati),
    supabase.from("parametri_radar").select("id, nome").eq("is_storico", false).order("ordine"),
  ]);

  const gruppiP: Record<string, { auto: number[]; resp: number[] }> = {};
  risposteDati.forEach((r) => {
    const pId = getParametroId(r, mansioneMap, skillMap);
    if (!pId) return;
    if (config.parametri_ids.length > 0 && !config.parametri_ids.includes(pId)) return;
    if (!gruppiP[pId]) gruppiP[pId] = { auto: [], resp: [] };
    if (r.tipo === "autovalutazione") gruppiP[pId].auto.push(r.punteggio);
    else if (r.tipo === "responsabile") gruppiP[pId].resp.push(r.punteggio);
  });

  const parametroNome: Record<string, string> = {};
  (parametri ?? []).forEach((p) => { parametroNome[p.id] = p.nome; });

  return Object.entries(gruppiP).map(([pId, { auto, resp }]) => {
    const a = mediaArr(auto);
    const rv = mediaArr(resp);
    return {
      gruppo: parametroNome[pId] ?? pId,
      autovalutazione: config.metrica !== "responsabile" ? a : undefined,
      responsabile: config.metrica !== "autovalutazione" ? rv : undefined,
      delta: config.metrica === "delta" ? Math.round((rv - a) * 10) / 10 : undefined,
    };
  });
}

// ─── getDatiLine ─────────────────────────────────────────────────────────────

export async function getDatiLine(config: BloccoLineConfig): Promise<LineDataPoint[]> {
  const supabase = await createClient();
  const [annoFrom, annoTo] = config.anni_range;
  const anni = Array.from({ length: annoTo - annoFrom + 1 }, (_, i) => annoFrom + i);

  const { data: sessioni } = await supabase
    .from("sessioni_utente")
    .select("id, anno")
    .in("anno", anni)
    .in("stato", ["completata", "certificata"]);

  if (!sessioni || sessioni.length === 0) return anni.map((anno) => ({ anno }));

  const { data: risposteDati } = await (supabase
    .from("risposte_valutazione")
    .select("sessione_utente_id, mansione_id, skill_id, punteggio, tipo")
    .in("sessione_utente_id", sessioni.map((s) => s.id)) as unknown as Promise<{
      data: Array<RispostaRaw & { sessione_utente_id: string }> | null;
    }>);

  if (!risposteDati || risposteDati.length === 0) return anni.map((anno) => ({ anno }));

  const sessioneAnnoMap: Record<string, number> = {};
  sessioni.forEach((s) => { sessioneAnnoMap[s.id] = s.anno; });

  let mansioneMap: Record<string, string | null> = {};
  let skillMap: Record<string, string | null> = {};

  if (config.parametri_ids.length > 0) {
    const maps = await buildParametroMaps(supabase, risposteDati);
    mansioneMap = maps.mansioneMap;
    skillMap = maps.skillMap;
  }

  return anni.map((anno) => {
    const risposteAnno = risposteDati.filter((r) => sessioneAnnoMap[r.sessione_utente_id] === anno);
    const filtrate = config.parametri_ids.length > 0
      ? risposteAnno.filter((r) => config.parametri_ids.includes(getParametroId(r, mansioneMap, skillMap) ?? ""))
      : risposteAnno;

    return {
      anno,
      autovalutazione: config.metrica !== "responsabile"
        ? mediaArr(filtrate.filter((r) => r.tipo === "autovalutazione").map((r) => r.punteggio)) || undefined
        : undefined,
      responsabile: config.metrica !== "autovalutazione"
        ? mediaArr(filtrate.filter((r) => r.tipo === "responsabile").map((r) => r.punteggio)) || undefined
        : undefined,
    };
  });
}

// ─── getDatiPie ──────────────────────────────────────────────────────────────

export async function getDatiPie(config: BloccoPieConfig): Promise<PieDataPoint[]> {
  const supabase = await createClient();
  const anno = config.anno ?? new Date().getFullYear();

  if (config.distribuzione === "stati_sessioni") {
    const { data } = await supabase
      .from("sessioni_utente")
      .select("stato")
      .eq("anno", anno);

    const conteggio: Record<string, number> = {};
    (data ?? []).forEach((s) => { conteggio[s.stato] = (conteggio[s.stato] ?? 0) + 1; });
    return Object.entries(conteggio).map(([nome, valore]) => ({ nome, valore }));
  }

  if (config.distribuzione === "reparti") {
    const { data } = await (supabase
      .from("sessioni_utente")
      .select("utenti!inner(reparto)")
      .eq("anno", anno)
      .in("stato", ["completata", "certificata"]) as unknown as Promise<{
        data: Array<{ utenti: { reparto: string } }> | null;
      }>);

    const conteggio: Record<string, number> = {};
    (data ?? []).forEach((s) => {
      const r = s.utenti.reparto || "N/D";
      if (config.reparti.length > 0 && !config.reparti.includes(r)) return;
      conteggio[r] = (conteggio[r] ?? 0) + 1;
    });
    return Object.entries(conteggio).map(([nome, valore]) => ({ nome, valore }));
  }

  // distribuzione === "punteggi_fasce"
  const { data: sessioni } = await supabase
    .from("sessioni_utente")
    .select("id")
    .eq("anno", anno)
    .in("stato", ["completata", "certificata"]);

  const { data: risposteDati } = await (supabase
    .from("risposte_valutazione")
    .select("punteggio")
    .in("sessione_utente_id", (sessioni ?? []).map((s) => s.id))
    .eq("tipo", "responsabile") as unknown as Promise<{ data: Array<{ punteggio: number }> | null }>);

  const fasce = { "1-2": 0, "2-3": 0, "3-4": 0, "4-5": 0 };
  (risposteDati ?? []).forEach(({ punteggio: p }) => {
    if (p < 2) fasce["1-2"]++;
    else if (p < 3) fasce["2-3"]++;
    else if (p < 4) fasce["3-4"]++;
    else fasce["4-5"]++;
  });

  return Object.entries(fasce).map(([nome, valore]) => ({ nome, valore }));
}

// ─── getDatiTable ─────────────────────────────────────────────────────────────

export async function getDatiTable(config: BloccoTableConfig): Promise<TableRow[]> {
  const supabase = await createClient();
  const anno = config.anno ?? new Date().getFullYear();
  const limit = config.limit ?? 20;

  if (config.modalita === "ranking_utenti") {
    let query = supabase
      .from("sessioni_utente")
      .select("id, utente_id, utenti!inner(nome, cognome, reparto)")
      .eq("anno", anno)
      .in("stato", ["completata", "certificata"]) as unknown as ReturnType<typeof supabase.from>;

    if (config.reparto) {
      query = (query as ReturnType<typeof supabase.from> & { filter: (col: string, op: string, val: string) => typeof query })
        .filter("utenti.reparto", "eq", config.reparto);
    }

    const { data: sessioni } = await (query as unknown as Promise<{
      data: Array<{ id: string; utente_id: string; utenti: { nome: string; cognome: string; reparto: string } }> | null;
    }>);

    if (!sessioni || sessioni.length === 0) return [];

    const { data: risposteDati } = await (supabase
      .from("risposte_valutazione")
      .select("sessione_utente_id, punteggio, tipo")
      .in("sessione_utente_id", sessioni.map((s) => s.id))
      .eq("tipo", "responsabile") as unknown as Promise<{
        data: Array<{ sessione_utente_id: string; punteggio: number; tipo: string }> | null;
      }>);

    const medie: Record<string, { somma: number; count: number; nome: string; cognome: string; reparto: string }> = {};
    sessioni.forEach((s) => {
      medie[s.utente_id] = { somma: 0, count: 0, nome: s.utenti.nome, cognome: s.utenti.cognome, reparto: s.utenti.reparto };
    });
    (risposteDati ?? []).forEach((r) => {
      const sessione = sessioni.find((s) => s.id === r.sessione_utente_id);
      if (!sessione) return;
      const m = medie[sessione.utente_id];
      if (m) { m.somma += r.punteggio; m.count++; }
    });

    return Object.entries(medie)
      .map(([, { nome, cognome, reparto, somma, count }]) => ({
        nome: `${nome} ${cognome}`,
        reparto,
        media: count > 0 ? Math.round((somma / count) * 10) / 10 : 0,
      }))
      .sort((a, b) => (b.media as number) - (a.media as number))
      .slice(0, limit)
      .map((row, i) => ({ posizione: i + 1, ...row }));
  }

  // modalita === "dettaglio_sessioni"
  const { data } = await (supabase
    .from("sessioni_utente")
    .select("id, anno, stato, tipo_valutazione, utenti!inner(nome, cognome, reparto)")
    .eq("anno", anno)
    .order("created_at", { ascending: false })
    .limit(limit) as unknown as Promise<{
      data: Array<{
        id: string; anno: number; stato: string; tipo_valutazione: string | null;
        utenti: { nome: string; cognome: string; reparto: string };
      }> | null;
    }>);

  return (data ?? []).map((s) => ({
    dipendente: `${s.utenti.nome} ${s.utenti.cognome}`,
    reparto: s.utenti.reparto,
    anno: s.anno,
    tipo: s.tipo_valutazione ?? "—",
    stato: s.stato,
  }));
}

// ─── getDatiKpiCard ───────────────────────────────────────────────────────────

export async function getDatiKpiCard(config: BloccoKpiCardConfig): Promise<KpiCardData[]> {
  const supabase = await createClient();
  const anno = config.anno ?? new Date().getFullYear();

  let kpiQuery = supabase.from("kpi_config").select("id, nome, parametro_id, soglia, operatore").eq("is_attivo", true);
  if (config.kpi_ids.length > 0) kpiQuery = kpiQuery.in("id", config.kpi_ids);

  const [{ data: kpis }, { data: sessioni }] = await Promise.all([
    kpiQuery,
    supabase
      .from("sessioni_utente")
      .select("id")
      .eq("anno", anno)
      .in("stato", ["completata", "certificata"]),
  ]);

  if (!kpis || kpis.length === 0) return [];

  const sessioneIds = (sessioni ?? []).map((s) => s.id);

  const { data: risposteDati } = await (supabase
    .from("risposte_valutazione")
    .select("mansione_id, skill_id, punteggio, tipo")
    .in("sessione_utente_id", sessioneIds)
    .eq("tipo", "responsabile") as unknown as Promise<{ data: RispostaRaw[] | null }>);

  const risposte = risposteDati ?? [];
  const { mansioneMap, skillMap } = risposte.length > 0
    ? await buildParametroMaps(supabase, risposte)
    : { mansioneMap: {}, skillMap: {} };

  const valutaKpi = (valore: number, op: string, soglia: number): "ok" | "ko" => {
    switch (op) {
      case ">": return valore > soglia ? "ok" : "ko";
      case ">=": return valore >= soglia ? "ok" : "ko";
      case "=": return valore === soglia ? "ok" : "ko";
      case "<=": return valore <= soglia ? "ok" : "ko";
      case "<": return valore < soglia ? "ok" : "ko";
      default: return "ko";
    }
  };

  return kpis.map((kpi) => {
    const filtrate = kpi.parametro_id
      ? risposte.filter((r) => getParametroId(r, mansioneMap, skillMap) === kpi.parametro_id)
      : risposte;

    const valore = filtrate.length > 0 ? mediaArr(filtrate.map((r) => r.punteggio)) : null;

    return {
      id: kpi.id,
      nome: kpi.nome,
      valore,
      soglia: kpi.soglia,
      operatore: kpi.operatore as KpiCardData["operatore"],
      status: valore !== null ? valutaKpi(valore, kpi.operatore, kpi.soglia) : "nd",
    };
  });
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function calcolaDatiBlocco(blocco: ReportBlocco | BloccoInput): Promise<unknown> {
  const cfg = blocco.configurazione;
  switch (blocco.tipo) {
    case "radar":   return getDatiRadar(cfg as BloccoRadarConfig);
    case "bar":     return getDatiBar(cfg as BloccoBarConfig);
    case "line":    return getDatiLine(cfg as BloccoLineConfig);
    case "pie":
    case "donut":   return getDatiPie(cfg as BloccoPieConfig);
    case "table":   return getDatiTable(cfg as BloccoTableConfig);
    case "kpi_card": return getDatiKpiCard(cfg as BloccoKpiCardConfig);
    default:        return [];
  }
}
