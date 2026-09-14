/**
 * ESECUZIONE DELLE ANALISI COMPOSITE.
 *
 * Le serie di uno stesso riquadro condividono un solo viaggio di rete. I filtri
 * della pagina vengono fusi prima di costruire il batch, così nessuna misura
 * resta silenziosamente ferma quando cambia il contesto della dashboard.
 */

import { fondiFiltriPaginaConEsito, type FiltriPagina } from "./filtri-pagina";
import { SpecNonValida, validaSpec } from "./semantico";
import type {
  Dimensione,
  RisultatoQuery,
  RuoloSerie,
  SerieAnalisi,
  SerieAnalisiEseguita,
  SpecQuery,
} from "./tipi";

/**
 * Le dimensioni su cui il budget è definito.
 *
 * La serie budget viene dagli Excel aziendali e contiene **solo** area
 * (business unit) e agente. `budget-fonte.ts` ignora in silenzio qualunque
 * altro raggruppamento: chiedere il budget per cliente non dà errore, dà il
 * budget TOTALE su una riga sola.
 *
 * Affiancato a un "ordinato per cliente" produrrebbe venti barre di ordinato e
 * una barra di budget da cinque milioni: un confronto che sembra legittimo e
 * non significa niente. Meglio non offrire la scorciatoia che offrirla e
 * mentire.
 */
const DIMENSIONI_CON_BUDGET: readonly Dimensione[] = ["bu", "agente"];

/** Se a questa spec si può affiancare il budget o il BEP. */
export function ammetteConfrontoBudget(spec: SpecQuery): boolean {
  const raggruppa = spec.raggruppa ?? [];
  return raggruppa.every((d) => DIMENSIONI_CON_BUDGET.includes(d));
}

/** Perché non si può, da mostrare all'utente al posto del pulsante. */
export function motivoBudgetNonDisponibile(spec: SpecQuery): string | null {
  if (ammetteConfrontoBudget(spec)) return null;
  const fuori = (spec.raggruppa ?? []).filter((d) => !DIMENSIONI_CON_BUDGET.includes(d));
  return (
    `Il budget è definito solo per business unit e agente: non esiste per ${fuori.join(" e ")}. ` +
    "Togli quel raggruppamento per confrontarlo."
  );
}

const RUOLI_SERIE: readonly RuoloSerie[] = ["principale", "confronto", "obiettivo", "soglia"];
const COLORE_ESAGONALE = /^#[0-9a-fA-F]{6}$/u;

export interface AnalisiEseguibile {
  spec: SpecQuery;
  serie?: SerieAnalisi[] | null;
}

export interface SerieAnalisiPreparata extends SerieAnalisi {
  id: string;
  filtriPaginaIgnorati: Dimensione[];
  periodoIgnorato: boolean;
}

export type RisultatiAnalisiIndicizzati = Partial<
  Record<RuoloSerie, Record<string, RisultatoQuery>>
>;

export interface EsitoAnalisiComposita {
  serie: SerieAnalisiEseguita[];
  risultati: RisultatiAnalisiIndicizzati;
  filtriPaginaIgnorati: Dimensione[];
  periodoIgnorato: boolean;
}

interface VoceRispostaBatch {
  id: string;
  risultato?: RisultatoQuery;
  errore?: string;
}

function eOggetto(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore);
}

function ruoloValido(valore: unknown): valore is RuoloSerie {
  return typeof valore === "string" && RUOLI_SERIE.includes(valore as RuoloSerie);
}

/** Valida anche la presenza della principale, perché senza non esiste una base di confronto. */
export function validaSerieAnalisi(valore: unknown): SerieAnalisi[] {
  if (!Array.isArray(valore) || valore.length === 0) {
    throw new SpecNonValida("Le serie devono essere un elenco non vuoto.");
  }

  const serie = valore.map((voce, indice): SerieAnalisi => {
    if (!eOggetto(voce) || !ruoloValido(voce.ruolo)) {
      throw new SpecNonValida(`Ruolo non valido nella serie ${indice + 1}.`);
    }
    const nome = typeof voce.nome === "string" ? voce.nome.trim() : "";
    if (!nome) throw new SpecNonValida(`Nome obbligatorio nella serie ${indice + 1}.`);
    if (
      voce.colore !== undefined &&
      (typeof voce.colore !== "string" || !COLORE_ESAGONALE.test(voce.colore))
    ) {
      throw new SpecNonValida(
        `Colore non valido nella serie ${indice + 1}: usa il formato #rrggbb.`
      );
    }
    return {
      ruolo: voce.ruolo,
      nome,
      ...(typeof voce.colore === "string" ? { colore: voce.colore } : {}),
      spec: validaSpec(voce.spec),
    };
  });

  if (!serie.some((voce) => voce.ruolo === "principale")) {
    throw new SpecNonValida("Un'analisi composita deve avere almeno una serie principale.");
  }
  return serie;
}

