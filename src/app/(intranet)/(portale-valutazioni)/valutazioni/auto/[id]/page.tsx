import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { AutvalutazioneForm } from "./autovalutazione-form";

/** Schermata informativa mostrata quando l'autovalutazione non è ancora accessibile. */
function NonDisponibile({ messaggio }: { messaggio: string }) {
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Valutazioni", href: "/valutazioni" },
        { label: "Autovalutazione" },
      ]} />
      <div className="mt-6 rounded-xl border border-border bg-bg p-8 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-secondary-light flex items-center justify-center mb-4">
          <Lock className="h-6 w-6 text-text-muted" />
        </div>
        <h1 className="font-tenorite text-xl font-semibold text-text mb-2">
          Autovalutazione non ancora disponibile
        </h1>
        <p className="text-sm text-text-muted mb-6">{messaggio}</p>
        <Link
          href="/valutazioni"
          className="inline-block bg-primary hover:bg-primary-dark text-white font-tenorite text-sm py-2 px-5 rounded-lg transition-colors"
        >
          Torna alle valutazioni
        </Link>
      </div>
    </div>
  );
}

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

  // L'autovalutazione si sblocca solo dopo che il responsabile ha completato.
  // Invece di un redirect "muto", mostriamo una schermata informativa.
  if (
    sessione.stato !== "resp_completata" &&
    sessione.stato !== "collab_in_corso" &&
    sessione.stato !== "completata" &&
    sessione.stato !== "certificata"
  ) {
    return (
      <NonDisponibile messaggio="La tua autovalutazione sarà disponibile dopo che il responsabile avrà completato la valutazione. Riprova più avanti." />
    );
  }

  // Interruttore generale: se la sessione globale dell'anno è chiusa,
  // la valutazione è in sola lettura per tutti.
  const { data: sessioneGlobale } = await supabase
    .from("sessioni_valutazione")
    .select("is_aperta")
    .eq("anno", sessione.anno)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle() as unknown as { data: { is_aperta: boolean } | null };
  const sessioneAperta = sessioneGlobale?.is_aperta ?? true;

  const isReadOnly =
    !sessioneAperta ||
    sessione.stato === "completata" ||
    sessione.stato === "certificata";

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

  // Carica SOLO le risposte di autovalutazione del dipendente.
  // Le risposte del responsabile NON vengono lette né inviate al client:
  // l'autovalutazione deve essere "alla cieca" — il dipendente non deve
  // vedere i punteggi assegnati dal responsabile.
  const { data: tutteRisposte } = await supabase
    .from("risposte_valutazione")
    .select("mansione_id, skill_id, punteggio, note, tipo")
    .eq("sessione_utente_id", id)
    .eq("tipo", "autovalutazione") as unknown as {
      data: Array<{
        mansione_id: string | null;
        skill_id: string | null;
        punteggio: number;
        note: string | null;
        tipo: string;
      }> | null;
    };

  const risposteAutoMansioni = (tutteRisposte ?? [])
    .filter((r) => r.mansione_id)
    .reduce<Record<string, { punteggio: number; note: string | null }>>((acc, r) => {
      acc[r.mansione_id!] = { punteggio: r.punteggio, note: r.note ?? null };
      return acc;
    }, {});

  const risposteAutoSkills = (tutteRisposte ?? [])
    .filter((r) => r.skill_id)
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
        isReadOnly={isReadOnly}
        ordineProfili={Array.isArray((sessione as unknown as { ordine_profili?: unknown }).ordine_profili)
          ? ((sessione as unknown as { ordine_profili: string[] }).ordine_profili)
          : []}
      />
    </div>
  );
}
