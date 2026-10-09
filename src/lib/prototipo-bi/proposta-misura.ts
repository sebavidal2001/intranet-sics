/**
 * PROPOSTA DI MISURA A PAROLE.
 *
 * L'utente descrive in italiano la misura che gli serve; il modello la traduce
 * in una definizione DICHIARATIVA (vedi `misure.ts`) e questo modulo la fa
 * passare dal validatore prima che qualcuno la veda. Il modello non calcola
 * niente e non scrive formule: sceglie fra metriche e operatori che esistono.
 *
 * Costo: si paga solo qui, alla creazione. Una misura salvata si riesegue senza
 * AI. Per contenerlo:
 *   - la bozza la fa il modello LEGGERO; se non esce una misura valida dopo due
 *     correzioni guidate dal validatore, si riparte UNA volta col modello
 *     STANDARD (gli ambigui, non tutti);
 *   - la proposta si ricorda per testo normalizzato, versione del catalogo e
 *     PERIMETRO (il perimetro e' nella chiave: i valori dei filtri vengono dai
 *     dati che l'utente vede, e un nome di cliente non deve passare a chi non
 *     lo vede).
 *
 * La funzione riceve il chiamante del modello come parametro, cosi' i test non
 * toccano la rete.
 */

import { calcolaCosto, MODELLI, type Modello } from "./modelli";
import { CacheRisultati } from "./cache";
import {
  descriviMisura,
  normalizzaValoriFiltri,
  provaMisura,
  validaMisura,
  type ProvaMisura,
} from "./misure";
import {
  CATALOGO,
  DIMENSIONI,
  SpecNonValida,
  elencaValoriDimensione,
} from "./semantico";
import { BUSINESS_UNIT } from "./business-unit";
import type { EsitoModello, MessaggioChat } from "./analista";
import type { Dimensione, MisuraDefinita, Snapshot } from "./tipi";

/** Cambia quando cambiano le istruzioni o gli strumenti: svuota la cache. */
const VERSIONE_PROMPT = 1;
const MAX_PASSI = 6;
const MAX_CORREZIONI = 2;
const MAX_CARATTERI_RICHIESTA = 500;

export type ChiamaModello = (
  modelloId: string,
  messaggi: MessaggioChat[],
  opzioni?: { strumenti?: unknown[]; temperatura?: number; maxToken?: number }
) => Promise<EsitoModello>;

export interface ConsumoProposta {
  tokenIngresso: number;
  tokenUscita: number;
  costoUsd: number;
}

export interface EsitoProposta {
  tipo: "misura" | "chiarimento";
  misura?: MisuraDefinita;
  /** La misura in una frase, per approvarla prima di salvarla. */
  descrizione?: string;
  /** Cio' che la richiesta chiedeva ma che NON fa parte della misura (periodo, confronto). */
  nota?: string;
  prova?: ProvaMisura;
  chiarimento?: string;
  modelli: string[];
  escalato: boolean;
  consumo: ConsumoProposta;
  dalCache: boolean;
}

