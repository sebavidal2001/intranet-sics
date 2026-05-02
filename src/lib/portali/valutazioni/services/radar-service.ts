import { createClient } from "@/lib/supabase/server";
import type { RadarDataPoint } from "@/lib/types";

/**
 * Recupera i dati per il radar chart di un utente
 * Usa il nuovo schema: sessioni_utente → risposte_valutazione → mansioni/skills → parametri_radar
 */
export async function getRadarData(
  utenteId: string,
  anno: number,
  includeStorico: boolean = false
): Promise<RadarDataPoint[]> {
  const supabase = await createClient();

  // Helper: calcola dati radar per un utente+anno dato
  async function calcolaPerAnno(uid: string, yr: number) {
    // Sessioni completate o certificate per quell'anno
    const { data: sessioni } = await supabase
      .from("sessioni_utente")
      .select("id")
      .eq("utente_id", uid)
      .eq("anno", yr)
      .in("stato", ["completata", "certificata"]);

    const sessioneIds = (sessioni ?? []).map((s) => s.id);
    if (sessioneIds.length === 0) return null;

    // Risposte per quelle sessioni
    // Cast necessario: skill_id e punteggio sono nel DB (migration 009) ma non nei tipi auto-generati
    const { data: risposte } = await (supabase
      .from("risposte_valutazione")
      .select("mansione_id, skill_id, punteggio, tipo")
      .in("sessione_utente_id", sessioneIds) as unknown as Promise<{
        data: Array<{ mansione_id: string | null; skill_id: string | null; punteggio: number; tipo: string }> | null;
      }>);

    if (!risposte || risposte.length === 0) return null;

    // Raccoglie gli ID unici di mansioni e skills presenti nelle risposte
    const mansioneIds = [
      ...new Set(risposte.filter((r) => r.mansione_id).map((r) => r.mansione_id as string)),
    ];
    const skillIds = [
      ...new Set(risposte.filter((r) => r.skill_id).map((r) => r.skill_id as string)),
    ];

    // Parallelizza fetch mansioni e skills (erano sequenziali)
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

    return { risposte, mansioneMap, skillMap };
  }

  // Parallelizza: fetch parametri radar + dati anno corrente (erano sequenziali)
  const [parametriResult, corrente] = await Promise.all([
    supabase
      .from("parametri_radar")
      .select("id, nome")
      .eq("is_storico", false)
      .order("ordine"),
    calcolaPerAnno(utenteId, anno),
  ]);

  const parametri = parametriResult.data;
  if (!parametri || parametri.length === 0) return [];

  // Storico anno precedente (solo se richiesto, non parallelizzabile con corrente
  // perché dipende dal contesto, ma possiamo avviarlo già sopra se includeStorico=true)
  let storico: Awaited<ReturnType<typeof calcolaPerAnno>> = null;
  if (includeStorico) {
    storico = await calcolaPerAnno(utenteId, anno - 1);
  }

  // Costruisci il dataset radar — solo parametri con almeno una risposta
  const radarData: RadarDataPoint[] = parametri.map((parametro) => {
    // Filtra risposte che appartengono a questo parametro
    const risposteDelParametro = (corrente?.risposte ?? []).filter((r) => {
      const pIdMansione = r.mansione_id ? corrente?.mansioneMap[r.mansione_id] : null;
      const pIdSkill = r.skill_id ? corrente?.skillMap[r.skill_id] : null;
      return pIdMansione === parametro.id || pIdSkill === parametro.id;
    });

    const risposteAuto = risposteDelParametro.filter((r) => r.tipo === "autovalutazione");
    const mediaAuto =
      risposteAuto.length > 0
        ? risposteAuto.reduce((sum, r) => sum + r.punteggio, 0) / risposteAuto.length
        : 0;

    const risposteResp = risposteDelParametro.filter((r) => r.tipo === "responsabile");
    const mediaResp =
      risposteResp.length > 0
        ? risposteResp.reduce((sum, r) => sum + r.punteggio, 0) / risposteResp.length
        : 0;

    // Storico anno precedente
    let mediaStorico: number | undefined = undefined;
    if (storico) {
      const risposteStorico = (storico.risposte ?? []).filter((r) => {
        if (r.tipo !== "responsabile") return false;
        const pIdMansione = r.mansione_id ? storico.mansioneMap[r.mansione_id] : null;
        const pIdSkill = r.skill_id ? storico.skillMap[r.skill_id] : null;
        return pIdMansione === parametro.id || pIdSkill === parametro.id;
      });
      if (risposteStorico.length > 0) {
        mediaStorico =
          risposteStorico.reduce((sum, r) => sum + r.punteggio, 0) / risposteStorico.length;
      }
    }

    return {
      parametro: parametro.nome,
      autovalutazione: Math.round(mediaAuto * 10) / 10,
      responsabile: Math.round(mediaResp * 10) / 10,
      storico: mediaStorico !== undefined ? Math.round(mediaStorico * 10) / 10 : undefined,
    };
  })
  // Esclude parametri senza risposte (scala min=1, quindi 0 = nessun dato)
  .filter((d) => d.autovalutazione > 0 || d.responsabile > 0);

  return radarData;
}
