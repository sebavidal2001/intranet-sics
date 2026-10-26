import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireConsuntivazione, UUID_RE } from "@/lib/portali/preventivatore/consuntivi-guard";
import { requireDocumentoVisibile } from "@/lib/portali/preventivatore/documento-visibile";
import { escapeIlike } from "@/lib/portali/preventivatore/postgrest";
import { logError, logInfo } from "@/lib/logger";

export const dynamic = "force-dynamic";

const COLONNE_LISTA =
  "id, codice_articolo, descrizione, documento_id, documento_codice, ambito, quantita_articolo, stato, " +
  "prev_materiale, prev_manodopera, prev_lavorazione, prev_lav_esterna, prev_altro, prev_totale, " +
  "rif_tipo, rif_data, rif_materiale, rif_manodopera, rif_lavorazione, rif_lav_esterna, rif_altro, rif_totale, created_at";

/** GET /api/portali/preventivatore/consuntivi?q=&stato=aperto|chiuso */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireConsuntivazione();
    if (!guard.ok) return guard.response;

    const sp = new URL(request.url).searchParams;
    const q = (sp.get("q") ?? "").trim().slice(0, 80);
    const stato = sp.get("stato");

    let qb = createAdminClient()
      .schema("preventivatore")
      .from("consuntivi")
      .select(COLONNE_LISTA)
      .order("created_at", { ascending: false })
      .limit(300);
    if (stato === "aperto" || stato === "chiuso") qb = qb.eq("stato", stato);
    if (q) {
      const e = escapeIlike(q);
      qb = qb.or(`codice_articolo.ilike.%${e}%,descrizione.ilike.%${e}%,documento_codice.ilike.%${e}%`);
    }
    const { data, error } = await qb;
    if (error) throw error;
    return NextResponse.json({ consuntivi: data ?? [] });
  } catch (e) {
    logError("preventivatore.consuntivi", "GET error", e);
    return NextResponse.json({ error: "Errore lettura consuntivi" }, { status: 500 });
  }
}

const PostSchema = z
  .object({
    codice_articolo: z.string().trim().min(1, "Codice articolo obbligatorio").max(60),
    descrizione: z.string().trim().max(300).optional(),
    documento_id: z.string().regex(UUID_RE, "Preventivo non valido"),
    ambito: z.enum(["preventivo", "blocchi", "righe"]),
    blocchi: z.array(z.string().max(200)).max(200).optional(),
    righe: z.array(z.string().regex(UUID_RE)).max(2000).optional(),
    quantita_articolo: z.number().positive().max(1_000_000).optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.ambito !== "blocchi" || (v.blocchi?.length ?? 0) > 0, { message: "Seleziona almeno un blocco" })
  .refine((v) => v.ambito !== "righe" || (v.righe?.length ?? 0) > 0, { message: "Seleziona almeno una riga" });

/** POST: crea il consuntivo e ne congela il preventivato (RPC crea_consuntivo, migration 157). */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireConsuntivazione();
    if (!guard.ok) return guard.response;

    const parsed = PostSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    }
    const body = parsed.data;

    const visibilita = await requireDocumentoVisibile(
      { userId: guard.user.id, livello: guard.ctx.livello },
      body.documento_id,
    );
    if (!visibilita.ok) return NextResponse.json({ error: visibilita.error }, { status: visibilita.status });

    const { data, error } = await createAdminClient()
      .schema("preventivatore")
      .rpc("crea_consuntivo", {
        p_payload: {
          codice_articolo: body.codice_articolo,
          descrizione: body.descrizione ?? null,
          documento_id: body.documento_id,
          ambito: body.ambito,
          blocchi: body.blocchi ?? [],
          righe: body.righe ?? [],
          quantita_articolo: body.quantita_articolo ?? null,
          note: body.note ?? null,
          _user_id: guard.user.id,
        },
      });
    if (error) {
      // Gli errori «attesi» della RPC (selezione vuota, preventivo inesistente) sono messaggi per l'utente.
      const atteso = /selezione|selezionat|obbligator|inesistente|non valido/i.test(error.message);
      if (!atteso) logError("preventivatore.consuntivi", "crea_consuntivo error", error);
      return NextResponse.json({ error: atteso ? error.message : "Errore creazione consuntivo" }, { status: atteso ? 422 : 500 });
    }
    logInfo("preventivatore.consuntivi", "Consuntivo creato", {
      utente: guard.user.id,
      codice: body.codice_articolo,
      documento: body.documento_id,
      ambito: body.ambito,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    logError("preventivatore.consuntivi", "POST error", e);
    return NextResponse.json({ error: "Errore creazione consuntivo" }, { status: 500 });
  }
}
