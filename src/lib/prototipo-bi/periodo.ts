/**
 * IL PERIODO DI UNA DOMANDA, IN UN POSTO SOLO.
 *
 * Il periodo sapeva dire un anno solo (`anno`) oppure un intervallo
 * (`dal`/`al`). Con l'anno fisso sull'anno in corso, le consegne e il
 * portafoglio del 2027 non comparivano da nessuna parte: per vederli bisognava
 * sapere che andava cambiato l'anno, e cambiandolo sparivano quelle del 2026.
 *
 * `anni` permette di sceglierne più d'uno, anche non contigui (2025 e 2027
 * senza il 2026). Convive con `anno`, che resta per le analisi già salvate e
 * per l'analista AI: un periodo con `anno` si legge come `anni: [anno]`.
 *
 * La stessa regola «questa data sta nel periodo?» era ricopiata in quattro
 * file, ognuno con la sua versione di `anno`. Una quinta copia con `anni`
 * sarebbe stata la volta buona per farle divergere: stanno tutte qui.
 */

import type { Periodo } from "./tipi";

const ANNO_MINIMO = 1900;
const ANNO_MASSIMO = 2200;

function annoValido(valore: unknown): valore is number {
  return (
    typeof valore === "number" &&
    Number.isInteger(valore) &&
    valore >= ANNO_MINIMO &&
    valore <= ANNO_MASSIMO
  );
}

/** Gli anni scelti esplicitamente, ordinati; `null` se il periodo non ne fissa. */
export function anniDelPeriodo(periodo: Periodo | undefined): number[] | null {
  if (!periodo) return null;
  if (Array.isArray(periodo.anni) && periodo.anni.length > 0) {
    return [...new Set(periodo.anni.filter(annoValido))].sort((a, b) => a - b);
  }
  if (annoValido(periodo.anno)) return [periodo.anno];
  return null;
}

export function periodoPresente(periodo: Periodo | undefined): periodo is Periodo {
  return Boolean(
    periodo &&
      (periodo.anno !== undefined ||
        (Array.isArray(periodo.anni) && periodo.anni.length > 0) ||
        periodo.dal ||
        periodo.al)
  );
}

/** Vero se la data (yyyy-mm-dd) cade nel periodo: anni scelti E intervallo. */
export function dataNelPeriodo(data: string, periodo: Periodo): boolean {
  if (!data) return false;
  const anni = anniDelPeriodo(periodo);
  if (anni && !anni.includes(Number(data.slice(0, 4)))) return false;
  if (periodo.dal && data < periodo.dal) return false;
  if (periodo.al && data > periodo.al) return false;
  return true;
}

/** Sposta tutto il periodo di `delta` anni (per i confronti anno su anno). */
export function spostaPeriodo(periodo: Periodo, delta: number): Periodo {
  const sposta = (data?: string) =>
    data ? `${Number(data.slice(0, 4)) + delta}${data.slice(4)}` : undefined;
  const risultato: Periodo = {};
  const dal = sposta(periodo.dal);
  const al = sposta(periodo.al);
  if (dal) risultato.dal = dal;
  if (al) risultato.al = al;
  if (periodo.anno !== undefined) risultato.anno = periodo.anno + delta;
  if (Array.isArray(periodo.anni) && periodo.anni.length > 0) {
    risultato.anni = periodo.anni.map((anno) => anno + delta);
  }
  return risultato;
}

/**
 * Pulisce un periodo arrivato da fuori (API, jsonb salvato, analista).
 *
 * Tiene solo i campi noti e ben formati. Un solo anno in `anni` resta in
 * `anni`: convertirlo in `anno` cambierebbe la forma di quello che l'utente ha
 * salvato, e rileggendolo l'interfaccia mostrerebbe un'altra modalità.
 */
export function normalizzaPeriodo(valore: unknown): Periodo {
  if (!valore || typeof valore !== "object" || Array.isArray(valore)) return {};
  const grezzo = valore as Record<string, unknown>;
  const risultato: Periodo = {};
  const data = (v: unknown) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(v) ? v : undefined;
  const dal = data(grezzo.dal);
  const al = data(grezzo.al);
  if (dal) risultato.dal = dal;
  if (al) risultato.al = al;
  const anno = grezzo.anno === undefined || grezzo.anno === null ? undefined : Number(grezzo.anno);
  if (annoValido(anno)) risultato.anno = anno;
  if (Array.isArray(grezzo.anni)) {
    const anni = [...new Set(grezzo.anni.map(Number).filter(annoValido))].sort((a, b) => a - b);
    if (anni.length > 0) risultato.anni = anni;
  }
  return risultato;
}

/** «2025, 2027», «2025–2027» se contigui, o l'intervallo di date. */
export function descriviPeriodo(periodo: Periodo | undefined, seVuoto = "tutto il periodo"): string {
  if (!periodoPresente(periodo)) return seVuoto;
  const parti: string[] = [];
  const anni = anniDelPeriodo(periodo);
  if (anni) {
    const contigui = anni.length > 2 && anni.every((anno, i) => i === 0 || anno === anni[i - 1] + 1);
    parti.push(contigui ? `${anni[0]}–${anni[anni.length - 1]}` : anni.join(", "));
  }
  if (periodo.dal && periodo.al) parti.push(`${periodo.dal} – ${periodo.al}`);
  else if (periodo.dal) parti.push(`dal ${periodo.dal}`);
  else if (periodo.al) parti.push(`fino al ${periodo.al}`);
  return parti.join(", ");
}
