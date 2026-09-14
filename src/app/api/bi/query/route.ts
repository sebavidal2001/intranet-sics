import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, snapshotPerimetrato } from "../_comune";
import { esegui, validaSpec, SpecNonValida, vocabolario } from "@/lib/prototipo-bi/semantico";
import { cacheQuery, chiaveStabile } from "@/lib/prototipo-bi/cache";
import { registraAccesso } from "@/lib/prototipo-bi/registro";
import type { RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

export const dynamic = "force-dynamic";

/** Il vocabolario, per la UI e per l'AI. */
export async function GET() {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  return NextResponse.json(vocabolario());
}

/**
 * Esegue una o più spec certificate.
 * Body: { spec } oppure { specs: [{ id, spec }] }
 */
export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  let body: { spec?: unknown; specs?: Array<{ id: string; spec: unknown }> };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }

  try {
    const snapshot = await snapshotPerimetrato(pre.accesso);

    /**
     * Esegue una spec, riusando il risultato se è già stato calcolato per
     * questo run. La chiave comprende il run pubblicato: un caricamento nuovo
     * rende irraggiungibili tutte le voci precedenti, quindi non si rischia di
     * servire numeri vecchi.
     */
    // Il perimetro fa parte della chiave di cache, e deve.
    //
    // `cacheQuery` è un singleton di modulo, condiviso da tutte le richieste
    // del processo. Senza questo pezzo la direzione eseguiva una spec, il
    // risultato completo finiva in cache, e il primo utente con perimetro
    // ristretto che chiedeva la stessa spec si vedeva servire quel risultato:
    // il filtro sullo snapshot non veniva mai raggiunto, perché la risposta
    // arrivava dalla cache prima. Due utenti con perimetri diversi non devono
    // mai condividere una voce.
    const chiavePerimetro = chiaveStabile(pre.accesso.perimetro);

    // Budget e BEP non sono piu' un caso speciale di questa rotta: `esegui()`
    // li risolve sulla serie che `snapshotPerimetrato` ha gia' agganciato.
    async function esegui1(grezza: unknown) {
      const spec = validaSpec(grezza);
      const chiave = `${snapshot.runCorrente ?? "?"}|${chiavePerimetro}|${chiaveStabile(spec)}`;
      const inCache = cacheQuery.leggi(chiave) as RisultatoQuery | undefined;
      if (inCache) return inCache;
      const calcolato = esegui(spec, snapshot);
      cacheQuery.scrivi(chiave, calcolato);
      return calcolato;
    }

    const inizio = Date.now();

    if (Array.isArray(body.specs)) {
      const risultati = await Promise.all(
        body.specs.map(async (s) => {
          try {
            return { id: s.id, risultato: await esegui1(s.spec) };
          } catch (e) {
            return { id: s.id, errore: e instanceof Error ? e.message : "Errore" };
          }
        })
      );
      await registraAccesso({
        utenteId: pre.accesso.userId,
        livello: pre.accesso.livello,
        perimetro: pre.accesso.perimetro,
        canale: "spec",
        righe: risultati.length,
        millisecondi: Date.now() - inizio,
        esito: "ok",
      });
      return NextResponse.json({
        risultati,
        dataMassima: snapshot.dataMassima,
        dataMinima: snapshot.dataMinima,
        // Utili per capire se la lentezza viene dal calcolo o dalla rete.
        durataMs: Date.now() - inizio,
        cache: cacheQuery.statistiche,
      });
    }

    const risultato = await esegui1(body.spec);
    await registraAccesso({
      utenteId: pre.accesso.userId,
      livello: pre.accesso.livello,
      perimetro: pre.accesso.perimetro,
      canale: "spec",
      spec: (risultato as RisultatoQuery).spec,
      righe: (risultato as RisultatoQuery).righe?.length,
      millisecondi: Date.now() - inizio,
      esito: "ok",
    });
    return NextResponse.json({
      risultato,
      dataMassima: snapshot.dataMassima,
      dataMinima: snapshot.dataMinima,
      durataMs: Date.now() - inizio,
    });
  } catch (e) {
    if (e instanceof SpecNonValida) return errore(e.message, 422);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Errore query" },
      { status: 500 }
    );
  }
}

export type { SpecQuery };
