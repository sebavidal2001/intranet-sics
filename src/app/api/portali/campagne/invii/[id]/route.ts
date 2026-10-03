import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { aggiornaInvio } from "@/lib/portali/campagne/dati";
import { datiNonValidi, IdUuid, leggiJson, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { AggiornaInvioBody } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/**
 * PATCH — un'azione su un invio. Quali sono ammesse dipende dallo stato
 * (`azioniConsentite`): il server rifiuta il resto con 409.
 *   { azione: "modifica", referente?, ordine_numero?, ordine_anno?, note? }
 *   { azione: "consegna", data_consegna }    consegna registrata a mano
 *   { azione: "banco", data_consegna? }      il cliente ha ritirato
 *   { azione: "annulla", motivo }
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCampagne({ chi: "operatore" });
    if (!guard.ok) return guard.response;

    const id = IdUuid.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Invio non trovato." }, { status: 404 });

    const parsed = AggiornaInvioBody.safeParse(await leggiJson(request));
    if (!parsed.success) return datiNonValidi(parsed.error);

    return NextResponse.json({ invio: await aggiornaInvio(id.data, parsed.data, guard.user.id) });
  } catch (e) {
    return rispondiErrore("invii.aggiorna", e);
  }
}
