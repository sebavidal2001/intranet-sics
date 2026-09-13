"use client";

/**
 *
 * Tabella analitica. Una tabella che mostra solo "nome e valore" costringe
 * chi legge a fare i conti a mente: qui ogni riga porta con sé il confronto
 * con l'anno precedente, lo scostamento dal budget, la quota sul totale e
 * l'andamento nel tempo.
 */

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";
import { euro, numero, valoreFmt } from "./primitivi";
import { Sparkline } from "./grafici-avanzati";
import type { RisultatoQuery, UnitaMisura } from "@/lib/prototipo-bi/tipi";

export type TipoColonna =
  | "testo"
  | "euro"
  | "numero"
  | "percentuale"
  | "delta_euro"
  | "delta_pct"
  | "barra"
  | "sparkline"
  | "raggiungimento";

/**
 * Come si calcola il totale di colonna.
 *
 * Sommare tutto era sbagliato in modo visibile: le righe medie per preventivo
 * diventavano 23 invece di 3, e i giorni medi di risposta 2 invece di 0,3.
 * Ogni colonna dichiara quindi come va aggregata.
 */
export type TotaleColonna =
  | { tipo: "somma" }
  /** Rapporto fra le somme di altre due colonne (percentuale). */
  | { tipo: "rapporto"; numeratore: string; denominatore: string; percentuale?: boolean }
  /** Media pesata sui valori di un'altra colonna. */
  | { tipo: "media_pesata"; peso: string }
  /** Nessun totale sensato: la cella resta vuota. */
  | { tipo: "nessuno" };

export interface ColonnaAnalitica {
  chiave: string;
  etichetta: string;
  tipo: TipoColonna;
  /**
   * Unità del valore. Serve alle colonne numeriche e alle barre, che
   * altrimenti verrebbero formattate tutte in euro: nella tabella del back
   * office il numero di preventivi compariva come "418 €".
   */
  unita?: UnitaMisura;
  /** Cifre decimali per le colonne numeriche. Default 0. */
  decimali?: number;
  /** Per delta e raggiungimento: true se un valore alto è positivo. */
  altoBuono?: boolean;
  larghezza?: string;
  titolo?: string;
  /** Strategia di totale. Default: somma per le colonne numeriche. */
  totale?: TotaleColonna;
}

export interface RigaAnalitica {
  chiave: string;
  celle: Record<string, number | string | number[] | null | undefined>;
}

function fmt(v: unknown, col: ColonnaAnalitica): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) && col.tipo !== "testo") return "—";
  const unita: UnitaMisura = col.unita ?? "euro";

  switch (col.tipo) {
    case "euro":
    case "barra":
      // Le barre e i valori numerici seguono l'unità dichiarata: senza,
      // il conteggio dei preventivi finiva stampato come "418 €".
      return valoreFmt(n, unita, false);
    case "numero":
      return col.decimali
        ? n.toLocaleString("it-IT", {
            minimumFractionDigits: col.decimali,
            maximumFractionDigits: col.decimali,
          })
        : valoreFmt(n, col.unita ?? "numero", false);
    case "percentuale":
      return `${n.toFixed(col.decimali ?? 1)}%`;
    case "delta_euro":
      return `${n >= 0 ? "+" : ""}${valoreFmt(n, unita, false)}`;
    case "delta_pct":
      return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
    case "raggiungimento":
      return `${n.toFixed(0)}%`;
    default:
      return String(v);
  }
}

function coloreDelta(n: number, altoBuono = true): string {
  if (Math.abs(n) < 0.0001) return "text-text-muted";
  const positivo = altoBuono ? n > 0 : n < 0;
  return positivo ? "text-success" : "text-danger";
}

