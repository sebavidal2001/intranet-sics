/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * STRATO SEMANTICO — il pezzo che decide tutto il resto.
 *
 * Ogni grafico, ogni rilevatore, ogni risposta dell'AI e ogni export passano
 * di qui. Nessuno di loro scrive SQL: tutti descrivono cosa vogliono con una
 * `SpecQuery` e questo modulo la esegue.
 *
 * Le due regole che risolvono i problemi del PBIX attuale:
 *
 *  1. NIENTE ANNI CABLATI NEI NOMI. Il PBIX ha "Ordinato 2026", "Fatturato
 *     2025", "BUDGET Progressivo 2026": ogni gennaio vanno riscritte ~30
 *     misure e ricontrollati 130 visual. Qui c'è UNA metrica (`ordinato`) e
 *     UN modificatore (`anno_precedente`, `progressivo`, …).
 *
 *  2. IL PERIMETRO È CHIUSO. Una spec che nomina una metrica o una dimensione
 *     inesistente viene rifiutata, non interpretata. È ciò che rende sicuro
 *     far comporre le spec all'AI.
 */

import type {
  ChiaveMetrica,
  Dimensione,
  Filtro,
  Granularita,
  Periodo,
  RigaFatto,
  RigaRisultato,
  RisultatoQuery,
  Snapshot,
  SpecQuery,
  UnitaMisura,
} from "./tipi";
import { dataDaIso, settimanaIso } from "./calendario";
import { dimensioniPerMetrica, TIPOLOGIE } from "./tassonomia";

// ─────────────────────────────────────────────────────────────────────────────
// Catalogo delle metriche
// ─────────────────────────────────────────────────────────────────────────────

type Aggregazione =
  | "somma"
  | "conta_documenti"
  | "conta_righe"
  | "media_documento"
  | "media"
  | "massimo"
  | "rapporto";

interface DefinizioneMetrica {
  chiave: ChiaveMetrica;
  etichetta: string;
  descrizione: string;
  dataset: keyof Snapshot["dataset"];
  aggregazione: Aggregazione;
  unita: UnitaMisura;
  /**
   * Valore della riga da sommare o mediare. Se restituisce null la riga non
   * entra nel calcolo: serve alle medie che devono ignorare i dati mancanti
   * invece di contarli come zero (i giorni di risposta sono il caso tipico).
   * Default: `importo`.
   */
  valore?: (r: RigaFatto) => number | null;
  /** Numeratore e denominatore per le metriche di rapporto (percentuali). */
  numeratore?: (r: RigaFatto) => number;
  denominatore?: (r: RigaFatto) => number;
  /** Filtro implicito sempre applicato (es. escludere righe già evase). */
  filtroImplicito?: (r: RigaFatto) => boolean;
}

