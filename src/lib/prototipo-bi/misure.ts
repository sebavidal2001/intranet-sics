/**
 * MISURE PERSONALIZZATE.
 *
 * Una misura e' una definizione DICHIARATIVA composta da metriche gia'
 * certificate: l'utente (o l'AI per lui) sceglie fra cinque operatori, non
 * scrive formule. Ogni operando e' una metrica del catalogo con filtri
 * incorporati; i numeri li calcola sempre `esegui()` sulle foglie, e qui si
 * combinano soltanto i risultati.
 *
 * Tre conseguenze volute:
 *
 *  1. IL PERIMETRO SI EREDITA. Le foglie girano sullo stesso snapshot gia'
 *     perimetrato: una misura non puo' leggere fuori dal perimetro di chi la
 *     esegue, qualunque cosa dica la sua definizione.
 *  2. LE AVVERTENZE SI PROPAGANO. Gli `avvisi` di ogni foglia (copertura dei
 *     costi del margine, dati che partono da una certa data...) finiscono nel
 *     risultato della misura, piu' quelle proprie della combinazione (date di
 *     riferimento diverse fra dataset).
 *  3. NIENTE NUMERI INVENTATI. Un gruppo in cui il denominatore manca o vale
 *     zero NON diventa 0%: viene escluso e il risultato lo dichiara.
 *
 * La definizione viaggia INCORPORATA nella spec (`SpecQuery.misura`), con id e
 * versione di provenienza: `esegui()` resta puro e sincrono, e una misura
 * funziona identica in dashboard, Excel e Word senza consultare il database.
 * Modificare la misura salvata non cambia le dashboard che ne hanno una copia:
 * e' una scelta (le dashboard assegnate non cambiano numeri da sole).
 *
 * Il modulo e' in ciclo con `semantico.ts` (che lo chiama da `validaSpec` e
 * `esegui`): tutto l'uso reciproco avviene a chiamata, mai al caricamento.
 */

import {
  CATALOGO,
  DIMENSIONI,
  SpecNonValida,
  dimensioneFuoriDominio,
  esegui,
  validaSpec,
} from "./semantico";
import { dimensioniPerMetrica } from "./tassonomia";
import type {
  ChiaveMetrica,
  Dimensione,
  EspressioneMisura,
  Filtro,
  MisuraDefinita,
  OperandoMisura,
  Periodo,
  RigaRisultato,
  RisultatoQuery,
  Snapshot,
  SpecQuery,
  UnitaMisura,
} from "./tipi";

// ─────────────────────────────────────────────────────────────────────────────
// Regole
// ─────────────────────────────────────────────────────────────────────────────

const NOME_MIN = 3;
const NOME_MAX = 80;
const MAX_FILTRI_PER_OPERANDO = 6;
const MAX_ADDENDI = 4;

type Famiglia = "vendite" | "acquisti" | "visite";

function famigliaDi(metrica: ChiaveMetrica): Famiglia {
  const dataset = CATALOGO[metrica].dataset;
  if (dataset === "acquisti") return "acquisti";
  if (dataset === "visite") return "visite";
  return "vendite";
}

/** Aggregazioni che si possono sommare fra gruppi e dare per assenti = zero. */
function eAdditiva(metrica: ChiaveMetrica): boolean {
  const a = CATALOGO[metrica].aggregazione;
  return a === "somma" || a === "conta_documenti" || a === "conta_righe";
}

/** Che cosa significa la data di riga, per dataset: serve all'avviso sui confronti. */
const SIGNIFICATO_DATA: Record<string, string> = {
  ordinato: "data dell'ordine",
  fatturato: "data della fattura",
  consegnato: "data della consegna",
  portafoglio: "ordini ancora da consegnare",
  consegnato_futuro_per_mese: "consegne future per mese previsto",
  preventivi_aperti: "data del preventivo",
  controllo_banco: "data del movimento al banco",
  acquisti: "data dell'ordine al fornitore",
  visite: "data della visita",
};

const ETICHETTA_DATASET: Record<string, string> = {
  ordinato: "ordinato",
  fatturato: "fatturato",
  consegnato: "consegnato",
  portafoglio: "portafoglio",
  consegnato_futuro_per_mese: "consegne future",
  preventivi_aperti: "preventivi",
  controllo_banco: "banco",
  acquisti: "acquisti",
  visite: "visite",
};

