import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { cercaClienti } from "@/lib/portali/campagne/dati";
import { rispondiErrore } from "@/lib/portali/campagne/risposte";

export const dynamic = "force-dynamic";

/** GET ?q=<nome o codice> — ricerca clienti (almeno 2 caratteri), al massimo 30 risultati. */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireCampagne({ chi: "operatore" });
    if (!guard.ok) return guard.response;

    const q = request.nextUrl.searchParams.get("q") ?? "";
    return NextResponse.json({ clienti: await cercaClienti(q) });
  } catch (e) {
    return rispondiErrore("clienti", e);
  }
}
