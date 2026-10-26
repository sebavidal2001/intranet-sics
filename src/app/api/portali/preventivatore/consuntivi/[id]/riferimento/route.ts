import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireConsuntivazione, UUID_RE } from "@/lib/portali/preventivatore/consuntivi-guard";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST: rinfresca il riferimento di Impresa (colonne rif_*) con l'ultimo standard
 * sincronizzato. Il preventivato non si muove: è lo snapshot.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    const guard = await requireConsuntivazione();
    if (!guard.ok) return guard.response;

    const { data, error } = await createAdminClient()
      .schema("preventivatore")
      .rpc("aggiorna_riferimento_consuntivo", { p_id: id });
    if (error) {
      if (/inesistente/i.test(error.message)) return NextResponse.json({ error: "Consuntivo non trovato" }, { status: 404 });
      throw error;
    }
    return NextResponse.json(data);
  } catch (e) {
    logError("preventivatore.consuntivi", "riferimento error", e);
    return NextResponse.json({ error: "Errore aggiornamento riferimento" }, { status: 500 });
  }
}
