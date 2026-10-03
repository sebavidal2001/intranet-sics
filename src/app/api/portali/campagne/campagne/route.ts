import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { creaCampagna, elencoCampagne } from "@/lib/portali/campagne/dati";
import { datiNonValidi, leggiJson, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { CreaCampagnaBody } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/** GET — tutte le campagne con destinatari e invii per stato (admin). */
export async function GET() {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;
    return NextResponse.json({ campagne: await elencoCampagne() });
  } catch (e) {
    return rispondiErrore("campagne.elenco", e);
  }
}

/** POST — crea una campagna (admin). Con `applica_pubblico_standard` copia il pubblico salvato. */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;

    const parsed = CreaCampagnaBody.safeParse(await leggiJson(request));
    if (!parsed.success) return datiNonValidi(parsed.error);

    return NextResponse.json({ campagna: await creaCampagna(parsed.data, guard.user.id) }, { status: 201 });
  } catch (e) {
    return rispondiErrore("campagne.crea", e);
  }
}
