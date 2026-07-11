import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasMinLivello } from "@/lib/auth/portale";
import {
  getPreventivatoreContext,
  filtroCommercialeFromContext,
  type PreventivatoreContext,
} from "./ruoli";

/**
 * Guard unico per i route handler del Preventivatore. Sostituisce il blocco
 * ripetuto `getUser()` + `getPortaleAccesso()` (+ eventuale scope commerciale)
 * duplicato in ~30 route. Un solo round-trip DB per i permessi (RPC
 * `get_preventivatore_context`, migration 064).
 *
 * Uso:
 *   const guard = await requirePreventivatore();
 *   if (!guard.ok) return guard.response;
 *   const { user, ctx } = guard;
 *
 * Con livello minimo:
 *   const guard = await requirePreventivatore("admin");
 */
export type PreventivatoreGuardResult =
  | { ok: true; user: { id: string }; ctx: PreventivatoreContext }
  | { ok: false; response: NextResponse };

export async function requirePreventivatore(
  minLivello?: "viewer" | "exporter" | "admin"
): Promise<PreventivatoreGuardResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Non autenticato" }, { status: 401 }),
    };
  }

  const ctx = await getPreventivatoreContext(user.id);

  if (ctx.livello === null || (minLivello && !hasMinLivello(ctx.livello, minLivello))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Accesso negato" }, { status: 403 }),
    };
  }

  return { ok: true, user: { id: user.id }, ctx };
}

/**
 * Codice agente del commerciale ristretto, derivato dal contesto del guard
 * (nessuna query aggiuntiva). `null` = l'utente vede tutto.
 */
export function scopeAgente(ctx: PreventivatoreContext): string | null {
  return filtroCommercialeFromContext(ctx);
}
