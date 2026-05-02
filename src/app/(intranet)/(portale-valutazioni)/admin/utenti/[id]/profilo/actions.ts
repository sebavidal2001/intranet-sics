"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

type ActionResult = { error?: string };

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");
  return supabase;
}

export async function setUtenteProfiloWithMansioni(data: {
  utente_id: string;
  ruolo_professionale_id: string;
  mansioni_ids: string[];
  attivo: boolean;
}): Promise<ActionResult> {
  const supabase = await requireAdmin();
  const { utente_id, ruolo_professionale_id, mansioni_ids, attivo } = data;

  if (!attivo) {
    // Rimuovi profilo e tutte le mansioni per questo ruolo
    // Prima trova le mansioni del ruolo
    const { data: mansioniRuolo } = await supabase
      .from("mansioni")
      .select("id")
      .eq("ruolo_professionale_id", ruolo_professionale_id);

    const mansioniIds = (mansioniRuolo ?? []).map((m) => m.id);

    if (mansioniIds.length > 0) {
      const { error: errMansioni } = await supabase
        .from("utente_mansioni")
        .delete()
        .eq("utente_id", utente_id)
        .in("mansione_id", mansioniIds);

      if (errMansioni) return { error: errMansioni.message };
    }

    const { error: errProfilo } = await supabase
      .from("utente_profili")
      .delete()
      .eq("utente_id", utente_id)
      .eq("ruolo_professionale_id", ruolo_professionale_id);

    if (errProfilo) return { error: errProfilo.message };
  } else {
    // UPSERT profilo
    const { error: errUpsert } = await supabase
      .from("utente_profili")
      .upsert(
        { utente_id, ruolo_professionale_id },
        { onConflict: "utente_id,ruolo_professionale_id" }
      );

    if (errUpsert) return { error: errUpsert.message };

    // Trova tutte le mansioni del ruolo
    const { data: mansioniRuolo } = await supabase
      .from("mansioni")
      .select("id")
      .eq("ruolo_professionale_id", ruolo_professionale_id);

    const tutteMansioniIds = (mansioniRuolo ?? []).map((m) => m.id);

    // Elimina tutte le utente_mansioni per le mansioni di questo ruolo
    if (tutteMansioniIds.length > 0) {
      const { error: errDelete } = await supabase
        .from("utente_mansioni")
        .delete()
        .eq("utente_id", utente_id)
        .in("mansione_id", tutteMansioniIds);

      if (errDelete) return { error: errDelete.message };
    }

    // Inserisci solo quelle selezionate
    if (mansioni_ids.length > 0) {
      const rows = mansioni_ids.map((mansione_id) => ({
        utente_id,
        mansione_id,
      }));

      const { error: errInsert } = await supabase
        .from("utente_mansioni")
        .insert(rows);

      if (errInsert) return { error: errInsert.message };
    }
  }

  revalidatePath(`/admin/utenti/${utente_id}/profilo`);
  return {};
}
