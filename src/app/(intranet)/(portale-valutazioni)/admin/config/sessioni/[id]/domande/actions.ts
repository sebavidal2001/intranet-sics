"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { redirect } from "next/navigation";

async function getAdminClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non autenticato");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) throw new Error("Accesso negato");
  return createAdminClient();
}

export async function saveUtenteMansioni(
  utenteId: string,
  mansioneIds: string[],
  sessioneId: string
): Promise<{ error?: string }> {
  try {
    const supabase = await getAdminClient();

    // Delete all existing utente_mansioni for this user
    const { error: deleteError } = await supabase
      .from("utente_mansioni")
      .delete()
      .eq("utente_id", utenteId);

    if (deleteError) return { error: deleteError.message };

    // Insert new ones
    if (mansioneIds.length > 0) {
      const rows = mansioneIds.map((mid) => ({
        utente_id: utenteId,
        mansione_id: mid,
      }));
      const { error: insertError } = await supabase
        .from("utente_mansioni")
        .insert(rows);
      if (insertError) return { error: insertError.message };
    }

    revalidatePath(`/admin/config/sessioni/${sessioneId}/domande`);
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveSessioneSkills(
  sessioneUtenteId: string,
  skillIds: string[],
  sessioneId: string
): Promise<{ error?: string }> {
  try {
    const supabase = await getAdminClient();

    // Delete all existing skills for this sessione_utente
    const { error: deleteError } = await supabase
      .from("sessione_skills")
      .delete()
      .eq("sessione_id", sessioneUtenteId);

    if (deleteError) return { error: deleteError.message };

    // Insert new ones
    if (skillIds.length > 0) {
      const rows = skillIds.map((sid) => ({
        sessione_id: sessioneUtenteId,
        skill_id: sid,
      }));
      const { error: insertError } = await supabase
        .from("sessione_skills")
        .insert(rows);
      if (insertError) return { error: insertError.message };
    }

    revalidatePath(`/admin/config/sessioni/${sessioneId}/domande`);
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function saveOrdineProfili(
  sessioneUtenteId: string,
  ordineProfili: string[]
): Promise<{ error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Non autenticato");
    const isAdmin = await isValutazioniAdmin(supabase, user.id);
    if (!isAdmin) throw new Error("Accesso negato");

    const db = createAdminClient();
    const { error } = await db
      .from("sessioni_utente")
      .update({ ordine_profili: ordineProfili })
      .eq("id", sessioneUtenteId);

    if (error) return { error: error.message };
    return {};
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function cloneSchedaAnnoPrecedente(
  sessioneUtenteId: string,
  sessioneId: string
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) return { error: "Non autorizzato" };

  const sb = createAdminClient();

  const { data: sessione } = await sb
    .from("sessioni_utente")
    .select("id, utente_id, anno, responsabile_id")
    .eq("id", sessioneUtenteId)
    .single();

  if (!sessione) return { error: "Sessione non trovata" };

  const { data: sessionePrec } = await sb
    .from("sessioni_utente")
    .select("id")
    .eq("utente_id", sessione.utente_id)
    .eq("tipo_valutazione", "annuale")
    .lt("anno", sessione.anno)
    .order("anno", { ascending: false })
    .limit(1)
    .single();

  if (!sessionePrec) return { error: "Nessuna sessione annuale precedente trovata" };

  const { data: rispostePrec } = await sb
    .from("risposte_valutazione")
    .select("mansione_id, punteggio, note")
    .eq("sessione_utente_id", sessionePrec.id)
    .eq("tipo", "responsabile");

  if (!rispostePrec || rispostePrec.length === 0) {
    return { error: "Nessuna risposta responsabile nell'anno precedente" };
  }

  const valutatore_id = sessione.responsabile_id ?? user.id;

  const { error: insertErr } = await sb
    .from("risposte_valutazione")
    .upsert(
      rispostePrec.map((r: { mansione_id: string; punteggio: number; note: string | null }) => ({
        sessione_utente_id: sessioneUtenteId,
        mansione_id: r.mansione_id,
        valutatore_id,
        punteggio: r.punteggio,
        tipo: "responsabile",
        note: r.note,
      })),
      { onConflict: "sessione_utente_id,mansione_id,tipo" }
    );

  if (insertErr) return { error: insertErr.message };

  revalidatePath(`/admin/config/sessioni/${sessioneId}/domande`);
  revalidatePath(`/valutazioni/responsabile/${sessioneUtenteId}`);
  return {};
}
