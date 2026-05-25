"use client"

import { useState, useCallback, useRef, useEffect, useMemo } from "react"
import { Loader2, X, ChevronRight, ChevronDown, Building2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import type { Cliente } from "@/components/portali/preventivatore/nuovo-view-types"

export type { Cliente }

// ─── AutocompleteCliente a 2 livelli ──────────────────────────────────────────
//
// Step 1: l'utente cerca per ragione sociale → mostro 1 entry per cliente
//         (deduplico per codice_cliente).
// Step 2: scelta la ragione, carico TUTTE le destinazioni del codice_cliente
//         e l'utente seleziona la sede/divisione corretta.
// Se il cliente ha 1 sola destinazione (HQ pura), la auto-seleziono e salto step 2.

interface RagioneAggregata {
  codice_cliente: string
  ragione_sociale: string
  citta: string | null
  provincia: string | null
  agente_nome: string | null
  n_destinazioni: number
}

export function AutocompleteCliente({
  onSelect,
  valore,
}: {
  onSelect: (c: Cliente | null) => void
  valore: Cliente | null
}) {
  // Step 1 — ricerca ragione
  const [testo, setTesto] = useState(valore?.ragione_sociale ?? "")
  const [risultatiRaw, setRisultatiRaw] = useState<Cliente[]>([])
  const [aperto, setAperto] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Step 2 — destinazioni
  const [ragioneScelta, setRagioneScelta] = useState<RagioneAggregata | null>(null)
  const [destinazioni, setDestinazioni] = useState<Cliente[]>([])
  const [loadingDest, setLoadingDest] = useState(false)

  // Sync esterno: reset
  useEffect(() => {
    if (!valore) {
      setTesto("")
      setRagioneScelta(null)
      setDestinazioni([])
    } else {
      setTesto(valore.ragione_sociale)
    }
  }, [valore])

  // Deduplica per codice_cliente (mostriamo 1 entry per cliente nello step 1)
  const ragioniAggregate = useMemo<RagioneAggregata[]>(() => {
    const map = new Map<string, RagioneAggregata>()
    for (const c of risultatiRaw) {
      if (!c.codice_cliente) continue
      const ex = map.get(c.codice_cliente)
      if (ex) {
        ex.n_destinazioni += 1
        // Preferisci come "representante" l'HQ pura
        if (c.is_hq) {
          ex.citta = c.citta ?? null
          ex.provincia = c.provincia ?? null
          ex.agente_nome = c.agente_nome ?? null
        }
      } else {
        map.set(c.codice_cliente, {
          codice_cliente: c.codice_cliente,
          ragione_sociale: c.ragione_sociale,
          citta: c.citta ?? null,
          provincia: c.provincia ?? null,
          agente_nome: c.agente_nome ?? null,
          n_destinazioni: 1,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.ragione_sociale.localeCompare(b.ragione_sociale))
  }, [risultatiRaw])

  const cerca = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (q.length < 1) {
      setRisultatiRaw([])
      setAperto(false)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/portali/preventivatore/clienti?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data: Cliente[] = await res.json()
          setRisultatiRaw(data)
          setAperto(true)
        }
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

  // Step 1 → Step 2: l'utente sceglie una ragione, carico le destinazioni
  async function selezionaRagione(r: RagioneAggregata) {
    setRagioneScelta(r)
    setTesto(r.ragione_sociale)
    setAperto(false)
    setLoadingDest(true)
    try {
      const res = await fetch(
        `/api/portali/preventivatore/clienti/destinazioni?codice_cliente=${encodeURIComponent(r.codice_cliente)}`
      )
      if (!res.ok) return
      const dest: Cliente[] = await res.json()
      setDestinazioni(dest)
      // Auto-select se UNA sola destinazione (HQ pura unica)
      if (dest.length === 1) {
        onSelect(dest[0])
      } else {
        // Default: HQ pura se presente, altrimenti aspetta la scelta dell'utente
        const hq = dest.find((d) => d.is_hq)
        if (hq && dest.length === 2) {
          // Se ci sono 2 entry ed una è HQ pura, preseleziono ma lascio modificare
          onSelect(hq)
        }
      }
    } finally {
      setLoadingDest(false)
    }
  }

  function resetSelezione() {
    onSelect(null)
    setTesto("")
    setRagioneScelta(null)
    setDestinazioni([])
    setRisultatiRaw([])
  }

  // Chiudi su click esterno
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setAperto(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // Stato a 2 step: se ragione scelta e ci sono >1 destinazioni, mostro lo step 2
  const mostraStep2 = ragioneScelta && destinazioni.length > 1 && (!valore || valore.codice_cliente === ragioneScelta.codice_cliente)

  return (
    <div ref={wrapperRef} className="space-y-2">
      {/* ── Step 1: ragione sociale ─────────────────────────────────────── */}
      <div className="relative">
        <div className="relative">
          <Input
            value={testo}
            onChange={(e) => {
              setTesto(e.target.value)
              if (valore) onSelect(null)
              if (ragioneScelta) setRagioneScelta(null)
              setDestinazioni([])
              cerca(e.target.value)
            }}
            placeholder="Cerca cliente (ragione sociale)..."
            className="pr-8"
          />
          {loading && (
            <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-text-muted" />
          )}
          {(valore || ragioneScelta) && !loading && (
            <button
              type="button"
              onClick={resetSelezione}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-red-500"
              title="Rimuovi selezione"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {aperto && ragioniAggregate.length > 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-bg shadow-lg overflow-hidden max-h-80 overflow-y-auto">
            {ragioniAggregate.map((r) => (
              <button
                key={r.codice_cliente}
                type="button"
                onClick={() => selezionaRagione(r)}
                className="w-full text-left px-3 py-2 hover:bg-bg-page transition-colors border-b border-border last:border-b-0 flex items-start justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-text truncate">{r.ragione_sociale}</div>
                  <div className="text-xs text-text-muted truncate">
                    {[r.citta, r.provincia, r.agente_nome && `Ag. ${r.agente_nome}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {r.n_destinazioni > 1 && (
                  <span className="shrink-0 text-xs text-primary font-medium flex items-center gap-0.5">
                    {r.n_destinazioni} sedi
                    <ChevronRight className="w-3 h-3" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {aperto && ragioniAggregate.length === 0 && !loading && testo.length > 0 && (
          <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-bg shadow-lg px-3 py-2 text-sm text-text-muted">
            Nessun cliente trovato
          </div>
        )}
      </div>

      {/* ── Step 2: destinazione / sede ─────────────────────────────────── */}
      {mostraStep2 && (
        <div className="rounded-lg border border-border bg-bg-page p-2">
          <div className="text-xs text-text-muted mb-1.5 flex items-center gap-1.5 px-1">
            <Building2 className="w-3 h-3" />
            Scegli la sede/divisione ({destinazioni.length})
            {loadingDest && <Loader2 className="w-3 h-3 animate-spin" />}
          </div>
          <div className="max-h-48 overflow-y-auto space-y-0.5">
            {destinazioni.map((d) => {
              const isSelected = valore?.id === d.id
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onSelect(d)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs flex items-center justify-between gap-2 transition-colors ${
                    isSelected ? "bg-primary text-white" : "hover:bg-bg text-text"
                  }`}
                >
                  <span className="truncate flex items-center gap-1.5">
                    {d.is_hq && <ChevronDown className="w-3 h-3 shrink-0" />}
                    {d.destinazione ?? d.ragione_sociale}
                    {d.is_hq && !isSelected && <span className="text-[10px] text-text-muted">(sede principale)</span>}
                  </span>
                  {d.agente_nome && !isSelected && (
                    <span className="text-[10px] text-text-muted shrink-0">{d.agente_nome}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Riepilogo cliente scelto ─────────────────────────────────────── */}
      {valore && valore.destinazione && valore.destinazione !== valore.ragione_sociale && (
        <div className="text-xs text-text-muted px-1">
          → {valore.destinazione}
        </div>
      )}
    </div>
  )
}