export function TabellaAnalitica({
  colonne,
  righe,
  colonnaDimensione = "Voce",
  colonnaOrdinamentoIniziale,
  mostraTotali = true,
  massimoIniziale = 12,
  onClickRiga,
  rigaEvidenziata,
  ricercabile = true,
}: {
  colonne: ColonnaAnalitica[];
  righe: RigaAnalitica[];
  colonnaDimensione?: string;
  colonnaOrdinamentoIniziale?: string;
  mostraTotali?: boolean;
  massimoIniziale?: number;
  onClickRiga?: (chiave: string) => void;
  rigaEvidenziata?: string | null;
  ricercabile?: boolean;
}) {
  const [ordinaPer, setOrdinaPer] = useState<string>(
    colonnaOrdinamentoIniziale ?? colonne.find((c) => c.tipo !== "testo")?.chiave ?? ""
  );
  const [discendente, setDiscendente] = useState(true);
  const [tutte, setTutte] = useState(false);
  const [cerca, setCerca] = useState("");

  const massimoBarra = useMemo(() => {
    const colBarra = colonne.find((c) => c.tipo === "barra");
    if (!colBarra) return 1;
    return Math.max(
      ...righe.map((r) => Math.abs(Number(r.celle[colBarra.chiave] ?? 0))),
      1
    );
  }, [colonne, righe]);

  const filtrate = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    if (!q) return righe;
    return righe.filter((r) => r.chiave.toLowerCase().includes(q));
  }, [righe, cerca]);

  const ordinate = useMemo(() => {
    const col = colonne.find((c) => c.chiave === ordinaPer);
    if (!col) return filtrate;
    return [...filtrate].sort((a, b) => {
      const va = a.celle[ordinaPer];
      const vb = b.celle[ordinaPer];
      if (col.tipo === "testo") {
        return discendente
          ? String(vb ?? "").localeCompare(String(va ?? ""))
          : String(va ?? "").localeCompare(String(vb ?? ""));
      }
      const na = Number(va ?? 0);
      const nb = Number(vb ?? 0);
      return discendente ? nb - na : na - nb;
    });
  }, [filtrate, ordinaPer, discendente, colonne]);

  const visibili = tutte ? ordinate : ordinate.slice(0, massimoIniziale);

  const totali = useMemo(() => {
    if (!mostraTotali) return null;

    const somma = (chiave: string) =>
      filtrate.reduce((s, r) => s + (Number(r.celle[chiave]) || 0), 0);

    const t: Record<string, number | null> = {};
    for (const c of colonne) {
      if (c.tipo === "testo" || c.tipo === "sparkline") continue;

      const strategia: TotaleColonna =
        c.totale ??
        // Senza indicazione esplicita, percentuali e rapporti non si sommano:
        // meglio nessun totale che un totale sbagliato.
        (c.tipo === "percentuale" || c.tipo === "delta_pct" || c.tipo === "raggiungimento"
          ? { tipo: "nessuno" }
          : { tipo: "somma" });

      switch (strategia.tipo) {
        case "somma":
          t[c.chiave] = somma(c.chiave);
          break;
        case "rapporto": {
          const den = somma(strategia.denominatore);
          const num = somma(strategia.numeratore);
          t[c.chiave] = den === 0 ? null : (num / den) * (strategia.percentuale === false ? 1 : 100);
          break;
        }
        case "media_pesata": {
          const peso = somma(strategia.peso);
          if (peso === 0) {
            t[c.chiave] = null;
            break;
          }
          const pesata = filtrate.reduce(
            (s, r) => s + (Number(r.celle[c.chiave]) || 0) * (Number(r.celle[strategia.peso]) || 0),
            0
          );
          t[c.chiave] = pesata / peso;
          break;
        }
        case "nessuno":
          t[c.chiave] = null;
          break;
      }
    }

    // Le colonne di confronto costruite da `colonneConfronto` sanno derivare
    // il proprio totale dalle altre: quota sempre 100%, delta % ricalcolato.
    const colValore = colonne.find((c) => c.chiave === "valore");
    const colPrec = colonne.find((c) => c.chiave === "precedente");
    const colDeltaPct = colonne.find((c) => c.chiave === "deltaAPPct");
    if (colValore && colPrec && colDeltaPct) {
      const prec = somma("precedente");
      t.deltaAPPct = prec === 0 ? null : ((somma("valore") - prec) / Math.abs(prec)) * 100;
    }
    const colRagg = colonne.find((c) => c.chiave === "raggiungimento");
    if (colRagg && colonne.some((c) => c.chiave === "budget")) {
      const b = somma("budget");
      t.raggiungimento = b === 0 ? null : (somma("valore") / b) * 100;
    }
    if (colonne.some((c) => c.chiave === "quota")) t.quota = 100;

    return t;
  }, [filtrate, colonne, mostraTotali]);

  function intestazione(c: ColonnaAnalitica) {
    const attiva = ordinaPer === c.chiave;
    return (
      <th
        key={c.chiave}
        className={`py-2 px-2 font-tenorite text-[11px] uppercase tracking-wide whitespace-nowrap ${
          c.tipo === "testo" ? "text-left" : "text-right"
        }`}
        style={{ width: c.larghezza }}
        title={c.titolo}
      >
        <button
          onClick={() => {
            if (attiva) setDiscendente((d) => !d);
            else {
              setOrdinaPer(c.chiave);
              setDiscendente(true);
            }
          }}
          className={`inline-flex items-center gap-1 hover:text-primary transition-colors ${
            attiva ? "text-primary" : "text-text-muted"
          }`}
        >
          {c.etichetta}
          {attiva ? (
            discendente ? (
              <ArrowDown className="w-3 h-3" aria-hidden />
            ) : (
              <ArrowUp className="w-3 h-3" aria-hidden />
            )
          ) : (
            <ChevronsUpDown className="w-3 h-3 opacity-40" aria-hidden />
          )}
        </button>
      </th>
    );
  }

  function cella(r: RigaAnalitica, c: ColonnaAnalitica) {
    const v = r.celle[c.chiave];

    if (c.tipo === "sparkline") {
      const valori = Array.isArray(v) ? (v as number[]) : [];
      return (
        <td key={c.chiave} className="py-1 px-2">
          <div className="flex justify-end">
            <Sparkline valori={valori} />
          </div>
        </td>
      );
    }

    if (c.tipo === "barra") {
      const n = Number(v ?? 0);
      const larghezza = Math.min(100, (Math.abs(n) / massimoBarra) * 100);
      return (
        <td key={c.chiave} className="py-1.5 px-2 relative">
          <div
            className="absolute inset-y-1 left-2 rounded bg-primary/12"
            style={{ width: `calc(${larghezza}% - 8px)` }}
            aria-hidden
          />
          <span className="relative tabular-nums font-medium text-right block">
            {fmt(n, c)}
          </span>
        </td>
      );
    }

    if (c.tipo === "raggiungimento") {
      const n = Number(v ?? 0);
      const colore = n >= 100 ? "bg-success" : n >= 85 ? "bg-warning" : "bg-danger";
      return (
        <td key={c.chiave} className="py-1.5 px-2">
          <div className="flex items-center gap-2 justify-end">
            <div className="w-14 h-1.5 rounded-full bg-bg-page overflow-hidden">
              <div
                className={`h-full ${colore} transition-all duration-500`}
                style={{ width: `${Math.min(100, n)}%` }}
              />
            </div>
            <span className="tabular-nums text-xs w-10 text-right">{fmt(n, c)}</span>
          </div>
        </td>
      );
    }

    const n = Number(v ?? 0);
    const isDelta = c.tipo === "delta_euro" || c.tipo === "delta_pct";
    return (
      <td
        key={c.chiave}
        className={`py-1.5 px-2 tabular-nums ${c.tipo === "testo" ? "text-left" : "text-right"} ${
          isDelta ? coloreDelta(n, c.altoBuono ?? true) + " font-medium" : ""
        }`}
      >
        {fmt(v, c)}
      </td>
    );
  }

  return (
    <div>
      {ricercabile && righe.length > 8 && (
        <div className="relative mb-2">
          <Search
            className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <input
            value={cerca}
            onChange={(e) => setCerca(e.target.value)}
            placeholder="Filtra…"
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-bg"
          />
        </div>
      )}

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 px-2 text-left font-tenorite text-[11px] uppercase tracking-wide text-text-muted">
                {colonnaDimensione}
              </th>
              {colonne.map(intestazione)}
            </tr>
          </thead>
          <tbody>
            {visibili.map((r) => {
              const evidenziata = rigaEvidenziata === r.chiave;
              return (
                <tr
                  key={r.chiave}
                  onClick={() => onClickRiga?.(r.chiave)}
                  className={`border-b border-border/50 last:border-0 transition-colors ${
                    onClickRiga ? "cursor-pointer hover:bg-primary/5" : ""
                  } ${evidenziata ? "bg-primary/10" : ""}`}
                >
                  <td
                    className="py-1.5 px-2 max-w-[240px] truncate font-medium"
                    title={r.chiave}
                  >
                    {r.chiave}
                  </td>
                  {colonne.map((c) => cella(r, c))}
                </tr>
              );
            })}

            {visibili.length === 0 && (
              <tr>
                <td
                  colSpan={colonne.length + 1}
                  className="py-6 text-center text-xs text-text-muted"
                >
                  Nessuna riga
                </td>
              </tr>
            )}
          </tbody>

          {totali && visibili.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border font-semibold bg-bg-page/60">
                <td className="py-2 px-2">Totale ({filtrate.length})</td>
                {colonne.map((c) => {
                  if (c.tipo === "sparkline") return <td key={c.chiave} />;
                  const v = totali[c.chiave];
                  if (v === undefined || v === null)
                    return (
                      <td key={c.chiave} className="py-2 px-2 text-right text-text-muted">
                        —
                      </td>
                    );
                  const isDelta = c.tipo === "delta_euro" || c.tipo === "delta_pct";
                  return (
                    <td
                      key={c.chiave}
                      className={`py-2 px-2 text-right tabular-nums ${
                        isDelta ? coloreDelta(v, c.altoBuono ?? true) : ""
                      }`}
                    >
                      {fmt(v, c)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {ordinate.length > massimoIniziale && (
        <button
          onClick={() => setTutte((t) => !t)}
          className="mt-2 text-xs text-primary hover:underline"
        >
          {tutte
            ? `Mostra solo le prime ${massimoIniziale}`
            : `Mostra tutte le ${ordinate.length} righe`}
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Costruzione delle righe dai risultati delle query
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Unisce corrente, anno precedente, budget e serie storica in righe pronte
 * per la tabella. Ogni confronto è calcolato qui una volta sola, invece che
 * a mente da chi legge.
 */
export function costruisciConfronto(opzioni: {
  corrente?: RisultatoQuery;
  precedente?: RisultatoQuery;
  budget?: RisultatoQuery;
  /** Serie temporale per la sparkline: raggruppata per dimensione + periodo. */
  serie?: RisultatoQuery;
  dimensione?: string;
}): { righe: RigaAnalitica[]; totaleCorrente: number } {
  const { corrente, precedente, budget, serie, dimensione } = opzioni;
  if (!corrente) return { righe: [], totaleCorrente: 0 };

  const mappaAP = new Map(precedente?.righe.map((r) => [r.etichetta, r.valore]) ?? []);
  const mappaBudget = new Map(budget?.righe.map((r) => [r.etichetta, r.valore]) ?? []);

  // La serie ha etichette "periodo · dimensione": si ricompone per chiave.
  const serieMappa = new Map<string, { periodo: string; valore: number }[]>();
  if (serie && dimensione) {
    for (const r of serie.righe) {
      const chiave = r.chiavi[dimensione];
      const periodo = r.chiavi.periodo;
      if (!chiave || !periodo) continue;
      const lista = serieMappa.get(chiave) ?? [];
      lista.push({ periodo, valore: r.valore });
      serieMappa.set(chiave, lista);
    }
  }

  const totaleCorrente = corrente.righe.reduce((s, r) => s + r.valore, 0);

  const righe: RigaAnalitica[] = corrente.righe.map((r) => {
    const ap = mappaAP.get(r.etichetta) ?? 0;
    const bdg = mappaBudget.get(r.etichetta) ?? 0;
    const deltaAP = r.valore - ap;
    const deltaAPPct = ap !== 0 ? (deltaAP / Math.abs(ap)) * 100 : 0;
    const scostBudget = r.valore - bdg;
    const raggiungimento = bdg !== 0 ? (r.valore / bdg) * 100 : 0;

    const storia = (serieMappa.get(r.etichetta) ?? [])
      .sort((a, b) => a.periodo.localeCompare(b.periodo))
      .map((x) => x.valore);

    return {
      chiave: r.etichetta,
      celle: {
        valore: r.valore,
        precedente: ap,
        deltaAP,
        deltaAPPct,
        quota: totaleCorrente ? (r.valore / totaleCorrente) * 100 : 0,
        budget: bdg,
        scostBudget,
        raggiungimento,
        andamento: storia,
        righe: r.conteggio,
      },
    };
  });

  return { righe, totaleCorrente };
}

/** Set di colonne pronto per il confronto standard. */
export function colonneConfronto(opzioni: {
  annoCorrente: number;
  conBudget?: boolean;
  conSparkline?: boolean;
}): ColonnaAnalitica[] {
  const col: ColonnaAnalitica[] = [
    { chiave: "valore", etichetta: String(opzioni.annoCorrente), tipo: "barra" },
    { chiave: "precedente", etichetta: String(opzioni.annoCorrente - 1), tipo: "euro" },
    { chiave: "deltaAP", etichetta: "Δ €", tipo: "delta_euro", altoBuono: true },
    {
      chiave: "deltaAPPct",
      etichetta: "Δ %",
      tipo: "delta_pct",
      altoBuono: true,
      totale: { tipo: "rapporto", numeratore: "deltaAP", denominatore: "precedente" },
    },
    { chiave: "quota", etichetta: "Quota", tipo: "percentuale" },
  ];

  if (opzioni.conBudget) {
    col.push(
      { chiave: "budget", etichetta: "Budget", tipo: "euro" },
      {
        chiave: "scostBudget",
        etichetta: "Δ budget",
        tipo: "delta_euro",
        altoBuono: true,
        titolo: "Scostamento dal budget nello stesso periodo",
      },
      {
        chiave: "raggiungimento",
        etichetta: "Raggiung.",
        tipo: "raggiungimento",
        totale: { tipo: "rapporto", numeratore: "valore", denominatore: "budget" },
      }
    );
  }

  if (opzioni.conSparkline) {
    col.push({ chiave: "andamento", etichetta: "Andamento", tipo: "sparkline", larghezza: "110px" });
  }

  return col;
}
