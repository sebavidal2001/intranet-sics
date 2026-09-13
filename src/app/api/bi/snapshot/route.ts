import { NextResponse } from "next/server";
import { preliminari, negato, snapshotPerimetrato } from "../_comune";
import { invalidaCacheMemoria } from "@/lib/prototipo-bi/sorgente";
import { etaSnapshot } from "@/lib/prototipo-bi/archivio";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Stato dello snapshot: freschezza, run, copertura. */
export async function GET() {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  try {
    const s = await snapshotPerimetrato(pre.accesso);
    const eta = await etaSnapshot();
    return NextResponse.json({
      generatoIl: s.generatoIl,
      runCorrente: s.runCorrente,
      runRicevutoIl: s.runRicevutoIl,
      dataMinima: s.dataMinima,
      dataMassima: s.dataMassima,
      conteggi: s.conteggi,
      etaCacheMs: eta,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore snapshot" },
      { status: 500 }
    );
  }
}

/** Ricarica forzata dalle viste bi_* (sola lettura). */
export async function POST() {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  // La ricarica svuota la cache condivisa da tutti e riscarica 66.000 righe
  // dalle viste: è un'azione sullo stato globale del server, non una lettura.
  // Resta alla direzione, così un click ripetuto non diventa un carico per tutti.
  if (!pre.accesso.sqlLibero) {
    return negato("L'aggiornamento forzato dei dati è riservato alla direzione.");
  }

  try {
    invalidaCacheMemoria();
    const s = await snapshotPerimetrato(pre.accesso, true);
    return NextResponse.json({
      ok: true,
      generatoIl: s.generatoIl,
      conteggi: s.conteggi,
      dataMassima: s.dataMassima,
      runCorrente: s.runCorrente,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore aggiornamento" },
      { status: 500 }
    );
  }
}
