
import { NextRequest, NextResponse } from "next/server";
import { preliminari, snapshotPerimetrato } from "../_comune";
import {
  leggiConfigurazione,
  leggiBriefingArchiviati,
  archiviaBriefing,
  pesiDaRiscontri,
  registraRiscontro,
} from "@/lib/prototipo-bi/archivio";
import { costruisciContesto, rilevaTutto, calcolaPunteggi } from "@/lib/prototipo-bi/rilevatori";
import { generaBriefing } from "@/lib/prototipo-bi/analista";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Genera il briefing del giorno.
 * `?grezzo=1` restituisce anche tutti i segnali valutati e scartati: serve a
 * capire, in fase di taratura, cosa il sistema ha visto e non ha detto.
 */
export async function GET(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  try {
    const snapshot = await snapshotPerimetrato(pre.accesso);
    const anno = Number((snapshot.dataMassima ?? "").slice(0, 4)) || new Date().getFullYear();
    const config = await leggiConfigurazione(anno);

    const ctx = costruisciContesto(snapshot, config, pre.accesso.agenteScope);
    const grezzi = rilevaTutto(ctx);

    // Cooldown: i segnali già usciti negli ultimi 3 briefing perdono priorità.
    const archiviati = await leggiBriefingArchiviati();
    const idGiaVisti = new Set(
      archiviati.slice(0, 3).flatMap((b) => b.voci.map((v) => v.segnaleId))
    );
    const pesi = await pesiDaRiscontri();

    const ordinati = calcolaPunteggi(grezzi, { idGiaVisti, pesiFamiglia: pesi });

    const briefing = await generaBriefing({
      segnali: ordinati,
      snapshot,
      destinatario: pre.accesso.nome,
      ruolo: pre.accesso.ruolo,
      massimoVoci: 3,
    });

    const salva = request.nextUrl.searchParams.get("salva") === "1";
    if (salva) await archiviaBriefing(briefing, pre.accesso.userId);

    const grezzo = request.nextUrl.searchParams.get("grezzo") === "1";
    return NextResponse.json({
      briefing,
      configurazioneBudget: Boolean(config),
      ...(grezzo
        ? {
            segnali: ordinati.map((s) => ({
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
