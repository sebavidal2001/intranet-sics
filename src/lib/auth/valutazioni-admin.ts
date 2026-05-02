import { type SupabaseClient } from "@supabase/supabase-js";
import { canAdminPortale } from "./portale";
import { PORTALE_SLUGS } from "@/lib/config/portali";

/**
 * Verifica se l'utente è admin del portale Valutazioni.
 * Delega a canAdminPortale() → get_portale_livello() (migration 012).
 *
 * Mantenuto per compatibilità con tutti i file esistenti che lo importano.
 */
export async function isValutazioniAdmin(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  return canAdminPortale(supabase, userId, PORTALE_SLUGS.VALUTAZIONI);
}
