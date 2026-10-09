import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, negato, snapshotPerimetrato } from "../../_comune";
import { SpecNonValida } from "@/lib/prototipo-bi/semantico";
import { chiamaModello } from "@/lib/prototipo-bi/analista";
import { PropostaFallita, proponiMisura } from "@/lib/prototipo-bi/proposta-misura";
import { chiaveStabile } from "@/lib/prototipo-bi/cache";
import { creaLimitatore } from "@/lib/prototipo-bi/assistente-comune";
import { registraAccesso } from "@/lib/prototipo-bi/registro";

export const dynamic = "force-dynamic";

/** Ogni proposta e' una chiamata al modello: 20 all'ora per persona (in memoria, per processo: ferma un errore, non e' un limite di sicurezza). */
const dentroIlLimite = creaLimitatore(20, 60 * 60 * 1000);

/**
 * Traduce una richiesta in italiano in una misura personalizzata.
 * Body: { testo }. Non salva niente: restituisce la proposta con la
 * definizione in parole e la prova su un periodo noto, e l'utente decide.
 */
export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  if (pre.accesso.soloAssegnate) {
    return negato("Le misure le creano la direzione e i responsabili.");
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return errore("L'assistente non è disponibile: manca la configurazione dell'AI.", 503);
  }

  let body: { testo?: unknown };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }
  const testo = typeof body.testo === "string" ? body.testo : "";
  if (!dentroIlLimite(pre.accesso.userId)) {
    return errore("Troppe proposte nell'ultima ora: riprova più tardi.", 429);
  }

  const inizio = Date.now();
  try {
    const snapshot = await snapshotPerimetrato(pre.accesso);
    const esito = await proponiMisura({
      testo,
      snapshot,
      chiavePerimetro: chiaveStabile(pre.accesso.perimetro),
      chiama: chiamaModello,
    });
    await registraAccesso({
      utenteId: pre.accesso.userId,
      livello: pre.accesso.livello,
      perimetro: pre.accesso.perimetro,
      canale: "analista",
      domanda: `[misura] ${testo.slice(0, 500)}`,
      righe: esito.prova?.risultato.righe.length,
      millisecondi: Date.now() - inizio,
      esito: "ok",
    });
    return NextResponse.json(esito);
  } catch (e) {
    const messaggio = e instanceof Error ? e.message : "Errore";
    await registraAccesso({
      utenteId: pre.accesso.userId,
      livello: pre.accesso.livello,
      perimetro: pre.accesso.perimetro,
      canale: "analista",
      domanda: `[misura] ${testo.slice(0, 500)}`,
      millisecondi: Date.now() - inizio,
      esito: "errore",
      errore: messaggio,
    });
    if (e instanceof SpecNonValida) {
      return NextResponse.json({ error: e.message, suggerimento: e.suggerimento }, { status: 422 });
    }
    if (e instanceof PropostaFallita) {
      return NextResponse.json({ error: e.message, consumo: e.consumo, modelli: e.modelli }, { status: 422 });
    }
    return errore("Non riesco a preparare la proposta in questo momento.", 502);
  }
}
