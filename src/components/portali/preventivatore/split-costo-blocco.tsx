"use client"

import { useEffect, useMemo, useState } from "react"
import {
  COMPONENTI,
  SPLIT_VUOTO,
  applicaQuote,
  totaleSplit,
  type SplitCosti,
} from "@/lib/portali/preventivatore/split-costi"
import { normalizzaCodice } from "@/lib/portali/preventivatore/listini"
import {
  calcCostoArticolo,
  calcCostoServizio,
  multServizioUnitario,
  fmtEur,
  type Blocco,
} from "@/components/portali/preventivatore/nuovo-view-types"

/**
 * Anteprima della composizione del costo di un blocco (per 1 pz): materia prima, manodopera,
 * lavorazioni, trattamenti esterni. Le percentuali di ogni articolo vengono dallo standard di
 * Impresa (migration 157) e si applicano al costo che il builder sta usando, quindi i
 * componenti sommano al «Costo (1 pz)» del riepilogo. Le lavorazioni del blocco sono tutte
 * manodopera. Il salvataggio congela lo stesso split nel database (trigger su righe_distinta).
 */

const COLORI: Record<keyof SplitCosti, string> = {
  materiale: "#00a1be",
  manodopera: "#f59e0b",
  lavorazione: "#8b5cf6",
  lav_esterna: "#ef4444",
  altro: "#94a3b8",
}

type Quote = SplitCosti & { costo_totale: number }

// Cache di modulo: lo split cambia una volta al giorno, non serve rileggerlo a ogni tasto premuto.
const cache = new Map<string, Quote | null>()

export function SplitCostoBlocco({ blocco, q }: { blocco: Blocco; q: number }) {
  const codici = useMemo(
    () => Array.from(new Set(blocco.articoli.map((a) => a.codice).filter((c) => c && c.trim()))),
    [blocco.articoli]
  )
  const chiave = codici.join("|")
  const [versione, setVersione] = useState(0)

  useEffect(() => {
    const mancanti = codici.filter((c) => !cache.has(normalizzaCodice(c)))
    if (mancanti.length === 0) return
    let vivo = true
    const t = setTimeout(() => {
      fetch(`/api/portali/preventivatore/costi-split?codici=${encodeURIComponent(mancanti.join(","))}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { split?: Record<string, Quote> } | null) => {
          if (!vivo || !j?.split) return
          for (const c of mancanti) cache.set(normalizzaCodice(c), j.split[normalizzaCodice(c)] ?? null)
          setVersione((v) => v + 1)
        })
        .catch(() => { /* anteprima opzionale: senza split resta tutto «materiale» */ })
    }, 300)
    return () => { vivo = false; clearTimeout(t) }
    // `chiave` riassume i codici: evita di rilanciare a ogni nuovo array con gli stessi valori.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiave])

  const { split, conStandard, senzaStandard } = useMemo(() => {
    void versione
    const tot: SplitCosti = { ...SPLIT_VUOTO }
    let con = 0
    let senza = 0
    for (const a of blocco.articoli) {
      const costo = calcCostoArticolo(a)
      if (!(costo > 0)) continue
      const rif = a.codice ? cache.get(normalizzaCodice(a.codice)) ?? null : null
      const { split: s, fonte } = applicaQuote(costo, rif)
      if (fonte === "impresa") con++
      else senza++
      tot.materiale += s.materiale
      tot.manodopera += s.manodopera
      tot.lavorazione += s.lavorazione
      tot.lav_esterna += s.lav_esterna
      tot.altro += s.altro
    }
    for (const sv of blocco.servizi) {
      tot.manodopera += calcCostoServizio(sv) * multServizioUnitario(sv, q)
    }
    return { split: tot, conStandard: con, senzaStandard: senza }
  }, [blocco.articoli, blocco.servizi, q, versione])

  const totale = totaleSplit(split)
  if (!(totale > 0)) return null

  return (
    <div className="mt-3 pt-3 border-t border-border">
      <p className="text-xs font-medium text-text mb-1.5">Composizione del costo (1 pz)</p>
      <div className="h-2.5 rounded bg-slate-100 overflow-hidden flex">
        {COMPONENTI.map((k) =>
          split[k.chiave] > 0 ? (
            <div key={k.chiave} title={`${k.etichetta}: ${fmtEur(split[k.chiave])}`} style={{ width: `${(split[k.chiave] / totale) * 100}%`, background: COLORI[k.chiave] }} />
          ) : null
        )}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
        {COMPONENTI.filter((k) => split[k.chiave] > 0.005).map((k) => (
          <div key={k.chiave} className="contents">
            <dt className="text-text-muted inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ background: COLORI[k.chiave] }} />{k.etichetta}
            </dt>
            <dd className="text-right tabular-nums text-text-muted">
              {fmtEur(split[k.chiave])} <span className="text-[10px]">({((split[k.chiave] / totale) * 100).toFixed(0)}%)</span>
            </dd>
          </div>
        ))}
      </dl>
      {senzaStandard > 0 && (
        <p className="mt-1.5 text-[10px] text-text-muted italic">
          {senzaStandard} {senzaStandard === 1 ? "articolo senza" : "articoli senza"} standard in Impresa: contati interamente come materia prima
          {conStandard > 0 ? `; ${conStandard} divisi secondo lo standard.` : "."}
        </p>
      )}
    </div>
  )
}
