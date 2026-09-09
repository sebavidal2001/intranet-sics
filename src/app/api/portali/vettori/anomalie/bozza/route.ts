import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import { elencoAnomalie } from "@/lib/portali/vettori/letture";
import { costruisciBozza } from "@/lib/portali/vettori/comunicazioni";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const Body = z.object({
  vettore: z.string().trim().min(1),
  anno: z.number().int().min(2020).max(2100),
  mese: z.number().int().min(1).max(12),
  destinatari: z.array(z.string().trim().email()).max(20).optional(),
  cc: z.array(z.string().trim().email()).max(20).optional(),
  ids: z.array(z.string().uuid()).min(1).max(400),
  direzione: z.enum(["entrata", "uscita"]).optional(),
});

/**
 * POST — costruisce la bozza di contestazione per un vettore e un mese.
 *
 * Restituisce testo e file, non li spedisce: la pagina mostra l'anteprima con
 * i dati veri e chi la legge decide se scaricarla. Vedi
 * `src/lib/portali/vettori/comunicazioni.ts` per il perché.
 */
export async function POST(request: NextRequest) {
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

    const { data: vRows, error: vettoreError } = await admin
      .schema("vettori")
      .from("vettori")
      .select("id, codice, nome")
      .eq("codice", b.vettore)
      .limit(1);
    if (vettoreError) throw vettoreError;
    const vettore = (vRows ?? [])[0] as { id: string; codice: string; nome: string } | undefined;
    if (!vettore) {
      return NextResponse.json({ error: "Vettore non trovato." }, { status: 404 });
    }

    // Modello del vettore se c'è, altrimenti quello generale. La ricerca è in
    // due passi e non con un `or`: l'ordine di preferenza deve essere esplicito.
    type Modello = {
      oggetto: string;
      corpo: string;
      destinatari: string[] | null;
      cc: string[] | null;
    };

    const { data: modelliVettore, error: modelloError } = await admin
      .schema("vettori")
      .from("mail_modelli")
      .select("oggetto, corpo, destinatari, cc")
      .eq("vettore_id", vettore.id)
      .eq("attivo", true)
      .limit(1);
    if (modelloError) throw modelloError;
    let modello = ((modelliVettore ?? []) as unknown as Modello[])[0] as
      | Modello
      | undefined;

    if (!modello) {
      const { data: generali, error: generaleError } = await admin
        .schema("vettori")
        .from("mail_modelli")
        .select("oggetto, corpo, destinatari, cc")
        .is("vettore_id", null)
        .eq("attivo", true)
        .limit(1);
      if (generaleError) throw generaleError;
      modello = ((generali ?? []) as unknown as Modello[])[0];
    }

    if (!modello) {
      return NextResponse.json(
        { error: "Nessun modello di comunicazione configurato." },
        { status: 409 }
      );
    }

    // Si contesta quello che è ancora aperto, non tutto lo storico: le anomalie
    // già accettate o corrette non tornano in una mail.
    const trovate = await elencoAnomalie({
      stati: ["aperta", "contestata"],
      vettore: b.vettore,
      limite: 10000,
    });
    const ids = new Set(b.ids);
    const anomalie = trovate.filter((a) => ids.has(a.id) && a.anno === b.anno && a.mese === b.mese && (!b.direzione || a.direzione === b.direzione));
    if (anomalie.length !== ids.size) return NextResponse.json({ error: "La selezione contiene anomalie cambiate o di periodi diversi. Aggiorna la pagina e riprova." }, { status: 409 });

    const bozza = costruisciBozza({
      vettoreNome: vettore.nome,
      anno: b.anno,
      mese: b.mese,
      anomalie,
      destinatari: b.destinatari ?? modello.destinatari ?? [],
      cc: b.cc ?? modello.cc ?? [],
      oggettoModello: modello.oggetto,
      corpoModello: modello.corpo,
    });

    return NextResponse.json({ bozza, quante: anomalie.length });
  } catch (e) {
    logError("vettori.anomalie.bozza", "costruzione bozza fallita", e);
    return NextResponse.json(
      { error: "Non è stato possibile costruire la bozza." },
      { status: 500 }
    );
  }
}
