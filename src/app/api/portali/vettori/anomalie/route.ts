import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import { elencoAnomalie } from "@/lib/portali/vettori/letture";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const STATI = ["aperta", "contestata", "accettata", "corretta"] as const;

/** GET — elenco filtrato. */
export async function GET(request: NextRequest) {
  try {
    const guard = await requireVettori();
    if (!guard.ok) return guard.response;

    const p = request.nextUrl.searchParams;
    const stati = p.getAll("stato").filter((s) => (STATI as readonly string[]).includes(s));

    return NextResponse.json({
      anomalie: await elencoAnomalie({
        stati: stati.length ? stati : null,
        vettore: p.get("vettore") || null,
        da: p.get("da") || null,
        a: p.get("a") || null,
      }),
    });
  } catch (e) {
    logError("vettori.anomalie", "lettura anomalie fallita", e);
    return NextResponse.json({ error: "Errore nella lettura delle anomalie" }, { status: 500 });
  }
}

const Decisione = z.object({
  id: z.string().uuid(),
  stato: z.enum(["contestata", "accettata", "corretta", "aperta"]),
  motivazione: z.string().trim().max(1000).nullable().optional(),
});

/**
 * PATCH — la decisione di una persona su un'anomalia.
 *
 * La motivazione è obbligatoria per tutto ciò che non è «aperta» o
 * «contestata»: accettare un addebito senza dire perché, riletto fra sei mesi,
 * non è una decisione ma una riga chiusa. Il vincolo esiste anche nel database
 * (migration 089): qui si controlla per poter rispondere con una frase invece
 * che con un errore di constraint.
 */
export async function PATCH(request: NextRequest) {
  try {
    const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
    if (!guard.ok) return guard.response;

    const parsed = Decisione.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Dati non validi", dettagli: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const { id, stato } = parsed.data;
    const motivazione = parsed.data.motivazione?.trim() || null;

    if (stato !== "aperta" && stato !== "contestata" && !motivazione) {
      return NextResponse.json(
        { error: "Serve una motivazione per chiudere l'anomalia." },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { error } = await admin
      .schema("vettori")
      .from("anomalie")
      .update({
        stato,
        motivazione,
        decisa_da: stato === "aperta" ? null : guard.user.id,
        decisa_il: stato === "aperta" ? null : new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, anomalie: await elencoAnomalie() });
  } catch (e) {
    logError("vettori.anomalie", "decisione anomalia fallita", e);
    return NextResponse.json(
      { error: "Non è stato possibile salvare la decisione." },
      { status: 500 }
    );
  }
}
