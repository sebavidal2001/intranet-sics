import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { elencoAnomalie } from "@/lib/portali/campagne/impresa";
import { datiNonValidi, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { FiltroAnomalieQuery } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/**
 * GET ?stato=&tipo=&codice_cliente= — le anomalie (di default le aperte), visibili
 * anche al back office: sono loro che le correggono.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireCampagne({ chi: "operatore" });
    if (!guard.ok) return guard.response;

    const parsed = FiltroAnomalieQuery.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return datiNonValidi(parsed.error);
    return NextResponse.json({ anomalie: await elencoAnomalie(parsed.data) });
  } catch (e) {
    return rispondiErrore("anomalie.elenco", e);
  }
}
