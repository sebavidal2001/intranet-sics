import { NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { schedaClienteCompleta } from "@/lib/portali/campagne/impresa";
import { rispondiErrore } from "@/lib/portali/campagne/risposte";

export const dynamic = "force-dynamic";

/** GET — scheda cliente: dati, storico, campagne assegnabili (la prima è la suggerita), ordini aperti e anomalie. */
export async function GET(_: Request, { params }: { params: Promise<{ codice: string }> }) {
  try {
    const guard = await requireCampagne({ chi: "operatore" });
    if (!guard.ok) return guard.response;

    const { codice } = await params;
    return NextResponse.json(await schedaClienteCompleta(decodeURIComponent(codice)));
  } catch (e) {
    return rispondiErrore("clienti.scheda", e);
  }
}
