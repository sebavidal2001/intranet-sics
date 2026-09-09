import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import { riepilogoListini } from "@/lib/portali/vettori/letture";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const Body = z.object({
  vettore: z.string().trim().min(1),
  anno: z.number().int().min(2020).max(2100),
  mese: z.number().int().min(1).max(12),
  // In percentuale come la scrive il vettore nella comunicazione (13,00),
  // non in frazione: chi la inserisce copia da un'email.
  percentuale: z.number().min(0).max(100),
  fonte: z.enum(["comunicazione", "letto_da_fattura", "stimato"]).default("comunicazione"),
  note: z.string().trim().max(300).nullable().optional(),
});

/**
 * PUT — la percentuale carburante di un mese.
 *
 * Ogni comunicazione resta in vigore fino alla successiva. Se non esiste
 * nemmeno una percentuale precedente, il controllo resta non valutabile.
 *
 * Sovrascrive il valore esistente per quel mese: una comunicazione che corregge
 * la precedente è la norma, e tenere due righe per lo stesso mese renderebbe
 * ambiguo quale ha usato il controllo.
 */
export async function PUT(request: NextRequest) {
  try {
    const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
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
    const { data: vRows } = await admin
      .schema("vettori")
      .from("vettori")
      .select("id")
      .eq("codice", b.vettore)
      .limit(1);
    const vettoreId = (vRows ?? [])[0]?.id as string | undefined;
    if (!vettoreId) {
      return NextResponse.json({ error: "Vettore non trovato." }, { status: 404 });
    }

    const { error } = await admin
      .schema("vettori")
      .from("carburante")
      .upsert(
        {
          vettore_id: vettoreId,
          anno: b.anno,
          mese: b.mese,
          // In tabella si conserva la frazione, come la usa il motore di
          // calcolo: la conversione avviene qui, in un punto solo.
          percentuale: b.percentuale / 100,
          fonte: b.fonte,
          note: b.note?.trim() || null,
          inserito_da: guard.user.id,
          inserito_il: new Date().toISOString(),
        },
        { onConflict: "vettore_id,anno,mese" }
      );

    if (error) throw new Error(error.message);

    return NextResponse.json({
      ok: true,
      listini: await riepilogoListini(new Date().toISOString().slice(0, 10)),
    });
  } catch (e) {
    logError("vettori.carburante", "salvataggio carburante fallito", e);
    return NextResponse.json(
      { error: "Non è stato possibile salvare la percentuale." },
      { status: 500 }
    );
  }
}
