import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { getPreventivatoreScope } from "@/lib/portali/preventivatore/ruoli";
import { computeBiDashboardData } from "@/lib/portali/preventivatore/bi/query-engine";
import { BiDashboardConfigSchema } from "@/lib/portali/preventivatore/bi/types";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;

    const raw = await request.json().catch(() => null) as { config?: unknown } | null;
    const parsed = BiDashboardConfigSchema.safeParse(raw?.config);
    if (!parsed.success) {
      return NextResponse.json({ error: "Config BI non valida" }, { status: 400 });
    }

    // Scope commerciale: i widget BI riflettono solo i clienti visibili.
    const scope = await getPreventivatoreScope(guard.user.id, guard.ctx.livello);
    const { results, meta } = await computeBiDashboardData(
      createAdminClient(),
      parsed.data,
      scope.restricted ? scope.clienteIds : null,
    );
    return NextResponse.json({ results, meta });
  } catch (error) {
    logError("preventivatore.bi.data", "BI data POST fallita", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
