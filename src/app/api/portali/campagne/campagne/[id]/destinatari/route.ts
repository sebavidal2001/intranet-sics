import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { categorieClienti, clientiCategoria, modificaDestinatari } from "@/lib/portali/campagne/dati";
import { datiNonValidi, IdUuid, leggiJson, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { DestinatariBody } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/**
 * GET — la selezione dei destinatari, ad accordion.
 *   senza parametri      → { categorie: [{ categoria, totale, selezionati }] }
 *   ?categoria=<nome>    → { clienti: [{ codice_cliente, ..., selezionato, ha_invio }] }
 * I rivenditori non compaiono mai.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;

    const id = IdUuid.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Campagna non trovata." }, { status: 404 });

    const categoria = request.nextUrl.searchParams.get("categoria");
    if (categoria) return NextResponse.json({ clienti: await clientiCategoria(id.data, categoria) });
    return NextResponse.json({ categorie: await categorieClienti(id.data) });
  } catch (e) {
    return rispondiErrore("campagne.destinatari.lettura", e);
  }
}

/**
 * POST — modifica i destinatari. Risponde con l'esito e la campagna aggiornata.
 *   { azione: "applica_standard" }                     copia il pubblico standard salvato
 *   { azione: "aggiungi" | "rimuovi", codici: [...] }
 *   { azione: "aggiungi_categorie" | "rimuovi_categorie", categorie: [...] }
 * Chi ha già un invio non si toglie.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;

    const id = IdUuid.safeParse((await params).id);
    if (!id.success) return NextResponse.json({ error: "Campagna non trovata." }, { status: 404 });

    const parsed = DestinatariBody.safeParse(await leggiJson(request));
    if (!parsed.success) return datiNonValidi(parsed.error);

    return NextResponse.json(await modificaDestinatari(id.data, parsed.data, guard.user.id));
  } catch (e) {
    return rispondiErrore("campagne.destinatari.modifica", e);
  }
}
