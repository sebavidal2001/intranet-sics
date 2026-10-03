import { NextResponse } from "next/server";
import { z } from "zod";
import { logError } from "@/lib/logger";
import { ErroreCampagne } from "./dati";

/**
 * Risposta d'errore uniforme dei route handler del Portale Campagne: gli errori
 * di dominio escono col loro stato e messaggio (l'operatore deve capire cosa e'
 * successo), tutto il resto e' un 500 generico e il dettaglio va solo nel log.
 */
export function rispondiErrore(scope: string, e: unknown): NextResponse {
  if (e instanceof ErroreCampagne) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  logError(`campagne.${scope}`, "richiesta fallita", e);
  return NextResponse.json({ error: "Operazione non riuscita. Riprova fra poco." }, { status: 500 });
}

export function datiNonValidi(errore: z.ZodError): NextResponse {
  const primo = errore.issues[0]?.message;
  return NextResponse.json(
    { error: primo ? `Dati non validi: ${primo}` : "Dati non validi", dettagli: errore.flatten().fieldErrors },
    { status: 400 }
  );
}

/** Legge il corpo JSON senza far esplodere la route su un corpo vuoto o malformato. */
export async function leggiJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export const IdUuid = z.string().uuid();
