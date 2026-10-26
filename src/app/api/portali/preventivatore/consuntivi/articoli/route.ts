import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireConsuntivazione } from "@/lib/portali/preventivatore/consuntivi-guard";
import { escapeIlike } from "@/lib/portali/preventivatore/postgrest";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/portali/preventivatore/consuntivi/articoli?q=AFD.00.2
 * Cerca nei codici di Impresa che hanno uno standard (articoli_costi_split): sono quelli
 * a cui si può attribuire un consuntivo e confrontare il preventivato.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireConsuntivazione();
    if (!guard.ok) return guard.response;

    const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 60);
    if (q.length < 2) return NextResponse.json({ articoli: [] });
    const e = escapeIlike(q);

    const { data, error } = await createAdminClient()
      .schema("preventivatore")
      .from("articoli_costi_split")
      .select("codice, descrizione, data_elaborazione, costo_totale, costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro")
      .or(`codice.ilike.${e}%,descrizione.ilike.%${e}%`)
      .order("codice", { ascending: true })
      .limit(20);
    if (error) throw error;
    return NextResponse.json({ articoli: data ?? [] });
  } catch (e) {
    logError("preventivatore.consuntivi", "articoli error", e);
    return NextResponse.json({ error: "Errore ricerca articoli" }, { status: 500 });
  }
}
