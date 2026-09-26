/**
 *
 * Risoluzione delle metriche `budget` e `bep`.
 *
 * Due fonti, con precedenza alla prima:
 *   1. SERIE IMPORTATA dagli Excel aziendali (giorno × area × agente).
 *      È il dato vero, non si ricalcola.
 *   2. DISTRIBUZIONE GENERATA da budget.ts, per gli anni non ancora pianificati.
 *
 * A differenza del PBIX, il budget qui è interrogabile con le stesse
 * dimensioni dei consuntivi: per business unit, per agente, per settimana.
 * È ciò che rende possibili i grafici a target (bullet), le tabelle con lo
 * scostamento e il waterfall del delta.
 */

import { distribuisci } from "./budget";
import { settimanaIso, dataDaIso } from "./calendario";
import type {
  ConfigurazioneAnno,
  Periodo,
  Granularita,
  RigaRisultato,
  RigaSerieBudget,
  RisultatoQuery,
  SerieBudget,
  SpecQuery,
} from "./tipi";
import { anniDelPeriodo, dataNelPeriodo, spostaPeriodo } from "./periodo";
import { SEPARATORE_RAMO } from "./tipi";

function arr(n: number) {
  return Math.round(n * 100) / 100;
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

function annoDaData(data: string | null | undefined): number | null {
  if (!data) return null;
  const anno = Number(data.slice(0, 4));
  return Number.isInteger(anno) && anno > 0 ? anno : null;
}

function anniFra(estremoA: number, estremoB: number): number[] {
  const primo = Math.min(estremoA, estremoB);
  const ultimo = Math.max(estremoA, estremoB);
  return Array.from({ length: ultimo - primo + 1 }, (_, indice) => primo + indice);
}

/** Gli anni che una spec attraversa davvero, nell'ordine. */
export function anniDellaSpec(
  spec: SpecQuery,
  copertura: { dataMinima: string | null; dataMassima: string | null }
): number[] {
  const periodo = spec.periodo;
  const annoCorrente = new Date().getFullYear();
  let anni: number[];

  const anniScelti = anniDelPeriodo(periodo);
  if (anniScelti) {
    anni = anniScelti;
  } else {
    const annoMinimo = annoDaData(copertura.dataMinima);
    const annoMassimo = annoDaData(copertura.dataMassima);
    const haEstremiEspliciti = Boolean(periodo?.dal || periodo?.al);

    const primo = haEstremiEspliciti
      ? annoDaData(periodo?.dal) ?? annoMinimo ?? annoDaData(periodo?.al) ?? annoMassimo
      : annoMinimo ?? annoMassimo;
    const ultimo = haEstremiEspliciti
      ? annoDaData(periodo?.al) ?? annoMassimo ?? annoDaData(periodo?.dal) ?? annoMinimo
      : annoMassimo ?? annoMinimo;

    anni = primo !== null && ultimo !== null ? anniFra(primo, ultimo) : [annoCorrente];
  }

  const modificatore = spec.modificatore ?? "corrente";
  if (modificatore === "anno_precedente" || modificatore === "progressivo_ap") {
    anni = [...anni, ...anni.map((anno) => anno - 1)];
  }

  const unici = [...new Set(anni)].filter((anno) => Number.isInteger(anno) && anno > 0);
  return unici.length > 0 ? unici.sort((a, b) => a - b) : [annoCorrente];
}

/** Fonde le serie di piu' anni in una sola, da passare a risolviBudget. */
export function unisciSerieBudget(
  mappa: Record<number, SerieBudget | null>,
  anni: number[]
): SerieBudget | null {
  const presenti: Array<{ annoRichiesto: number; serie: SerieBudget }> = [];
  for (const anno of new Set(anni)) {
    const serie = mappa[anno];
    if (serie) presenti.push({ annoRichiesto: anno, serie });
  }

  if (presenti.length === 0) return null;

  const prima = presenti[0].serie;
  const origini = [...new Set(presenti.map(({ serie }) => serie.origine))];
  const formato =
    origini.length > 1
      ? `${prima.formato} (origini miste: ${origini.join(" + ")})`
      : prima.formato;
  const anniFusi: number[] = [];
  const visti = new Set<number>();
  const totaliPerAnno: SerieBudget["totaliPerAnno"] = {};
  const righe: RigaSerieBudget[] = [];

  const aggiungiAnno = (anno: number) => {
    if (visti.has(anno)) return;
    visti.add(anno);
    anniFusi.push(anno);
  };

  for (const { annoRichiesto, serie } of presenti) {
    aggiungiAnno(annoRichiesto);
    for (const anno of serie.anni) aggiungiAnno(anno);
    for (const [annoTesto, totali] of Object.entries(serie.totaliPerAnno)) {
      const anno = Number(annoTesto);
      if (Number.isInteger(anno)) {
        aggiungiAnno(anno);
        totaliPerAnno[anno] = totali;
      }
    }
    righe.push(...serie.righe);
  }

  return {
    origine: prima.origine,
    formato,
    importatoIl: prima.importatoIl,
    anni: anniFusi,
    totaliPerAnno,
    righe,
  };
}

/** Converte una distribuzione generata nella stessa forma della serie importata. */
export function serieDaConfigurazione(config: ConfigurazioneAnno): SerieBudget {
  const d = distribuisci(config);
  const righe: RigaSerieBudget[] = [];

  const perDataBU = new Map<string, { budget: number; bep: number }>();
  for (const r of d.perBU) {
    const k = `${r.data}|${r.chiave}`;
    const cur = perDataBU.get(k) ?? { budget: 0, bep: 0 };
    cur.budget += r.budget;
    cur.bep += r.bep;
    perDataBU.set(k, cur);
  }

  if (perDataBU.size > 0) {
    for (const [k, v] of perDataBU) {
      const [data, area] = k.split("|");
      righe.push({
        data,
        area,
        agente: null,
        codiceAgente: null,
        budget: arr(v.budget),
        bep: arr(v.bep),
        granularita: "giorno",
      });
    }
  } else {
    // Nessuna incidenza BU configurata: si resta al livello aziendale.
    for (const g of d.giorni) {
      if (!g.lavorativo) continue;
      righe.push({
        data: g.data,
        area: "(totale)",
        agente: null,
        codiceAgente: null,
        budget: g.budget,
        bep: g.bep,
        granularita: "giorno",
      });
    }
  }

  for (const r of d.perAgente) {
    righe.push({
      data: r.data,
      area: "(totale)",
      agente: r.chiave,
      codiceAgente: null,
      budget: r.budget,
      bep: r.bep,
      granularita: "giorno",
    });
  }

  return {
    origine: "generato",
    formato: "generato",
    importatoIl: new Date().toISOString(),
    anni: [config.anno],
    totaliPerAnno: {
      [config.anno]: { budget: config.budgetAnnuo, bep: config.bepAnnuo },
    },
    righe,
  };
}

export interface EsitoBudget {
  risultato: RisultatoQuery;
  origine: "importato" | "generato" | "assente";
}

/**
 * Esegue una spec su `budget` o `bep`.
 *
 * Regola sul livello di dettaglio: le righe con agente e quelle senza sono
 * due viste dello STESSO budget. Si usa il livello agente solo quando la spec
 * lo richiede (raggruppa o filtra per agente), altrimenti quello per area.
 * Sommarli darebbe il doppio.
 */
export function risolviBudget(
  spec: SpecQuery,
  serie: SerieBudget | null
): EsitoBudget {
  const campo = spec.metrica === "bep" ? "bep" : "budget";
  const avvisi: string[] = [];

  if (!serie) {
    return {
      origine: "assente",
      risultato: {
        spec,
        metrica: spec.metrica,
        unita: "euro",
        righe: [],
        totale: 0,
        certificata: true,
        avvisi: [
          "Budget/BEP non disponibili per questo periodo: importare il file Excel " +
            "oppure impostare gli importi annuali nella pagina Budget & BEP.",
        ],
      },
    };
  }

  const vuoleAgente =
    (spec.raggruppa ?? []).includes("agente") ||
    (spec.filtri ?? []).some((f) => f.campo === "agente");

  let righe = serie.righe.filter((r) => (vuoleAgente ? r.agente !== null : r.agente === null));

  if (vuoleAgente && righe.length === 0) {
    righe = serie.righe.filter((r) => r.agente === null);
    avvisi.push(
      "Il budget per agente non è presente in questo file: mostrato il budget di livello aziendale."
    );
  }

  // ── Periodo (con lo spostamento per i modificatori anno su anno) ──────────
  const mod = spec.modificatore ?? "corrente";
  let p: Periodo = spec.periodo ?? {};

  if (mod === "anno_precedente" || mod === "progressivo_ap") p = spostaPeriodo(p, -1);
  if (mod === "progressivo" || mod === "progressivo_ap") {
    const a = anniDelPeriodo(p)?.[0] ?? Number((p.al ?? p.dal ?? "").slice(0, 4));
    if (a) p = { ...p, dal: `${a}-01-01` };
  }

  const periodoFiltro = p;
  righe = righe.filter((r) => dataNelPeriodo(r.data, periodoFiltro));

  // ── Filtri su dimensioni ──────────────────────────────────────────────────
  for (const filtroOriginale of spec.filtri ?? []) {
    let f = filtroOriginale;
    // Scelta per rami («COMPONENTI › FLUIDI»): il budget non scende sotto la
    // business unit, quindi si confronta con quello delle business unit toccate
    // e lo si dice. Ignorarlo avrebbe messo l'ordinato di una categoria accanto
    // al budget di tutta l'azienda.
    if (f.campo === "bu_categoria") {
      const rami = (Array.isArray(f.valore) ? f.valore : [f.valore]).map(String).filter(Boolean);
      if (rami.length === 0) continue;
      const bu = [...new Set(rami.map((r) => r.split(SEPARATORE_RAMO)[0]))];
      f = { campo: "bu", op: "in", valore: bu };
      avvisi.push(
        `Il budget esiste per business unit intera: la scelta per categorie è confrontata con il budget di ${bu.join(", ")}.`
      );
    }
    const estrai = (r: RigaSerieBudget) =>
      f.campo === "agente" ? (r.agente ?? "") : f.campo === "bu" ? r.area : null;

    // Le altre dimensioni (cliente, articolo, categoria, causale) non esistono
    // nel budget: filtrarci sopra darebbe zero invece di un errore onesto.
    if (estrai(righe[0] ?? ({} as RigaSerieBudget)) === null) {
      avvisi.push(
        `Il budget non è definito per dimensione "${f.campo}": il filtro è stato ignorato.`
      );
      continue;
    }

    righe = righe.filter((r) => {
      const v = estrai(r) ?? "";
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
    });
  }

  // ── Raggruppamento ────────────────────────────────────────────────────────
  const gruppi = new Map<string, { chiavi: Record<string, string>; valore: number; n: number }>();

  for (const r of righe) {
    const chiavi: Record<string, string> = {};
    const parti: string[] = [];

    if (spec.granularita) {
      const k = chiaveTempo(r.data, spec.granularita);
      chiavi.periodo = k;
      parti.push(k);
    }
    for (const d of spec.raggruppa ?? []) {
      let v: string | null = null;
      if (d === "bu") v = r.area;
      else if (d === "agente") v = r.agente;
      if (v === null) {
        // Il budget esiste per area e agente, non per cliente, articolo o
        // categoria. Prima questo `continue` era muto: chiedere il budget per
        // cliente restituiva il TOTALE su una riga sola, etichettata "totale",
        // che sembra un risultato valido e non lo e'. Il filtro sulle stesse
        // dimensioni l'avviso ce l'aveva gia'; il raggruppamento no.
        const avviso = `Il budget non e' definito per dimensione "${d}": il raggruppamento e' stato ignorato e il valore resta aggregato.`;
        if (!avvisi.includes(avviso)) avvisi.push(avviso);
        continue;
      }
      chiavi[d] = v;
      parti.push(v);
    }

    const k = parti.join(" · ") || "totale";
    const g = gruppi.get(k) ?? { chiavi, valore: 0, n: 0 };
    g.valore += r[campo];
    g.n += 1;
    gruppi.set(k, g);
  }

  let risultati: RigaRisultato[] = [...gruppi.entries()].map(([etichetta, g]) => ({
    etichetta,
    chiavi: g.chiavi,
    valore: arr(g.valore),
    conteggio: g.n,
  }));

  const ordina = spec.ordina ?? (spec.granularita ? "etichetta" : "valore_desc");
  risultati.sort((a, b) => {
    if (ordina === "etichetta") return a.etichetta.localeCompare(b.etichetta);
    if (ordina === "valore_asc") return a.valore - b.valore;
    return b.valore - a.valore;
  });

  if ((mod === "progressivo" || mod === "progressivo_ap") && spec.granularita) {
    let acc = 0;
    risultati = risultati
      .slice()
      .sort((a, b) => a.etichetta.localeCompare(b.etichetta))
      .map((r) => {
        acc += r.valore;
        return { ...r, valore: arr(acc) };
      });
  }

  const totale = arr(righe.reduce((s, r) => s + r[campo], 0));
  if (spec.limite) risultati = risultati.slice(0, spec.limite);

  if (campo === "bep" && totale === 0 && righe.length > 0) {
    avvisi.push("Il BEP non è valorizzato in questa serie (il file dei commerciali non lo contiene).");
  }

  return {
    origine: serie.origine,
    risultato: {
      spec,
      metrica: spec.metrica,
      unita: "euro",
      righe: risultati,
      totale,
      certificata: true,
      avvisi,
    },
  };
}
