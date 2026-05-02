import { type SupabaseClient } from "@supabase/supabase-js";

/**
 * Livelli di accesso a un portale (gerarchia crescente).
 *
 * superadmin > admin > exporter > viewer > null (nessun accesso)
 *
 * - superadmin : flag di piattaforma, bypassa tutto
 * - admin      : gestione completa del portale (CRUD, export, certifica)
 * - exporter   : visualizza + scarica PDF/CSV, nessuna modifica strutturale
 * - viewer     : sola lettura, nessun export
 * - null       : portale non visibile / nessun accesso
 */
export type LivelloAccesso = "superadmin" | "admin" | "exporter" | "viewer" | null;

const GERARCHIA: LivelloAccesso[] = ["superadmin", "admin", "exporter", "viewer", null];

/**
 * Restituisce il livello di accesso dell'utente per il portale indicato.
 * Usa la RPC `get_portale_livello` (migration 012).
 */
export async function getPortaleAccesso(
  supabase: SupabaseClient,
  userId: string,
  portaleSlug: string
): Promise<LivelloAccesso> {
  const { data, error } = await supabase.rpc("get_portale_livello", {
    p_user_id: userId,
    p_slug: portaleSlug,
  });

  if (error || data === undefined) return null;
  return (data as LivelloAccesso) ?? null;
}

/**
 * Verifica se il livello corrente è almeno pari al livello richiesto.
 */
export function hasMinLivello(
  livello: LivelloAccesso,
  minimo: Exclude<LivelloAccesso, null>
): boolean {
  if (livello === null) return false;
  return GERARCHIA.indexOf(livello) <= GERARCHIA.indexOf(minimo);
}

/** Può fare qualsiasi operazione sul portale (admin o superadmin). */
export async function canAdminPortale(
  supabase: SupabaseClient,
  userId: string,
  portaleSlug: string
): Promise<boolean> {
  const livello = await getPortaleAccesso(supabase, userId, portaleSlug);
  return hasMinLivello(livello, "admin");
}

