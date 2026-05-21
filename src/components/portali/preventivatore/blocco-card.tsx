"use client"

import { PlusCircle, Trash2, ChevronDown, ChevronUp, Search, X, Package } from "lucide-react"
import { useState, useCallback, useRef, useEffect, type CSSProperties } from "react"
import { Input } from "@/components/ui/input"
import {
  fmtEur,
  genKey,
  calcNettoArticolo,
  calcTotaleServizio,
  calcTotaleBlocco,
  COEFF_RICARICO_DEFAULT,
  TIPI_BLOCCO,
  COLORI_BLOCCO,
  type Blocco,
  type ArticoloBlocco,
  type ServizioBlocco,
  type Prodotto,
} from "@/components/portali/preventivatore/nuovo-view-types"

// ─── SearchArticoli ───────────────────────────────────────────────────────────

function SearchArticoli({
  onAggiungi,
}: {
  onAggiungi: (p: Prodotto) => void
}) {
  const [testo, setTesto] = useState("")
  const [risultati, setRisultati] = useState<Prodotto[]>([])
  const [aperto, setAperto] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

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
        const res = await fetch(`/api/portali/preventivatore/prodotti?q=${encodeURIComponent(q)}`)
        if (res.ok) {
          const data: Prodotto[] = await res.json()
          setRisultati(data)
          setAperto(true)
        }
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [])

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
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
        <Input
          value={testo}
          onChange={(e) => { setTesto(e.target.value); cerca(e.target.value) }}
          placeholder="Cerca codice o descrizione articolo..."
          className="pl-8 pr-8 text-sm"
        />
        {loading && (
          <Package className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
        )}
      </div>

      {aperto && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-bg shadow-lg overflow-hidden max-h-64 overflow-y-auto">
          {risultati.length === 0 ? (
            <div className="px-3 py-3 text-sm text-text-muted flex items-center gap-2">
              <Package className="w-4 h-4" />
              Nessun articolo trovato nel catalogo
            </div>
          ) : (
            risultati.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onAggiungi(p)
                  setTesto("")
                  setAperto(false)
                }}
                className="w-full text-left px-3 py-2 hover:bg-bg-page transition-colors border-b border-border last:border-0"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono font-medium text-[#00a1be] truncate">{p.codice}</span>
                  {p.ult_costo != null && (
                    <span className="text-xs text-text-muted shrink-0 flex items-center gap-1">
                      {fmtEur(p.ult_costo)}/{p.unita_misura}
                      {p.prezzo_stale && (
                        <span
                          title="Prezzo aggiornato più di 1 anno fa"
                          className="text-[10px] px-1 rounded bg-amber-500/15 text-amber-600 font-medium"
                        >
                          ?
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="text-sm text-text truncate">{p.descrizione}</div>
                <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
                  <span className="truncate">{p.categoria || p.fornitore || ""}</span>
                  <span className="shrink-0 flex items-center gap-2">
                    {p.giacenza != null && p.giacenza > 0 && (
                      <span className="text-emerald-600">stock {p.giacenza}</span>
                    )}
                    {p.n_magazzini != null && p.n_magazzini > 1 && (
                      <span title={`Registrato in ${p.n_magazzini} magazzini`}>
                        ({p.n_magazzini} mag)
                      </span>
                    )}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── ServiziSection ───────────────────────────────────────────────────────────

function ServiziSection({
  servizi,
  onToggle,
  onAggiorna,
}: {
  servizi: ServizioBlocco[]
  onToggle: (sid: string) => void
  onAggiorna: (sid: string, campo: "ore" | "markup", valore: number) => void
}) {
  const categorie = Array.from(new Set(servizi.map((s) => s.categoria)))
  const nAttivi = servizi.filter((s) => s.attivo).length
  const totaleAttivi = servizi
    .filter((s) => s.attivo)
    .reduce((sum, s) => sum + calcTotaleServizio(s), 0)

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text uppercase tracking-wide">
            Servizi &amp; Lavorazioni
          </span>
          {nAttivi > 0 && (
            <span
              className="text-xs px-1.5 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(0,161,190,0.15)", color: "#00a1be" }}
            >
              {nAttivi} {nAttivi === 1 ? "attivo" : "attivi"}
            </span>
          )}
        </div>
        {nAttivi > 0 && (
          <span className="text-sm font-semibold text-text">{fmtEur(totaleAttivi)}</span>
        )}
      </div>

      {/* Categories */}
      <div className="space-y-2">
        {categorie.map((cat) => {
          const items = servizi.filter((s) => s.categoria === cat)
          const totCat = items
            .filter((s) => s.attivo)
            .reduce((sum, s) => sum + calcTotaleServizio(s), 0)

          return (
            <div
              key={cat}
              className="rounded-lg overflow-hidden"
              style={{ border: "1px solid rgba(255,255,255,0.07)" }}
            >
              {/* Category header */}
              <div
                className="flex items-center gap-2 px-3 py-1.5"
                style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
              >
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                  {cat}
                </span>
                {totCat > 0 && (
                  <span className="ml-auto text-xs font-medium" style={{ color: "#00a1be" }}>
                    {fmtEur(totCat)}
                  </span>
                )}
              </div>

              {/* Service rows */}
              <div>
                {items.map((s, idx) => (
                  <div
                    key={s.servizio_id}
                    style={
                      s.attivo
                        ? {
                            borderLeft: "2px solid #00a1be",
                            background: "rgba(0,161,190,0.06)",
                            borderBottom: idx < items.length - 1 ? "1px solid rgba(255,255,255,0.06)" : undefined,
                          }
                        : {
                            borderLeft: "2px solid transparent",
                            borderBottom: idx < items.length - 1 ? "1px solid rgba(255,255,255,0.06)" : undefined,
                          }
                    }
                    className="transition-colors"
                  >
                    {s.attivo ? (
                      /* ── Active: expanded ── */
                      <div className="px-3 py-2.5 space-y-2">
                        {/* Top row: name + total + deactivate */}
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text flex-1 leading-tight">
                            {s.nome}
                          </span>
                          <span className="text-sm font-semibold shrink-0" style={{ color: "#00a1be" }}>
                            {fmtEur(calcTotaleServizio(s))}
                          </span>
                          <button
                            onClick={() => onToggle(s.servizio_id)}
                            title="Disattiva"
                            className="shrink-0 text-text-muted hover:text-red-400 transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {/* Bottom row: ore + markup + formula */}
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-text-muted">Ore</span>
                            <input
                              type="number"
                              min={0.5}
                              step={0.5}
                              value={s.ore}
                              onChange={(e) =>
                                onAggiorna(s.servizio_id, "ore", Math.max(0.5, Number(e.target.value)))
                              }
                              className="w-14 text-center text-sm rounded px-1.5 py-0.5 focus:outline-none focus:ring-1"
                              style={{
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.12)",
                                color: "inherit",
                                "--tw-ring-color": "rgba(0,161,190,0.4)",
                              } as CSSProperties}
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-text-muted">Markup %</span>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              value={s.markup}
                              onChange={(e) =>
                                onAggiorna(s.servizio_id, "markup", Number(e.target.value))
                              }
                              className="w-14 text-center text-sm rounded px-1.5 py-0.5 focus:outline-none focus:ring-1"
                              style={{
                                background: "rgba(255,255,255,0.05)",
                                border: "1px solid rgba(255,255,255,0.12)",
                                color: "inherit",
                                "--tw-ring-color": "rgba(0,161,190,0.4)",
                              } as CSSProperties}
                            />
                          </div>
                          <span className="text-[11px] text-text-muted ml-auto font-mono">
                            {fmtEur(s.tariffa_ora)}/h
                            {s.markup > 0 && ` + ${s.markup}%`}
                          </span>
                        </div>
                      </div>
                    ) : (
                      /* ── Inactive: compact row ── */
                      <div className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.02] transition-colors">
                        <span className="text-sm text-text-muted flex-1 leading-tight">{s.nome}</span>
                        <span className="text-[11px] text-text-muted font-mono shrink-0">
                          {fmtEur(s.tariffa_ora)}/h
                        </span>
                        <button
                          onClick={() => onToggle(s.servizio_id)}
                          title="Attiva servizio"
                          className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full transition-all"
                          style={{
                            border: "1px solid rgba(255,255,255,0.15)",
                            color: "rgba(255,255,255,0.35)",
                          }}
                          onMouseEnter={(e) => {
                            ;(e.currentTarget as HTMLButtonElement).style.borderColor = "#00a1be"
                            ;(e.currentTarget as HTMLButtonElement).style.color = "#00a1be"
                            ;(e.currentTarget as HTMLButtonElement).style.background = "rgba(0,161,190,0.1)"
                          }}
                          onMouseLeave={(e) => {
                            ;(e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.15)"
                            ;(e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.35)"
                            ;(e.currentTarget as HTMLButtonElement).style.background = "transparent"
                          }}
                        >
                          <PlusCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── BloccoCard ───────────────────────────────────────────────────────────────

export function BloccoCard({
  blocco,
  indice,
  onChange,
  onDelete,
}: {
  blocco: Blocco
  indice: number
  onChange: (b: Blocco) => void
  onDelete: () => void
}) {
  const colore = COLORI_BLOCCO[indice % COLORI_BLOCCO.length]
  const totale = calcTotaleBlocco(blocco)

  function aggiornaArticolo(key: string, campo: keyof ArticoloBlocco, valore: number | string) {
    onChange({
      ...blocco,
      articoli: blocco.articoli.map((a) =>
        a._key === key ? { ...a, [campo]: valore } : a
      ),
    })
  }

  function rimuoviArticolo(key: string) {
    onChange({ ...blocco, articoli: blocco.articoli.filter((a) => a._key !== key) })
  }

  function aggiungiArticolo(p: Prodotto) {
    const articolo: ArticoloBlocco = {
      _key: genKey(),
      prodotto_id: p.id,
      codice: p.codice,
      descrizione: p.descrizione,
      ult_costo: p.ult_costo ?? 0,
      qty: 1,
      coeff_ricarico: COEFF_RICARICO_DEFAULT,
    }
    onChange({ ...blocco, articoli: [...blocco.articoli, articolo] })
  }

  function toggleServizio(sid: string) {
    onChange({
      ...blocco,
      servizi: blocco.servizi.map((s) =>
        s.servizio_id === sid
          ? { ...s, attivo: !s.attivo, ore: s.attivo ? s.ore : (s.ore === 0 ? 1 : s.ore) }
          : s
      ),
    })
  }

  function aggiornaServizio(sid: string, campo: "ore" | "markup", valore: number) {
    onChange({
      ...blocco,
      servizi: blocco.servizi.map((s) =>
        s.servizio_id === sid ? { ...s, [campo]: valore } : s
      ),
    })
  }

  return (
    <div className="border border-border rounded-xl bg-bg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-page border-b border-border">
        <div className={`w-2 h-8 rounded-full shrink-0 ${colore}`} />

        <span className="text-xs font-semibold text-text-muted shrink-0">
          B{indice + 1}
        </span>

        <select
          value={blocco.tipo}
          onChange={(e) => onChange({ ...blocco, tipo: e.target.value })}
          className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#00a1be]/10 text-[#00a1be] border-0 focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40 cursor-pointer"
        >
          {TIPI_BLOCCO.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <Input
          value={blocco.nome}
          onChange={(e) => onChange({ ...blocco, nome: e.target.value })}
          placeholder="Nome blocco..."
          className="flex-1 h-7 text-sm border-0 bg-transparent px-1 focus:ring-0 focus:border-b focus:border-[#00a1be] rounded-none"
        />

        <span className="text-sm font-semibold text-text shrink-0">
          {fmtEur(totale)}
        </span>

        <button
          onClick={() => onChange({ ...blocco, espanso: !blocco.espanso })}
          className="text-text-muted hover:text-text transition-colors"
          aria-label={blocco.espanso ? "Comprimi" : "Espandi"}
        >
          {blocco.espanso ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        <button
          onClick={onDelete}
          className="text-text-muted hover:text-red-500 transition-colors"
          aria-label="Elimina blocco"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {blocco.espanso && (
        <div className="p-4 space-y-5">
          {/* Note tecniche */}
          <div>
            <label className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Note tecniche
            </label>
            <textarea
              value={blocco.note}
              onChange={(e) => onChange({ ...blocco, note: e.target.value })}
              rows={2}
              placeholder="Note tecniche per questo blocco..."
              className="mt-1 w-full rounded-md border border-border bg-bg-page px-3 py-2 text-sm text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40 resize-none"
            />
          </div>

          {/* Articoli */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-text uppercase tracking-wide">
                Articoli
              </span>
              <span className="text-xs text-text-muted">
                ({blocco.articoli.length})
              </span>
            </div>

            <SearchArticoli onAggiungi={aggiungiArticolo} />

            {blocco.articoli.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-bg-page">
                      <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border">
                        Codice
                      </th>
                      <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border">
                        Descrizione
                      </th>
                      <th className="text-center text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-16">
                        Q.tà
                      </th>
                      <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-28">
                        Ult. Costo
                      </th>
                      <th className="text-center text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-24">
                        Coeff. ricarico
                      </th>
                      <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-24">
                        Netto
                      </th>
                      <th className="border border-border w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {blocco.articoli.map((a) => (
                      <tr key={a._key} className="hover:bg-bg-page/50">
                        <td className="px-2 py-1.5 border border-border">
                          <span className="font-mono text-xs text-[#00a1be]">{a.codice}</span>
                        </td>
                        <td className="px-2 py-1.5 border border-border text-xs text-text">
                          {a.descrizione}
                        </td>
                        <td className="px-2 py-1.5 border border-border">
                          <input
                            type="number"
                            min={1}
                            value={a.qty}
                            onChange={(e) =>
                              aggiornaArticolo(a._key, "qty", Math.max(1, Number(e.target.value)))
                            }
                            className="w-full text-center text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 rounded px-1"
                          />
                        </td>
                        <td className="px-2 py-1.5 border border-border">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={a.ult_costo}
                            onChange={(e) =>
                              aggiornaArticolo(a._key, "ult_costo", Math.max(0, Number(e.target.value)))
                            }
                            className="w-full text-right text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 rounded px-1"
                          />
                        </td>
                        <td className="px-2 py-1.5 border border-border">
                          <input
                            type="number"
                            min={0.01}
                            max={1}
                            step={0.01}
                            value={a.coeff_ricarico}
                            onChange={(e) =>
                              aggiornaArticolo(a._key, "coeff_ricarico", Math.max(0.01, Number(e.target.value)))
                            }
                            className="w-full text-center text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 rounded px-1"
                            title="Convenzione SICS: prezzo = ult_costo / coeff_ricarico (es. 0.5 = ricarico 100%)"
                          />
                        </td>
                        <td className="px-2 py-1.5 border border-border text-right text-sm font-medium text-text">
                          {fmtEur(calcNettoArticolo(a))}
                        </td>
                        <td className="px-2 py-1.5 border border-border text-center">
                          <button
                            onClick={() => rimuoviArticolo(a._key)}
                            className="text-text-muted hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {blocco.articoli.length === 0 && (
              <p className="mt-2 text-xs text-text-muted italic">
                Cerca e aggiungi articoli dal catalogo prodotti.
              </p>
            )}
          </div>

          {/* Servizi & Lavorazioni */}
          {blocco.servizi.length > 0 && (
            <ServiziSection
              servizi={blocco.servizi}
              onToggle={toggleServizio}
              onAggiorna={aggiornaServizio}
            />
          )}
        </div>
      )}
    </div>
  )
}