export const CATALOGO: Record<ChiaveMetrica, DefinizioneMetrica> = {
  ordinato: {
    chiave: "ordinato",
    etichetta: "Ordinato",
    descrizione: "Valore degli ordini ricevuti, per data documento.",
    dataset: "ordinato",
    aggregazione: "somma",
    unita: "euro",
  },
  fatturato: {
    chiave: "fatturato",
    etichetta: "Fatturato",
    descrizione: "Valore fatturato, per data documento.",
    dataset: "fatturato",
    aggregazione: "somma",
    unita: "euro",
  },
  consegnato: {
    chiave: "consegnato",
    etichetta: "Consegnato",
    descrizione: "Valore delle merci consegnate.",
    dataset: "consegnato",
    aggregazione: "somma",
    unita: "euro",
  },
  portafoglio: {
    chiave: "portafoglio",
    etichetta: "Portafoglio",
    descrizione: "Ordini acquisiti non ancora consegnati.",
    dataset: "portafoglio",
    aggregazione: "somma",
    unita: "euro",
  },
  consegnato_futuro: {
    chiave: "consegnato_futuro",
    etichetta: "Portafoglio per mese di consegna",
    descrizione:
      "Consegne future ripartite sul mese previsto. Attenzione: stessa origine del portafoglio, non sommare le due metriche.",
    dataset: "consegnato_futuro_per_mese",
    aggregazione: "somma",
    unita: "euro",
  },
  preventivi_aperti: {
    chiave: "preventivi_aperti",
    etichetta: "Preventivi aperti",
    descrizione: "Importo inevaso dei preventivi ancora aperti.",
    dataset: "preventivi_aperti",
    aggregazione: "somma",
    unita: "euro",
  },
  banco: {
    chiave: "banco",
    etichetta: "Banco",
    descrizione: "Vendite al banco.",
    dataset: "controllo_banco",
    aggregazione: "somma",
    unita: "euro",
  },
  n_ordini: {
    chiave: "n_ordini",
    etichetta: "Numero ordini",
    descrizione: "Documenti d'ordine distinti.",
    dataset: "ordinato",
    aggregazione: "conta_documenti",
    unita: "numero",
  },
  ordine_medio: {
    chiave: "ordine_medio",
    etichetta: "Ordine medio",
    descrizione: "Valore medio per documento d'ordine.",
    dataset: "ordinato",
    aggregazione: "media_documento",
    unita: "euro",
  },
  n_preventivi: {
    chiave: "n_preventivi",
    etichetta: "Numero preventivi",
    descrizione: "Preventivi aperti distinti.",
    dataset: "preventivi_aperti",
    aggregazione: "conta_documenti",
    unita: "numero",
  },
  // ── Esito dei preventivi ─────────────────────────────────────────────────
  // ATTENZIONE alla semantica: nel gestionale la colonna `importo_evaso` NON
  // è l'evaso, è il valore totale della riga (verificato: vale il totale anche
  // con riga_evasa='N' e quantita evasa 0). Il convertito è la differenza, e
  // viene calcolato dalla vista `bi_preventivi_backoffice`, non qui.
  preventivi_valore: {
    chiave: "preventivi_valore",
    etichetta: "Valore preventivi",
    descrizione: "Valore totale dei preventivi emessi, evasi e non.",
    dataset: "preventivi_aperti",
    aggregazione: "somma",
    unita: "euro",
    valore: (r) => r.valoreTotale ?? 0,
  },
  preventivi_convertito: {
    chiave: "preventivi_convertito",
    etichetta: "Convertito in ordine",
    descrizione: "Quota di preventivo derivata in ordine (valore totale meno inevaso).",
    dataset: "preventivi_aperti",
    aggregazione: "somma",
    unita: "euro",
    valore: (r) => r.convertito ?? 0,
  },
  tasso_conversione: {
    chiave: "tasso_conversione",
    etichetta: "Tasso di conversione",
    descrizione: "Percentuale del valore preventivato che si è trasformata in ordine.",
    dataset: "preventivi_aperti",
    aggregazione: "rapporto",
    unita: "percentuale",
    numeratore: (r) => r.convertito ?? 0,
    denominatore: (r) => r.valoreTotale ?? 0,
  },
  valore_medio_preventivo: {
    chiave: "valore_medio_preventivo",
    etichetta: "Valore medio preventivo",
    descrizione: "Valore totale medio per documento di preventivo.",
    dataset: "preventivi_aperti",
    aggregazione: "media_documento",
    unita: "euro",
    valore: (r) => r.valoreTotale ?? 0,
  },

  // ── Carico e tempi del back office ───────────────────────────────────────
  preventivi_creati: {
    chiave: "preventivi_creati",
    etichetta: "Preventivi creati",
    descrizione: "Documenti di preventivo distinti creati.",
    dataset: "preventivi_aperti",
    aggregazione: "conta_documenti",
    unita: "numero",
  },
  righe_preventivo: {
    chiave: "righe_preventivo",
    etichetta: "Righe preventivate",
    descrizione: "Righe di preventivo lavorate: misura il volume di lavoro reale.",
    dataset: "preventivi_aperti",
    aggregazione: "conta_righe",
    unita: "numero",
  },
  giorni_risposta: {
    chiave: "giorni_risposta",
    etichetta: "Giorni di risposta",
    descrizione:
      "Giorni fra la richiesta del cliente e la registrazione del preventivo. Le date incoerenti sono escluse, non contate come zero.",
    dataset: "preventivi_aperti",
    aggregazione: "media",
    unita: "giorni",
    valore: (r) => r.giorniRisposta ?? null,
  },
  quota_stesso_giorno: {
    chiave: "quota_stesso_giorno",
    etichetta: "Risposte in giornata",
    descrizione: "Percentuale di preventivi registrati lo stesso giorno della richiesta.",
    dataset: "preventivi_aperti",
    aggregazione: "rapporto",
    unita: "percentuale",
    numeratore: (r) => (r.giorniRisposta === 0 ? 1 : 0),
    denominatore: (r) => (r.giorniRisposta === null || r.giorniRisposta === undefined ? 0 : 1),
  },

  // ── Anzianità dei preventivi ancora aperti ───────────────────────────────
  // "Aperto" significa che resta dell'inevaso sulla riga. Le righe interamente
  // convertite hanno anzianità null e restano fuori da queste medie: contarle
  // come zero abbasserebbe artificialmente l'attesa media.
  giorni_apertura: {
    chiave: "giorni_apertura",
    etichetta: "Giorni di apertura",
    descrizione:
      "Da quanti giorni i preventivi ancora aperti sono in attesa, contati dalla data del documento alla data dei dati.",
    dataset: "preventivi_aperti",
    aggregazione: "media",
    unita: "giorni",
    valore: (r) => r.giorniAperto ?? null,
  },
  eta_massima_apertura: {
    chiave: "eta_massima_apertura",
    etichetta: "Preventivo più vecchio",
    descrizione: "Anzianità della riga aperta da più tempo.",
    dataset: "preventivi_aperti",
    aggregazione: "massimo",
    unita: "giorni",
    valore: (r) => r.giorniAperto ?? null,
  },
  preventivi_aperti_oltre_90: {
    chiave: "preventivi_aperti_oltre_90",
    etichetta: "Inevaso oltre 90 giorni",
    descrizione:
      "Valore ancora aperto su preventivi più vecchi di 90 giorni: la parte di pipeline che difficilmente si chiude da sola.",
    dataset: "preventivi_aperti",
    aggregazione: "somma",
    unita: "euro",
    valore: (r) => ((r.giorniAperto ?? 0) > 90 ? r.importo : 0),
  },

  // Budget e BEP non vengono dallo snapshot: sono iniettati dal motore budget.
  budget: {
    chiave: "budget",
    etichetta: "Budget",
    descrizione: "Obiettivo distribuito sui giorni lavorativi.",
    dataset: "ordinato",
    aggregazione: "somma",
    unita: "euro",
  },
  bep: {
    chiave: "bep",
    etichetta: "BEP",
    descrizione: "Punto di pareggio distribuito sui giorni lavorativi.",
    dataset: "ordinato",
    aggregazione: "somma",
    unita: "euro",
  },
};

