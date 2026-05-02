"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export async function avviaSessioneResponsabile(sessioneId: string): Promise<{ error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const { data: sessione, error: errSessione } = await supabase
    .from("sessioni_utente")
    .select("id, responsabile_id, stato")
    .eq("id", sessioneId)
    .single();

  if (errSessione || !sessione) return { error: "Sessione non trovata" };

  const isAdmin = await isValutazioniAdmin(supabase, user.id);

  if (!isAdmin && sessione.responsabile_id !== user.id) {
    return { error: "Non autorizzato" };
  }

  if (sessione.stato !== "programmata") {
    return { error: "La sessione non è in stato programmata" };
  }

  // Usa admin client per bypassare RLS sull'update dello stato
  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("sessioni_utente")
    .update({ stato: "resp_in_corso" })
    .eq("id", sessioneId);

  if (error) return { error: error.message };

  revalidatePath("/valutazioni");
  redirect(`/valutazioni/responsabile/${sessioneId}`);
}
