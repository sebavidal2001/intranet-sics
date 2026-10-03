import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { creaInvio, elencoInvii } from "@/lib/portali/campagne/dati";
import { datiNonValidi, leggiJson, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { AssegnaInvioBody, FiltroInvii } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/** GET ?stato=&campagna_id=(anche più volte)&q=&limit=&offset= — elenco invii (gli annullati solo se richiesti). */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireCampagne({ chi: "operatore" });
    if (!guard.ok) return guard.response;

    // `campagna_id` puo' ripetersi (?campagna_id=a&campagna_id=b): Object.fromEntries terrebbe solo l'ultima.
    const sp = request.nextUrl.searchParams;
    const parsed = FiltroInvii.safeParse({ ...Object.fromEntries(sp), campagna_id: sp.getAll("campagna_id") });
    if (!parsed.success) return datiNonValidi(parsed.error);

    return NextResponse.json(await elencoInvii(parsed.data));
  } catch (e) {
    return rispondiErrore("invii.elenco", e);
  }
}

/**
 * POST — assegna una campagna a un cliente.
 *   { tipo: "ordine", codice_cliente, campagna_id, referente, ordine_numero, ordine_anno }
 *       → busta PREPARATA (referente e ordine obbligatori)
 *   { tipo: "banco",  codice_cliente, campagna_id, referente?, data_consegna? }
 *       → CONSEGNATA AL BANCO direttamente, senza ordine
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireCampagne({ chi: "operatore" });
    if (!guard.ok) return guard.response;

    const parsed = AssegnaInvioBody.safeParse(await leggiJson(request));
    if (!parsed.success) return datiNonValidi(parsed.error);

    const invio = await creaInvio(parsed.data, guard.user.id);
    return NextResponse.json({ invio }, { status: 201 });
  } catch (e) {
    return rispondiErrore("invii.crea", e);
  }
}