export const DIMENSIONI: Record<Dimensione, { etichetta: string; estrai: (r: RigaFatto) => string }> = {
  bu: { etichetta: "Business unit", estrai: (r) => r.bu },
  agente: { etichetta: "Agente", estrai: (r) => r.agente },
  cliente: { etichetta: "Cliente", estrai: (r) => r.cliente },
  categoria: { etichetta: "Categoria", estrai: (r) => r.categoria },
  causale: {
    etichetta: "Causale magazzino",
    estrai: (r) => r.causaleDescrizione || r.causaleCodice || "(nessuna)",
  },
  articolo: { etichetta: "Articolo", estrai: (r) => r.descrizioneArticolo || r.articolo },
  creatore: {
    etichetta: "Addetto back office",
    estrai: (r) => r.creatore || "(non indicato)",
  },
  fascia_eta: {
    etichetta: "Anzianità preventivo",
    estrai: (r) => {
      const g = r.giorniAperto;
      if (g === null || g === undefined) return "(chiuso)";
      if (g <= 30) return "0-30 giorni";
      if (g <= 60) return "31-60 giorni";
      if (g <= 90) return "61-90 giorni";
      if (g <= 180) return "91-180 giorni";
      if (g <= 365) return "6-12 mesi";
      return "oltre 1 anno";
    },
  },
  esito: {
    etichetta: "Esito preventivo",
    estrai: (r) => {
      if (r.valoreTotale === undefined) return "(non applicabile)";
      const convertito = r.convertito ?? 0;
      if (convertito <= 0.01) return "Aperto";
      if (r.importo <= 0.01) return "Convertito";
      return "Parziale";
    },
  },
};

