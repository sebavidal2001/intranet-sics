import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, snapshotPerimetrato } from "../_comune";
import { registraAccesso } from "@/lib/prototipo-bi/registro";
import { chiediAnalista } from "@/lib/prototipo-bi/analista";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const rl = checkRateLimit(`proto-bi-analista:${pre.accesso.userId}`, {
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);

  let body: {
    domanda?: string;
    storico?: { ruolo: "utente" | "analista"; testo: string }[];
    /** Forza il livello di approfondimento invece di dedurlo dalla domanda. */
    complessita?: "semplice" | "analitica" | "profonda";
  };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }

  const domanda = body.domanda?.trim();
  if (!domanda) return errore("Domanda obbligatoria");
  if (domanda.length > 2000) return errore("Domanda troppo lunga");

  const avvio = Date.now();
  try {
    // Lo snapshot è già perimetrato: l'analista ragiona su ciò che l'utente
    // può vedere, quindi non può riferire numeri che l'utente non potrebbe
    // ottenere da solo.
    const snapshot = await snapshotPerimetrato(pre.accesso);
    const risposta = await chiediAnalista({
      domanda,
      snapshot,
      storico: (body.storico ?? []).slice(-8),
      complessita: body.complessita,
      sqlLibero: pre.accesso.sqlLibero,
    });
    await registraAccesso({
      utenteId: pre.accesso.userId,
      livello: pre.accesso.livello,
      perimetro: pre.accesso.perimetro,
      canale: "analista",
      domanda,
      righe: risposta.interrogazioni.length,
      millisecondi: Date.now() - avvio,
      esito: "ok",
    });
    return NextResponse.json(risposta);
  } catch (e) {
    const messaggio = e instanceof Error ? e.message : "Errore analista";
    await registraAccesso({
      utenteId: pre.accesso.userId,
      livello: pre.accesso.livello,
      perimetro: pre.accesso.perimetro,
      canale: "analista",
      domanda,
      millisecondi: Date.now() - avvio,
      esito: "errore",
      errore: messaggio,
    });
    return NextResponse.json({ error: messaggio }, { status: 500 });
  }
}
