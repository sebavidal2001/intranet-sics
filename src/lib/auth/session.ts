/**
 * Funzioni di sessione con React cache().
 * cache() deduplica le chiamate all'interno dello stesso request tree:
 * la prima chiamata esegue la query, le successive ricevono il risultato già calcolato.
 * Ogni nuova request ricomincia da zero (nessuna cache cross-request).
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isValutazioniAdmin } from "./valutazioni-admin";

/** Utente autenticato (da Supabase Auth) */
export const getSessionUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ?? null;
});

/** Profilo dalla tabella utenti */
export const getSessionProfile = cache(async () => {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("utenti")
    .select("id, nome, cognome, ruolo, reparto")
    .eq("id", user.id)
    .single();
  return data ?? null;
});

/** Se l'utente è admin del portale valutazioni (superadmin o is_portal_admin) */
export const getSessionIsAdmin = cache(async () => {
  const user = await getSessionUser();
  if (!user) return false;
  const supabase = await createClient();
  return isValutazioniAdmin(supabase, user.id);
});
