import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso } from "@/lib/auth/portale";
import { getPreventivatoreScope } from "@/lib/portali/preventivatore/ruoli";
import { computeBiDashboardData } from "@/lib/portali/preventivatore/bi/query-engine";
import type { BiDashboardConfig } from "@/lib/portali/preventivatore/bi/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (livello === null) return NextResponse.json({ error: "Accesso negato" }, { status: 403 });

    const body = await request.json() as { config?: BiDashboardConfig };
    if (!body.config || body.config.version !== 1 || !Array.isArray(body.config.widgets)) {
      return NextResponse.json({ error: "Config BI non valida" }, { status: 400 });
    }

    // Scope commerciale: i widget BI riflettono solo i clienti visibili.
    const scope = await getPreventivatoreScope(user.id, livello);
    const { results, meta } = await computeBiDashboardData(
      createAdminClient(),
      body.config,
      scope.restricted ? scope.clienteIds : null,
    );
    return NextResponse.json({ results, meta });
  } catch (error) {
    console.error("BI data POST error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
