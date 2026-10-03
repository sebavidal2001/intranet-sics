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

/** POST — crea una campagna (admin). Il pubblico è `pubblico_id` (assente = lo standard); con `applica_pubblico` (di default sì) ne copia i clienti fra i destinatari. */
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
