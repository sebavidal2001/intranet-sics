import { NextRequest, NextResponse } from "next/server";
import { requireCampagne } from "@/lib/portali/campagne/api-guard";
import { alberoArticoli, cercaArticoli } from "@/lib/portali/campagne/dati";
import { datiNonValidi, rispondiErrore } from "@/lib/portali/campagne/risposte";
import { CercaArticoliQuery, FiltroAlbero } from "@/lib/portali/campagne/schemi";

export const dynamic = "force-dynamic";

/**
 * GET — l'anagrafica articoli, per scegliere gli articoli promossi di una campagna (admin).
 *   ?                         i fornitori
 *   ?f=…                      i gruppi di quel fornitore
 *   ?f=…&g=…                  le categorie
 *   ?f=…&g=…&c=…              gli articoli
 *   &q=…                      restringe agli articoli (codice, descrizione) o fornitori che contengono il testo
 *   ?cerca=…                  ricerca libera di un articolo, col suo percorso
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireCampagne({ chi: "admin" });
    if (!guard.ok) return guard.response;

    const sp = Object.fromEntries(request.nextUrl.searchParams);
    if (sp.cerca !== undefined) {
      const parsed = CercaArticoliQuery.safeParse(sp);
      if (!parsed.success) return datiNonValidi(parsed.error);
      return NextResponse.json(await cercaArticoli(parsed.data.cerca, parsed.data.limit));
    }

    const parsed = FiltroAlbero.safeParse(sp);
    if (!parsed.success) return datiNonValidi(parsed.error);
    return NextResponse.json(await alberoArticoli(parsed.data));
  } catch (e) {
    return rispondiErrore("articoli.albero", e);
  }
}
