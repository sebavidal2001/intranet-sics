"use client"

import { PlusCircle, Trash2, ChevronDown, ChevronUp, Search, X, Package } from "lucide-react"
import { useState, useCallback, useRef, useEffect } from "react"
import { Input } from "@/components/ui/input"
import {
  fmtEur,
  genKey,
  calcNettoArticolo,
  calcTotaleServizio,
  calcBloccoVendita,
  calcBloccoCosto,
  prezzoVecchio,
  servizioBloccoDaDB,
  COEFF_RICARICO_DEFAULT,
  MESI_PREZZO_VECCHIO,
  TIPI_BLOCCO,
  COLORI_BLOCCO,
  type Blocco,
  type ArticoloBlocco,
  type ServizioBlocco,
  type ServizioDB,
  type Prodotto,
} from "@/components/portali/preventivatore/nuovo-view-types"

// ─── SearchArticoli ───────────────────────────────────────────────────────────

function SearchArticoli({
  onAggiungi,
  onAggiungiManuale,
}: {
  onAggiungi: (p: Prodotto) => void
  /** Inserisce una voce libera non presente in anagrafica. Riceve il testo digitato. */
  onAggiungiManuale: (testo: string) => void
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
            <div className="p-2">
              <div className="px-1 py-2 text-sm text-text-muted flex items-center gap-2">
                <Package className="w-4 h-4" />
                Nessun articolo trovato nel catalogo
              </div>
              <button
                onClick={() => {
                  onAggiungiManuale(testo.trim())
                  setTesto("")
                  setAperto(false)
                }}
                className="w-full text-left px-2.5 py-2 rounded-md text-sm flex items-center gap-2 bg-[#00a1be]/8 text-[#00a1be] hover:bg-[#00a1be]/15 transition-colors"
              >
                <PlusCircle className="w-4 h-4 shrink-0" />
                <span>
                  Aggiungi {testo.trim() ? <span className="font-mono font-medium">&quot;{testo.trim()}&quot;</span> : "una voce"} come articolo manuale
                </span>
              </button>
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

/**
 * Lavorazioni del blocco. I servizi non sono precaricati: si aggiungono dal
 * picker solo quelli necessari. Ogni servizio aggiunto è una riga editabile.
 */
function ServiziSection({
  servizi,
  serviziDisponibili,
  quantita,
  onAggiungi,
  onRimuovi,
  onAggiorna,
  onToggleScala,
}: {
  servizi: ServizioBlocco[]
  serviziDisponibili: ServizioDB[]
  quantita: number
  onAggiungi: (s: ServizioDB) => void
  onRimuovi: (key: string) => void
  onAggiorna: (key: string, campo: "ore" | "coeff_ricarico", valore: number) => void
  onToggleScala: (key: string) => void
}) {
  const [pickerAperto, setPickerAperto] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerAperto(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  const totale = servizi.reduce((sum, s) => sum + calcTotaleServizio(s), 0)

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-semibold text-text uppercase tracking-wide">
          Servizi &amp; Lavorazioni
        </span>
        <span className="text-xs text-text-muted">({servizi.length})</span>
        {servizi.length > 0 && (
          <span className="ml-auto text-sm font-semibold text-text">{fmtEur(totale)}</span>
        )}
      </div>

      {/* Righe servizi aggiunti */}
      {servizi.length > 0 && (
        <div className="overflow-x-auto mb-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-bg-page">
                <th className="text-left text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border">
                  Lavorazione
                </th>
                <th className="text-center text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-16">
                  Ore
                </th>
                <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-20">
                  Tariffa/h
                </th>
                <th className="text-center text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-20" title="Coefficiente di ricarico SICS: prezzo = (ore × tariffa) / coeff">
                  Ricarico
                </th>
                <th className="text-center text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-20" title="×Q = scala con la quantità pezzi del blocco · 1× = una tantum">
                  Tipo
                </th>
                <th className="text-right text-xs font-medium text-text-muted uppercase tracking-wide px-2 py-1.5 border border-border w-24">
                  Totale
                </th>
                <th className="border border-border w-8" />
              </tr>
            </thead>
            <tbody>
              {servizi.map((s) => (
                <tr key={s._key} className="hover:bg-bg-page/50">
                  <td className="px-2 py-1.5 border border-border text-sm text-text">
                    {s.nome}
                    <span className="text-[10px] text-text-muted ml-1.5">{s.categoria}</span>
                  </td>
                  <td className="px-2 py-1.5 border border-border">
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={s.ore}
                      onChange={(e) => onAggiorna(s._key, "ore", Math.max(0, Number(e.target.value)))}
                      className="w-full text-center text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 rounded px-1"
                    />
                  </td>
                  <td className="px-2 py-1.5 border border-border text-right text-xs text-text-muted">
                    {fmtEur(s.tariffa_ora)}
                  </td>
                  <td className="px-2 py-1.5 border border-border">
                    <input
                      type="number"
                      min={0.01}
                      max={1}
                      step={0.05}
                      value={s.coeff_ricarico}
                      onChange={(e) => onAggiorna(s._key, "coeff_ricarico", Math.max(0.01, Number(e.target.value)))}
                      className="w-full text-center text-sm bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 rounded px-1 tabular-nums"
                      title="Coefficiente di ricarico SICS (es. 0.5 = costo × 2, 0.65 = costo × 1.538)"
                    />
                  </td>
                  <td className="px-2 py-1.5 border border-border text-center">
                    <button
                      onClick={() => onToggleScala(s._key)}
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                        s.scala_con_quantita
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                      }`}
                      title={
                        s.scala_con_quantita
                          ? "Scala con la quantità: il totale viene moltiplicato per i pezzi del blocco. Clicca per renderla una tantum."
                          : "Una tantum: conteggiata una volta sola. Clicca per farla scalare con la quantità."
                      }
                    >
                      {s.scala_con_quantita ? "×Q" : "1×"}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 border border-border text-right text-sm font-medium text-text">
                    {fmtEur(calcTotaleServizio(s))}
                    {s.scala_con_quantita && quantita > 1 && (
                      <span className="block text-[10px] text-emerald-600 tabular-nums">×{quantita} = {fmtEur(calcTotaleServizio(s) * quantita)}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 border border-border text-center">
                    <button
                      onClick={() => onRimuovi(s._key)}
                      className="text-text-muted hover:text-red-500 transition-colors"
                      title="Rimuovi lavorazione"
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

      {/* Picker per aggiungere lavorazioni */}
      <ServiziPicker
        anchorRef={pickerRef}
        aperto={pickerAperto}
        onToggle={() => setPickerAperto((v) => !v)}
        onClose={() => setPickerAperto(false)}
        serviziDisponibili={serviziDisponibili}
        onAggiungi={onAggiungi}
      />
    </div>
  )
}

// ─── ServiziPicker (popover smart-positioned, niente tagliature) ─────────────
// Dropdown in position:fixed con calcolo runtime della posizione: si apre verso
// il basso se c'è spazio, altrimenti verso l'alto. Niente più clipping dal parent.
function ServiziPicker({
  anchorRef,
  aperto,
  onToggle,
  onClose,
  serviziDisponibili,
  onAggiungi,
}: {
  anchorRef: React.RefObject<HTMLDivElement | null>
  aperto: boolean
  onToggle: () => void
  onClose: () => void
  serviziDisponibili: ServizioDB[]
  onAggiungi: (s: ServizioDB) => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; openUpward: boolean } | null>(null)
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (!aperto) {
      setQuery("")
      return
    }
    function recompute() {
      const btn = triggerRef.current
      if (!btn) return
      const r = btn.getBoundingClientRect()
      const PANEL_H = 320
      const PANEL_W = 320
      const spaceBelow = window.innerHeight - r.bottom
      const openUpward = spaceBelow < PANEL_H && r.top > PANEL_H
      const top = openUpward ? Math.max(8, r.top - PANEL_H - 8) : Math.min(window.innerHeight - PANEL_H - 8, r.bottom + 6)
      const left = Math.min(window.innerWidth - PANEL_W - 8, Math.max(8, r.left))
      setPos({ top, left, openUpward })
    }
    recompute()
    window.addEventListener("scroll", recompute, true)
    window.addEventListener("resize", recompute)
    return () => {
      window.removeEventListener("scroll", recompute, true)
      window.removeEventListener("resize", recompute)
    }
  }, [aperto])

  // Click fuori chiude (anche se il panel è in fixed)
  useEffect(() => {
    if (!aperto) return
    function handler(e: MouseEvent) {
      const t = e.target as Node
      if (anchorRef.current?.contains(t)) return
      const panel = document.getElementById("servizi-picker-panel")
      if (panel?.contains(t)) return
      onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [aperto, anchorRef, onClose])

  const filtered = query.trim().length === 0
    ? serviziDisponibili
    : serviziDisponibili.filter((s) =>
        (s.nome + " " + s.categoria).toLowerCase().includes(query.trim().toLowerCase())
      )

  return (
    <>
      <button
        ref={triggerRef}
        onClick={onToggle}
        className={`text-xs inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition-all ${
          aperto
            ? "bg-[#00a1be] text-white shadow-sm"
            : "text-[#00a1be] bg-[#00a1be]/10 hover:bg-[#00a1be]/15"
        }`}
      >
        <PlusCircle className="w-3.5 h-3.5" />
        Aggiungi lavorazione
      </button>
      {aperto && pos && (
        <div
          id="servizi-picker-panel"
          style={{ top: pos.top, left: pos.left, width: 320, maxHeight: 320 }}
          className="fixed z-[60] rounded-xl border border-border bg-bg/95 backdrop-blur-md shadow-2xl overflow-hidden flex flex-col animate-in fade-in slide-in-from-top-2 duration-150"
        >
          <div className="px-3 py-2 border-b border-border bg-bg-page/80 flex items-center gap-2">
            <Search className="w-3.5 h-3.5 text-text-muted shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cerca lavorazione..."
              className="flex-1 bg-transparent border-0 focus:outline-none text-sm text-text placeholder:text-text-muted"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-text-muted hover:text-text text-xs"
                title="Cancella"
              >
                ✕
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-text-muted text-center">
                {serviziDisponibili.length === 0
                  ? "Nessuna lavorazione configurata. Aggiungile da Impostazioni."
                  : "Nessun risultato."}
              </div>
            ) : (
              filtered.map((sd) => (
                <button
                  key={sd.id}
                  onClick={() => { onAggiungi(sd); onClose() }}
                  className="w-full text-left px-3 py-2 hover:bg-[#00a1be]/8 transition-colors border-b border-border last:border-0 flex items-center justify-between gap-2 group"
                >
                  <span className="text-sm text-text flex items-baseline gap-2 min-w-0">
                    <span className="truncate group-hover:text-[#007a91] transition-colors">{sd.nome}</span>
                    <span className="text-[10px] text-text-muted shrink-0 px-1.5 py-0.5 rounded-full bg-bg-page">{sd.categoria}</span>
                  </span>
                  <span className="text-xs font-mono text-text-muted shrink-0 tabular-nums">
                    {fmtEur(sd.tariffa_ora)}/{sd.unita}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ─── BloccoCard ───────────────────────────────────────────────────────────────

export function BloccoCard({
  blocco,
  indice,
  serviziDB,
  onChange,
  onDelete,
}: {
  blocco: Blocco
  indice: number
  serviziDB: ServizioDB[]
  onChange: (b: Blocco) => void
  onDelete: () => void
}) {
  const colore = COLORI_BLOCCO[indice % COLORI_BLOCCO.length]
  const [coeffBlocco, setCoeffBlocco] = useState(COEFF_RICARICO_DEFAULT)
  const q = blocco.quantita_pezzi ?? 1
  const venditaUnitaria = calcBloccoVendita(blocco, 1)   // prezzo vendita singola unità (no spese/margine)
  const costoUnitario = calcBloccoCosto(blocco, 1)
  const venditaCompl = calcBloccoVendita(blocco, q)
  const costoCompl = calcBloccoCosto(blocco, q)

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
      data_ult_costo: p.data_ult_costo ?? null,
    }
    onChange({ ...blocco, articoli: [...blocco.articoli, articolo] })
  }

  /** Applica lo stesso coefficiente di ricarico a tutti i materiali del blocco. */
  function applicaCoeffATutti(coeff: number) {
    if (!coeff || coeff <= 0) return
    onChange({
      ...blocco,
      articoli: blocco.articoli.map((a) => ({ ...a, coeff_ricarico: coeff })),
    })
  }

  /** Aggiunge una voce libera non presente in anagrafica (codice/descrizione editabili). */
  function aggiungiArticoloManuale(testo: string) {
    const articolo: ArticoloBlocco = {
      _key: genKey(),
      prodotto_id: "",
      codice: testo || "",
      descrizione: "",
      ult_costo: 0,
      qty: 1,
      coeff_ricarico: COEFF_RICARICO_DEFAULT,
      manuale: true,
    }
    onChange({ ...blocco, articoli: [...blocco.articoli, articolo] })
  }

  function aggiungiServizio(sd: ServizioDB) {
    onChange({ ...blocco, servizi: [...blocco.servizi, servizioBloccoDaDB(sd)] })
  }

  function rimuoviServizio(key: string) {
    onChange({ ...blocco, servizi: blocco.servizi.filter((s) => s._key !== key) })
  }

  function aggiornaServizio(key: string, campo: "ore" | "coeff_ricarico", valore: number) {
    onChange({
      ...blocco,
      servizi: blocco.servizi.map((s) =>
        s._key === key ? { ...s, [campo]: valore } : s
      ),
    })
  }

  function toggleScalaServizio(key: string) {
    onChange({
      ...blocco,
      servizi: blocco.servizi.map((s) =>
        s._key === key ? { ...s, scala_con_quantita: !s.scala_con_quantita } : s
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

        {/* Quantità pezzi del blocco */}
        <div className="flex items-center gap-1 shrink-0" title="Numero di pezzi da produrre per questo blocco">
          <span className="text-[10px] uppercase tracking-wide text-text-muted">Pz</span>
          <input
            type="number"
            min={1}
            step={1}
            value={q}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChange({ ...blocco, quantita_pezzi: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
            className="w-14 text-center text-sm rounded-md border border-border bg-bg px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40 tabular-nums"
          />
        </div>

        <div className="shrink-0 text-right leading-tight">
          <div className="text-sm font-semibold text-text tabular-nums" title="Prezzo di vendita per singola unità (escl. imballaggio/spese/margine)">
            {fmtEur(venditaUnitaria)}
            {q > 1 && <span className="text-[10px] text-text-muted ml-1">/pz</span>}
          </div>
          <div className="text-[10px] text-text-muted tabular-nums" title="Costo del blocco (vergine, senza ricarico)">
            costo {fmtEur(q > 1 ? costoCompl : costoUnitario)}
          </div>
        </div>

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

              {/* Coeff. ricarico uniforme per il blocco */}
              {blocco.articoli.length > 0 && (
                <div className="ml-auto flex items-center gap-1.5" title="Imposta lo stesso coefficiente di ricarico a tutti i materiali del blocco (poi modificabili singolarmente)">
                  <span className="text-[10px] uppercase tracking-wide text-text-muted">Coeff. blocco</span>
                  <input
                    type="number"
                    min={0.01}
                    max={1}
                    step={0.01}
                    value={coeffBlocco}
                    onChange={(e) => setCoeffBlocco(Math.max(0.01, Number(e.target.value)))}
                    className="w-14 text-center text-xs rounded border border-border bg-bg px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 tabular-nums"
                  />
                  <button
                    onClick={() => applicaCoeffATutti(coeffBlocco)}
                    className="text-[11px] px-1.5 py-0.5 rounded bg-[#00a1be]/10 text-[#007a91] hover:bg-[#00a1be]/20 transition-colors"
                  >
                    applica a tutti
                  </button>
                </div>
              )}

              <button
                onClick={() => aggiungiArticoloManuale("")}
                className={`text-xs flex items-center gap-1 text-[#00a1be] hover:underline ${blocco.articoli.length > 0 ? "" : "ml-auto"}`}
                title="Aggiungi una voce non presente nel catalogo articoli"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Voce manuale
              </button>
            </div>

            <SearchArticoli onAggiungi={aggiungiArticolo} onAggiungiManuale={aggiungiArticoloManuale} />

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
                          {a.manuale ? (
                            <input
                              value={a.codice}
                              onChange={(e) => aggiornaArticolo(a._key, "codice", e.target.value)}
                              placeholder="Codice"
                              className="w-full font-mono text-xs text-[#00a1be] bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 rounded px-1"
                            />
                          ) : (
                            <span className="font-mono text-xs text-[#00a1be]">{a.codice}</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 border border-border text-xs text-text">
                          {a.manuale ? (
                            <input
                              value={a.descrizione}
                              onChange={(e) => aggiornaArticolo(a._key, "descrizione", e.target.value)}
                              placeholder="Descrizione voce manuale"
                              className="w-full text-xs text-text bg-transparent border-0 focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 rounded px-1"
                            />
                          ) : (
                            a.descrizione
                          )}
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
                        <td
                          className={`px-2 py-1.5 border border-border ${prezzoVecchio(a.data_ult_costo) ? "bg-amber-100" : ""}`}
                          title={
                            prezzoVecchio(a.data_ult_costo)
                              ? `Ultimo costo aggiornato il ${a.data_ult_costo} (oltre ${MESI_PREZZO_VECCHIO} mesi fa): verificare il prezzo`
                              : a.data_ult_costo
                                ? `Ultimo costo: ${a.data_ult_costo}`
                                : undefined
                          }
                        >
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={a.ult_costo}
                            onChange={(e) =>
                              aggiornaArticolo(a._key, "ult_costo", Math.max(0, Number(e.target.value)))
                            }
                            className={`w-full text-right text-sm border-0 focus:outline-none focus:ring-1 focus:ring-[#00a1be]/40 rounded px-1 ${prezzoVecchio(a.data_ult_costo) ? "bg-amber-100" : "bg-transparent"}`}
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
          <ServiziSection
            servizi={blocco.servizi}
            serviziDisponibili={serviziDB}
            quantita={q}
            onAggiungi={aggiungiServizio}
            onRimuovi={rimuoviServizio}
            onAggiorna={aggiornaServizio}
            onToggleScala={toggleScalaServizio}
          />

          {/* Recap economico del blocco: prezzo vendita + costo (unità e complessivo) */}
          <div className="rounded-lg border border-border bg-bg-page/60 px-4 py-3">
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <div className="text-text-muted">Prezzo vendita (1 pz)</div>
              <div className="text-right tabular-nums text-text">{fmtEur(venditaUnitaria)}</div>
              <div className="text-text-muted">Costo (1 pz)</div>
              <div className="text-right tabular-nums text-text-muted">{fmtEur(costoUnitario)}</div>
              {q > 1 && (
                <>
                  <div className="text-text border-t border-border pt-1.5 font-medium">Prezzo vendita × {q}</div>
                  <div className="text-right tabular-nums text-text border-t border-border pt-1.5 font-medium" style={{ color: "#007a91" }}>{fmtEur(venditaCompl)}</div>
                  <div className="text-text-muted">Costo × {q}</div>
                  <div className="text-right tabular-nums text-text-muted">{fmtEur(costoCompl)}</div>
                </>
              )}
            </div>
            <p className="mt-2 text-[10px] text-text-muted italic">
              Imballaggio, spese generali e margine trattativa sono applicati nel riepilogo finale.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
