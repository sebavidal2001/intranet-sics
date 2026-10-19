import { NextResponse } from "next/server";
import type { ZodError, ZodIssue } from "zod";
import { logError } from "@/lib/logger";

/**
 * Il 400 «Dati non validi» delle route vettori, detto in modo che chi è
 * davanti alla pagina sappia cosa correggere (richiesta dell'amministrazione,
 * 19/10/2026).
 *
 * Ogni route passa le etichette dei campi che l'operatore scrive, con le
 * stesse parole della pagina. La chiave è il percorso del campo con `*` al
 * posto degli indici (`gruppi.*.quantita`); `{n}` nell'etichetta diventa il
 * numero della riga, contato da 1.
 *
 * Un errore su un campo senza etichetta non dipende da cosa si è scritto: è un
 * dato che la pagina manda da sola (id, esiti della simulazione...). Allora il
 * messaggio lo dice e il dettaglio va nel log, invece di lasciare l'operatore
 * a cercare un errore che non può trovare.
 */
export type EtichetteCampi = Readonly<Record<string, string>>;

export const ERRORE_DEL_PROGRAMMA =
  "Errore del programma, non dei dati inseriti: è già stato registrato. Segnalalo a Seba con la pagina e l'ora.";

const MAX_VOCI = 4;

function etichettaDi(path: ReadonlyArray<string | number>, etichette: EtichetteCampi): string | null {
  const chiave = path.map((p) => (typeof p === "number" ? "*" : p)).join(".");
  const etichetta = etichette[chiave];
  if (!etichetta) return null;
  const indice = path.find((p): p is number => typeof p === "number");
  return indice === undefined ? etichetta : etichetta.replace("{n}", String(indice + 1));
}

function numero(n: number | bigint): string {
  return Number(n).toLocaleString("it-IT");
}

/** Il motivo in italiano. I messaggi scritti negli schemi (refine) passano così come sono. */
function motivo(issue: ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" || issue.received === "null" ? "manca" : "valore non valido";
    case "too_small":
      if (issue.type === "string") return Number(issue.minimum) <= 1 ? "obbligatorio" : `almeno ${numero(issue.minimum)} caratteri`;
      if (issue.type === "array") return Number(issue.minimum) <= 1 ? "almeno un elemento" : `almeno ${numero(issue.minimum)} elementi`;
      return issue.inclusive ? `deve essere almeno ${numero(issue.minimum)}` : `deve essere maggiore di ${numero(issue.minimum)}`;
    case "too_big":
      if (issue.type === "string") return `al massimo ${numero(issue.maximum)} caratteri`;
      if (issue.type === "array") return `al massimo ${numero(issue.maximum)} elementi`;
      return issue.inclusive ? `al massimo ${numero(issue.maximum)}` : `deve essere minore di ${numero(issue.maximum)}`;
    case "invalid_string":
      if (issue.validation === "date" || issue.validation === "datetime") return "data non valida";
      if (issue.validation === "email") return "indirizzo email non valido";
      return "formato non valido";
    case "invalid_date":
      return "data non valida";
    case "invalid_enum_value":
    case "invalid_literal":
      return "valore non ammesso";
    case "not_finite":
    case "not_multiple_of":
      return "numero non valido";
    default:
      return issue.message;
  }
}

/** Il testo dell'errore: le voci dei campi dell'operatore, oppure l'errore del programma. */
export function descriviDatiNonValidi(error: ZodError, etichette: EtichetteCampi): { messaggio: string; delProgramma: boolean } {
  const voci: string[] = [];
  let delProgramma = false;
  for (const issue of error.issues) {
    const etichetta = etichettaDi(issue.path, etichette);
    let voce: string | null = null;
    if (etichetta) voce = `${etichetta}: ${motivo(issue)}`;
    // Un refine scritto da noi è già una frase per l'operatore.
    else if (issue.code === "custom") voce = issue.message;
    else delProgramma = true;
    if (voce && !voci.includes(voce)) voci.push(voce);
  }
  if (voci.length === 0) return { messaggio: ERRORE_DEL_PROGRAMMA, delProgramma: true };
  const elenco = voci.slice(0, MAX_VOCI).join("; ") + (voci.length > MAX_VOCI ? ` (e altri ${voci.length - MAX_VOCI})` : "");
  return { messaggio: `Dati non validi — ${elenco}${/[.!?)]$/.test(elenco) ? "" : "."}`, delProgramma };
}

/**
 * La risposta 400. `dettagli` resta per compatibilità; quando c'è di mezzo un
 * dato che l'operatore non scrive, il dettaglio va nel log con lo `scope`.
 */
export function rispostaDatiNonValidi(error: ZodError, etichette: EtichetteCampi, scope: string): NextResponse {
  const { messaggio, delProgramma } = descriviDatiNonValidi(error, etichette);
  if (delProgramma) logError(scope, "richiesta rifiutata dallo schema", error.issues.slice(0, 5));
  return NextResponse.json({ error: messaggio, dettagli: error.flatten().fieldErrors }, { status: 400 });
}

/** Le stesse etichette con un prefisso di percorso (`simulazione.` nella conferma). */
export function conPrefisso(prefisso: string, etichette: EtichetteCampi): EtichetteCampi {
  return Object.fromEntries(Object.entries(etichette).map(([k, v]) => [`${prefisso}.${k}`, v]));
}

/** I campi che l'operatore compila nella Simulazione: valgono per `/simula` e per la conferma. */
export const ETICHETTE_SIMULAZIONE: EtichetteCampi = {
  cap: "CAP di destinazione",
  provincia: "Provincia",
  colli: "Colli",
  pesoKg: "Peso totale (kg)",
  data: "Data di spedizione",
  controparteCodice: "Codice cliente",
  "gruppi.*.quantita": "Quantità gruppo {n}",
  "gruppi.*.lunghezzaCm": "Lunghezza (cm) gruppo {n}",
  "gruppi.*.larghezzaCm": "Profondità (cm) gruppo {n}",
  "gruppi.*.altezzaCm": "Altezza (cm) gruppo {n}",
  "gruppi.*.pesoRealeKg": "Peso reale (kg) gruppo {n}",
};
