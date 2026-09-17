"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { Search, ChevronDown, FileText, AlertCircle, Sparkles, X, ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formattaNomeCliente } from "@/lib/portali/preventivatore/testo"
import { badgeStato, type StatoDocumento } from "@/lib/portali/preventivatore/stati"

const ChatAI = dynamic(
  () => import("@/components/portali/preventivatore/chat-ai").then((m) => m.ChatAI),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-80 shrink-0 sticky top-6 self-start rounded-2xl"
        style={{ height: "600px", background: "linear-gradient(180deg, #0f1720 0%, #18222e 100%)" }}
      />
    ),
  }
)

// ─── Types ────────────────────────────────────────────────────────────────────

type TipoDocumento = "storico" | "generato"

/** Sede/divisione del cliente selezionato, con quanti preventivi ha. */
type Destinazione = {
  id: string
  destinazione: string | null
  n: number
}

interface DocumentoItem {
  id: string
  codice: string | null
  cliente: string | null
  stato: StatoDocumento
  categoria: string | null
  tipo: TipoDocumento
  numero_offerta: string | null
  data_offerta: string | null
  importo_preventivo: number | string | null
  importo_ordinato: number | string | null
  created_at: string
}

interface DocumentiResponse {
  items: DocumentoItem[]
  total: number
  page: number
  limit: number
  total_pages: number
  sort: string
  dir: "asc" | "desc"
}

interface SemanticaResult {
  documento_id: string
  codice: string
  cliente: string
  stato: StatoDocumento
  categoria: string | null
  similarity: number
  n_chunks: number
  top_chunk_contenuto: string
  numero_offerta: string | null
  data_offerta: string | null
}

interface MotivoRifiuto {
  id: string
  label: string
  ordine: number
}

// ─── Const ────────────────────────────────────────────────────────────────────

// Le opzioni sono i GRUPPI di `lib/portali/preventivatore/stati.ts`: ognuno
// copre sia gli stati legacy dell'import V2 sia quelli del workflow (migration
// 039). Prima qui c'erano solo i tre legacy, che nessun documento porta più:
// qualunque filtro si scegliesse il risultato era zero su 386.
const FILTRI_STATO = [
  { value: "tutti", label: "Tutti gli stati" },
  { value: "in_lavorazione", label: "In lavorazione" },
  { value: "inviata", label: "Offerta inviata" },
  { value: "ordinato", label: "Ordinato" },
  { value: "rifiutato", label: "Rifiutato" },
  { value: "storico", label: "Archivio storico" },
] as const

const FILTRI_TIPO = [
  { value: "tutti", label: "Tutti i tipi" },
  { value: "storico", label: "Storico" },
  { value: "generato", label: "Generato" },
] as const

type SortField = "codice" | "cliente" | "importo_preventivo" | "data_offerta" | "created_at" | "stato"

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "created_at", label: "Data inserimento" },
  { value: "data_offerta", label: "Data offerta" },
  { value: "codice", label: "Numero preventivo" },
  { value: "cliente", label: "Cliente" },
  { value: "importo_preventivo", label: "Importo" },
  { value: "stato", label: "Stato" },
]

