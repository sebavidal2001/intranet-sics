import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { aggiornaCampagna } from "@/lib/portali/campagne/dati";
import { datiNonValidi, IdUuid, leggiJson, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { AggiornaCampagnaBody } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/**
 * PATCH — modifica una campagna (admin): titolo, note, articolo, parole di
 * riconoscimento, marchio e STATO. Una campagna terminata non cambia più stato.
 * L'articolo non si cambia se la campagna ha già degli invii.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;

    const id = IdUuid.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Campagna non trovata." }, { status: 404 });

    const parsed = AggiornaCampagnaBody.safeParse(await leggiJson(request));
    if (!parsed.success) return datiNonValidi(parsed.error);

    return NextResponse.json({ campagna: await aggiornaCampagna(id.data, parsed.data, guard.user.id) });
  } catch (e) {
    return rispondiErrore("campagne.aggiorna", e);
  }
}
