import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPortaleAccesso, hasMinLivello } from "@/lib/auth/portale";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: "ID documento mancante" }, { status: 400 });
    }

    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
    }

    const livello = await getPortaleAccesso(supabase, user.id, "preventivatore");
    if (!hasMinLivello(livello, "admin")) {
      return NextResponse.json({ error: "Accesso negato" }, { status: 403 });
    }

    const body = await request.json() as {
      stato: "ordinato" | "rifiutato" | "pending";
      codici_articolo?: string[];
      motivo_rifiuto_id?: string;
      note?: string;
      importo_ordinato?: number;
    };

    const { stato, codici_articolo, motivo_rifiuto_id, note, importo_ordinato } = body;

    if (!stato || !["ordinato", "rifiutato", "pending"].includes(stato)) {
      return NextResponse.json({ error: "Stato non valido" }, { status: 400 });
    }

    if (stato === "rifiutato" && !motivo_rifiuto_id) {
      return NextResponse.json(
        { error: "Motivo rifiuto obbligatorio" },
        { status: 400 }
      );
    }
    if (codici_articolo !== undefined && !Array.isArray(codici_articolo)) {
      return NextResponse.json({ error: "Codici articolo non validi" }, { status: 400 });
    }
    if (importo_ordinato !== undefined && typeof importo_ordinato !== "number") {
      return NextResponse.json({ error: "Importo ordinato non valido" }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {
      stato,
      stato_aggiornato_da: user.id,
      stato_aggiornato_il: new Date().toISOString(),
    };

    if (codici_articolo !== undefined) {
      updatePayload.codici_articolo = codici_articolo;
    }
    if (motivo_rifiuto_id !== undefined) {
      updatePayload.motivo_rifiuto_id = motivo_rifiuto_id;
    }
    if (note !== undefined) {
      updatePayload.stato_note = note;
    }
    if (stato === "ordinato" && importo_ordinato !== undefined && importo_ordinato > 0) {
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
      return NextResponse.json({ error: "Errore aggiornamento stato" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Stato PATCH error:", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
