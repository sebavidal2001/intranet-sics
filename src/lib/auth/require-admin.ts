import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValutazioniAdmin } from "@/lib/auth/valutazioni-admin";
import { redirect } from "next/navigation";

export async function requireValutazioniAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) redirect("/");
  return supabase;
}

/**
 * Guard per Server Actions e pagine riservate al superadmin di piattaforma.
 * Verifica `utenti.ruolo = 'superadmin'`. Redirect se non autenticato o non
 * autorizzato. Ritorna l'utente per usarne l'id (es. audit `assegnato_da`).
 *
 * Nota: non affidarsi solo alla RLS — ogni action deve fare il proprio check
 * (convenzione di progetto), così la protezione non dipende da un singolo layer.
 */
export async function requireSuperadmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  const admin = createAdminClient();
  const { data } = await admin
    .from("utenti")
    .select("ruolo")
    .eq("id", user.id)
    .maybeSingle();
  if ((data?.ruolo as string | undefined) !== "superadmin") redirect("/");
  return { supabase, user };
}