/** I record storici senza `serie` diventano in memoria una sola principale. */
export function serieEffettiveAnalisi(analisi: AnalisiEseguibile): SerieAnalisi[] {
  if (analisi.serie === null || analisi.serie === undefined) {
    const spec = validaSpec(analisi.spec);
    return [{ ruolo: "principale", nome: spec.metrica, spec }];
  }
  return validaSerieAnalisi(analisi.serie);
}

export function preparaEsecuzioneAnalisi(
  analisi: AnalisiEseguibile,
  filtriPagina: FiltriPagina = {},
  prefissoId = "serie"
): SerieAnalisiPreparata[] {
  const serie = serieEffettiveAnalisi(analisi);
  const idSemplice = serie.length === 1 && (analisi.serie === null || analisi.serie === undefined);

  return serie.map((voce, indice) => {
    const fusione = fondiFiltriPaginaConEsito(voce.spec, filtriPagina);
    return {
      ...voce,
      spec: fusione.spec,
      id: idSemplice ? prefissoId : `${prefissoId}:${indice}`,
      filtriPaginaIgnorati: fusione.filtriPaginaIgnorati,
      periodoIgnorato: fusione.periodoIgnorato,
    };
  });
}

export function indicizzaRisultatiSerie(
  serie: SerieAnalisiEseguita[]
): RisultatiAnalisiIndicizzati {
  const risultati: RisultatiAnalisiIndicizzati = {};
  for (const voce of serie) {
    const perRuolo = risultati[voce.ruolo] ?? {};
    perRuolo[voce.nome] = voce.risultato;
    risultati[voce.ruolo] = perRuolo;
  }
  return risultati;
}

/** Esegue un'analisi intera con una sola POST batch, anche quando è semplice. */
export async function eseguiAnalisiComposita(
  analisi: AnalisiEseguibile,
  filtriPagina: FiltriPagina = {},
  opzioni: {
    signal?: AbortSignal;
    fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  } = {}
): Promise<EsitoAnalisiComposita> {
  const preparate = preparaEsecuzioneAnalisi(analisi, filtriPagina);
  const fetcher = opzioni.fetcher ?? fetch;
  const risposta = await fetcher("/api/bi/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      specs: preparate.map(({ id, spec }) => ({ id, spec })),
    }),
    signal: opzioni.signal,
  });
  const corpo: unknown = await risposta.json();
  if (!risposta.ok) {
    const messaggio = eOggetto(corpo) && typeof corpo.error === "string"
      ? corpo.error
      : "Non riesco a calcolare questo riquadro.";
    throw new Error(messaggio);
  }
  if (!eOggetto(corpo) || !Array.isArray(corpo.risultati)) {
    throw new Error("Il motore ha restituito una risposta batch incompleta.");
  }

  const voci = corpo.risultati.filter(eOggetto).map((voce): VoceRispostaBatch => ({
    id: typeof voce.id === "string" ? voce.id : "",
    risultato: eOggetto(voce.risultato)
      ? (voce.risultato as unknown as RisultatoQuery)
      : undefined,
    errore: typeof voce.errore === "string" ? voce.errore : undefined,
  }));
  const perId = new Map(voci.map((voce) => [voce.id, voce]));
  const eseguite = preparate.map((preparata): SerieAnalisiEseguita => {
    const voce = perId.get(preparata.id);
    if (!voce?.risultato) {
      throw new Error(voce?.errore ?? `Risultato mancante per la serie ${preparata.nome}.`);
    }
    return {
      ruolo: preparata.ruolo,
      nome: preparata.nome,
      colore: preparata.colore,
      spec: preparata.spec,
      risultato: voce.risultato,
    };
  });

  return {
    serie: eseguite,
    risultati: indicizzaRisultatiSerie(eseguite),
    filtriPaginaIgnorati: [
      ...new Set(preparate.flatMap((voce) => voce.filtriPaginaIgnorati)),
    ],
    periodoIgnorato: preparate.some((voce) => voce.periodoIgnorato),
  };
}
