/**
 *
 * Import dei file Excel Budget/BEP realmente in uso in azienda.
 *
 * Riconosce da solo i tre formati esistenti:
 *
 *  1. BUDGET-BEP.xlsx                       area × settimana        (624 righe)
 *     header: area | mese | AnnoMese | Anno-Settimana | BEP | Budget
 *
 *  2. BUDGET-BEP_GIORNALIERO.xlsx           area × giorno           (5.844 righe)
 *     header: Data | Area | Mese | NumeroSettimana | AnnoMese | AnnoSettimana |
 *             GiornoSettimana | Budget | BEP
 *
 *  3. BUDGET-BEP_GIORNALIERO_COMMERCIALI.xlsx  agente × area × giorno
 *     header: Data | Codice agente | Agente | Area | … | Budget
 *     (più fogli: GENERALE contiene già l'unione, gli altri sono per agente)
 *
 * PRINCIPIO: si importa quello che c'è, senza ricalcolarlo. Il motore di
 * generazione (budget.ts) resta per gli anni non ancora pianificati.
 */

import * as XLSX from "xlsx";
import type { RigaSerieBudget, SerieBudget } from "./tipi";

// ─────────────────────────────────────────────────────────────────────────────
// Normalizzazione
// ─────────────────────────────────────────────────────────────────────────────

function norm(s: unknown): string {
  return String(s ?? "")
    .replace(/�/g, "")
    .trim()
    .toLowerCase();
}

function numero(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Le date arrivano in tre forme diverse a seconda del foglio: seriale Excel,
 * Date già convertita, oppure la stringa "07/01/2026". Il formato italiano
 * gg/mm/aaaa è quello che rompe di più: interpretato all'americana sposta
 * silenziosamente il budget di mesi interi.
 */
export function leggiData(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;

  if (v instanceof Date) {
    return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()))
      .toISOString()
      .slice(0, 10);
  }

  if (typeof v === "number") {
    // Seriale Excel: giorni dal 1899-12-30.
    const ms = Math.round((v - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }

  const s = String(v).trim();

  const italiana = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  if (italiana) {
    const [, g, m, a] = italiana;
    return `${a}-${m.padStart(2, "0")}-${g.padStart(2, "0")}`;
  }

  const isoLike = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (isoLike) return isoLike[0];

  return null;
}

/** Da "2026-W35" o "202601" al primo giorno utile, per gli import settimanali. */
function lunediDiSettimanaIso(etichetta: string): string | null {
  const m = /^(\d{4})-?W(\d{1,2})$/i.exec(etichetta.trim());
  if (!m) return null;
  const anno = Number(m[1]);
  const settimana = Number(m[2]);
  const quattroGen = new Date(Date.UTC(anno, 0, 4));
  const gs = quattroGen.getUTCDay() || 7;
  const lunedi1 = new Date(quattroGen.getTime() - (gs - 1) * 86400000);
  const lunedi = new Date(lunedi1.getTime() + (settimana - 1) * 7 * 86400000);
  return lunedi.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Riconoscimento del formato
// ─────────────────────────────────────────────────────────────────────────────

export type FormatoBudget =
  | "area_settimana"
  | "area_giorno"
  | "agente_giorno"
  | "sconosciuto";

function intestazioni(ws: XLSX.WorkSheet): string[] {
  const righe = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, range: 0 });
  return (righe[0] ?? []).map(norm);
}

export function riconosciFormato(ws: XLSX.WorkSheet): FormatoBudget {
  const h = intestazioni(ws);
  const ha = (nome: string) => h.some((x) => x === nome || x.startsWith(nome));

  if (ha("agente") || ha("codice agente")) return "agente_giorno";
  if (ha("data") && ha("area")) return "area_giorno";
  if (ha("area") && (ha("anno-settimana") || ha("annosettimana"))) return "area_settimana";
  return "sconosciuto";
}

// ─────────────────────────────────────────────────────────────────────────────
// Lettura
// ─────────────────────────────────────────────────────────────────────────────

interface RigaGrezza {
  [k: string]: unknown;
}

function valore(riga: RigaGrezza, ...nomi: string[]): unknown {
  for (const n of nomi) {
    for (const k of Object.keys(riga)) {
      if (norm(k) === n) return riga[k];
    }
  }
  return undefined;
}

export interface EsitoImport {
  serie: SerieBudget;
  avvisi: string[];
  scartate: number;
  fogliLetti: string[];
}

/**
 * Importa un workbook Budget/BEP.
 *
 * `soloAnno` limita l'import a un anno (i file contengono 2024-2027).
 * Nel file dei commerciali si legge SOLO il foglio GENERALE quando c'è:
 * gli altri fogli sono la stessa cosa spezzata per agente, e sommarli
 * raddoppierebbe il budget.
 */
