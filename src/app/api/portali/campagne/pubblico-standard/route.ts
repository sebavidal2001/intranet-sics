import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { leggiPubblicoStandard, salvaPubblicoStandard } from "@/lib/portali/campagne/dati";
import { datiNonValidi, leggiJson, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { PubblicoStandardBody } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/** GET — la regola salvata, quanti clienti raggiunge oggi e i candidati extra (admin). */
export async function GET() {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;
    return NextResponse.json(await leggiPubblicoStandard());
  } catch (e) {
    return rispondiErrore("pubblico-standard.lettura", e);
  }
}

/**
 * PUT — salva la regola (admin). Vale per le campagne create DOPO: quelle già
 * esistenti hanno una fotografia dei loro destinatari e non cambiano.
 */
export async function PUT(request: NextRequest) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;

    const parsed = PubblicoStandardBody.safeParse(await leggiJson(request));
    if (!parsed.success) return datiNonValidi(parsed.error);

    return NextResponse.json(await salvaPubblicoStandard(parsed.data, guard.user.id));
  } catch (e) {
    return rispondiErrore("pubblico-standard.salvataggio", e);
  }
}
