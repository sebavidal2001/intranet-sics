import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { creaPubblico, elencoPubblici } from "@/lib/portali/campagne/dati";
import { datiNonValidi, leggiJson, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { CreaPubblicoBody } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/** GET — i pubblici (lo standard per primo), con a quanti clienti arrivano e quante campagne li usano (admin). */
export async function GET() {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;
    return NextResponse.json({ pubblici: await elencoPubblici() });
  } catch (e) {
    return rispondiErrore("pubblici.elenco", e);
  }
}

/** POST — crea un pubblico, vuoto o copiando la regola di un altro (admin). */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;

    const parsed = CreaPubblicoBody.safeParse(await leggiJson(request));
    if (!parsed.success) return datiNonValidi(parsed.error);

    return NextResponse.json({ pubblico: await creaPubblico(parsed.data, guard.user.id) }, { status: 201 });
  } catch (e) {
    return rispondiErrore("pubblici.crea", e);
  }
}
