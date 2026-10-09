/**
 * IL CICLO COMUNE DEGLI ASSISTENTI «A PAROLE».
 *
 * Le misure personalizzate e la modifica di un riquadro hanno la stessa forma:
 * il modello risponde solo con strumenti, il codice li esegue e li valida, e un
 * rifiuto del validatore torna al modello con il motivo perche' corregga.
 * Questo modulo e' il ciclo, senza sapere cosa c'e' dentro gli strumenti.
 *
 * Costo: la bozza la fa il modello LEGGERO; se non esce un risultato valido dopo
 * due correzioni guidate dal validatore si riparte UNA volta col modello
 * STANDARD, passandogli il motivo del fallimento. Il modello grande si paga per
 * i casi che lo meritano, non per tutti.
 *
 * Il chiamante del modello e' un parametro, cosi' i test non toccano la rete.
 */

import { calcolaCosto, MODELLI, type Modello } from "./modelli";
import type { EsitoModello, MessaggioChat } from "./analista";

export type ChiamaModello = (
  modelloId: string,
  messaggi: MessaggioChat[],
  opzioni?: { strumenti?: unknown[]; temperatura?: number; maxToken?: number }
) => Promise<EsitoModello>;

export interface ConsumoAssistente {
  tokenIngresso: number;
  tokenUscita: number;
  costoUsd: number;
}

export interface Accumulo {
  ingresso: number;
  uscita: number;
  costoUsd: number;
}

export function nuovoAccumulo(): Accumulo {
  return { ingresso: 0, uscita: 0, costoUsd: 0 };
}

export function consumoDa(acc: Accumulo): ConsumoAssistente {
  return {
    tokenIngresso: acc.ingresso,
    tokenUscita: acc.uscita,
    costoUsd: Math.round(acc.costoUsd * 1e6) / 1e6,
  };
}

export const NESSUN_CONSUMO: ConsumoAssistente = { tokenIngresso: 0, tokenUscita: 0, costoUsd: 0 };

export function leggiArgomenti(grezzi: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(grezzi) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Cosa risponde il codice a uno strumento.
 *  - `fine`: il ciclo finisce con questo valore;
 *  - `risposta`: testo che torna al modello; con `errore` conta come una
 *    correzione (e se sono troppe il tentativo fallisce).
 */
export type EsitoStrumento<T> = { fine: T } | { risposta: string; errore?: string };

export interface EsitoTentativo<T> {
  valore?: T;
  ultimoErrore: string;
}

const MAX_PASSI = 6;
const MAX_CORREZIONI = 2;

export async function tentativo<T>(opzioni: {
  modello: Modello;
  messaggi: MessaggioChat[];
  strumenti: unknown[];
  chiama: ChiamaModello;
  acc: Accumulo;
  gestisci: (nome: string, argomenti: Record<string, unknown>) => EsitoStrumento<T> | Promise<EsitoStrumento<T>>;
  ultimoErroreIniziale?: string | null;
  maxToken?: number;
}): Promise<EsitoTentativo<T>> {
  const { modello, messaggi, strumenti, chiama, acc, gestisci } = opzioni;
  let correzioni = 0;
  let ultimoErrore = opzioni.ultimoErroreIniziale ?? "nessuna proposta";

  for (let passo = 0; passo < MAX_PASSI; passo += 1) {
    const res = await chiama(modello.id, messaggi, {
      strumenti,
      temperatura: 0.1,
      maxToken: opzioni.maxToken ?? 900,
    });
    const consumo = calcolaCosto(modello, res.ingresso, res.uscita, res.costo, res.cache);
    acc.ingresso += consumo.tokenIngresso;
    acc.uscita += consumo.tokenUscita;
    acc.costoUsd += consumo.costoUsd;

    messaggi.push({
      role: "assistant",
      content: res.testo || null,
      ...(res.toolCalls.length ? { tool_calls: res.toolCalls } : {}),
    });

    if (res.toolCalls.length === 0) {
      correzioni += 1;
      ultimoErrore = "il modello ha risposto a parole invece di usare uno strumento";
      if (correzioni > MAX_CORREZIONI) return { ultimoErrore };
      messaggi.push({ role: "user", content: "Rispondi usando uno strumento." });
      continue;
    }

    for (const tc of res.toolCalls) {
      const rispondi = (contenuto: string) =>
        messaggi.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: contenuto });

      const args = leggiArgomenti(tc.function.arguments);
      if (!args) {
        rispondi("Argomenti non validi: devono essere un oggetto JSON.");
        correzioni += 1;
        ultimoErrore = "argomenti dello strumento non validi";
        continue;
      }

      const esito = await gestisci(tc.function.name, args);
      if ("fine" in esito) return { valore: esito.fine, ultimoErrore };

      rispondi(esito.risposta);
      if (esito.errore) {
        correzioni += 1;
        ultimoErrore = esito.errore;
        if (correzioni > MAX_CORREZIONI) return { ultimoErrore };
      }
    }
  }
  return { ultimoErrore };
}

export interface EsitoConEscalation<T> {
  valore?: T;
  ultimoErrore: string;
  modelli: string[];
  escalato: boolean;
  consumo: ConsumoAssistente;
}

/** Leggero prima; se non basta, standard una volta sola, col motivo del fallimento. */
export async function conEscalation<T>(
  acc: Accumulo,
  esegui: (modello: Modello, indizio: string | null) => Promise<EsitoTentativo<T>>
): Promise<EsitoConEscalation<T>> {
  const modelli = [MODELLI.leggero.nome];
  const primo = await esegui(MODELLI.leggero, null);
  if (primo.valore !== undefined) {
    return { ...primo, modelli, escalato: false, consumo: consumoDa(acc) };
  }
  const secondo = await esegui(MODELLI.standard, primo.ultimoErrore);
  modelli.push(MODELLI.standard.nome);
  return { ...secondo, modelli, escalato: true, consumo: consumoDa(acc) };
}

/**
 * Tetto di richieste per persona: ogni richiesta e' una chiamata al modello
 * (frazioni di centesimo, ma un ciclo in un loop sono comunque soldi). In
 * memoria, per processo: basta a fermare un errore, non e' un limite di
 * sicurezza.
 */
export function creaLimitatore(massimo: number, finestraMs: number) {
  const richieste = new Map<string, number[]>();
  return function dentroIlLimite(chiave: string): boolean {
    const adesso = Date.now();
    const recenti = (richieste.get(chiave) ?? []).filter((t) => adesso - t < finestraMs);
    if (recenti.length >= massimo) {
      richieste.set(chiave, recenti);
      return false;
    }
    recenti.push(adesso);
    richieste.set(chiave, recenti);
    return true;
  };
}
