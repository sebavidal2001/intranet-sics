import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  eAdminCampagne,
  getCampagneContext,
  puoOperare,
  type CampagneContext,
} from "./ruoli";

/**
 * Guard unico per i route handler del Portale Campagne, sul modello di
 * `requireVettori`. Un solo round-trip DB per i permessi.
 *
 *   const guard = await requireCampagne({ chi: "operatore" });
 *   if (!guard.ok) return guard.response;
 *   const { user, ctx } = guard;
 *
 * `chi`:
 *   "operatore"  back office e admin (clienti, invii)
 *   "admin"      solo admin (campagne, pubblico)
 */
export type CampagneGuardResult =
  | { ok: true; user: { id: string }; ctx: CampagneContext }
  | { ok: false; response: NextResponse };

export async function requireCampagne(opts: {
  chi: "operatore" | "admin";
}): Promise<CampagneGuardResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Non autenticato" }, { status: 401 }) };
  }

  const ctx = await getCampagneContext(user.id);
  if (ctx.livello === null) {
    return { ok: false, response: NextResponse.json({ error: "Accesso negato" }, { status: 403 }) };
  }

  const consentito = opts.chi === "admin" ? eAdminCampagne(ctx) : puoOperare(ctx);
  if (!consentito) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Operazione non consentita dal tuo ruolo" }, { status: 403 }),
    };
  }

  return { ok: true, user: { id: user.id }, ctx };
}
