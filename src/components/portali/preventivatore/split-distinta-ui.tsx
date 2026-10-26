"use client"

import { useState } from "react"
import { PieChart } from "lucide-react"
import { COMPONENTI } from "@/lib/portali/preventivatore/split-costi"
import { composizioneArticolo } from "@/components/portali/preventivatore/split-builder"
import {
  calcTotaleServizio,
  fmtEur,
  type ArticoloBlocco,
  type ServizioBlocco,
} from "@/components/portali/preventivatore/nuovo-view-types"

/**
 * Interfaccia dello split di costo nel builder (migration 158):
 *   - SplitInfo: icona accanto a ULT.COSTO di un articolo splittato; al passaggio del mouse (o al
 *     tocco) mostra la composizione del suo costo pieno. Il pannello esiste solo da aperto.
 *   - CostiDaDistinta: le righe automatiche di manodopera e trattamenti, in una sezione separata
 *     dalle lavorazioni che aggiunge l'utente.
 */

const COLORI = {
  materiale: "#00a1be",
  manodopera: "#f59e0b",
  lavorazione: "#8b5cf6",
  lav_esterna: "#ef4444",
  altro: "#94a3b8",
} as const

export function SplitInfo({ articolo }: { articolo: ArticoloBlocco }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const parti = composizioneArticolo(articolo)
  if (!parti) return null
  const totale = parti.reduce((s, p) => s + p.valore, 0)

  function apri(el: HTMLElement) {
    const r = el.getBoundingClientRect()
    // Il pannello e' largo 260 px: si apre a sinistra dell'icona, senza uscire dallo schermo.
    setPos({ x: Math.max(8, r.right - 260), y: r.bottom + 6 })
  }

  return (
    <>
      <button
        type="button"
        onMouseEnter={(e) => apri(e.currentTarget)}
        onMouseLeave={() => setPos(null)}
        onFocus={(e) => apri(e.currentTarget)}
        onBlur={() => setPos(null)}
        onClick={(e) => (pos ? setPos(null) : apri(e.currentTarget))}
        className="shrink-0 text-[#00a1be] hover:text-[#007a91] focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 rounded"
        aria-label="Composizione del costo dell'articolo"
      >
        <PieChart className="w-3.5 h-3.5" />
      </button>
      {pos && (
        <div
          role="tooltip"
          style={{ position: "fixed", left: pos.x, top: pos.y, width: 260, zIndex: 60 }}
          className="rounded-lg border border-border bg-bg shadow-lg p-3 pointer-events-none"
        >
          <p className="text-xs font-semibold text-text mb-1.5">Composizione del costo (1 pz)</p>
          <div className="h-2.5 rounded bg-slate-100 overflow-hidden flex mb-2">
            {parti.map((p) => (
              <div key={p.chiave} style={{ width: `${(p.valore / totale) * 100}%`, background: COLORI[p.chiave] }} />
            ))}
          </div>
          <dl className="space-y-0.5 text-xs">
            {parti.map((p) => (
              <div key={p.chiave} className="flex items-center justify-between gap-3">
                <dt className="inline-flex items-center gap-1.5 text-text-muted">
                  <span className="w-2 h-2 rounded-sm" style={{ background: COLORI[p.chiave] }} />
                  {COMPONENTI.find((c) => c.chiave === p.chiave)?.etichetta}
                </dt>
                <dd className="tabular-nums text-text">
                  {fmtEur(p.valore)} <span className="text-[10px] text-text-muted">({((p.valore / totale) * 100).toFixed(0)}%)</span>
                </dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-border pt-1 mt-1 font-medium">
              <dt className="text-text">Costo pieno</dt>
              <dd className="tabular-nums text-text">{fmtEur(totale)}</dd>
            </div>
          </dl>
          <p className="mt-1.5 text-[10px] text-text-muted italic">
            In ULT.COSTO resta la materia prima; il resto e&apos; nelle righe «da distinta».
          </p>
        </div>
      )}
    </>
  )
}

export function CostiDaDistinta({ servizi, quantita }: { servizi: ServizioBlocco[]; quantita: number }) {
  if (servizi.length === 0) return null
  const totale = servizi.reduce((s, x) => s + calcTotaleServizio(x), 0)
  const costo = servizi.reduce((s, x) => s + x.tariffa_ora * x.ore, 0)
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <span className="text-sm font-semibold text-text">Costi da distinta</span>
        <span className="text-xs text-text-muted">Impresa · si aggiornano con gli articoli</span>
        <span className="ml-auto text-sm font-semibold text-text tabular-nums">{fmtEur(totale)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-bg-page">
              <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border">Voce</th>
              <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-28" title="Costo dell'intero lotto">Costo lotto</th>
              <th className="text-center text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-20" title="Ricarico medio: lascia invariato il prezzo di vendita degli articoli">Ricarico</th>
              <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-28">Totale</th>
            </tr>
          </thead>
          <tbody>
            {servizi.map((s) => (
              <tr key={s._key} className="bg-bg-page/30">
                <td className="px-2 py-1.5 border border-border text-sm text-text">{s.nome}</td>
                <td className="px-2 py-1.5 border border-border text-right text-sm text-text-muted tabular-nums">{fmtEur(s.tariffa_ora * s.ore)}</td>
                <td className="px-2 py-1.5 border border-border text-center text-xs text-text-muted tabular-nums">{s.coeff_ricarico.toFixed(2)}</td>
                <td className="px-2 py-1.5 border border-border text-right text-sm font-medium text-text tabular-nums">
                  {fmtEur(calcTotaleServizio(s))}
                  {quantita > 1 && <span className="block text-[10px] text-emerald-600">÷{quantita} = {fmtEur(calcTotaleServizio(s) / quantita)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-text-muted italic">
        Costo {fmtEur(costo)}. Non si modificano qui: derivano da quantità e pezzi degli articoli con standard in Impresa.
        Le lavorazioni da aggiungere a mano stanno nella sezione sotto.
      </p>
    </div>
  )
}
