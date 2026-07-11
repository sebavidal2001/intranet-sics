import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/portali/preventivatore/prodotti?q=<testo>
 *
 * Cerca articoli nell'anagrafica cruscotto (preventivatore.prodotti) via RPC
 * search_prodotti (match per codice, codice_norm, descrizione con trigram).
 *
 * Risposta: array di Prodotto compatibile col builder.
 *   {
 *     id, codice, descrizione, ult_costo, fornitore, unita_misura, giacenza,
 *     categoria, n_magazzini, prezzo_stale
 *   }
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;

    const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
    if (!q) return NextResponse.json([]);

    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .schema("preventivatore")
      .rpc("search_prodotti", { q, limite: 20 });

    if (error) {
      logError("preventivatore.prodotti", "Prodotti search_prodotti error", error);
      return NextResponse.json({ error: "Errore recupero prodotti" }, { status: 500 });
    }

    type RpcRow = {
      codice: string;
      descrizione: string | null;
      uc: string | null;
      categoria: string | null;
      ult_costo: number | null;
      data_ult_costo: string | null;
      esistenza_totale: number | null;
      disponibilita_totale: number | null;
      n_magazzini: number;
      prezzo_stale: boolean;
      score: number;
    };

    // Mapping verso il tipo `Prodotto` usato dal builder
    const mapped = ((data as RpcRow[]) ?? []).map((r) => ({
      id: r.codice, // il codice è la PK
      codice: r.codice,
      descrizione: r.descrizione ?? "",
      ult_costo: r.ult_costo,
      data_ult_costo: r.data_ult_costo,
      fornitore: r.categoria, // riusiamo lo slot "fornitore" del builder per mostrare la categoria
      unita_misura: r.uc ?? "PZ",
      giacenza: r.esistenza_totale,
      // campi extra (UI builder può ignorarli)
      categoria: r.categoria,
      n_magazzini: r.n_magazzini,
      prezzo_stale: r.prezzo_stale,
    }));

    return NextResponse.json(mapped);
  } catch (error) {
    logError("preventivatore.prodotti", "Prodotti route error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
