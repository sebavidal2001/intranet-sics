import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { applicaScambio } from "@/lib/portali/campagne/controllo-dati";
import { ignoraAnomalia } from "@/lib/portali/campagne/impresa";
import { datiNonValidi, IdUuid, leggiJson, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { AggiornaAnomaliaBody } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/**
 * PATCH — un'azione su un'anomalia.
 *   { azione: "ignora", nota }      la lascia com'e', con il motivo; non si riapre ogni notte
 *   { azione: "applica_scambio" }   solo per `ordine_invertito`: scambia gli ordini fra gli
 *                                   invii. La busta fisica va scambiata a mano.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCampagne({ chi: "operatore" });
    if (!guard.ok) return guard.response;

    const id = IdUuid.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Anomalia non trovata." }, { status: 404 });

    const parsed = AggiornaAnomaliaBody.safeParse(await leggiJson(request));
    if (!parsed.success) return datiNonValidi(parsed.error);

    const anomalia =
      parsed.data.azione === "ignora"
        ? await ignoraAnomalia(id.data, parsed.data.nota, guard.user.id)
        : await applicaScambio(id.data, guard.user.id);
    return NextResponse.json({ anomalia });
  } catch (e) {
    return rispondiErrore("anomalie.aggiorna", e);
  }
}
