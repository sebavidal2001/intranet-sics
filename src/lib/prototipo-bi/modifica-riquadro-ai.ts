/**
 * MODIFICA DI UN RIQUADRO A PAROLE — l'assistente.
 *
 * Riceve la richiesta in italiano e lo stato attuale del riquadro, e risponde
 * con un ELENCO DI OPERAZIONI (vocabolario chiuso, vedi `modifica-riquadro.ts`).
 * Non scrive spec, non calcola niente: i numeri del nuovo riquadro li calcola il
 * motore quando l'utente guarda il "dopo".
 *
 * Tre esiti oltre alla modifica: una DOMANDA (richiesta ambigua in un punto che
 * cambia il risultato), un RIFIUTO motivato (cosa non esiste fra le operazioni:
 * colori, classifiche «primi 10», ...) e «gia' cosi'».
 *
 * Costo: stesso schema delle misure (`assistente-comune.ts`): bozza col modello
 * leggero, correzioni guidate dal validatore, standard una volta sola. Niente
 * cache: la risposta dipende dallo stato del riquadro, che cambia a ogni passo.
 */

import {
  conEscalation,
  nuovoAccumulo,
  tentativo,
  type ChiamaModello,
  type ConsumoAssistente,
  type EsitoStrumento,
} from "./assistente-comune";
import {
  NOMI_OPERAZIONI,
  applicaOperazioni,
  validaOperazioni,
  type OperazioneRiquadro,
  type StatoRiquadro,
} from "./modifica-riquadro";
import { chiaveDellaSpec } from "./misure-vocabolario";
import { descriviMisura } from "./misure";
import { NOMI_GRAFICI } from "./scelta-grafico";
import { CATALOGO, DIMENSIONI, SpecNonValida, elencaValoriDimensione } from "./semantico";
import { BUSINESS_UNIT } from "./business-unit";
import type { Dimensione, MisuraDefinita, Snapshot } from "./tipi";
import type { Modello } from "./modelli";

const MAX_CARATTERI_RICHIESTA = 500;

export interface EsitoModificaAi {
  tipo: "modifica" | "invariato" | "chiarimento" | "non_possibile";
  /** Il nuovo stato, solo per `modifica`. */
  stato?: StatoRiquadro;
  /** Una riga per operazione, per approvarla prima di applicarla. */
  riepilogo?: string[];
  /** Cio' che non si applica a qualche serie, e perche'. */
  ignorati?: string[];
  /** Le operazioni, per il registro e per chi vuole rileggerle. */
  operazioni?: OperazioneRiquadro[];
  spiegazione?: string;
  chiarimento?: string;
  motivo?: string;
  modelli: string[];
  escalato: boolean;
  consumo: ConsumoAssistente;
}

export class ModificaFallita extends Error {
  constructor(messaggio: string, readonly consumo: ConsumoAssistente, readonly modelli: string[]) {
    super(messaggio);
    this.name = "ModificaFallita";
  }
}

export function normalizzaRichiestaModifica(testo: string): string {
  return testo.replace(/\s+/gu, " ").trim().slice(0, MAX_CARATTERI_RICHIESTA);
}

// ─────────────────────────────────────────────────────────────────────────────
// Istruzioni, stato e strumenti
// ─────────────────────────────────────────────────────────────────────────────

