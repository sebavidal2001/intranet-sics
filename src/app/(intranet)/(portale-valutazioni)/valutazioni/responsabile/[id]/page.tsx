import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ValutazioneForm } from "./valutazione-form";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export default async function ValutazioneResponsabilePage({
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

  // Carica la sessione utente (senza join su utenti — FK hint non supportata)
  const { data: sessione, error: errSessione } = await supabase
    .from("sessioni_utente")
    .select("id, anno, stato, responsabile_id, utente_id, scala_id, ordine_profili")
    .eq("id", id)
    .single() as unknown as {
      data: { id: string; anno: number; stato: string; responsabile_id: string | null; utente_id: string; scala_id: string | null; ordine_profili: unknown } | null;
      error: unknown;
    };

  if (errSessione || !sessione) redirect("/valutazioni");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);

  // Permette accesso se l'utente è il responsabile OPPURE è admin
  if (!isAdmin && sessione.responsabile_id !== user.id) redirect("/valutazioni");

  // Interruttore generale: se la sessione globale dell'anno è chiusa,
  // la valutazione è in sola lettura (nessuno può modificarla).
  const { data: sessioneGlobale } = await supabase
    .from("sessioni_valutazione")
    .select("is_aperta")
    .eq("anno", sessione.anno)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle() as unknown as { data: { is_aperta: boolean } | null };
  const sessioneAperta = sessioneGlobale?.is_aperta ?? true;

  const stato = sessione.stato;
  const isReadOnly =
    !sessioneAperta ||
    stato === "resp_completata" ||
    stato === "collab_in_corso" ||
    stato === "completata" ||
    stato === "certificata";

  // Carica la scala di valutazione
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

  // Carica i dati dell'utente da valutare
  const { data: utenteData } = await supabase
    .from("utenti")
    .select("id, nome, cognome, reparto")
    .eq("id", sessione.utente_id)
    .single();

  if (!utenteData) redirect("/valutazioni");

  const utente = utenteData;

  // Carica le mansioni attive dell'utente da valutare
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
    .eq("utente_id", utente.id);

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
    .eq("sessione_id", id);

  const skills = (sessioneSkills ?? [])
    .map((ss) => (ss as unknown as { skill: {
      id: string;
      nome: string;
      descrizione: string | null;
      ordine: number;
      parametro_radar: { id: string; nome: string; colore: string } | null;
    } | null }).skill)
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.ordine - b.ordine);

  if (mansioni.length === 0 && skills.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Breadcrumbs items={[
          { label: "Valutazioni", href: "/valutazioni" },
          { label: "Valutazione responsabile" },
        ]} />
        <div className="mt-8 rounded-xl border border-warning/40 bg-warning/10 p-6 text-center">
          <p className="font-tenorite text-lg text-text mb-2">Nessuna mansione o skill configurata</p>
          <p className="text-sm text-text-muted">
            L&apos;utente <strong>{utente.nome} {utente.cognome}</strong> non ha mansioni assegnate
            e questa sessione non ha skill configurate.
          </p>
          <p className="text-sm text-text-muted mt-1">
            Vai in <strong>Admin → Utenti</strong> per assegnare le mansioni, oppure in
            <strong> Admin → Sessioni</strong> per aggiungere skill a questa sessione.
          </p>
        </div>
      </div>
    );
  }

  // Carica risposte esistenti di tipo 'responsabile' (query flat, senza FK hint)
  const { data: risposteEsistenti } = await supabase
    .from("risposte_valutazione")
    .select("mansione_id, skill_id, punteggio, note")
    .eq("sessione_utente_id", id)
    .eq("tipo", "responsabile") as unknown as {
      data: Array<{
        mansione_id: string | null;
        skill_id: string | null;
        punteggio: number;
        note: string | null;
      }> | null;
    };

  const risposteMansioni = (risposteEsistenti ?? [])
    .filter((r) => r.mansione_id)
    .reduce<Record<string, { punteggio: number; note: string | null }>>((acc, r) => {
      acc[r.mansione_id!] = { punteggio: r.punteggio, note: r.note ?? null };
      return acc;
    }, {});

  const risposteSkills = (risposteEsistenti ?? [])
    .filter((r) => r.skill_id)
    .reduce<Record<string, { punteggio: number; note: string | null }>>((acc, r) => {
      acc[r.skill_id!] = { punteggio: r.punteggio, note: r.note ?? null };
      return acc;
    }, {});

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <Breadcrumbs items={[
        { label: "Valutazioni", href: "/valutazioni" },
        { label: "Valutazione responsabile" },
      ]} />
      <ValutazioneForm
        sessioneId={id}
        nomeUtente={`${utente.nome} ${utente.cognome}`}
        anno={sessione.anno}
        mansioni={mansioni}
        skills={skills}
        scala={scala as unknown as { id: string; nome: string; min: number; max: number; labels: Record<string, string> | null }}
        risposteMansioni={risposteMansioni}
        risposteSkills={risposteSkills}
        isReadOnly={isReadOnly}
        ordineProfili={Array.isArray((sessione as unknown as { ordine_profili?: unknown }).ordine_profili)
          ? ((sessione as unknown as { ordine_profili: string[] }).ordine_profili)
          : []}
      />
    </div>
  );
}
