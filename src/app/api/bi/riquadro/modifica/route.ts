import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, negato, snapshotPerimetrato } from "../../_comune";
import { SpecNonValida } from "@/lib/prototipo-bi/semantico";
import { validaSerieAnalisi } from "@/lib/prototipo-bi/analisi-composita";
import { chiamaModello } from "@/lib/prototipo-bi/analista";
import { creaLimitatore } from "@/lib/prototipo-bi/assistente-comune";
import { ModificaFallita, proponiModifica } from "@/lib/prototipo-bi/modifica-riquadro-ai";
import type { StatoRiquadro } from "@/lib/prototipo-bi/modifica-riquadro";
import { chiaveMisura, misureNelleSpec } from "@/lib/prototipo-bi/misure-vocabolario";
import { elencaMisure } from "@/lib/prototipo-bi/misure-catalogo";
import { registraAccesso } from "@/lib/prototipo-bi/registro";
import type { MisuraDefinita } from "@/lib/prototipo-bi/tipi";
import { graficoValido, oggettoJson } from "../../dashboard/_utili";

export const dynamic = "force-dynamic";

/** Ogni richiesta e' una chiamata al modello: 30 all'ora per persona bastano a lavorare e fermano un ciclo. */
const dentroIlLimite = creaLimitatore(30, 60 * 60 * 1000);

/** Uno stato di riquadro vero pesa poche migliaia di caratteri: oltre, e' un abuso. */
const MAX_CARATTERI_STATO = 60_000;

/**
 * Traduce una richiesta in italiano in operazioni su un riquadro.
 * Body: { testo, stato: { titolo, grafico?, serie } }.
 *
 * Non salva niente e non calcola niente: restituisce il NUOVO STATO proposto e
 * il riepilogo in parole. Il prima e il dopo li calcola l'interfaccia con le
 * query di sempre (cioe' sul perimetro di chi guarda), e la modifica si applica
 * solo se l'utente conferma.
 */
export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  if (pre.accesso.soloAssegnate) {
    return negato("I riquadri li modificano la direzione e i responsabili.");
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return errore("L'assistente non è disponibile: manca la configurazione dell'AI.", 503);
  }

  let corpoGrezzo: string;
  try {
    corpoGrezzo = await request.text();
  } catch {
    return errore("Body non leggibile");
  }
  if (corpoGrezzo.length > MAX_CARATTERI_STATO) return errore("Il riquadro e' troppo grande per essere modificato a parole.", 413);

  let body: { testo?: unknown; stato?: unknown };
  try {
    body = JSON.parse(corpoGrezzo) as typeof body;
  } catch {
    return errore("Body JSON non valido");
  }
  const testo = typeof body.testo === "string" ? body.testo : "";

  // Lo stato arriva dal browser: si rivalida per intero, specie e serie comprese.
  let stato: StatoRiquadro;
  try {
    if (!oggettoJson(body.stato)) return errore("Stato del riquadro mancante.");
    const titolo = typeof body.stato.titolo === "string" ? body.stato.titolo.trim().slice(0, 200) : "";
    const grafico = body.stato.grafico;
    if (grafico !== undefined && grafico !== null && !graficoValido(grafico)) {
      return errore("Tipo di grafico non valido.");
    }
    stato = {
      titolo,
      serie: validaSerieAnalisi(body.stato.serie),
      ...(grafico ? { grafico } : {}),
    };
  } catch (e) {
    if (e instanceof SpecNonValida) return NextResponse.json({ error: e.message, suggerimento: e.suggerimento }, { status: 422 });
    return errore("Stato del riquadro non valido.");
  }

  if (!dentroIlLimite(pre.accesso.userId)) {
    return errore("Troppe richieste nell'ultima ora: riprova più tardi.", 429);
  }

  const inizio = Date.now();
  try {
    const snapshot = await snapshotPerimetrato(pre.accesso);

    // Le misure che l'assistente puo' nominare: quelle del catalogo e quelle che
    // il riquadro gia' porta (una misura archiviata resta usabile qui). Se il
    // catalogo non c'e' (migration non applicata) si va avanti senza.
    const definizioni: Record<string, MisuraDefinita> = {};
    for (const m of misureNelleSpec(stato.serie.map((s) => s.spec))) definizioni[chiaveMisura(m)] = m;
    try {
      for (const salvata of await elencaMisure()) {
        if (salvata.misura && !definizioni[chiaveMisura(salvata.misura)]) definizioni[chiaveMisura(salvata.misura)] = salvata.misura;
      }
    } catch {
      /* catalogo non disponibile: nessuna misura nominabile oltre a quelle del riquadro */
    }

    const esito = await proponiModifica({ testo, stato, snapshot, definizioni, chiama: chiamaModello });
    await registraAccesso({
      utenteId: pre.accesso.userId,
      livello: pre.accesso.livello,
      perimetro: pre.accesso.perimetro,
      canale: "analista",
      domanda: `[modifica riquadro] ${testo.slice(0, 500)}`,
      righe: esito.operazioni?.length,
      millisecondi: Date.now() - inizio,
      esito: "ok",
    });
    return NextResponse.json(esito);
  } catch (e) {
    await registraAccesso({
      utenteId: pre.accesso.userId,
      livello: pre.accesso.livello,
      perimetro: pre.accesso.perimetro,
      canale: "analista",
      domanda: `[modifica riquadro] ${testo.slice(0, 500)}`,
      millisecondi: Date.now() - inizio,
      esito: "errore",
      errore: e instanceof Error ? e.message : "Errore",
    });
    if (e instanceof SpecNonValida) {
      return NextResponse.json({ error: e.message, suggerimento: e.suggerimento }, { status: 422 });
    }
    if (e instanceof ModificaFallita) {
      return NextResponse.json({ error: e.message, consumo: e.consumo, modelli: e.modelli }, { status: 422 });
    }
    return errore("Non riesco a preparare la modifica in questo momento.", 502);
  }
}
