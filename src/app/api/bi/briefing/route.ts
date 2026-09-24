import { NextRequest, NextResponse } from "next/server";
import { preliminari, snapshotPerimetrato } from "../_comune";
import { registraRiscontro } from "@/lib/prototipo-bi/archivio";
import { briefingDelGiorno } from "@/lib/prototipo-bi/briefing-del-giorno";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Il briefing del giorno, uno per persona e archiviato.
 * `?rigenera=1` lo rifa' da capo invece di restituire quello di stamattina.
 * `?grezzo=1` restituisce anche tutti i segnali valutati e scartati: serve a
 * capire, in fase di taratura, cosa il sistema ha visto e non ha detto.
 */
export async function GET(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  try {
    const snapshot = await snapshotPerimetrato(pre.accesso);
    const rigenera = request.nextUrl.searchParams.get("rigenera") === "1";
    const { briefing, segnali, configurazioneBudget } = await briefingDelGiorno(
      pre.accesso,
      snapshot,
      { rigenera }
    );

    const grezzo = request.nextUrl.searchParams.get("grezzo") === "1";
    return NextResponse.json({
      briefing,
      configurazioneBudget,
      ...(grezzo
        ? {
            segnali: segnali.map((s) => ({
              id: s.id,
              famiglia: s.famiglia,
              titolo: s.titolo,
              descrizione: s.descrizione,
              punteggio: s.punteggio,
              magnitudineEuro: s.magnitudineEuro,
              direzione: s.direzione,
              selezionato: briefing.voci.some((v) => v.segnaleId === s.id),
              dettaglio: s.dettaglio ?? null,
            })),
          }
        : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore briefing" },
      { status: 500 }
    );
  }
}

/** Riscontro dell'utente su una voce: è l'unico modo onesto di tarare i pesi. */
export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  try {
    const body = (await request.json()) as {
      segnaleId?: string;
      famiglia?: string;
      utile?: boolean;
      nota?: string;
    };
    if (!body.segnaleId || !body.famiglia || typeof body.utile !== "boolean") {
      return NextResponse.json({ error: "Riscontro incompleto" }, { status: 400 });
    }
    await registraRiscontro({
      segnaleId: body.segnaleId,
      famiglia: body.famiglia,
      utile: body.utile,
      nota: body.nota?.slice(0, 300),
      registratoIl: new Date().toISOString(),
    }, pre.accesso.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore riscontro" },
      { status: 500 }
    );
  }
}
