import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { conteggioPromossi } from "@/lib/portali/campagne/dati";
import { datiNonValidi, leggiJson, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { ConteggioPromossiBody } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/** POST — quanti articoli prende una selezione dell'albero e quanti di questi sono nel fatturato (admin). */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;

    const parsed = ConteggioPromossiBody.safeParse(await leggiJson(request));
    if (!parsed.success) return datiNonValidi(parsed.error);

    return NextResponse.json(await conteggioPromossi(parsed.data.selettori));
  } catch (e) {
    return rispondiErrore("articoli.conteggio", e);
  }
}
