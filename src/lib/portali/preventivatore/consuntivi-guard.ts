import { NextResponse } from "next/server";
import { requirePreventivatore, scopeAgente, type PreventivatoreGuardResult } from "./api-guard";
import { haRuoloFunzionale, PREVENTIVATORE_RUOLI } from "./ruoli";

/**
 * Guard della Consuntivazione. I costi interni (materiale, manodopera, standard di
 * Impresa) non vanno ai commerciali ristretti al proprio portfolio: serve il ruolo
 * funzionale «preventivatore» (admin e superadmin lo bypassano).
 */
export async function requireConsuntivazione(): Promise<PreventivatoreGuardResult> {
  const guard = await requirePreventivatore();
  if (!guard.ok) return guard;
  if (scopeAgente(guard.ctx) !== null || !haRuoloFunzionale(guard.ctx, [PREVENTIVATORE_RUOLI.preventivatore])) {
    return {
      ok: false,
      response: NextResponse.json({ error: "La consuntivazione è riservata all'ufficio tecnico" }, { status: 403 }),
    };
  }
  return guard;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
