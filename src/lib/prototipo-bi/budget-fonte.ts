/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
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
  Granularita,
  RigaRisultato,
  RigaSerieBudget,
  RisultatoQuery,
  SerieBudget,
  SpecQuery,
} from "./tipi";

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
  const p = spec.periodo ?? {};
  const meno1 = (s?: string) => (s ? `${Number(s.slice(0, 4)) - 1}${s.slice(4)}` : undefined);

  let dal = p.dal;
  let al = p.al;
  let anno = p.anno;

  if (mod === "anno_precedente" || mod === "progressivo_ap") {
    dal = meno1(dal);
    al = meno1(al);
    anno = anno ? anno - 1 : undefined;
  }
  if (mod === "progressivo" || mod === "progressivo_ap") {
    const a = anno ?? Number((al ?? dal ?? "").slice(0, 4));
    if (a) dal = `${a}-01-01`;
  }

  righe = righe.filter((r) => {
    if (anno && Number(r.data.slice(0, 4)) !== anno) return false;
    if (dal && r.data < dal) return false;
    if (al && r.data > al) return false;
    return true;
  });

  // ── Filtri su dimensioni ──────────────────────────────────────────────────
  for (const f of spec.filtri ?? []) {
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
      if (v === null) continue;
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
