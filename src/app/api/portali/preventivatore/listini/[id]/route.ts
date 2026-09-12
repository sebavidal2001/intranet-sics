import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET    /api/portali/preventivatore/listini/[id]
 *        Dettaglio: quante voci corrispondono all'anagrafica, di quanto si
 *        discostano dall'UC, e un campione di confronto per il controllo visivo.
 *
 * PATCH  /api/portali/preventivatore/listini/[id]  { attivo: boolean }
 *        Accende/spegne il listino senza cancellarlo (spento = si torna all'UC).
 *
 * DELETE /api/portali/preventivatore/listini/[id]
 *        Elimina listino e voci (cascade).
 */

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requirePreventivatore("admin");
    if (!guard.ok) return guard.response;
    const { id } = await params;

    const admin = createAdminClient();
    const { data: listino, error: errL } = await admin
      .schema("preventivatore")
      .from("listini_fornitore")
      .select("id, fornitore, nome_file, colonne, righe_lette, righe_valide, attivo, note, caricato_il")
      .eq("id", id)
      .maybeSingle();

    if (errL) {
      logError("preventivatore.listini", "Dettaglio listino error", errL);
      return NextResponse.json({ error: "Errore recupero listino" }, { status: 500 });
    }
    if (!listino) return NextResponse.json({ error: "Listino non trovato" }, { status: 404 });

    const { data: confronto, error: errC } = await admin
      .schema("preventivatore")
      .rpc("listino_confronto_anagrafica", { p_listino_id: id, p_campione: 15 });
    if (errC) {
      logError("preventivatore.listini", "Confronto listino error", errC);
      return NextResponse.json({ listino, confronto: null });
    }

    return NextResponse.json({ listino, confronto });
  } catch (error) {
    logError("preventivatore.listini", "Listino GET error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requirePreventivatore("admin");
    if (!guard.ok) return guard.response;
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const attivo = (body as { attivo?: unknown }).attivo;
    if (typeof attivo !== "boolean") {
      return NextResponse.json({ error: "Campo 'attivo' mancante" }, { status: 400 });
    }

    const admin = createAdminClient();

    // Accendere un listino spegne l'altro dello stesso fornitore: l'indice
    // unico parziale ammette un solo attivo per fornitore.
    if (attivo) {
      const { data: corrente } = await admin
        .schema("preventivatore")
        .from("listini_fornitore")
        .select("fornitore")
        .eq("id", id)
        .maybeSingle();
      if (corrente?.fornitore) {
        await admin
          .schema("preventivatore")
          .from("listini_fornitore")
          .update({ attivo: false })
          .eq("attivo", true)
          .ilike("fornitore", corrente.fornitore);
      }
    }

    const { error } = await admin
      .schema("preventivatore")
      .from("listini_fornitore")
      .update({ attivo })
      .eq("id", id);

    if (error) {
      logError("preventivatore.listini", "Patch listino error", error);
      return NextResponse.json({ error: "Errore aggiornamento listino" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, attivo });
  } catch (error) {
    logError("preventivatore.listini", "Listino PATCH error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requirePreventivatore("admin");
    if (!guard.ok) return guard.response;
    const { id } = await params;

    const admin = createAdminClient();
    const { error } = await admin
      .schema("preventivatore")
      .from("listini_fornitore")
      .delete()
      .eq("id", id);

    if (error) {
      logError("preventivatore.listini", "Delete listino error", error);
      return NextResponse.json({ error: "Errore eliminazione listino" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("preventivatore.listini", "Listino DELETE error", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
