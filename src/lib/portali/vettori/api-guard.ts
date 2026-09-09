import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasMinLivello } from "@/lib/auth/portale";
import { getVettoriContext, haRuoloFunzionale, type VettoriContext } from "./ruoli";

/**
 * Guard unico per i route handler del Controllo Vettori, sullo stesso modello di
 * `requirePreventivatore`. Un solo round-trip DB per i permessi.
 *
 * Uso:
 *   const guard = await requireVettori();
 *   if (!guard.ok) return guard.response;
 *   const { user, ctx } = guard;
 *
 * Con ruolo funzionale richiesto:
 *   const guard = await requireVettori({ ruoli: ["amministrazione"] });
 */
export type VettoriGuardResult =
  | { ok: true; user: { id: string }; ctx: VettoriContext }
  | { ok: false; response: NextResponse };

export async function requireVettori(opts?: {
  minLivello?: "viewer" | "exporter" | "admin";
  ruoli?: readonly string[];
}): Promise<VettoriGuardResult> {
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

  const ctx = await getVettoriContext(user.id);

  if (ctx.livello === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Accesso negato" }, { status: 403 }),
    };
  }
  if (opts?.minLivello && !hasMinLivello(ctx.livello, opts.minLivello)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Accesso negato" }, { status: 403 }),
    };
  }
  if (opts?.ruoli && !haRuoloFunzionale(ctx, opts.ruoli)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Operazione non consentita dal tuo ruolo" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user: { id: user.id }, ctx };
}