/** Descrizione del vocabolario, da passare all'AI come contesto. */
export function vocabolario() {
  const dimensioniAmmesse = Object.fromEntries(
    Object.keys(CATALOGO).map((chiave) => [
      chiave,
      dimensioniPerMetrica(chiave as ChiaveMetrica),
    ])
  ) as Record<ChiaveMetrica, Dimensione[]>;

  return {
    tipologie: TIPOLOGIE,
    metriche: Object.values(CATALOGO).map((m) => ({
      chiave: m.chiave,
      etichetta: m.etichetta,
      descrizione: m.descrizione,
      unita: m.unita,
    })),
    modificatori: [
      { chiave: "corrente", descrizione: "valore del periodo richiesto" },
      { chiave: "anno_precedente", descrizione: "stesso periodo dell'anno prima" },
      { chiave: "progressivo", descrizione: "cumulato dall'inizio dell'anno" },
      { chiave: "progressivo_ap", descrizione: "cumulato dall'inizio dell'anno precedente" },
    ],
    dimensioni: Object.entries(DIMENSIONI).map(([k, v]) => ({
      chiave: k,
      etichetta: v.etichetta,
    })),
    dimensioniPerMetrica: dimensioniAmmesse,
    granularita: ["giorno", "settimana", "mese", "anno"],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validazione: perimetro chiuso
// ─────────────────────────────────────────────────────────────────────────────

export class SpecNonValida extends Error {}

export function validaSpec(spec: unknown): SpecQuery {
  if (!spec || typeof spec !== "object") throw new SpecNonValida("Spec assente.");
  const s = spec as Record<string, unknown>;

  const metrica = String(s.metrica ?? "") as ChiaveMetrica;
  if (!CATALOGO[metrica]) {
    throw new SpecNonValida(
      `Metrica "${String(s.metrica)}" non esiste. Disponibili: ${Object.keys(CATALOGO).join(", ")}.`
    );
  }

  const modificatore = s.modificatore
    ? (String(s.modificatore) as SpecQuery["modificatore"])
    : "corrente";
  if (
    modificatore &&
    !["corrente", "anno_precedente", "progressivo", "progressivo_ap"].includes(modificatore)
  ) {
    throw new SpecNonValida(`Modificatore "${modificatore}" non valido.`);
  }

  const granularita = s.granularita ? (String(s.granularita) as Granularita) : undefined;
  if (granularita && !["giorno", "settimana", "mese", "anno"].includes(granularita)) {
    throw new SpecNonValida(`Granularità "${granularita}" non valida.`);
  }

  const raggruppa = Array.isArray(s.raggruppa)
    ? s.raggruppa.map((d) => {
        const dim = String(d) as Dimensione;
        if (!DIMENSIONI[dim]) throw new SpecNonValida(`Dimensione "${d}" non esiste.`);
        return dim;
      })
    : [];

  const filtri: Filtro[] = Array.isArray(s.filtri)
    ? s.filtri.map((f) => {
        const ff = f as Record<string, unknown>;
        const campo = String(ff.campo ?? "") as Dimensione;
        if (!DIMENSIONI[campo]) throw new SpecNonValida(`Filtro su dimensione "${ff.campo}" non esiste.`);
        const op = String(ff.op ?? "eq") as Filtro["op"];
        if (!["eq", "neq", "in", "contiene"].includes(op)) {
          throw new SpecNonValida(`Operatore filtro "${op}" non valido.`);
        }
        return { campo, op, valore: (ff.valore ?? "") as string | string[] };
      })
    : [];

  const periodo = (s.periodo ?? {}) as Periodo;

  return {
    metrica,
    modificatore,
    granularita,
    raggruppa,
    filtri,
    periodo,
    ordina: (s.ordina as SpecQuery["ordina"]) ?? undefined,
    limite: typeof s.limite === "number" ? Math.min(500, Math.max(1, s.limite)) : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Esecuzione
// ─────────────────────────────────────────────────────────────────────────────

function passaFiltro(r: RigaFatto, f: Filtro): boolean {
  const v = DIMENSIONI[f.campo].estrai(r);
  switch (f.op) {
    case "eq":
      return v === String(f.valore);
    case "neq":
      return v !== String(f.valore);
    case "in":
      return (Array.isArray(f.valore) ? f.valore : [f.valore]).map(String).includes(v);
    case "contiene":
      return v.toLowerCase().includes(String(f.valore).toLowerCase());
  }
}

function chiaveTempo(data: string, g: Granularita): string {
  switch (g) {
    case "giorno":
      return data;
    case "settimana":
      return settimanaIso(dataDaIso(data));
    case "mese":
      return data.slice(0, 7);
    case "anno":
      return data.slice(0, 4);
  }
}

/** Sposta un periodo indietro di un anno (per i confronti anno su anno). */
function periodoAnnoPrecedente(p: Periodo): Periodo {
  const meno1 = (s?: string) =>
    s ? `${Number(s.slice(0, 4)) - 1}${s.slice(4)}` : undefined;
  return {
    dal: meno1(p.dal),
    al: meno1(p.al),
    anno: p.anno ? p.anno - 1 : undefined,
  };
}

function periodoEffettivo(spec: SpecQuery): Periodo {
  const base = spec.periodo ?? {};
  const mod = spec.modificatore ?? "corrente";

  if (mod === "anno_precedente" || mod === "progressivo_ap") {
    const p = periodoAnnoPrecedente(base);
    if (mod === "progressivo_ap" && p.anno) {
      return { dal: `${p.anno}-01-01`, al: p.al ?? `${p.anno}-12-31` };
    }
    return p;
  }

  if (mod === "progressivo") {
    const anno = base.anno ?? (Number((base.al ?? base.dal ?? "").slice(0, 4)) || undefined);
    if (anno) return { dal: `${anno}-01-01`, al: base.al ?? `${anno}-12-31` };
  }

  return base;
}

function inPeriodo(data: string, p: Periodo): boolean {
  if (!data) return false;
  if (p.anno && Number(data.slice(0, 4)) !== p.anno) return false;
  if (p.dal && data < p.dal) return false;
  if (p.al && data > p.al) return false;
  return true;
}

/**
 * Esegue una spec contro lo snapshot.
 * Il risultato è sempre marcato `certificata: true`: proviene dal vocabolario,
 * non da SQL improvvisato.
 */
export function esegui(spec: SpecQuery, snapshot: Snapshot): RisultatoQuery {
  const def = CATALOGO[spec.metrica];
  const avvisi: string[] = [];
  const periodo = periodoEffettivo(spec);

  let righe = snapshot.dataset[def.dataset] ?? [];
  if (def.filtroImplicito) righe = righe.filter(def.filtroImplicito);

  righe = righe.filter((r) => inPeriodo(r.data, periodo));
  for (const f of spec.filtri ?? []) righe = righe.filter((r) => passaFiltro(r, f));

  // Avviso onesto sulla copertura: il dato parte dal 2025-01-07.
  if (snapshot.dataMinima && periodo.dal && periodo.dal < snapshot.dataMinima) {
    avvisi.push(
      `I dati disponibili partono dal ${snapshot.dataMinima}: il periodo richiesto è coperto solo in parte.`
    );
  }
  if (righe.length === 0) {
    avvisi.push("Nessuna riga nel periodo e nei filtri richiesti.");
  }

  // ── Raggruppamento ────────────────────────────────────────────────────────
  const gruppi = new Map<
    string,
    {
      chiavi: Record<string, string>;
      somma: number;
      validi: number;
      massimo: number;
      num: number;
      den: number;
      documenti: Set<string>;
      conteggio: number;
    }
  >();

  // Accumulatore del totale generale: si calcola insieme ai gruppi, così
  // media e rapporto sul totale non sono la media delle medie — errore
  // classico che sul tasso di conversione dà numeri visibilmente sbagliati.
  const complessivo = {
    somma: 0,
    validi: 0,
    massimo: 0,
    num: 0,
    den: 0,
    documenti: new Set<string>(),
    conteggio: 0,
  };

  const valoreRiga = (r: RigaFatto): number | null =>
    def.valore ? def.valore(r) : r.importo;

  for (const r of righe) {
    const chiavi: Record<string, string> = {};
    const parti: string[] = [];

    if (spec.granularita) {
      const k = chiaveTempo(r.data, spec.granularita);
      chiavi.periodo = k;
      parti.push(k);
    }
    for (const d of spec.raggruppa ?? []) {
      const v = DIMENSIONI[d].estrai(r);
      chiavi[d] = v;
      parti.push(v);
    }

    const k = parti.join(" · ") || "totale";
    const g =
      gruppi.get(k) ??
      {
        chiavi,
        somma: 0,
        validi: 0,
        massimo: 0,
        num: 0,
        den: 0,
        documenti: new Set<string>(),
        conteggio: 0,
      };

    const v = valoreRiga(r);
    if (v !== null) {
      g.somma += v;
      g.validi += 1;
      g.massimo = Math.max(g.massimo, v);
      complessivo.somma += v;
      complessivo.validi += 1;
      complessivo.massimo = Math.max(complessivo.massimo, v);
    }
    if (def.numeratore) {
      const n = def.numeratore(r);
      const d = def.denominatore ? def.denominatore(r) : 0;
      g.num += n;
      g.den += d;
      complessivo.num += n;
      complessivo.den += d;
    }

    g.conteggio += 1;
    complessivo.conteggio += 1;
    if (r.documento) {
      g.documenti.add(r.documento);
      complessivo.documenti.add(r.documento);
    }
    gruppi.set(k, g);
  }

  function aggrega(a: {
    somma: number;
    validi: number;
    massimo: number;
    num: number;
    den: number;
    documenti: Set<string>;
    conteggio: number;
  }): number {
    switch (def.aggregazione) {
      case "somma":
        return a.somma;
      case "conta_documenti":
        return a.documenti.size;
      case "conta_righe":
        return a.conteggio;
      case "media_documento":
        return a.documenti.size > 0 ? a.somma / a.documenti.size : 0;
      case "media":
        return a.validi > 0 ? a.somma / a.validi : 0;
      case "massimo":
        return a.massimo;
      case "rapporto":
        return a.den > 0 ? (a.num / a.den) * 100 : 0;
    }
  }

  let risultati: RigaRisultato[] = [...gruppi.entries()].map(([etichetta, g]) => ({
    etichetta,
    chiavi: g.chiavi,
    valore: Math.round(aggrega(g) * 100) / 100,
    conteggio: g.conteggio,
  }));

  // ── Ordinamento e taglio ──────────────────────────────────────────────────
  const ordina = spec.ordina ?? (spec.granularita ? "etichetta" : "valore_desc");
  risultati.sort((a, b) => {
    if (ordina === "etichetta") return a.etichetta.localeCompare(b.etichetta);
    if (ordina === "valore_asc") return a.valore - b.valore;
    return b.valore - a.valore;
  });

  // Il progressivo cumula lungo l'asse temporale ordinato.
  // Non si applica a medie e percentuali: cumulare un tasso di conversione
  // produrrebbe numeri privi di senso (e crescenti all'infinito).
  const cumulabile =
    def.aggregazione === "somma" ||
    def.aggregazione === "conta_documenti" ||
    def.aggregazione === "conta_righe";
  if (
    (spec.modificatore === "progressivo" || spec.modificatore === "progressivo_ap") &&
    spec.granularita &&
    cumulabile
  ) {
    let acc = 0;
    risultati = risultati
      .slice()
      .sort((a, b) => a.etichetta.localeCompare(b.etichetta))
      .map((r) => {
        acc += r.valore;
        return { ...r, valore: Math.round(acc * 100) / 100 };
      });
  }

  const totale = Math.round(aggrega(complessivo) * 100) / 100;

  if (
    (spec.modificatore === "progressivo" || spec.modificatore === "progressivo_ap") &&
    !cumulabile
  ) {
    avvisi.push(
      `La metrica "${def.etichetta}" è una media o una percentuale: il progressivo non è stato applicato perché non avrebbe significato.`
    );
  }

  if (spec.limite) risultati = risultati.slice(0, spec.limite);

  return {
    spec,
    metrica: spec.metrica,
    unita: def.unita,
    righe: risultati,
    totale: Math.round(totale * 100) / 100,
    certificata: true,
    avvisi,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilità di formattazione condivise
// ─────────────────────────────────────────────────────────────────────────────

export function formattaEuro(n: number, compatto = false): string {
  if (compatto && Math.abs(n) >= 1000) {
    return `${new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(n / 1000)} k€`;
  }
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formattaNumero(n: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(n);
}

export function formattaValore(n: number, unita: "euro" | "numero", compatto = false) {
  return unita === "euro" ? formattaEuro(n, compatto) : formattaNumero(n);
}
