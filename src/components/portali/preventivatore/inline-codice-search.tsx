"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { fmtEur, type Prodotto } from "@/components/portali/preventivatore/nuovo-view-types"

/**
 * Input "codice" con autocomplete sull'anagrafica (come la ricerca articoli classica):
 * mentre si digita propone i codici che matchano. Selezionando un risultato si
 * compila la riga (onPick); la digitazione libera resta possibile (onText).
 */
export function InlineCodiceSearch({
  value,
  onText,
  onPick,
}: {
  value: string
  onText: (codice: string) => void
  onPick: (p: Prodotto) => void
}) {
  const [risultati, setRisultati] = useState<Prodotto[]>([])
  const [aperto, setAperto] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const cerca = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.trim().length < 1) { setRisultati([]); setAperto(false); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/portali/preventivatore/prodotti?q=${encodeURIComponent(q)}`)
        if (res.ok) { setRisultati(await res.json()); setAperto(true) }
      } catch { /* ignora */ }
    }, 250)
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setAperto(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <input
        value={value}
        onChange={(e) => { onText(e.target.value); cerca(e.target.value) }}
        // Anche modificando un codice già presente: al focus rilancia la ricerca
        // sul testo corrente, così compaiono subito i codici che lo contengono
        // (stesso comportamento dell'inserimento ex novo).
        onFocus={() => { if (value.trim().length >= 1) cerca(value); else if (risultati.length > 0) setAperto(true) }}
        placeholder="Codice…"
        className="w-full font-mono text-xs text-[#00a1be] bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 rounded px-1"
        title="Codice articolo: digita per cercarlo in anagrafica"
      />
      {aperto && risultati.length > 0 && (
        <div className="absolute z-50 mt-1 w-72 rounded-lg border border-border bg-bg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {risultati.map((p) => (
            <button
              key={p.id}
              onClick={() => { onPick(p); setAperto(false) }}
              className="w-full text-left px-2.5 py-1.5 hover:bg-bg-page transition-colors border-b border-border last:border-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-medium text-[#00a1be] truncate">{p.codice}</span>
                {p.ult_costo != null && <span className="text-[11px] text-text-muted shrink-0">{fmtEur(p.ult_costo)}</span>}
              </div>
              <div className="text-[11px] text-text truncate">{p.descrizione}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