const PAGE_SIZE = 20

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtEuro = (v: number | string | null) => {
  if (v == null) return "—"
  const n = typeof v === "number" ? v : parseFloat(v)
  if (isNaN(n)) return "—"
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ArchivioView() {
  const router = useRouter()
  // Filtri
  const [q, setQ] = useState("")
  const [filtroStato, setFiltroStato] = useState<string>("tutti")
  const [filtroTipo, setFiltroTipo] = useState<string>("tutti")
  const [filtroCliente, setFiltroCliente] = useState<string>("")
  const [filtroDestinazione, setFiltroDestinazione] = useState<string>("")
  const [importoMin, setImportoMin] = useState("")
  const [importoMax, setImportoMax] = useState("")

  // Sort
  const [sort, setSort] = useState<SortField>("created_at")
  const [dir, setDir] = useState<"asc" | "desc">("desc")

  // Pagination
  const [page, setPage] = useState(1)

  // AI semantic mode
  const [aiMode, setAiMode] = useState(false)

  // Data
  const [data, setData] = useState<DocumentiResponse | null>(null)
  const [aiResults, setAiResults] = useState<SemanticaResult[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Filtri sidebar collapsed (mobile)
  const [filtriOpen, setFiltriOpen] = useState(false)

  // Clienti dropdown + secondo livello (sedi/divisioni del cliente scelto)
  const [clientiDisponibili, setClientiDisponibili] = useState<string[]>([])
  const [destinazioniDisponibili, setDestinazioniDisponibili] = useState<Destinazione[]>([])

  // Modal stato

  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null)

  // ── Carica clienti unici ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/portali/preventivatore/documenti/clienti")
      .then(r => r.ok ? r.json() : [])
      .then((d: string[]) => setClientiDisponibili(d))
      .catch(() => {})
  }, [])

  // ── Sedi/divisioni del cliente selezionato ──────────────────────────────────
  // Solo quelle con almeno un preventivo: elencare tutta l'anagrafica sarebbe
  // rumore (IMA ha 47 destinazioni, 6 usate).
  useEffect(() => {
    if (!filtroCliente) {
      setDestinazioniDisponibili([])
      return
    }
    let cancelled = false
    fetch(`/api/portali/preventivatore/documenti/destinazioni?cliente=${encodeURIComponent(filtroCliente)}`)
      .then(r => r.ok ? r.json() : [])
      .then((d: Destinazione[]) => { if (!cancelled) setDestinazioniDisponibili(d ?? []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [filtroCliente])

  // ── Build query string ──────────────────────────────────────────────────────
  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (q.trim()) params.set("q", q.trim())
    if (filtroStato !== "tutti") params.set("stato", filtroStato)
    if (filtroTipo !== "tutti") params.set("tipo", filtroTipo)
    if (filtroCliente) params.set("cliente", filtroCliente)
    if (filtroDestinazione) params.set("destinazione_id", filtroDestinazione)
    if (importoMin) params.set("importo_min", importoMin)
    if (importoMax) params.set("importo_max", importoMax)
    params.set("sort", sort)
    params.set("dir", dir)
    params.set("page", String(page))
    params.set("limit", String(PAGE_SIZE))
    return params.toString()
  }, [q, filtroStato, filtroTipo, filtroCliente, filtroDestinazione, importoMin, importoMax, sort, dir, page])

  // ── Reset alla pagina 1 quando cambiano filtri (NON sort/dir/page) ──────────
  useEffect(() => {
    setPage(1)
  }, [q, filtroStato, filtroTipo, filtroCliente, filtroDestinazione, importoMin, importoMax])

  // ── Fetch lista (modalità classica) ─────────────────────────────────────────
  useEffect(() => {
    if (aiMode) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/portali/preventivatore/documenti?${queryString}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
        return r.json() as Promise<DocumentiResponse>
      })
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Errore caricamento") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [queryString, aiMode])

  // ── Ricerca AI semantica ────────────────────────────────────────────────────
  const cercaAi = useCallback(async () => {
    if (!q.trim()) return
    setAiMode(true)
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/portali/preventivatore/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q.trim(),
          filtro_stato: filtroStato === "tutti" ? undefined : filtroStato,
          filtro_cliente: filtroCliente || undefined,
          filtro_destinazione_id: filtroDestinazione || undefined,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? "Errore ricerca AI")
      }
      const d = (await res.json()) as SemanticaResult[]
      setAiResults(d)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore sconosciuto")
      setAiResults([])
    } finally {
      setLoading(false)
    }
  }, [q, filtroStato, filtroCliente, filtroDestinazione])

  const exitAiMode = () => {
    setAiMode(false)
    setAiResults(null)
  }

  // ── Reset filtri ────────────────────────────────────────────────────────────
  const resetFiltri = () => {
    setQ("")
    setFiltroStato("tutti")
    setFiltroTipo("tutti")
    setFiltroCliente("")
    setFiltroDestinazione("")
    setImportoMin("")
    setImportoMax("")
    setPage(1)
    if (aiMode) exitAiMode()
  }

  const filtriAttivi =
    (q.trim() ? 1 : 0) +
    (filtroStato !== "tutti" ? 1 : 0) +
    (filtroTipo !== "tutti" ? 1 : 0) +
    (filtroCliente ? 1 : 0) +
    (filtroDestinazione ? 1 : 0) +
    (importoMin ? 1 : 0) +
    (importoMax ? 1 : 0)

  // ── Header sort handler ─────────────────────────────────────────────────────
  const toggleSort = (field: SortField) => {
    if (sort === field) {
      setDir(dir === "asc" ? "desc" : "asc")
    } else {
      setSort(field)
      setDir(field === "importo_preventivo" || field === "created_at" || field === "data_offerta" ? "desc" : "asc")
    }
  }

  // ── Render: scegli source dati ──────────────────────────────────────────────
  const items = aiMode
    ? (aiResults ?? []).map((r) => ({
        id: r.documento_id,
        codice: r.codice,
        cliente: r.cliente,
        stato: r.stato,
        categoria: r.categoria,
        tipo: "storico" as TipoDocumento,
        numero_offerta: r.numero_offerta,
        data_offerta: r.data_offerta,
        importo_preventivo: null,
        importo_ordinato: null,
        created_at: "",
        // extra campo per AI mode
        _similarity: r.similarity,
        _topChunk: r.top_chunk_contenuto,
        _nChunks: r.n_chunks,
      }))
    : (data?.items ?? []).map((r) => ({ ...r, _similarity: null, _topChunk: null, _nChunks: null }))

  const totale = aiMode ? (aiResults?.length ?? 0) : (data?.total ?? 0)

  const sortIcon = (field: SortField) => {
    if (sort !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />
    return dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0 space-y-4">
          {/* Header */}
          <div className="flex items-end justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-tenorite text-text">Archivio Preventivi</h1>
              <p className="text-sm text-text-muted mt-1">
                {aiMode
                  ? "Risultati ricerca AI ordinati per similarità semantica."
                  : `${totale} preventiv${totale === 1 ? "o" : "i"} ${filtriAttivi > 0 ? "filtrati" : "in archivio"}.`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {filtriAttivi > 0 && (
                <Button variant="ghost" size="sm" onClick={resetFiltri} className="text-xs">
                  <X className="w-3 h-3 mr-1" /> Pulisci ({filtriAttivi})
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFiltriOpen((v) => !v)}
                className="lg:hidden"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 mr-1" /> Filtri
              </Button>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) cercaAi() }}
                placeholder="Cerca per codice, numero offerta, cliente — oppure descrivi a parole con AI..."
                className="pl-9"
              />
              {aiMode && (
                <button
                  onClick={exitAiMode}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                  title="Esci da ricerca AI"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <Button
              variant="outline"
              onClick={cercaAi}
              disabled={loading || !q.trim()}
              className="shrink-0 gap-1.5"
              title="Ricerca semantica AI sui chunk vettorizzati"
            >
              <Sparkles className="w-3.5 h-3.5" style={{ color: "#00a1be" }} />
              Cerca con AI
            </Button>
          </div>

          {/* Filtri inline */}
          <div className={`${filtriOpen ? "" : "hidden lg:grid"} grid grid-cols-2 lg:grid-cols-5 gap-2`}>
            {/* Stato */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="justify-between text-xs gap-1 w-full">
                  <span className="truncate">{FILTRI_STATO.find((f) => f.value === filtroStato)?.label}</span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {FILTRI_STATO.map((f) => (
                  <DropdownMenuItem key={f.value} onClick={() => setFiltroStato(f.value)} className={filtroStato === f.value ? "font-medium" : ""}>
                    {f.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Cliente */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="justify-between text-xs gap-1 w-full">
                  <span className="truncate">{filtroCliente ? formattaNomeCliente(filtroCliente) : "Tutti i clienti"}</span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                <DropdownMenuItem
                  onClick={() => { setFiltroCliente(""); setFiltroDestinazione("") }}
                  className={!filtroCliente ? "font-medium" : ""}
                >
                  Tutti i clienti
                </DropdownMenuItem>
                {clientiDisponibili.map((c) => (
                  <DropdownMenuItem
                    key={c}
                    // Cambiando cliente la sede scelta non ha più senso: si azzera.
                    onClick={() => { setFiltroCliente(c); setFiltroDestinazione("") }}
                    className={filtroCliente === c ? "font-medium" : ""}
                  >
                    {formattaNomeCliente(c)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Sede / divisione — solo se il cliente ne ha più di una con preventivi */}
            {filtroCliente && destinazioniDisponibili.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="justify-between text-xs gap-1 w-full">
                    <span className="truncate">
                      {filtroDestinazione
                        ? formattaNomeCliente(
                            destinazioniDisponibili.find((d) => d.id === filtroDestinazione)?.destinazione ?? ""
                          ) || "Sede"
                        : "Tutte le sedi"}
                    </span>
                    <ChevronDown className="w-3 h-3 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                  <DropdownMenuItem onClick={() => setFiltroDestinazione("")} className={!filtroDestinazione ? "font-medium" : ""}>
                    Tutte le sedi
                  </DropdownMenuItem>
                  {destinazioniDisponibili.map((d) => (
                    <DropdownMenuItem
                      key={d.id}
                      onClick={() => setFiltroDestinazione(d.id)}
                      className={filtroDestinazione === d.id ? "font-medium" : ""}
                    >
                      {formattaNomeCliente(d.destinazione ?? "—")}
                      <span className="ml-2 text-text-muted">{d.n}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Tipo */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="justify-between text-xs gap-1 w-full">
                  <span className="truncate">{FILTRI_TIPO.find((f) => f.value === filtroTipo)?.label}</span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {FILTRI_TIPO.map((f) => (
                  <DropdownMenuItem key={f.value} onClick={() => setFiltroTipo(f.value)} className={filtroTipo === f.value ? "font-medium" : ""}>
                    {f.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Importo min */}
            <Input
              type="number"
              inputMode="decimal"
              placeholder="Importo min €"
              value={importoMin}
              onChange={(e) => setImportoMin(e.target.value)}
              className="text-xs"
            />
            {/* Importo max */}
            <Input
              type="number"
              inputMode="decimal"
              placeholder="Importo max €"
              value={importoMax}
              onChange={(e) => setImportoMax(e.target.value)}
              className="text-xs"
            />
          </div>

          {/* Sort row */}
          {!aiMode && (
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="text-text-muted">Ordina per:</span>
              {SORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => toggleSort(o.value)}
                  className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                    sort === o.value
                      ? "bg-[#00a1be]/10 text-[#007a91] border border-[#00a1be]/30"
                      : "text-text-muted hover:bg-bg-page border border-transparent"
                  }`}
                >
                  {o.label}
                  {sortIcon(o.value)}
                </button>
              ))}
            </div>
          )}

          {/* Feedback / error */}
          {feedbackMsg && (
            <div className={`text-sm px-3 py-2 rounded-lg ${feedbackMsg.startsWith("Errore") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}>
              {feedbackMsg}
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {/* Results */}
          {loading && items.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-bg-page animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>{filtriAttivi > 0 ? "Nessun preventivo corrisponde ai filtri." : "Archivio vuoto."}</p>
              {filtriAttivi > 0 && (
                <Button variant="ghost" size="sm" onClick={resetFiltri} className="mt-3 text-xs">
                  Pulisci filtri
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((r) => {
                const badge = badgeStato(r.stato)
                return (
                  <div
                    key={r.id}
                    role="link"
                    tabIndex={0}
                    onClick={() => router.push(`/preventivatore/archivio/${r.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        router.push(`/preventivatore/archivio/${r.id}`)
                      }
                    }}
                    className="border border-border rounded-xl p-4 bg-bg space-y-2 hover:border-[#00a1be]/60 hover:shadow-sm transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-text text-sm font-mono">{r.codice ?? "—"}</p>
                          {r.cliente && <span className="text-sm text-text-muted">· {formattaNomeCliente(r.cliente)}</span>}
                          {r.tipo === "generato" && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#00a1be]/10 text-[#007a91]">
                              Generato
                            </span>
                          )}
                          {r.categoria && (
                            <span className="text-[10px] text-text-muted px-1.5 py-0.5 rounded-full bg-bg-page border border-border">
                              {r.categoria}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-text-muted flex-wrap">
                          {r.numero_offerta && <span>Offerta: <span className="font-mono">{r.numero_offerta}</span></span>}
                          {r.data_offerta && <span>{r.data_offerta}</span>}
                          {!aiMode && r.importo_preventivo != null && (
                            <span className="text-text font-medium">{fmtEuro(r.importo_preventivo)}</span>
                          )}
                          {!aiMode && r.importo_ordinato != null && r.stato === "ordinato" && (
                            <span className="text-green-700 font-medium">→ {fmtEuro(r.importo_ordinato)}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}>{badge.label}</span>
                        {aiMode && r._similarity != null && (
                          <span className="text-xs text-text-muted bg-bg-page px-2 py-0.5 rounded-full border border-border">
                            {Math.round(r._similarity * 100)}%
                          </span>
                        )}
                      </div>
                    </div>

                    {aiMode && r._topChunk && (
                      <p className="text-xs text-text-muted leading-relaxed line-clamp-3">
                        {r._topChunk.slice(0, 200)}
                        {r._topChunk.length > 200 ? "…" : ""}
                      </p>
                    )}

                  </div>
                )
              })}
            </div>
          )}

          {/* Paginazione (solo modalità lista) */}
          {!aiMode && data && data.total_pages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-text-muted">
                Pagina {data.page} di {data.total_pages} · {data.total} totali
              </p>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  ← Precedente
                </Button>
                {Array.from({ length: Math.min(5, data.total_pages) }, (_, i) => {
                  const start = Math.max(1, Math.min(data.total_pages - 4, data.page - 2))
                  return start + i
                }).map((p) => (
                  <Button
                    key={p}
                    variant={p === data.page ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPage(p)}
                    className="w-9"
                    style={p === data.page ? { backgroundColor: "#00a1be" } : undefined}
                  >
                    {p}
                  </Button>
                ))}
                <Button variant="outline" size="sm" disabled={data.page >= data.total_pages} onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}>
                  Successiva →
                </Button>
              </div>
            </div>
          )}

        </div>

        <ChatAI contesto="archivio" />
      </div>
    </div>
  )
}
