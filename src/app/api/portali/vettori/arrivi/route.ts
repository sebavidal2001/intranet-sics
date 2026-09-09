import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import { rilevazioniRecenti } from "@/lib/portali/vettori/letture";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const CONDIZIONI = [
  "bancale",
  "non_sovrapponibile",
  "oversized",
  "ztl",
  "movimentazione_manuale",
] as const;

const Body = z.object({
  fornitore: z.string().trim().min(1, "Indicare il fornitore").max(200),
  numeroBolla: z.string().trim().max(60).nullable().optional(),
  dataArrivo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  colli: z.number().int().min(1).max(999),
  pesoKg: z.number().min(0).max(100_000).nullable().optional(),
  lunghezzaCm: z.number().min(0).max(2000).nullable().optional(),
  larghezzaCm: z.number().min(0).max(2000).nullable().optional(),
  altezzaCm: z.number().min(0).max(2000).nullable().optional(),
  condizioni: z.array(z.enum(CONDIZIONI)).default([]),
  note: z.string().trim().max(500).nullable().optional(),
});

/**
 * GET — le rilevazioni recenti, per rivedere quello appena registrato.
 */
export async function GET() {
  try {
    const guard = await requireVettori({
      ruoli: [VETTORI_RUOLI.magazzino, VETTORI_RUOLI.amministrazione],
    });
    if (!guard.ok) return guard.response;
    return NextResponse.json({ rilevazioni: await rilevazioniRecenti() });
  } catch (e) {
    logError("vettori.arrivi", "lettura rilevazioni fallita", e);
    return NextResponse.json({ error: "Errore nella lettura degli arrivi" }, { status: 500 });
  }
}

/**
 * POST — registra la misura di un arrivo.
 *
 * Non richiede che la bolla sia già arrivata dal gestionale: si registra e si
 * aggancia dopo. Fermare il magazzino in attesa dell'estrazione notturna
 * vorrebbe dire, in pratica, non avere il dato — ed è l'unica fonte dei dati
 * fisici degli arrivi, perché il gestionale i colli li ha 8 volte su 1.937.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireVettori({
      ruoli: [VETTORI_RUOLI.magazzino, VETTORI_RUOLI.amministrazione],
    });
    if (!guard.ok) return guard.response;

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dati non validi", dettagli: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const b = parsed.data;

    const admin = createAdminClient();
    const { data, error } = await admin
      .schema("vettori")
      .from("rilevazioni")
      .insert({
        fornitore_testo: b.fornitore,
        numero_bolla: b.numeroBolla?.trim() || null,
        data_arrivo: b.dataArrivo,
        colli: b.colli,
        peso_kg: b.pesoKg ?? null,
        lunghezza_cm: b.lunghezzaCm ?? null,
        larghezza_cm: b.larghezzaCm ?? null,
        altezza_cm: b.altezzaCm ?? null,
        condizioni: b.condizioni,
        note: b.note?.trim() || null,
        rilevata_da: guard.user.id,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    return NextResponse.json({
      id: data.id,
      rilevazioni: await rilevazioniRecenti(),
    });
  } catch (e) {
    logError("vettori.arrivi", "registrazione arrivo fallita", e);
    return NextResponse.json(
      { error: "Non è stato possibile registrare l'arrivo." },
      { status: 500 }
    );
  }
}
