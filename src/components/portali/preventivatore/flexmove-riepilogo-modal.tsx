"use client"

import { useEffect, useMemo, useState } from "react"
import { X, AlertTriangle, CheckCircle2, PackageSearch, Loader2 } from "lucide-react"
import type { Blocco } from "@/components/portali/preventivatore/nuovo-view-types"

type Giac = { esistenza: number | null; disponibilita: number | null; descrizione: string }

function fmtN(n: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2 }).format(n)
}

/**
 * Modale riepilogo materiali Nastro Flexmove: quantità totali di CATENA, GUIDA
 * e TRAVI (sommate, × pezzi del blocco), con giacenza da anagrafica e alert
 * "da ordinare" se la giacenza è inferiore al preventivato.
 */
export function FlexmoveRiepilogoModal({
  open,
  onClose,
  blocco,
}: {
  open: boolean
  onClose: () => void
  blocco: Blocco
}) {
  const [giac, setGiac] = useState<Record<string, Giac>>({})
  const [loading, setLoading] = useState(false)

  const q = blocco.quantita_pezzi ?? 1

  // Voci: catena, guida — quantità totali nel blocco × pezzi
  const voci = useMemo(() => {
    const totCatena = blocco.articoli.reduce((s, a) => s + (a.qty ?? 0) * (a.metri_catena ?? 0), 0) * q
    const totGuida = blocco.articoli.reduce((s, a) => s + (a.qty ?? 0) * (a.metri_guida ?? 0), 0) * q
    return [
      { key: "catena", label: "Catena", codice: blocco.catena_articolo?.codice ?? "", qta: totCatena, unita: "m" },
      { key: "guida", label: "Guida", codice: blocco.guida_articolo?.codice ?? "", qta: totGuida, unita: "m" },
    ]
  }, [blocco, q])

  useEffect(() => {
    if (!open) return
    const codici = voci.map((v) => v.codice).filter(Boolean)
    if (codici.length === 0) { setGiac({}); return }
    setLoading(true)
    fetch(`/api/portali/preventivatore/prodotti/giacenza?codici=${encodeURIComponent(codici.join(","))}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: Array<{ codice: string } & Giac> }) => {
        const m: Record<string, Giac> = {}
        for (const it of d.items ?? []) m[it.codice] = { esistenza: it.esistenza, disponibilita: it.disponibilita, descrizione: it.descrizione }
        setGiac(m)
      })
      .catch(() => setGiac({}))
      .finally(() => setLoading(false))
  }, [open, voci])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-bg border border-border shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-text font-semibold">
            <PackageSearch className="w-4 h-4 text-[#007a91]" />
            Riepilogo materiali — {blocco.nome || blocco.tipo}
            {q > 1 && <span className="text-xs text-text-muted font-normal">× {q} pezzi</span>}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5">
          <table className="w-full text-sm">
            <thead className="bg-bg-page">
              <tr className="text-left text-[10px] uppercase tracking-wide text-text-muted">
                <th className="px-3 py-2 font-medium">Voce</th>
                <th className="px-3 py-2 font-medium">Codice</th>
                <th className="px-3 py-2 font-medium text-right">Preventivato</th>
                <th className="px-3 py-2 font-medium text-right">Giacenza</th>
                <th className="px-3 py-2 font-medium text-right">Stato</th>
              </tr>
            </thead>
            <tbody>
              {voci.map((v) => {
                const g = v.codice ? giac[v.codice] : undefined
                const esist = g?.esistenza ?? null
                const mancante = esist != null && esist < v.qta
                return (
                  <tr key={v.key} className="border-t border-border">
                    <td className="px-3 py-2 text-text">{v.label}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[#00a1be]">{v.codice || <span className="text-text-muted">— da selezionare</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtN(v.qta)} {v.unita}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {loading ? <Loader2 className="inline w-3.5 h-3.5 animate-spin" /> : (esist != null ? `${fmtN(esist)} ${v.unita}` : (v.codice ? "n/d" : "—"))}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {esist == null ? (
                        <span className="text-text-muted text-xs">—</span>
                      ) : mancante ? (
                        <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" /> da ordinare {fmtN(v.qta - esist)} {v.unita}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                          <CheckCircle2 className="w-3.5 h-3.5" /> disponibile
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] text-text-muted">
            Le quantità includono i pezzi del blocco. La giacenza è quella corrente in anagrafica
            (somma magazzini). &quot;n/d&quot; = codice non presente in anagrafica.
          </p>
        </div>
      </div>
    </div>
  )
}
