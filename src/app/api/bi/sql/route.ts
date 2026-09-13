/**
 * SQL ESPLORATIVO — riservato alla direzione.
 *
 * È l'unica superficie del BI su cui gira testo SQL arbitrario. Il motore è
 * difeso in profondità (validazione doppia, esecuzione come `powerbi_reader`,
 * timeout, limite righe), ma la difesa che conta davvero è a monte: qui non
 * entra chi ha un perimetro di riga da rispettare, perché un `WHERE` non si
 * può imporre in modo affidabile dentro una SELECT scritta da altri.
 */

import { NextRequest, NextResponse } from "next/server";
import { preliminari, errore, negato } from "../_comune";
import { eseguiSqlBi, SCHEMA_SQL_BI } from "@/lib/prototipo-bi/sql";
import { registraAccesso } from "@/lib/prototipo-bi/registro";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MOTIVO_NEGATO =
  "L'interrogazione SQL libera è riservata alla direzione. " +
  "Con il tuo livello puoi usare le metriche certificate, che coprono le stesse domande " +
  "restando dentro il tuo perimetro.";

export async function GET() {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;
  if (!pre.accesso.sqlLibero) return negato(MOTIVO_NEGATO);
  return NextResponse.json({ schema: SCHEMA_SQL_BI });
}

export async function POST(request: NextRequest) {
  const pre = await preliminari();
  if (!pre.ok) return pre.risposta;

  const { accesso } = pre;

  if (!accesso.sqlLibero) {
    // Il tentativo si registra: un accesso negato è esattamente il genere di
    // evento che serve avere per iscritto.
    await registraAccesso({
      utenteId: accesso.userId,
      livello: accesso.livello,
      perimetro: accesso.perimetro,
      canale: "sql",
      esito: "negato",
    });
    return negato(MOTIVO_NEGATO);
  }

  let body: { sql?: unknown; limite?: number };
  try {
    body = await request.json();
  } catch {
    return errore("Body JSON non valido");
  }

  const avvio = Date.now();
  try {
    const esito = await eseguiSqlBi(body.sql, body.limite);
    await registraAccesso({
      utenteId: accesso.userId,
      livello: accesso.livello,
      perimetro: accesso.perimetro,
      canale: "sql",
      sql: esito.sql,
      righe: esito.righe.length,
      millisecondi: Date.now() - avvio,
      esito: "ok",
    });
    return NextResponse.json(esito);
  } catch (e) {
    const messaggio = e instanceof Error ? e.message : "Errore SQL";
    await registraAccesso({
      utenteId: accesso.userId,
      livello: accesso.livello,
      perimetro: accesso.perimetro,
      canale: "sql",
      sql: typeof body.sql === "string" ? body.sql : undefined,
      millisecondi: Date.now() - avvio,
      esito: "errore",
      errore: messaggio,
    });
    return errore(messaggio, 422);
  }
}
