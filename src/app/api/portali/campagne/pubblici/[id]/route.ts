import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { eliminaPubblico, leggiPubblico, salvaPubblico } from "@/lib/portali/campagne/dati";
import { datiNonValidi, IdUuid, leggiJson, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { PubblicoBody } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

const NON_TROVATO = () => NextResponse.json({ error: "Pubblico non trovato." }, { status: 404 });

/** GET — la regola salvata, quanti clienti raggiunge oggi, le campagne che lo usano e i candidati (admin). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;
    const id = IdUuid.safeParse((await params).id);
    if (!id.success) return NON_TROVATO();
    return NextResponse.json(await leggiPubblico(id.data));
  } catch (e) {
    return rispondiErrore("pubblici.lettura", e);
  }
}

/**
 * PUT — salva nome, descrizione e regola (admin). I destinatari delle campagne già
 * create non cambiano: restano la fotografia di quando sono stati aggiunti.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;
    const id = IdUuid.safeParse((await params).id);
    if (!id.success) return NON_TROVATO();

    const parsed = PubblicoBody.safeParse(await leggiJson(request));
    if (!parsed.success) return datiNonValidi(parsed.error);

    return NextResponse.json(await salvaPubblico(id.data, parsed.data, guard.user.id));
  } catch (e) {
    return rispondiErrore("pubblici.salvataggio", e);
  }
}

/** DELETE — elimina un pubblico (admin). Non lo standard e non uno usato da una campagna. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;
    const id = IdUuid.safeParse((await params).id);
    if (!id.success) return NON_TROVATO();
    await eliminaPubblico(id.data);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return rispondiErrore("pubblici.eliminazione", e);
  }
}
