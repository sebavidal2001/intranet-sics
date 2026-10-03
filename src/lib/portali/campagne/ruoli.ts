import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ruoli del Portale Campagne Marketing (migration 131).
 *
 * Stessa separazione di Preventivatore e Vettori: il **livello di portale**
 * stabilisce se vedi il portale, il **ruolo funzionale** cosa ci fai.
 *
 * - admin (livello `admin` o `superadmin`): campagne, pubblico, e in Fase 3
 *   l'Analisi. Può fare anche tutto ciò che fa il back office.
 * - back office (ruolo funzionale `backoffice`): clienti e invii. Non vede la
 *   configurazione.
 */
export const CAMPAGNE_RUOLI = {
  backoffice: "backoffice",
} as const;

export type CampagneLivello = "viewer" | "exporter" | "admin" | "superadmin" | null;

export interface CampagneContext {
  livello: CampagneLivello;
  ruoli: string[];
}

/** Contesto permessi in un solo round-trip (RPC `get_campagne_context`, migration 131). */
export async function getCampagneContext(userId: string): Promise<CampagneContext> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("get_campagne_context", { p_user_id: userId });
  const ctx = (data ?? {}) as { livello?: string | null; ruoli?: string[] | null };
  return {
    livello: (ctx.livello as CampagneLivello) ?? null,
    ruoli: ctx.ruoli ?? [],
  };
}

/** Admin del portale: gestisce campagne e pubblico. */
export function eAdminCampagne(ctx: CampagneContext): boolean {
  return ctx.livello === "admin" || ctx.livello === "superadmin";
}

/** Può lavorare sui clienti e sugli invii. Gli admin bypassano sempre. */
export function puoOperare(ctx: CampagneContext): boolean {
  if (ctx.livello === null) return false;
  return eAdminCampagne(ctx) || ctx.ruoli.includes(CAMPAGNE_RUOLI.backoffice);
}
