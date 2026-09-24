import { NextRequest, NextResponse } from "next/server";
import { errore, preliminari, snapshotPerimetrato } from "../_comune";
import { calcolaCruscottoAcquisti, oggiAcquisti, righeAcquisti } from "@/lib/prototipo-bi/acquisti";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Indicatori degli ordini di acquisto per la scheda Acquisti del Cruscotto.
 * `?dal=YYYY-MM-DD&al=YYYY-MM-DD`; senza, l'anno dei dati fino a oggi.
 */
export async function GET(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  try {
    const snapshot = await snapshotPerimetrato(pre.accesso);
    if (snapshot.acquisti === undefined) {
      return errore("Ordini di acquisto non disponibili: la vista bi_acquisti non è raggiungibile.", 503);
    }
    const oggi = oggiAcquisti(snapshot);
    const p = request.nextUrl.searchParams;
    const dal = p.get("dal") ?? `${oggi.slice(0, 4)}-01-01`;
    const al = p.get("al") ?? oggi;
    if (!DATA.test(dal) || !DATA.test(al) || dal > al) return errore("Periodo non valido.");

    return NextResponse.json(calcolaCruscottoAcquisti(righeAcquisti(snapshot), { dal, al, oggi }));
  } catch (e) {
    console.error("[bi.acquisti]", e);
    return errore("Indicatori acquisti non disponibili.", 500);
  }
}