export function istruzioniModifica(definizioni: Record<string, MisuraDefinita>): string {
  const metriche = Object.values(CATALOGO)
    .map((m) => `- ${m.chiave} [${m.unita}]: ${m.etichetta}. ${m.descrizione}`)
    .join("\n");
  const misure = Object.entries(definizioni)
    .map(([chiave, d]) => `- ${chiave}: «${d.nome}» = ${descriviMisura(d)}`)
    .join("\n");
  const dimensioni = Object.entries(DIMENSIONI)
    .map(([chiave, d]) => `${chiave} (${d.etichetta})`)
    .join(", ");

  return `Sei l'assistente che aiuta a MODIFICARE UN RIQUADRO di una dashboard del BI di SICS.
L'utente ti descrive in italiano cosa cambiare; tu rispondi con un elenco di OPERAZIONI da un vocabolario chiuso. Non scrivi spec, non calcoli numeri: dopo, il sistema ricalcola il riquadro e l'utente vede il prima e il dopo prima di confermare.

OPERAZIONI
- {"op":"aggiungi_confronto","tipo":"anno_precedente"}  aggiunge la serie «Anno precedente» (stessa misura, stesso periodo spostato di un anno). tipo può essere anche "progressivo"
- {"op":"aggiungi_serie","metrica":"fatturato","ruolo":"confronto"}  aggiunge un'altra metrica (o una misura personalizzata) allo stesso riquadro. ruolo: confronto | obiettivo | soglia; di default confronto, e obiettivo per budget, soglia per bep
- {"op":"togli_serie","nome":"Budget"}  oppure {"op":"togli_serie","ruolo":"obiettivo"}. La serie principale NON si toglie
- {"op":"imposta_misura_principale","metrica":"fatturato"}  cambia la misura principale
- {"op":"imposta_filtro","campo":"cliente","valore":"Boni"}  filtra tutto il riquadro (operatore eq; con più valori "valore":["a","b"] e operatore in; oppure neq, contiene). Sostituisce un filtro precedente sulla stessa dimensione
- {"op":"togli_filtro","campo":"cliente"}
- {"op":"imposta_suddivisione","dimensioni":["bu","agente"]}  al massimo due; [] = solo il totale
- {"op":"imposta_granularita","granularita":"mese"}  giorno | settimana | mese | anno, oppure null per togliere l'andamento nel tempo
- {"op":"imposta_periodo","anno":2025}  oppure "anni":[2024,2025], oppure "dal":"2026-01-01","al":"2026-06-30", oppure "eredita":true per seguire il periodo della dashboard
- {"op":"imposta_grafico","tipo":"barre"}  tipi: ${Object.keys(NOMI_GRAFICI).join(", ")}, oppure "automatico"
- {"op":"imposta_titolo","titolo":"..."}

REGOLE TASSATIVE
1. Fai SOLO quello che l'utente chiede. Non cambiare altro «per migliorare» il riquadro.
2. Una richiesta può chiedere più cose: dai tutte le operazioni in un'unica chiamata (massimo 8).
3. «Confronto con l'anno scorso» è aggiungi_confronto, NON un cambio di periodo. «Togli il budget» è togli_serie sulla serie che si chiama così fra quelle attuali.
4. I valori dei filtri devono esistere nei dati dell'utente. Se non sei sicuro della grafia, o non sai se «Boni» è un cliente o un agente, usa elenca_valori PRIMA (anche su più dimensioni). Se resta ambiguo in un modo che cambia il risultato, usa chiedi_chiarimento. Le business unit sono: ${BUSINESS_UNIT.join(", ")}.
5. Budget e BEP esistono solo per business unit e agente: non si suddividono per altro e non si filtrano per cliente. Se la richiesta li metterebbe in conflitto, togli la serie o chiedi.
6. Se la richiesta chiede qualcosa che le operazioni non sanno fare (colori, ordinamento, «i primi dieci», esportare, creare un riquadro nuovo), usa rifiuta_richiesta spiegando in una frase cosa non si può fare e cosa si può.
7. Se il riquadro è già come richiesto, usa modifica_riquadro comunque: il sistema lo riconosce.
8. Rispondi SEMPRE e SOLO chiamando uno strumento: modifica_riquadro, chiedi_chiarimento, rifiuta_richiesta oppure elenca_valori.

METRICHE
${metriche}
${misure ? `\nMISURE PERSONALIZZATE (si usano come le metriche, con la chiave o con il nome)\n${misure}\n` : ""}
DIMENSIONI
${dimensioni}`;
}

/** Lo stato del riquadro come lo legge il modello: compatto e senza campi di resa. */
export function descriviStatoPerModello(stato: StatoRiquadro): string {
  const serie = stato.serie.map((s) => ({
    nome: s.nome,
    ruolo: s.ruolo,
    metrica: s.spec.misura ? chiaveDellaSpec(s.spec) : s.spec.metrica,
    ...(s.spec.misura ? { misura: s.spec.misura.nome } : {}),
    modificatore: s.spec.modificatore ?? "corrente",
    suddivisione: s.spec.raggruppa ?? [],
    granularita: s.spec.granularita ?? null,
    periodo: s.spec.periodo ?? "eredita dalla dashboard",
    filtri: (s.spec.filtri ?? []).map((f) => ({ campo: f.campo, op: f.op, valore: f.valore })),
  }));
  return JSON.stringify({ titolo: stato.titolo, grafico: stato.grafico ?? "automatico", serie });
}

