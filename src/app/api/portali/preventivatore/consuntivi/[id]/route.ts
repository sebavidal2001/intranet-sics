import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireConsuntivazione, UUID_RE } from "@/lib/portali/preventivatore/consuntivi-guard";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** GET: testata + righe dello snapshot. */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    const guard = await requireConsuntivazione();
    if (!guard.ok) return guard.response;

    const sb = createAdminClient().schema("preventivatore");
    const [testata, righe] = await Promise.all([
      sb.from("consuntivi").select("*").eq("id", id).maybeSingle(),
      sb
        .from("consuntivo_righe")
        .select("id, ordine, codice_blocco, tipo_riga, codice_articolo, descrizione, quantita, quantita_pezzi_blocco, costo_unitario, split_fonte, costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro, costo_totale")
        .eq("consuntivo_id", id)
        .order("ordine", { ascending: true, nullsFirst: false }),
    ]);
    if (testata.error) throw testata.error;
    if (righe.error) throw righe.error;
    if (!testata.data) return NextResponse.json({ error: "Consuntivo non trovato" }, { status: 404 });
    return NextResponse.json({ consuntivo: testata.data, righe: righe.data ?? [] });
  } catch (e) {
    logError("preventivatore.consuntivi", "GET [id] error", e);
    return NextResponse.json({ error: "Errore lettura consuntivo" }, { status: 500 });
  }
}

const PatchSchema = z
  .object({
    stato: z.enum(["aperto", "chiuso"]).optional(),
    note: z.string().trim().max(1000).nullable().optional(),
    quantita_articolo: z.number().positive().max(1_000_000).optional(),
    descrizione: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nessuna modifica" });

/** PATCH: stato, note, descrizione, pezzi coperti. Il preventivato congelato non si tocca. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    const guard = await requireConsuntivazione();
    if (!guard.ok) return guard.response;

    const parsed = PatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dati non validi" }, { status: 400 });
    }
    const { data, error } = await createAdminClient()
      .schema("preventivatore")
      .from("consuntivi")
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, stato, note, quantita_articolo, descrizione")
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Consuntivo non trovato" }, { status: 404 });
    return NextResponse.json({ consuntivo: data });
  } catch (e) {
    logError("preventivatore.consuntivi", "PATCH error", e);
    return NextResponse.json({ error: "Errore aggiornamento consuntivo" }, { status: 500 });
  }
}

/** DELETE: toglie il consuntivo (le righe vanno in cascata). */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "ID non valido" }, { status: 400 });
    const guard = await requireConsuntivazione();
    if (!guard.ok) return guard.response;

    const { error } = await createAdminClient().schema("preventivatore").from("consuntivi").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("preventivatore.consuntivi", "DELETE error", e);
    return NextResponse.json({ error: "Errore eliminazione consuntivo" }, { status: 500 });
  }
}
