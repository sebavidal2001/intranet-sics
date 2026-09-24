import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireVettori } from "@/lib/portali/vettori/api-guard";
import { VETTORI_RUOLI } from "@/lib/portali/vettori/ruoli";
import { segnaAddebitoVerificato } from "@/lib/portali/vettori/storico";
import { logError } from "@/lib/logger";

export const dynamic = "force-dynamic";

const Corpo = z.object({
  spedizioneId: z.string().uuid(),
  verificato: z.boolean(),
}).strict();

/**
 * POST /api/portali/vettori/spedizioni/verifica-addebito
 *
 * La spunta che l'amministrazione mette quando, fatturando al cliente, ha
 * controllato l'addebito del trasporto. Solo amministrazione: e' una
 * dichiarazione su una fattura attiva, non un dato di magazzino.
 */
export async function POST(request: NextRequest) {
  try {
    const guard = await requireVettori({ ruoli: [VETTORI_RUOLI.amministrazione] });
    if (!guard.ok) return guard.response;

    let corpo: unknown;
    try {
      corpo = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo della richiesta non valido." }, { status: 400 });
    }
    const parsed = Corpo.safeParse(corpo);
    if (!parsed.success) {
      return NextResponse.json({ error: "Dati non validi." }, { status: 400 });
    }

    const esito = await segnaAddebitoVerificato(
      parsed.data.spedizioneId,
      parsed.data.verificato,
      guard.user.id
    );
    return NextResponse.json(esito);
  } catch (error) {
    logError("vettori.spedizioni", "spunta addebito fallita", error);
    const messaggio = error instanceof Error ? error.message : "Spunta non salvata.";
    return NextResponse.json(
      { error: messaggio },
      { status: messaggio === "Spedizione non trovata." ? 404 : 500 }
    );
  }
}
