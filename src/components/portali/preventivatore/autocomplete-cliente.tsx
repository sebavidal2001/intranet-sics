"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { Loader2, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { Cliente } from "@/components/portali/preventivatore/nuovo-view-types"

export type { Cliente }

// ─── AutocompleteCliente ──────────────────────────────────────────────────────

export function AutocompleteCliente({
  onSelect,
  valore,
}: {
  onSelect: (c: Cliente | null) => void
  valore: Cliente | null
}) {
  const [testo, setTesto] = useState(valore?.ragione_sociale ?? "")
  const [risultati, setRisultati] = useState<Cliente[]>([])
  const [aperto, setAperto] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Sync external reset
  useEffect(() => {
    if (!valore) setTesto("")
  }, [valore])

  const cerca = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 1) {
      setRisultati([])
      setAperto(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/portali/preventivatore/clienti?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data: Cliente[] = await res.json()
          setRisultati(data)
          setAperto(true)
        }
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setAperto(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <Input
          value={testo}
          onChange={(e) => {
            setTesto(e.target.value)
            if (valore) onSelect(null)
            cerca(e.target.value)
          }}
          placeholder="Cerca ragione sociale..."
          className="pr-8"
        />
        {loading && (
          <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-text-muted" />
        )}
        {valore && (
          <button
            onClick={() => { onSelect(null); setTesto("") }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-red-500"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {aperto && risultati.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-bg shadow-lg overflow-hidden">
          {risultati.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onSelect(c)
                setTesto(c.ragione_sociale)
                setAperto(false)
              }}
              className="w-full text-left px-3 py-2 hover:bg-bg-page transition-colors"
            >
              <div className="text-sm font-medium text-text">{c.ragione_sociale}</div>
              <div className="text-xs text-text-muted">
                {[c.piva && `P.IVA ${c.piva}`, c.citta, c.provincia].filter(Boolean).join(" · ")}
              </div>
            </button>
          ))}
        </div>
      )}

      {aperto && risultati.length === 0 && !loading && testo.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-bg shadow-lg px-3 py-2 text-sm text-text-muted">
          Nessun cliente trovato
        </div>
      )}
    </div>
  )
}
