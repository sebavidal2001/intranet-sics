"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";

export type LivelloOverride = "default" | "viewer" | "exporter" | "admin" | "nessuno";

export async function salvaPermessoPortale(
  utenteId: string,
  portaleId: string,
  livello: LivelloOverride
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) return { error: "Non autorizzato" };

  const db = createAdminClient();

  if (livello === "default") {
    // Rimuove l'override: cancella la riga
    await db
      .from("permessi_utente")
      .delete()
      .eq("utente_id", utenteId)
      .eq("portale_id", portaleId);
  } else {
    const row = {
      utente_id: utenteId,
      portale_id: portaleId,
      override_access: livello === "nessuno" ? false : livello === "viewer" || livello === "exporter" || livello === "admin",
      override_export: livello === "exporter" || livello === "admin",
      is_portal_admin: livello === "admin",
    };

    const { error } = await db
      .from("permessi_utente")
      .upsert(row, { onConflict: "utente_id,portale_id" });

    if (error) return { error: error.message };
  }

  revalidatePath(`/admin/utenti/${utenteId}/permessi`);
  return {};
}
