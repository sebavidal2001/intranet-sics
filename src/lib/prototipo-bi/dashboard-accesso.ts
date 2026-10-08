/**
 * Chi può aprire una dashboard.
 *
 * Tre strade, in ordine di forza:
 *   1. è l'autore;
 *   2. la direzione gliel'ha ASSEGNATA (`dashboard_assegnazioni`);
 *   3. è `condivisa` — ma solo se non è un utente "solo assegnate".
 *
 * La terza strada si chiude per chi ha il livello operativo, altrimenti una
 * dashboard condivisa (come il Cruscotto di sistema) arriverebbe a tutti i
 * dipendenti abilitati e "ricevere solo ciò che serve" non sarebbe vero.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export interface DashboardAccessibile {
  autore_id: string;
  visibilita: "privata" | "condivisa" | string;
}

export function dashboardVisibile(
  utente: { userId: string; soloAssegnate: boolean },
  dashboard: DashboardAccessibile,
  assegnata: boolean
): boolean {
  if (dashboard.autore_id === utente.userId) return true;
  if (assegnata) return true;
  return dashboard.visibilita === "condivisa" && !utente.soloAssegnate;
}

/** Identificativi delle dashboard assegnate a un utente. */
export async function dashboardAssegnateA(userId: string): Promise<Set<string>> {
  const { data, error } = await createAdminClient()
    .schema("bi_direzionale")
    .from("dashboard_assegnazioni")
    .select("dashboard_id")
    .eq("utente_id", userId);
  // Se la tabella non risponde non si apre niente: meglio un elenco vuoto.
  if (error) {
    console.error("[bi] assegnazioni non leggibili:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => String(r.dashboard_id)));
}
