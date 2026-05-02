import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AutvalutazioneForm } from "./autovalutazione-form";

export default async function AutovalutazionePage({
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

  const { data: sessione, error: errSessione } = await supabase
    .from("sessioni_utente")
    .select(`id, anno, stato, utente_id, scala_id, ordine_profili`)
    .eq("id", id)
    .single() as unknown as {
      data: { id: string; anno: number; stato: string; utente_id: string; scala_id: string | null; ordine_profili: unknown } | null;
      error: unknown;
    };

  if (errSessione || !sessione) redirect("/valutazioni");
  if (sessione.utente_id !== user.id) redirect("/valutazioni");

  if (
    sessione.stato !== "resp_completata" &&
    sessione.stato !== "collab_in_corso" &&
    sessione.stato !== "completata" &&
    sessione.stato !== "certificata"
  ) {
    redirect("/valutazioni");
  }

  const isReadOnly =
    sessione.stato === "completata" || sessione.stato === "certificata";

  let scala: { id: string; nome: string; min: number; max: number; labels: Record<number, string> } | null = null;
  if (sessione.scala_id) {
    const { data } = await supabase
      .from("scale_valutazione")
      .select("id, nome, min, max, labels")
      .eq("id", sessione.scala_id)
      .single() as unknown as { data: { id: string; nome: string; min: number; max: number; labels: Record<number, string> } | null };
    scala = data;
  }

  if (!scala) redirect("/valutazioni");

  // Carica le mansioni attive dell'utente
  const { data: utenteMansioni } = await supabase
    .from("utente_mansioni")
    .select(
      `
      mansione_id,
      mansione:mansioni!utente_mansioni_mansione_id_fkey(
        id,
        testo,
        ordine,
        ruolo_professionale:ruoli_professionali(id, nome),
        parametro_radar:parametri_radar!mansioni_parametro_radar_id_fkey(id, nome, colore)
      )
    `
    )
    .eq("utente_id", user.id);

  const mansioni = (utenteMansioni ?? [])
    .map((um) => (um as unknown as { mansione: {
      id: string;
      testo: string;
      ordine: number;
      ruolo_professionale: { id: string; nome: string } | null;
      parametro_radar: { id: string; nome: string; colore: string } | null;
    } | null }).mansione)
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => a.ordine - b.ordine);

  // Carica skills per questa sessione
  const { data: sessioneSkills } = await supabase
    .from("sessione_skills")
    .select(
      `
      skill_id,
      skill:skills!sessione_skills_skill_id_fkey(
        id, nome, descrizione, ordine,
        parametro_radar:parametri_radar(id, nome, colore)
      )
    `
    )
    .eq("sessione_id", id) as unknown as {
      data: Array<{ skill_id: string; skill: {
        id: string;
        nome: string;
        descrizione: string | null;
        ordine: number;
        parametro_radar: { id: string; nome: string; colore: string } | null;
      } | null }> | null;
    };

  const skills = (sessioneSkills ?? [])
    .map((ss) => ss.skill)
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.ordine - b.ordine);

  if (mansioni.length === 0 && skills.length === 0) redirect("/valutazioni");

  // Carica tutte le risposte per questa sessione
  const { data: tutteRisposte } = await supabase
    .from("risposte_valutazione")
    .select("mansione_id, skill_id, punteggio, note, tipo")
    .eq("sessione_utente_id", id) as unknown as {
      data: Array<{
        mansione_id: string | null;
        skill_id: string | null;
        punteggio: number;
        note: string | null;
        tipo: string;
      }> | null;
    };

  const risposteRespMansioni = (tutteRisposte ?? [])
    .filter((r) => r.tipo === "responsabile" && r.mansione_id)
    .reduce<Record<string, { punteggio: number; note: string | null }>>((acc, r) => {
      acc[r.mansione_id!] = { punteggio: r.punteggio, note: r.note ?? null };
      return acc;
    }, {});

  const risposteRespSkills = (tutteRisposte ?? [])
    .filter((r) => r.tipo === "responsabile" && r.skill_id)
    .reduce<Record<string, { punteggio: number; note: string | null }>>((acc, r) => {
      acc[r.skill_id!] = { punteggio: r.punteggio, note: r.note ?? null };
      return acc;
    }, {});

  const risposteAutoMansioni = (tutteRisposte ?? [])
    .filter((r) => r.tipo === "autovalutazione" && r.mansione_id)
    .reduce<Record<string, { punteggio: number; note: string | null }>>((acc, r) => {
      acc[r.mansione_id!] = { punteggio: r.punteggio, note: r.note ?? null };
      return acc;
    }, {});

  const risposteAutoSkills = (tutteRisposte ?? [])
    .filter((r) => r.tipo === "autovalutazione" && r.skill_id)
    .reduce<Record<string, { punteggio: number; note: string | null }>>((acc, r) => {
      acc[r.skill_id!] = { punteggio: r.punteggio, note: r.note ?? null };
      return acc;
    }, {});

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Valutazioni", href: "/valutazioni" },
        { label: "Autovalutazione" },
      ]} />
      <AutvalutazioneForm
        sessioneId={id}
        anno={sessione.anno}
        mansioni={mansioni}
        skills={skills}
        scala={scala}
        risposteAutoMansioni={risposteAutoMansioni}
        risposteAutoSkills={risposteAutoSkills}
        risposteRespMansioni={risposteRespMansioni}
        risposteRespSkills={risposteRespSkills}
        isReadOnly={isReadOnly}
        ordineProfili={Array.isArray((sessione as unknown as { ordine_profili?: unknown }).ordine_profili)
          ? ((sessione as unknown as { ordine_profili: string[] }).ordine_profili)
          : []}
      />
    </div>
  );
}
