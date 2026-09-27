import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePreventivatore } from "@/lib/portali/preventivatore/api-guard";
import { requireDocumentoVisibile } from "@/lib/portali/preventivatore/documento-visibile";
import { haRuoloFunzionale, PREVENTIVATORE_RUOLI } from "@/lib/portali/preventivatore/ruoli";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const StatoBodySchema = z.object({
  stato: z.enum(["aperta", "completato"]),
  codici_articolo: z.array(z.string().trim().max(64)).max(500).optional(),
  note: z.string().trim().max(4000).optional(),
});

const TRANSIZIONI_VALIDE: Record<string, readonly string[]> = {
  aperta: ["completato"],
  completato: ["aperta"],
};

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ error: "ID documento non valido" }, { status: 400 });
    }

    const guard = await requirePreventivatore();
    if (!guard.ok) return guard.response;

    const rawBody = await request.json().catch(() => null);
    const parsed = StatoBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Payload invalido", dettagli: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 },
      );
    }

    const visibilita = await requireDocumentoVisibile(
      { userId: guard.user.id, livello: guard.ctx.livello },
      id,
    );
    if (!visibilita.ok) {
      return NextResponse.json({ error: visibilita.error }, { status: visibilita.status });
    }

    const admin = createAdminClient();
    const { data: documento, error: documentoError } = await admin
      .schema("preventivatore")
      .from("documenti")
      .select("stato")
      .eq("id", id)
      .maybeSingle();
    if (documentoError) throw documentoError;
    if (!documento) return NextResponse.json({ error: "Documento non trovato" }, { status: 404 });

    const statoCorrente = String(documento.stato);
    const { stato, codici_articolo, note } = parsed.data;
    const sbloccoStorico = statoCorrente === "storico";

    if (sbloccoStorico) {
      if (guard.ctx.livello !== "superadmin") {
        return NextResponse.json({ error: "Solo un superadmin può riaprire uno storico." }, { status: 403 });
      }
      if (stato !== "aperta") {
        return NextResponse.json({ error: "Uno storico può essere riaperto solo come bozza aperta." }, { status: 400 });
      }
    } else {
      const ammesse = TRANSIZIONI_VALIDE[statoCorrente] ?? [];
      if (stato === statoCorrente) {
        return NextResponse.json({ error: "Il preventivo è già nello stato richiesto." }, { status: 409 });
      }
      if (!ammesse.includes(stato)) {
        return NextResponse.json({ error: `Transizione non valida da '${statoCorrente}' a '${stato}'.` }, { status: 400 });
      }
      if (!haRuoloFunzionale(guard.ctx, [PREVENTIVATORE_RUOLI.preventivatore])) {
        return NextResponse.json({ error: "Per cambiare stato serve il ruolo 'preventivatore'." }, { status: 403 });
      }
    }

    const payload: Record<string, unknown> = {
      stato,
      stato_aggiornato_da: guard.user.id,
      stato_aggiornato_il: new Date().toISOString(),
    };
    if (codici_articolo !== undefined) payload.codici_articolo = codici_articolo;
    if (note !== undefined) payload.stato_note = note;

    const { data: aggiornato, error } = await admin
      .schema("preventivatore")
      .from("documenti")
      .update(payload)
      .eq("id", id)
      .eq("stato", statoCorrente)
      .select("id")
      .maybeSingle();

    if (error) {
      logError("preventivatore.documenti.stato", "update stato fallita", error, { id });
      return NextResponse.json({ error: "Errore aggiornamento stato" }, { status: 500 });
    }
    if (!aggiornato) {
      return NextResponse.json(
        { error: "Il preventivo è stato modificato da qualcun altro, ricarica." },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logError("preventivatore.documenti.stato", "PATCH stato fallita", error);
    return NextResponse.json({ error: "Errore del server" }, { status: 500 });
  }
}
