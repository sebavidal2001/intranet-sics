/**
 * REGISTRO DELLE INTERROGAZIONI — chi ha chiesto cosa.
 *
 * Serve a rispondere alla domanda che arriva sempre e sempre troppo tardi:
 * «chi ha visto questo numero?». Senza registro la risposta è "non è
 * ricostruibile", che su dati direzionali non è una risposta accettabile.
 *
 * Si registra l'INTENZIONE (la spec o l'SQL) e l'ESITO (quante righe, quanto
 * tempo, se è andata male), mai i dati restituiti: un registro che contiene i
 * risultati è una seconda copia degli stessi dati riservati, con gli stessi
 * problemi di accesso e nessuna delle protezioni.
 *
 * Destinazione: `bi_direzionale.registro_query` (migration 103), con ripiego su
 * file JSON Lines finché le migration non sono applicate.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SpecQuery } from "./tipi";
import { descriviPerimetro, type Perimetro } from "./perimetro";

const CARTELLA = path.join(process.cwd(), "prototipo-bi", "dati", "registro");

export interface VoceRegistro {
  momento: string;
  utenteId: string;
  /** Livello con cui l'utente ha chiesto: serve per rileggere gli accessi. */
  livello: string;
  perimetro: string;
  canale: "spec" | "sql" | "analista" | "export";
  /** La spec certificata, quando il canale è `spec`. */
  spec?: SpecQuery;
  /** L'SQL eseguito, quando il canale è `sql`. Troncato per sicurezza. */
  sql?: string;
  /** La domanda in chiaro, quando il canale è `analista`. */
  domanda?: string;
  righe?: number;
  millisecondi?: number;
  esito: "ok" | "errore" | "negato";
  errore?: string;
}

function fileDelGiorno(momento: Date): string {
  const giorno = momento.toISOString().slice(0, 10);
  return path.join(CARTELLA, `${giorno}.jsonl`);
}

/**
 * Registra una voce.
 *
 * Destinazione: `bi_direzionale.registro_query` (migration 103). Se la tabella
 * non c'è — migration non ancora applicate — si ripiega sul file, invece di
 * perdere la traccia.
 *
 * **Non solleva mai.** Un registro che rompe la richiesta che stava
 * registrando trasforma un problema di tracciabilità in un guasto: si logga
 * l'errore e si va avanti. L'audit mancato si vede dal buco nella sequenza.
 */
export async function registra(voce: Omit<VoceRegistro, "momento">): Promise<void> {
  const completa: VoceRegistro = { momento: new Date().toISOString(), ...voce };
  if (completa.sql && completa.sql.length > 4000) {
    completa.sql = `${completa.sql.slice(0, 4000)}… [troncato]`;
  }

  try {
    const { error } = await createAdminClient()
      .schema("bi_direzionale")
      .from("registro_query")
      .insert({
        momento: completa.momento,
        utente_id: completa.utenteId,
        livello: completa.livello,
        perimetro: completa.perimetro,
        canale: completa.canale,
        spec: completa.spec ?? null,
        sql_testo: completa.sql ?? null,
        domanda: completa.domanda ?? null,
        righe: completa.righe ?? null,
        millisecondi: completa.millisecondi ?? null,
        esito: completa.esito,
        errore: completa.errore ?? null,
      });
    if (!error) return;
    console.warn("[bi] registro su database non riuscito, ripiego su file:", error.message);
  } catch (e) {
    console.warn("[bi] registro su database non raggiungibile:", e instanceof Error ? e.message : e);
  }

  try {
    await fs.mkdir(CARTELLA, { recursive: true });
    await fs.appendFile(fileDelGiorno(new Date()), `${JSON.stringify(completa)}\n`, "utf8");
  } catch (e) {
    console.error("[bi] registro non scritto:", e instanceof Error ? e.message : e);
  }
}

/** Scorciatoia: registra descrivendo il perimetro applicato. */
export async function registraAccesso(opzioni: {
  utenteId: string;
  livello: string;
  perimetro: Perimetro;
  canale: VoceRegistro["canale"];
  spec?: SpecQuery;
  sql?: string;
  domanda?: string;
  righe?: number;
  millisecondi?: number;
  esito: VoceRegistro["esito"];
  errore?: string;
}): Promise<void> {
  const { perimetro, ...resto } = opzioni;
  await registra({ ...resto, perimetro: descriviPerimetro(perimetro) });
}

/** Rilettura del registro di un giorno. Per le verifiche e per il futuro pannello. */
export async function leggiRegistro(giorno: string): Promise<VoceRegistro[]> {
  try {
    const testo = await fs.readFile(path.join(CARTELLA, `${giorno}.jsonl`), "utf8");
    return testo
      .split("\n")
      .filter((r) => r.trim() !== "")
      .map((r) => JSON.parse(r) as VoceRegistro);
  } catch {
    return [];
  }
}
