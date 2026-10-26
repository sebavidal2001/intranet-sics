import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { normalizzaCodice } from "@/lib/portali/preventivatore/listini";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/portali/preventivatore/costi-split?codici=AFD.00.2.00019.0,FAHBS-40
 *
 * Quote di split (materiale / manodopera / lavorazioni / trattamenti esterni / altro)
 * dello standard di Impresa per i codici richiesti. Alimenta l'anteprima del builder:
 * il builder applica le quote al costo che sta usando (che per Dorner e Alusic è quello
 * di listino), mentre il salvataggio congela lo split nel database con un trigger.
 * Chi non ha uno split di Impresa non compare nella risposta.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;

    const grezzi = (new URL(request.url).searchParams.get("codici") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
      .slice(0, 200);
    const norm = Array.from(new Set(grezzi.map(normalizzaCodice).filter(Boolean)));
    if (norm.length === 0) return NextResponse.json({ split: {} });

    const { data, error } = await createAdminClient()
      .schema("preventivatore")
      .from("articoli_costi_split")
      .select("codice_norm, codice, data_elaborazione, costo_totale, costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro")
      .in("codice_norm", norm);
    if (error) throw error;

    const split: Record<string, unknown> = {};
    for (const r of data ?? []) {
      split[r.codice_norm as string] = {
        codice: r.codice,
        data: r.data_elaborazione,
        costo_totale: Number(r.costo_totale),
        materiale: Number(r.costo_materiale),
        manodopera: Number(r.costo_manodopera),
        lavorazione: Number(r.costo_lavorazione),
        lav_esterna: Number(r.costo_lav_esterna),
        altro: Number(r.costo_altro),
      };
    }
    return NextResponse.json({ split });
  } catch (e) {
    logError("preventivatore.costi-split", "GET error", e);
    return NextResponse.json({ error: "Errore lettura split costi" }, { status: 500 });
  }
}