// ─────────────────────────────────────────────────────────────────────────────
// Lettura strutturale
// ─────────────────────────────────────────────────────────────────────────────

/** Gli operandi nell'ordine di valutazione (e di presentazione). */
export function operandiDellaMisura(espressione: EspressioneMisura): OperandoMisura[] {
  switch (espressione.tipo) {
    case "metrica":
      return [{ metrica: espressione.metrica, filtri: espressione.filtri }];
    case "rapporto":
      return [espressione.numeratore, espressione.denominatore];
    case "differenza":
      return [espressione.da, espressione.sottrai];
    case "somma":
      return espressione.addendi;
    case "quota":
      // Prima la parte (con i filtri della quota), poi il tutto (senza).
      return [
        { metrica: espressione.metrica, filtri: espressione.filtri },
        { metrica: espressione.metrica },
      ];
  }
}

/** La metrica che rappresenta la misura per chi non la conosce (drill-down, tassonomia). */
export function metricaRappresentativa(espressione: EspressioneMisura): ChiaveMetrica {
  return operandiDellaMisura(espressione)[0].metrica;
}

/** L'unita' del risultato. Assume un'espressione gia' validata. */
export function unitaDellaMisura(espressione: EspressioneMisura): UnitaMisura {
  switch (espressione.tipo) {
    case "metrica":
      return CATALOGO[espressione.metrica].unita;
    case "quota":
      return "percentuale";
    case "somma":
      return CATALOGO[espressione.addendi[0].metrica].unita;
    case "differenza":
      return CATALOGO[espressione.da.metrica].unita;
    case "rapporto": {
      const n = CATALOGO[espressione.numeratore.metrica].unita;
      const d = CATALOGO[espressione.denominatore.metrica].unita;
      return n === d ? "percentuale" : "euro";
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validazione
// ─────────────────────────────────────────────────────────────────────────────

function eOggetto(valore: unknown): valore is Record<string, unknown> {
  return typeof valore === "object" && valore !== null && !Array.isArray(valore);
}

function elencoMetriche(): string {
  return Object.keys(CATALOGO)
    .filter((k) => k !== "budget" && k !== "bep")
    .join(", ");
}

function validaOperando(grezzo: unknown, dove: string, conFiltriObbligatori = false): OperandoMisura {
  if (!eOggetto(grezzo)) throw new SpecNonValida(`Operando mancante: ${dove}.`);
  const metrica = String(grezzo.metrica ?? "") as ChiaveMetrica;
  if (!CATALOGO[metrica]) {
    throw new SpecNonValida(
      `Metrica "${String(grezzo.metrica)}" non esiste (${dove}).`,
      `Disponibili: ${elencoMetriche()}. Se nessuna esprime la domanda, dillo invece di ripiegare su una vicina.`
    );
  }
  if (metrica === "budget" || metrica === "bep") {
    throw new SpecNonValida(
      `Budget e BEP non si usano nelle misure personalizzate (${dove}).`,
      "Il budget esiste solo per business unit e agente: per un confronto col budget usa la serie «obiettivo» del riquadro."
    );
  }
  const grezziFiltri = grezzo.filtri === undefined ? [] : grezzo.filtri;
  if (!Array.isArray(grezziFiltri)) throw new SpecNonValida(`I filtri devono essere un elenco (${dove}).`);
  if (grezziFiltri.length > MAX_FILTRI_PER_OPERANDO) {
    throw new SpecNonValida(`Troppi filtri (${grezziFiltri.length}) su un operando (${dove}): massimo ${MAX_FILTRI_PER_OPERANDO}.`);
  }
  // I filtri passano dal validatore delle spec: stesso vocabolario, stessi rifiuti.
  const filtri = validaSpec({ metrica, filtri: grezziFiltri }).filtri ?? [];
  for (const f of filtri) {
    const vuoto = Array.isArray(f.valore) ? f.valore.length === 0 : String(f.valore).trim() === "";
    if (vuoto) {
      throw new SpecNonValida(
        `Il filtro su "${f.campo}" non ha un valore (${dove}).`,
        "Un filtro senza valore non restringe niente: indica il valore o toglilo."
      );
    }
  }
  if (conFiltriObbligatori && filtri.length === 0) {
    throw new SpecNonValida(
      `La quota ha bisogno di almeno un filtro (${dove}).`,
      "Una quota senza filtro varrebbe sempre 100%: indica a quale parte del totale ti riferisci."
    );
  }
  return filtri.length > 0 ? { metrica, filtri } : { metrica };
}

function validaEspressione(grezza: unknown): EspressioneMisura {
  if (!eOggetto(grezza)) throw new SpecNonValida("Espressione della misura assente.");
  const tipo = String(grezza.tipo ?? "");
  switch (tipo) {
    case "metrica": {
      const op = validaOperando(grezza, "metrica");
      return { tipo: "metrica", ...op };
    }
    case "rapporto": {
      const numeratore = validaOperando(grezza.numeratore, "numeratore");
      const denominatore = validaOperando(grezza.denominatore, "denominatore");
      const n = CATALOGO[numeratore.metrica].unita;
      const d = CATALOGO[denominatore.metrica].unita;
      const sensata = (n === d && (n === "euro" || n === "numero")) || (n === "euro" && d === "numero");
      if (!sensata) {
        throw new SpecNonValida(
          `Il rapporto fra «${CATALOGO[numeratore.metrica].etichetta}» (${n}) e «${CATALOGO[denominatore.metrica].etichetta}» (${d}) non ha un significato.`,
          "Ammessi: euro su euro e numero su numero (percentuale), euro su numero (euro per unità, es. fatturato per ordine)."
        );
      }
      return { tipo: "rapporto", numeratore, denominatore };
    }
    case "differenza": {
      const da = validaOperando(grezza.da, "primo termine");
      const sottrai = validaOperando(grezza.sottrai, "termine da sottrarre");
      const u1 = CATALOGO[da.metrica].unita;
      const u2 = CATALOGO[sottrai.metrica].unita;
      if (u1 !== u2) {
        throw new SpecNonValida(
          `Non si sottraggono unità diverse: «${CATALOGO[da.metrica].etichetta}» è in ${u1}, «${CATALOGO[sottrai.metrica].etichetta}» in ${u2}.`
        );
      }
      return { tipo: "differenza", da, sottrai };
    }
    case "somma": {
      if (!Array.isArray(grezza.addendi) || grezza.addendi.length < 2 || grezza.addendi.length > MAX_ADDENDI) {
        throw new SpecNonValida(`Una somma ha da 2 a ${MAX_ADDENDI} addendi.`);
      }
      const addendi = grezza.addendi.map((a, i) => validaOperando(a, `addendo ${i + 1}`));
      const unita = CATALOGO[addendi[0].metrica].unita;
      if (unita !== "euro" && unita !== "numero") {
        throw new SpecNonValida(`Non si sommano misure in ${unita}: la somma vale solo per euro e numeri.`);
      }
      for (const a of addendi) {
        if (CATALOGO[a.metrica].unita !== unita) {
          throw new SpecNonValida(
            `Non si sommano unità diverse: «${CATALOGO[addendi[0].metrica].etichetta}» è in ${unita}, «${CATALOGO[a.metrica].etichetta}» in ${CATALOGO[a.metrica].unita}.`
          );
        }
      }
      return { tipo: "somma", addendi };
    }
    case "quota": {
      const op = validaOperando(grezza, "quota", true);
      if (!eAdditiva(op.metrica)) {
        throw new SpecNonValida(
          `La quota non si calcola su «${CATALOGO[op.metrica].etichetta}»: è una media o una percentuale, e la quota di una media non ha significato.`,
          "Usa una metrica in euro o un conteggio (fatturato, ordinato, numero ordini...)."
        );
      }
      return { tipo: "quota", metrica: op.metrica, filtri: op.filtri ?? [] };
    }
    default:
      throw new SpecNonValida(
        `Operatore "${tipo}" non ammesso.`,
        "Operatori: metrica (con filtri), rapporto, differenza, somma, quota. Niente formule libere."
      );
  }
}

/** Valida e normalizza una misura. Errori in italiano, con suggerimento. */
export function validaMisura(grezza: unknown): MisuraDefinita {
  if (!eOggetto(grezza)) throw new SpecNonValida("Misura assente.");
  const nome = typeof grezza.nome === "string" ? grezza.nome.trim() : "";
  if (nome.length < NOME_MIN || nome.length > NOME_MAX) {
    throw new SpecNonValida(`Il nome della misura deve avere da ${NOME_MIN} a ${NOME_MAX} caratteri.`);
  }
  const espressione = validaEspressione(grezza.espressione);

  // Tutti gli operandi nella stessa famiglia: un fatturato a fornitore o una
  // visita per ordinato non hanno dimensioni in comune e darebbero gruppi vuoti.
  const operandi = operandiDellaMisura(espressione);
  const famiglie = new Set(operandi.map((o) => famigliaDi(o.metrica)));
  if (famiglie.size > 1) {
    throw new SpecNonValida(
      `Una misura non può mescolare ${[...famiglie].join(" e ")}: non hanno dimensioni in comune.`,
      "Usa operandi della stessa famiglia (vendite, acquisti oppure visite)."
    );
  }

  const misura: MisuraDefinita = { nome, espressione };
  if (typeof grezza.id === "string" && grezza.id.trim()) misura.id = grezza.id.trim();
  if (typeof grezza.versione === "number" && Number.isInteger(grezza.versione) && grezza.versione > 0) {
    misura.versione = grezza.versione;
  }
  return misura;
}

/**
 * Le dimensioni di raggruppamento e di filtro devono valere per OGNI operando.
 * Chiamata da `validaSpec` quando la spec porta una misura.
 */
function dimensioneAmmessaDaOperando(dimensione: Dimensione, metrica: ChiaveMetrica): boolean {
  return (
    dimensioniPerMetrica(metrica).includes(dimensione) ||
    (dimensione === "bu_categoria" && !dimensioneFuoriDominio(metrica, dimensione))
  );
}

/** Vero se la dimensione vale per TUTTI gli operandi della misura. */
export function dimensioneAmmessaDallaMisura(misura: MisuraDefinita, dimensione: Dimensione): boolean {
  return operandiDellaMisura(misura.espressione).every((o) => dimensioneAmmessaDaOperando(dimensione, o.metrica));
}

/** Le dimensioni per cui la misura si puo' raggruppare o filtrare (tutti gli operandi le ammettono). */
export function dimensioniDellaMisura(misura: MisuraDefinita): Dimensione[] {
  const multiDataset =
    new Set(operandiDellaMisura(misura.espressione).map((o) => CATALOGO[o.metrica].dataset)).size > 1;
  return (Object.keys(DIMENSIONI) as Dimensione[]).filter(
    (d) => dimensioneAmmessaDallaMisura(misura, d) && !(multiDataset && (d === "documento" || d === "documento_anno"))
  );
}

export function controllaDimensioniMisura(
  misura: MisuraDefinita,
  raggruppa: Dimensione[],
  filtri: Filtro[]
): void {
  const operandi = operandiDellaMisura(misura.espressione);
  const datasetDistinti = new Set(operandi.map((o) => CATALOGO[o.metrica].dataset));

  for (const dimensione of [...raggruppa, ...filtri.map((f) => f.campo)]) {
    for (const o of operandi) {
      if (!dimensioneAmmessaDaOperando(dimensione, o.metrica)) {
        throw new SpecNonValida(
          `La dimensione "${dimensione}" non vale per «${CATALOGO[o.metrica].etichetta}», usata dalla misura «${misura.nome}».`,
          `Per questa misura hanno senso: ${[...new Set(operandi.map((x) => dimensioniPerMetrica(x.metrica).join(",")))].join(" / ")}.`
        );
      }
    }
  }
  if (datasetDistinti.size > 1 && (raggruppa.includes("documento") || raggruppa.includes("documento_anno"))) {
    throw new SpecNonValida(
      `Una misura che combina dataset diversi non si raggruppa per documento: il numero del documento è di un altro dataset in ciascun operando.`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Descrizione a parole
// ─────────────────────────────────────────────────────────────────────────────

const NOMI_OPERATORI: Record<Filtro["op"], string> = {
  eq: "=",
  neq: "diverso da",
  in: "è fra",
  contiene: "contiene",
};

export function descriviFiltro(f: Filtro): string {
  const valore = Array.isArray(f.valore) ? f.valore.join(", ") : String(f.valore);
  return `${DIMENSIONI[f.campo].etichetta} ${NOMI_OPERATORI[f.op]} ${valore}`;
}

export function descriviOperando(o: OperandoMisura): string {
  const base = CATALOGO[o.metrica].etichetta;
  const filtri = o.filtri ?? [];
  return filtri.length === 0 ? base : `${base} (${filtri.map(descriviFiltro).join("; ")})`;
}

/** La misura in una frase, per mostrarla all'utente prima di salvarla. */
export function descriviMisura(misura: MisuraDefinita): string {
  const e = misura.espressione;
  switch (e.tipo) {
    case "metrica":
      return descriviOperando(e);
    case "rapporto": {
      const unita = unitaDellaMisura(e);
      const come = unita === "percentuale" ? "in percentuale" : "per unità";
      return `${descriviOperando(e.numeratore)} diviso ${descriviOperando(e.denominatore)}, ${come}`;
    }
    case "differenza":
      return `${descriviOperando(e.da)} meno ${descriviOperando(e.sottrai)}`;
    case "somma":
      return e.addendi.map(descriviOperando).join(" + ");
    case "quota":
      return `Quota di ${descriviOperando({ metrica: e.metrica, filtri: e.filtri })} sul totale di ${CATALOGO[e.metrica].etichetta} (stessi filtri della dashboard, senza quelli della quota)`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Esecuzione
// ─────────────────────────────────────────────────────────────────────────────

const arrotonda = (n: number) => Math.round(n * 100) / 100;

/**
 * Combina i valori degli operandi (stesso ordine di `operandiDellaMisura`).
 * `null` = non definito: il chiamante esclude il gruppo e lo dichiara.
 */
function combina(espressione: EspressioneMisura, v: Array<number | null>): number | null {
  if (v.some((x) => x === null)) return null;
  const n = v as number[];
  switch (espressione.tipo) {
    case "metrica":
      return n[0];
    case "somma":
      return n.reduce((a, b) => a + b, 0);
    case "differenza":
      return n[0] - n[1];
    case "rapporto": {
      if (n[1] === 0) return null;
      return unitaDellaMisura(espressione) === "percentuale" ? (n[0] / n[1]) * 100 : n[0] / n[1];
    }
    case "quota":
      return n[1] === 0 ? null : (n[0] / n[1]) * 100;
  }
}

function avvisoDatasetDiversi(operandi: OperandoMisura[]): string | null {
  const dataset = [...new Set(operandi.map((o) => CATALOGO[o.metrica].dataset))];
  if (dataset.length < 2) return null;
  const elenco = dataset
    .map((d) => `${ETICHETTA_DATASET[d] ?? d}: ${SIGNIFICATO_DATA[d] ?? "data propria del dataset"}`)
    .join("; ");
  return (
    "Questa misura combina dataset con date di riferimento diverse " +
    `(${elenco}). Nello stesso periodo si confrontano eventi diversi: ` +
    "ordini e fatture dello stesso mese non sono lo stesso business."
  );
}

/** Esegue una spec che porta una misura: le foglie girano su `esegui()`. */
export function eseguiMisura(spec: SpecQuery, snapshot: Snapshot): RisultatoQuery {
  const misura = validaMisura(spec.misura);
  if (spec.modificatore === "progressivo" || spec.modificatore === "progressivo_ap") {
    throw new SpecNonValida(
      "Il progressivo non è disponibile per le misure personalizzate.",
      "Usa 'corrente' o 'anno_precedente'; per il cumulato calcola il progressivo sulle metriche di base."
    );
  }

  const espressione = misura.espressione;
  const operandi = operandiDellaMisura(espressione);
  const additive = operandi.map((o) => eAdditiva(o.metrica));

  const foglie: RisultatoQuery[] = operandi.map((o) =>
    esegui(
      {
        metrica: o.metrica,
        modificatore: spec.modificatore,
        granularita: spec.granularita,
        raggruppa: spec.raggruppa,
        filtri: [...(spec.filtri ?? []), ...(o.filtri ?? [])],
        periodo: spec.periodo,
        ordina: "etichetta",
      },
      snapshot
    )
  );

  // ── Avvisi: quelli delle foglie, senza doppioni, piu' i propri ────────────
  const avvisi: string[] = [];
  const vista = new Set<string>();
  for (const f of foglie) {
    for (const a of f.avvisi) {
      if (!vista.has(a)) {
        vista.add(a);
        avvisi.push(a);
      }
    }
  }
  const diversi = avvisoDatasetDiversi(operandi);
  if (diversi) avvisi.push(diversi);

  // ── Gruppi: unione delle chiavi, combinazione riga per riga ────────────────
  const indicizzate = foglie.map((f) => new Map(f.righe.map((r) => [r.etichetta, r])));
  const etichette = new Set<string>();
  for (const m of indicizzate) for (const k of m.keys()) etichette.add(k);

  const righe: RigaRisultato[] = [];
  let esclusi = 0;
  for (const etichetta of etichette) {
    const valori = indicizzate.map((m, i) => {
      const r = m.get(etichetta);
      if (r) return r.valore;
      // Assente in un operando additivo = nessuna riga = zero. In una media o
      // in una percentuale = indefinito: il gruppo non si calcola.
      return additive[i] ? 0 : null;
    });
    const valore = combina(espressione, valori);
    if (valore === null) {
      esclusi += 1;
      continue;
    }
    const sorgente = indicizzate.map((m) => m.get(etichetta)).find((r) => r !== undefined)!;
    righe.push({
      etichetta,
      chiavi: sorgente.chiavi,
      valore: arrotonda(valore),
      conteggio: indicizzate[0].get(etichetta)?.conteggio ?? sorgente.conteggio,
    });
  }
  if (esclusi > 0) {
    avvisi.push(
      `${esclusi} ${esclusi === 1 ? "gruppo escluso" : "gruppi esclusi"}: il denominatore o un operando medio non esiste, ` +
        "e un valore indefinito non viene mostrato come zero."
    );
  }

  const ordina = spec.ordina ?? (spec.granularita ? "etichetta" : "valore_desc");
  righe.sort((a, b) => {
    if (ordina === "etichetta") return a.etichetta.localeCompare(b.etichetta);
    if (ordina === "valore_asc") return a.valore - b.valore;
    return b.valore - a.valore;
  });

  // ── Totale: combinato dai totali delle foglie (rapporto delle somme) ───────
  let totale = combina(espressione, foglie.map((f) => f.totale));
  if (totale === null) {
    totale = 0;
    avvisi.push("Il totale non è calcolabile: il denominatore vale zero.");
  }

  return {
    spec,
    metrica: spec.metrica,
    unita: unitaDellaMisura(espressione),
    righe: spec.limite ? righe.slice(0, spec.limite) : righe,
    totale: arrotonda(totale),
    certificata: true,
    avvisi,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prova su un periodo noto e controllo dei valori dei filtri
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Il periodo su cui provare una misura: l'ultimo anno COMPLETO nei dati, o
 * l'anno in corso se non ce ne sono. Cosi' chi la guarda confronta con un
 * numero che conosce.
 */
export function periodoDiProva(snapshot: Snapshot): Periodo {
  const max = Number((snapshot.dataMassima ?? "").slice(0, 4)) || new Date().getFullYear();
  const min = Number((snapshot.dataMinima ?? "").slice(0, 4)) || max;
  const completo = (snapshot.dataMassima ?? "") >= `${max}-12-15`;
  if (completo) return { anno: max };
  if (max - 1 >= min && (snapshot.dataMinima ?? "") <= `${max - 1}-01-01`) return { anno: max - 1 };
  return { anno: max };
}

export interface FogliaProva {
  descrizione: string;
  unita: UnitaMisura;
  valore: number;
}

export interface ProvaMisura {
  periodo: Periodo;
  risultato: RisultatoQuery;
  /** Il valore di ciascun operando sullo stesso periodo: serve a verificare a mano. */
  foglie: FogliaProva[];
}

export function provaMisura(
  misura: MisuraDefinita,
  snapshot: Snapshot,
  periodo: Periodo = periodoDiProva(snapshot)
): ProvaMisura {
  const valida = validaMisura(misura);
  const risultato = esegui(
    { metrica: metricaRappresentativa(valida.espressione), misura: valida, periodo },
    snapshot
  );
  const foglie = operandiDellaMisura(valida.espressione).map((o): FogliaProva => {
    const r = esegui(
      { metrica: o.metrica, filtri: o.filtri, periodo },
      snapshot
    );
    return { descrizione: descriviOperando(o), unita: r.unita, valore: r.totale };
  });
  return { periodo, risultato, foglie };
}

/**
 * Riporta i valori dei filtri alla grafia del dato.
 *
 * L'AI scrive «Componenti» e nel gestionale c'e' «COMPONENTI»: senza questo la
 * misura darebbe zero righe e un avviso, e sembrerebbe un errore dei dati.
 * Un valore che non esiste nemmeno ignorando le maiuscole e' un errore vero e
 * viene rifiutato col suggerimento di cosa esiste.
 */
/**
 * Riporta i valori di un elenco di filtri alla grafia del dato, per una
 * metrica. Rifiuta (SpecNonValida, con i valori presenti) quelli che non
 * esistono. Usata anche per i filtri di un riquadro, non solo per le misure.
 */
export function normalizzaFiltri(metrica: ChiaveMetrica, filtri: Filtro[], snapshot: Snapshot): Filtro[] {
  if (filtri.length === 0) return filtri;
  const dataset = snapshot.dataset[CATALOGO[metrica].dataset] ?? [];
  return filtri.map((f): Filtro => {
    // Un filtro senza valore non restringe niente: non c'e' nulla da verificare.
    const vuoto = Array.isArray(f.valore) ? f.valore.length === 0 : String(f.valore).trim() === "";
    if (f.op === "contiene" || vuoto) return f;
    const esistenti = new Map<string, string>();
    for (const r of dataset) {
      const v = DIMENSIONI[f.campo].estrai(r);
      if (v && !esistenti.has(v.toLowerCase())) esistenti.set(v.toLowerCase(), v);
    }
    const dati = Array.isArray(f.valore) ? f.valore : [f.valore];
    const corretti = dati.map((v) => {
      const trovato = esistenti.get(String(v).trim().toLowerCase());
      if (!trovato) {
        const simili = [...esistenti.values()].slice(0, 12).join(", ");
        throw new SpecNonValida(
          `Il valore "${String(v)}" non esiste nella dimensione "${f.campo}" per «${CATALOGO[metrica].etichetta}».`,
          `Valori presenti (primi 12): ${simili || "nessuno"}. Per un confronto parziale usa l'operatore "contiene".`
        );
      }
      return trovato;
    });
    return { ...f, valore: Array.isArray(f.valore) ? corretti : corretti[0] };
  });
}

export function normalizzaValoriFiltri(misura: MisuraDefinita, snapshot: Snapshot): MisuraDefinita {
  const correggi = (o: OperandoMisura): OperandoMisura =>
    o.filtri?.length ? { ...o, filtri: normalizzaFiltri(o.metrica, o.filtri, snapshot) } : o;

  const e = misura.espressione;
  switch (e.tipo) {
    case "metrica": {
      const { metrica, filtri } = correggi({ metrica: e.metrica, filtri: e.filtri });
      return { ...misura, espressione: { tipo: "metrica", metrica, ...(filtri ? { filtri } : {}) } };
    }
    case "rapporto":
      return { ...misura, espressione: { ...e, numeratore: correggi(e.numeratore), denominatore: correggi(e.denominatore) } };
    case "differenza":
      return { ...misura, espressione: { ...e, da: correggi(e.da), sottrai: correggi(e.sottrai) } };
    case "somma":
      return { ...misura, espressione: { ...e, addendi: e.addendi.map(correggi) } };
    case "quota": {
      const { filtri } = correggi({ metrica: e.metrica, filtri: e.filtri });
      return { ...misura, espressione: { ...e, filtri: filtri ?? e.filtri } };
    }
  }
}
