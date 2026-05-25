import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/portali/preventivatore/documenti/[id]/stato
 *
 * Cambio di stato del preventivo. Accetta sia gli stati legacy (compat
 * con vecchio import V2: pending/ordinato/rifiutato) sia i nuovi stati
 * workflow (migration 039: aperta/presa_in_carico/completato/inviata/
 * ordinata/fallita/storico).
 *
 * Body: {
 *   stato: <stato>,
 *   codici_articolo?: string[],
 *   motivo_rifiuto_id?: string,        // obbligatorio per fallita/rifiutato
 *   note?: string,                      // salvata su stato_note
 *   importo_ordinato?: number,          // per ordinato (legacy)
 *   numero_preventivo?: string,         // per inviata (PC N°)
 *   importo_offerta?: number,           // per inviata (importo confermato)
 *   note_offerta?: string,              // motivo scostamento vs importo_preventivo
 * }
 *
 * Auth: serve livello >= 'admin' sul portale preventivatore. (In futuro
 * affineremo con ruoli funzionali commerciale/preventivatore/back_office.)
 */

const STATI_VALIDI = new Set([
  // legacy compat
  "pending", "ordinato", "rifiutato",
  // workflow nuovo (migration 039)
  "storico", "aperta", "presa_in_carico", "completato", "inviata", "ordinata", "fallita",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "ID documento mancante" }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const body = await request.json() as {
      stato: string;
      codici_articolo?: string[];
      motivo_rifiuto_id?: string;
      note?: string;
      importo_ordinato?: number;
      numero_preventivo?: string;
      importo_offerta?: number;
      note_offerta?: string;
    };

    const { stato, codici_articolo, motivo_rifiuto_id, note, importo_ordinato,
            numero_preventivo, importo_offerta, note_offerta } = body;

    if (!stato || !STATI_VALIDI.has(stato)) {
      return NextResponse.json({ error: "Stato non valido" }, { status: 400 });
    }

    // Validazioni per stati specifici
    if ((stato === "rifiutato" || stato === "fallita") && !motivo_rifiuto_id) {
      return NextResponse.json({ error: "Motivo rifiuto obbligatorio" }, { status: 400 });
    }
    if (stato === "inviata" && !numero_preventivo?.trim()) {
      return NextResponse.json(
        { error: "Numero preventivo obbligatorio per stato 'inviata'" },
        { status: 400 }
      );
    }
    if (codici_articolo !== undefined && !Array.isArray(codici_articolo)) {
      return NextResponse.json({ error: "Codici articolo non validi" }, { status: 400 });
    }
    if (importo_ordinato !== undefined && typeof importo_ordinato !== "number") {
      return NextResponse.json({ error: "Importo ordinato non valido" }, { status: 400 });
    }
    if (importo_offerta !== undefined && typeof importo_offerta !== "number") {
      return NextResponse.json({ error: "Importo offerta non valido" }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {
      stato,
      stato_aggiornato_da: user.id,
      stato_aggiornato_il: new Date().toISOString(),
    };

    if (codici_articolo !== undefined) updatePayload.codici_articolo = codici_articolo;
    if (motivo_rifiuto_id !== undefined) updatePayload.motivo_rifiuto_id = motivo_rifiuto_id;
    if (note !== undefined) updatePayload.stato_note = note;

    // Legacy: importo_ordinato si applica a 'ordinato'
    if (stato === "ordinato" && importo_ordinato !== undefined && importo_ordinato > 0) {
      updatePayload.importo_ordinato = importo_ordinato;
    }

    // Workflow: inviata → setta numero_preventivo + importo_offerta + note_offerta
    if (stato === "inviata") {
      updatePayload.numero_preventivo = numero_preventivo?.trim();
      if (typeof importo_offerta === "number" && importo_offerta > 0) {
        updatePayload.importo_offerta = importo_offerta;
      }
      if (note_offerta !== undefined) updatePayload.note_offerta = note_offerta;
    }

    // Workflow: ordinata → si può fissare un importo_ordinato come per legacy
    if (stato === "ordinata" && importo_ordinato !== undefined && importo_ordinato > 0) {
      updatePayload.importo_ordinato = importo_ordinato;
    }

    const adminClient = createAdminClient();
    const { error } = await adminClient
      .schema("preventivatore")
      .from("documenti")
      .update(updatePayload)
      .eq("id", id);

    if (error) {
      console.error("Stato update error:", error);
      return NextResponse.json({ error: "Errore aggiornamento stato: " + error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Stato PATCH error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