export function importaBudget(
  buffer: ArrayBuffer | Buffer,
  opzioni: { soloAnno?: number } = {}
): EsitoImport {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const avvisi: string[] = [];
  const righe: RigaSerieBudget[] = [];
  const fogliLetti: string[] = [];
  let scartate = 0;

  // Il foglio GENERALE, quando esiste, è già l'unione di tutti gli agenti.
  const nomiFogli = wb.SheetNames;
  const generale = nomiFogli.find((n) => norm(n) === "generale");
  const daLeggere = generale ? [generale] : nomiFogli;

  if (generale && nomiFogli.length > 1) {
    avvisi.push(
      `Il file contiene ${nomiFogli.length} fogli: letto solo "GENERALE", che è già ` +
        `l'unione di tutti gli agenti. Sommare anche gli altri raddoppierebbe il budget.`
    );
  }

  let formatoVisto: FormatoBudget = "sconosciuto";

  for (const nome of daLeggere) {
    const ws = wb.Sheets[nome];
    if (!ws) continue;
    const formato = riconosciFormato(ws);
    if (formato === "sconosciuto") {
      avvisi.push(`Foglio "${nome}": intestazioni non riconosciute, saltato.`);
      continue;
    }
    formatoVisto = formato;
    fogliLetti.push(nome);

    const dati = XLSX.utils.sheet_to_json<RigaGrezza>(ws);

    for (const r of dati) {
      const area = String(valore(r, "area") ?? "").trim();
      const budget = numero(valore(r, "budget"));
      const bep = numero(valore(r, "bep"));

      let data: string | null = null;
      if (formato === "area_settimana") {
        const sett = String(valore(r, "anno-settimana", "annosettimana") ?? "");
        data = lunediDiSettimanaIso(sett);
      } else {
        data = leggiData(valore(r, "data"));
      }

      if (!data) {
        scartate += 1;
        continue;
      }
      if (opzioni.soloAnno && Number(data.slice(0, 4)) !== opzioni.soloAnno) continue;
      // Le righe a zero sono i giorni non lavorativi: si tengono, perché
      // documentano il calendario implicito del file.
      if (!area && budget === 0 && bep === 0) {
        scartate += 1;
        continue;
      }

      const agente =
        formato === "agente_giorno"
          ? String(valore(r, "agente") ?? "").trim() || null
          : null;

      righe.push({
        data,
        area: area || "(non assegnata)",
        agente,
        codiceAgente:
          formato === "agente_giorno"
            ? String(valore(r, "codice agente") ?? "").trim() || null
            : null,
        budget,
        bep,
        granularita: formato === "area_settimana" ? "settimana" : "giorno",
      });
    }
  }

  const anni = [...new Set(righe.map((r) => Number(r.data.slice(0, 4))))].sort();
  const totali: Record<number, { budget: number; bep: number }> = {};
  for (const r of righe) {
    const a = Number(r.data.slice(0, 4));
    totali[a] ??= { budget: 0, bep: 0 };
    totali[a].budget += r.budget;
    totali[a].bep += r.bep;
  }
  for (const a of anni) {
    totali[a].budget = Math.round(totali[a].budget * 100) / 100;
    totali[a].bep = Math.round(totali[a].bep * 100) / 100;
  }

  // Il BEP nel file dei commerciali non esiste: si segnala invece di
  // lasciar credere che sia zero.
  if (formatoVisto === "agente_giorno" && righe.every((r) => r.bep === 0)) {
    avvisi.push(
      "Il file dei commerciali non contiene la colonna BEP: il BEP per agente resterà non definito."
    );
  }

  if (scartate > 0) {
    avvisi.push(`${scartate} righe scartate perché prive di data o completamente vuote.`);
  }

  return {
    serie: {
      origine: "importato",
      formato: formatoVisto,
      importatoIl: new Date().toISOString(),
      anni,
      totaliPerAnno: totali,
      righe,
    },
    avvisi,
    scartate,
    fogliLetti,
  };
}

/**
 * Unisce più serie (es. il file per area + quello per commerciale).
 * Le righe con agente e quelle senza convivono: sono due livelli di dettaglio
 * dello stesso budget, non due budget da sommare.
 */
export function unisciSerie(serie: SerieBudget[]): SerieBudget {
  const righe = serie.flatMap((s) => s.righe);
  const anni = [...new Set(righe.map((r) => Number(r.data.slice(0, 4))))].sort();

  const totali: Record<number, { budget: number; bep: number }> = {};
  for (const r of righe) {
    if (r.agente) continue; // il totale si conta una sola volta, sul livello area
    const a = Number(r.data.slice(0, 4));
    totali[a] ??= { budget: 0, bep: 0 };
    totali[a].budget += r.budget;
    totali[a].bep += r.bep;
  }
  for (const a of anni) {
    if (!totali[a]) continue;
    totali[a].budget = Math.round(totali[a].budget * 100) / 100;
    totali[a].bep = Math.round(totali[a].bep * 100) / 100;
  }

  return {
    origine: "importato",
    formato: "misto",
    importatoIl: new Date().toISOString(),
    anni,
    totaliPerAnno: totali,
    righe,
  };
}