export class PropostaFallita extends Error {
  constructor(messaggio: string, readonly consumo: ConsumoProposta, readonly modelli: string[]) {
    super(messaggio);
    this.name = "PropostaFallita";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Istruzioni e strumenti
// ─────────────────────────────────────────────────────────────────────────────

function nomeAggregazione(a: string): string {
  if (a === "rapporto") return "percentuale";
  if (a === "media" || a === "media_documento") return "media";
  if (a === "massimo") return "massimo";
  return "additiva";
}

export function istruzioniMisure(): string {
  const metriche = Object.values(CATALOGO)
    .filter((m) => m.chiave !== "budget" && m.chiave !== "bep")
    .map((m) => `- ${m.chiave} [${m.unita}, ${nomeAggregazione(m.aggregazione)}]: ${m.etichetta}. ${m.descrizione}`)
    .join("\n");
  const dimensioni = Object.entries(DIMENSIONI)
    .map(([chiave, d]) => `${chiave} (${d.etichetta})`)
    .join(", ");

  return `Sei l'assistente che aiuta a creare MISURE PERSONALIZZATE nel BI di SICS.
L'utente descrive in italiano un indicatore; tu lo traduci in una definizione dichiarativa fatta SOLO di metriche del catalogo. Non calcoli niente e non scrivi formule: i numeri li calcola il sistema.

OPERATORI (l'espressione ha un solo livello: gli operandi sono metriche, non altre espressioni)
- {"tipo":"metrica","metrica":"fatturato","filtri":[{"campo":"bu","op":"eq","valore":"COMPONENTI"}]}  la metrica con filtri incorporati
- {"tipo":"rapporto","numeratore":{...},"denominatore":{...}}  stessa unità = percentuale; euro su numero = euro per unità
- {"tipo":"differenza","da":{...},"sottrai":{...}}  stessa unità
- {"tipo":"somma","addendi":[{...},{...}]}  2-4 operandi, euro o numeri
- {"tipo":"quota","metrica":"fatturato","filtri":[...]}  quota dei filtri sul totale (filtri obbligatori); solo metriche additive
Un operando è {"metrica":"...","filtri":[...]}. Un filtro è {"campo":"<dimensione>","op":"eq|neq|in|contiene","valore":"..."} (con "in" il valore è un elenco).

REGOLE TASSATIVE
1. Usa SOLO metriche e dimensioni elencate sotto. Se nessuna esprime la richiesta, chiedi chiarimento o dillo: non ripiegare su una metrica vicina.
2. Se esiste già una metrica che risponde (margine_pct, ordine_medio, tasso_conversione...), usa quella con tipo "metrica": non ricostruirla con un rapporto. Attenzione: margine_pct è calcolato SOLO sulle righe di cui si conosce il costo; margine diviso fatturato include nel denominatore anche le righe senza costo. Sono due cose diverse: scegli quella che la richiesta intende, e dillo nella nota.
3. Il PERIODO (anno, mese, "da gennaio") e il CONFRONTO COL PERIODO PRECEDENTE ("rispetto all'anno scorso") NON fanno parte della misura: si scelgono nel riquadro. Se la richiesta li contiene, escludili dalla misura e spiegalo in "nota" (per l'anno scorso: «si ottiene aggiungendo al riquadro la serie di confronto con l'anno precedente»).
4. I valori dei filtri devono esistere nei dati. Se non sei sicuro della grafia di un cliente, di un agente o di un articolo, usa elenca_valori PRIMA. Le business unit sono: ${BUSINESS_UNIT.join(", ")}.
5. Non mescolare vendite, acquisti e visite nella stessa misura.
6. Il nome è breve, in italiano, descrive cosa misura (massimo 60 caratteri), per esempio «Margine % componenti».
7. Se la richiesta è ambigua in un punto che cambia il numero (quale margine, quale periodo di riferimento fra ordinato e fatturato), usa chiedi_chiarimento con UNA domanda precisa. Non chiedere cose che hai già in chiaro.
8. Rispondi SEMPRE e SOLO chiamando uno strumento: proponi_misura, chiedi_chiarimento oppure elenca_valori.

METRICHE
${metriche}

DIMENSIONI
${dimensioni}`;
}

const STRUMENTI = [
  {
    type: "function",
    function: {
      name: "proponi_misura",
      description:
        "Propone la misura. Viene validata e provata sui dati: se non è valida ricevi il motivo e puoi correggere.",
      parameters: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Nome breve della misura, massimo 60 caratteri" },
          espressione: { type: "object", description: "L'espressione dichiarativa (uno degli operatori)" },
          nota: {
            type: "string",
            description:
              "Cio' che la richiesta chiedeva ma non fa parte della misura (periodo, confronto), o la scelta fatta fra due letture.",
          },
        },
        required: ["nome", "espressione"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "chiedi_chiarimento",
      description: "Fa UNA domanda all'utente quando la richiesta e' ambigua in un punto che cambia il numero.",
      parameters: {
        type: "object",
        properties: { domanda: { type: "string" } },
        required: ["domanda"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "elenca_valori",
      description:
        "Elenca i valori che una dimensione contiene davvero nei dati dell'utente (con quanto pesano). Usalo prima di filtrare su un nome.",
      parameters: {
        type: "object",
        properties: {
          dimensione: { type: "string", description: "Per esempio cliente, agente, articolo, categoria" },
          contiene: { type: "string", description: "Parte del nome da cercare" },
        },
        required: ["dimensione"],
      },
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

interface VoceCache {
  misura?: unknown;
  nota?: string;
  chiarimento?: string;
}

/** Ventiquattro ore: dipende da testo, catalogo e perimetro, non dai numeri. */
const cacheProposte = new CacheRisultati<VoceCache>(200, 24 * 60 * 60 * 1000);

function versioneCatalogo(): string {
  return `${VERSIONE_PROMPT}|${Object.keys(CATALOGO).join(",")}|${Object.keys(DIMENSIONI).join(",")}`;
}

export function normalizzaRichiesta(testo: string): string {
  return testo.replace(/\s+/gu, " ").trim().slice(0, MAX_CARATTERI_RICHIESTA);
}

// ─────────────────────────────────────────────────────────────────────────────
// Un tentativo con un modello
// ─────────────────────────────────────────────────────────────────────────────

interface Accumulo {
  ingresso: number;
  uscita: number;
  costoUsd: number;
}

interface RisultatoTentativo {
  voce?: VoceCache & { misuraValida?: MisuraDefinita; prova?: ProvaMisura; descrizione?: string };
  ultimoErrore: string;
}

function leggiArgomenti(grezzi: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(grezzi) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function tentativo(
  modello: Modello,
  richiesta: string,
  snapshot: Snapshot,
  chiama: ChiamaModello,
  acc: Accumulo,
  indizio: string | null
): Promise<RisultatoTentativo> {
  const messaggi: MessaggioChat[] = [
    { role: "system", content: istruzioniMisure() },
    {
      role: "user",
      content:
        `Richiesta dell'utente: «${richiesta}»` +
        (indizio ? `\n\nUn primo tentativo non ha prodotto una misura valida. Motivo: ${indizio}` : ""),
    },
  ];
  let correzioni = 0;
  let ultimoErrore = indizio ?? "nessuna proposta";

  for (let passo = 0; passo < MAX_PASSI; passo += 1) {
    const res = await chiama(modello.id, messaggi, { strumenti: STRUMENTI, temperatura: 0.1, maxToken: 900 });
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
      messaggi.push({ role: "user", content: "Rispondi usando uno strumento: proponi_misura, chiedi_chiarimento o elenca_valori." });
      continue;
    }

    for (const tc of res.toolCalls) {
      const args = leggiArgomenti(tc.function.arguments);
      const rispondi = (contenuto: string) =>
        messaggi.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: contenuto });

      if (!args) {
        rispondi("Argomenti non validi: devono essere un oggetto JSON.");
        correzioni += 1;
        ultimoErrore = "argomenti dello strumento non validi";
        continue;
      }

      if (tc.function.name === "chiedi_chiarimento") {
        const domanda = typeof args.domanda === "string" ? args.domanda.trim() : "";
        if (domanda) return { voce: { chiarimento: domanda }, ultimoErrore };
        rispondi("La domanda e' vuota.");
        continue;
      }

      if (tc.function.name === "elenca_valori") {
        const dimensione = String(args.dimensione ?? "") as Dimensione;
        if (!DIMENSIONI[dimensione]) {
          rispondi(`Dimensione "${String(args.dimensione)}" non esiste. Esistenti: ${Object.keys(DIMENSIONI).join(", ")}.`);
          continue;
        }
        const elenco = elencaValoriDimensione(snapshot, dimensione, {
          contiene: typeof args.contiene === "string" ? args.contiene : undefined,
          massimo: 30,
        });
        rispondi(JSON.stringify(elenco));
        continue;
      }

      if (tc.function.name === "proponi_misura") {
        try {
          const validata = validaMisura({ nome: args.nome, espressione: args.espressione });
          const normalizzata = normalizzaValoriFiltri(validata, snapshot);
          const prova = provaMisura(normalizzata, snapshot);
          return {
            voce: {
              misura: normalizzata,
              misuraValida: normalizzata,
              prova,
              descrizione: descriviMisura(normalizzata),
              nota: typeof args.nota === "string" && args.nota.trim() ? args.nota.trim() : undefined,
            },
            ultimoErrore,
          };
        } catch (e) {
          if (!(e instanceof SpecNonValida)) throw e;
          correzioni += 1;
          ultimoErrore = e.message;
          rispondi(`Misura non valida: ${e.message}${e.suggerimento ? ` ${e.suggerimento}` : ""}`);
          if (correzioni > MAX_CORREZIONI) return { ultimoErrore };
          continue;
        }
      }

      rispondi(`Strumento "${tc.function.name}" non disponibile.`);
      correzioni += 1;
    }
  }
  return { ultimoErrore };
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrata
// ─────────────────────────────────────────────────────────────────────────────

export async function proponiMisura(opzioni: {
  testo: string;
  snapshot: Snapshot;
  /** Chiave stabile del perimetro dell'utente (vedi `chiaveStabile`). */
  chiavePerimetro: string;
  chiama: ChiamaModello;
}): Promise<EsitoProposta> {
  const richiesta = normalizzaRichiesta(opzioni.testo);
  if (richiesta.length < 8) {
    throw new SpecNonValida("Descrivi la misura con qualche parola in più.");
  }
  const { snapshot, chiama } = opzioni;
  const chiave = `${versioneCatalogo()}|${opzioni.chiavePerimetro}|${richiesta.toLowerCase()}`;
  const nessunConsumo: ConsumoProposta = { tokenIngresso: 0, tokenUscita: 0, costoUsd: 0 };

  // Dalla cache si riparte dalla definizione, non dal risultato: si rivalida e
  // si riprova sui dati correnti. Se non regge piu', si rifa' da capo.
  const inCache = cacheProposte.leggi(chiave);
  if (inCache?.chiarimento) {
    return { tipo: "chiarimento", chiarimento: inCache.chiarimento, modelli: [], escalato: false, consumo: nessunConsumo, dalCache: true };
  }
  if (inCache?.misura) {
    try {
      const misura = normalizzaValoriFiltri(validaMisura(inCache.misura), snapshot);
      return {
        tipo: "misura",
        misura,
        descrizione: descriviMisura(misura),
        nota: inCache.nota,
        prova: provaMisura(misura, snapshot),
        modelli: [],
        escalato: false,
        consumo: nessunConsumo,
        dalCache: true,
      };
    } catch (e) {
      if (!(e instanceof SpecNonValida)) throw e;
    }
  }

  const acc: Accumulo = { ingresso: 0, uscita: 0, costoUsd: 0 };
  const modelli: string[] = [];

  const primo = await tentativo(MODELLI.leggero, richiesta, snapshot, chiama, acc, null);
  modelli.push(MODELLI.leggero.nome);
  let esito = primo;
  let escalato = false;
  if (!primo.voce) {
    escalato = true;
    esito = await tentativo(MODELLI.standard, richiesta, snapshot, chiama, acc, primo.ultimoErrore);
    modelli.push(MODELLI.standard.nome);
  }

  const consumo: ConsumoProposta = {
    tokenIngresso: acc.ingresso,
    tokenUscita: acc.uscita,
    costoUsd: Math.round(acc.costoUsd * 1e6) / 1e6,
  };

  if (!esito.voce) {
    throw new PropostaFallita(
      `Non sono riuscito a tradurre la richiesta in una misura valida (${esito.ultimoErrore}). Prova a riformularla.`,
      consumo,
      modelli
    );
  }

  if (esito.voce.chiarimento) {
    cacheProposte.scrivi(chiave, { chiarimento: esito.voce.chiarimento });
    return { tipo: "chiarimento", chiarimento: esito.voce.chiarimento, modelli, escalato, consumo, dalCache: false };
  }

  cacheProposte.scrivi(chiave, { misura: esito.voce.misuraValida, nota: esito.voce.nota });
  return {
    tipo: "misura",
    misura: esito.voce.misuraValida,
    descrizione: esito.voce.descrizione,
    nota: esito.voce.nota,
    prova: esito.voce.prova,
    modelli,
    escalato,
    consumo,
    dalCache: false,
  };
}