const STRUMENTI = [
  {
    type: "function",
    function: {
      name: "modifica_riquadro",
      description:
        "Propone le operazioni da applicare al riquadro. Vengono validate sullo stato reale: se qualcosa non va ricevi il motivo e puoi correggere.",
      parameters: {
        type: "object",
        properties: {
          operazioni: {
            type: "array",
            description: `Da 1 a 8 operazioni. Ogni operazione e' un oggetto con "op" fra: ${NOMI_OPERAZIONI.join(", ")}.`,
            items: { type: "object" },
          },
          spiegazione: { type: "string", description: "Una frase: cosa hai capito e, se c'e', cosa hai scelto fra due letture." },
        },
        required: ["operazioni"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "chiedi_chiarimento",
      description: "Fa UNA domanda quando la richiesta e' ambigua in un punto che cambia il risultato.",
      parameters: { type: "object", properties: { domanda: { type: "string" } }, required: ["domanda"] },
    },
  },
  {
    type: "function",
    function: {
      name: "rifiuta_richiesta",
      description: "Spiega in una frase che la richiesta non e' fra le cose che si possono fare qui, e cosa invece si puo' fare.",
      parameters: { type: "object", properties: { motivo: { type: "string" } }, required: ["motivo"] },
    },
  },
  {
    type: "function",
    function: {
      name: "elenca_valori",
      description: "Elenca i valori che una dimensione contiene davvero nei dati dell'utente. Usalo prima di filtrare su un nome.",
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
// Un tentativo con un modello
// ─────────────────────────────────────────────────────────────────────────────

type Voce =
  | { tipo: "modifica"; stato: StatoRiquadro; riepilogo: string[]; ignorati: string[]; operazioni: OperazioneRiquadro[]; spiegazione?: string }
  | { tipo: "invariato"; ignorati: string[]; spiegazione?: string }
  | { tipo: "chiarimento"; chiarimento: string }
  | { tipo: "non_possibile"; motivo: string };

function tentaConModello(
  modello: Modello,
  richiesta: string,
  stato: StatoRiquadro,
  snapshot: Snapshot,
  definizioni: Record<string, MisuraDefinita>,
  chiama: ChiamaModello,
  acc: ReturnType<typeof nuovoAccumulo>,
  indizio: string | null
) {
  const oggi = new Date().toISOString().slice(0, 10);
  return tentativo<Voce>({
    modello,
    chiama,
    acc,
    strumenti: STRUMENTI,
    ultimoErroreIniziale: indizio,
    messaggi: [
      { role: "system", content: istruzioniModifica(definizioni) },
      {
        role: "user",
        content:
          `Richiesta dell'utente: «${richiesta}»\n\n` +
          `Stato attuale del riquadro (JSON):\n${descriviStatoPerModello(stato)}\n\n` +
          `Oggi: ${oggi}. I dati vanno dal ${snapshot.dataMinima ?? "?"} al ${snapshot.dataMassima ?? "?"}.` +
          (indizio ? `\n\nUn primo tentativo non ha prodotto una modifica valida. Motivo: ${indizio}` : ""),
      },
    ],
    gestisci: (nome, args): EsitoStrumento<Voce> => {
      if (nome === "chiedi_chiarimento") {
        const domanda = typeof args.domanda === "string" ? args.domanda.trim() : "";
        return domanda ? { fine: { tipo: "chiarimento", chiarimento: domanda } } : { risposta: "La domanda e' vuota." };
      }
      if (nome === "rifiuta_richiesta") {
        const motivo = typeof args.motivo === "string" ? args.motivo.trim() : "";
        return motivo ? { fine: { tipo: "non_possibile", motivo } } : { risposta: "Il motivo e' vuoto." };
      }
      if (nome === "elenca_valori") {
        const dimensione = String(args.dimensione ?? "") as Dimensione;
        if (!DIMENSIONI[dimensione]) {
          return { risposta: `Dimensione "${String(args.dimensione)}" non esiste. Esistenti: ${Object.keys(DIMENSIONI).join(", ")}.` };
        }
        return {
          risposta: JSON.stringify(
            elencaValoriDimensione(snapshot, dimensione, {
              contiene: typeof args.contiene === "string" ? args.contiene : undefined,
              massimo: 30,
            })
          ),
        };
      }
      if (nome === "modifica_riquadro") {
        try {
          const operazioni = validaOperazioni(args.operazioni);
          const esito = applicaOperazioni(stato, operazioni, { snapshot, definizioni });
          const spiegazione = typeof args.spiegazione === "string" && args.spiegazione.trim() ? args.spiegazione.trim() : undefined;
          if (esito.invariato) return { fine: { tipo: "invariato", ignorati: esito.ignorati, spiegazione } };
          return {
            fine: {
              tipo: "modifica",
              stato: esito.stato,
              riepilogo: esito.riepilogo,
              ignorati: esito.ignorati,
              operazioni,
              spiegazione,
            },
          };
        } catch (e) {
          if (!(e instanceof SpecNonValida)) throw e;
          return {
            risposta: `Modifica non valida: ${e.message}${e.suggerimento ? ` ${e.suggerimento}` : ""}`,
            errore: e.message,
          };
        }
      }
      return { risposta: `Strumento "${nome}" non disponibile.`, errore: "strumento non disponibile" };
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Entrata
// ─────────────────────────────────────────────────────────────────────────────

export async function proponiModifica(opzioni: {
  testo: string;
  stato: StatoRiquadro;
  snapshot: Snapshot;
  definizioni: Record<string, MisuraDefinita>;
  chiama: ChiamaModello;
}): Promise<EsitoModificaAi> {
  const richiesta = normalizzaRichiestaModifica(opzioni.testo);
  if (richiesta.length < 5) throw new SpecNonValida("Descrivi la modifica con qualche parola in più.");
  const { stato, snapshot, definizioni, chiama } = opzioni;

  const acc = nuovoAccumulo();
  const esito = await conEscalation<Voce>(acc, (modello, indizio) =>
    tentaConModello(modello, richiesta, stato, snapshot, definizioni, chiama, acc, indizio)
  );

  if (!esito.valore) {
    throw new ModificaFallita(
      `Non sono riuscito a tradurre la richiesta in una modifica valida (${esito.ultimoErrore}). Prova a riformularla.`,
      esito.consumo,
      esito.modelli
    );
  }
  return { ...esito.valore, modelli: esito.modelli, escalato: esito.escalato, consumo: esito.consumo };
}
