"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { Search, ChevronDown, Loader2, FileText, AlertCircle, Sparkles, X, ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

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

type StatoDocumento = "pending" | "ordinato" | "rifiutato"
type TipoDocumento = "storico" | "generato"

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

const STATO_BADGE: Record<StatoDocumento, { label: string; className: string }> = {
  pending: { label: "In attesa", className: "bg-yellow-100 text-yellow-800" },
  ordinato: { label: "Ordinato", className: "bg-green-100 text-green-800" },
  rifiutato: { label: "Rifiutato", className: "bg-red-100 text-red-800" },
}

const FILTRI_STATO = [
  { value: "tutti", label: "Tutti gli stati" },
  { value: "pending", label: "In attesa" },
  { value: "ordinato", label: "Ordinato" },
  { value: "rifiutato", label: "Rifiutato" },
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

  // Clienti dropdown
  const [clientiDisponibili, setClientiDisponibili] = useState<string[]>([])

  // Modal stato
  const [modalOrdinato, setModalOrdinato] = useState<string | null>(null)
  const [codiciArticolo, setCodiciArticolo] = useState("")
  const [noteOrdinato, setNoteOrdinato] = useState("")
  const [importoOrdinato, setImportoOrdinato] = useState("")

  const [modalRifiutato, setModalRifiutato] = useState<string | null>(null)
  const [motiviRifiuto, setMotiviRifiuto] = useState<MotivoRifiuto[]>([])
  const [motivoSelezionato, setMotivoSelezionato] = useState("")
  const [noteRifiutato, setNoteRifiutato] = useState("")
  const [savingStato, setSavingStato] = useState(false)
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null)

  // ── Carica clienti unici ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/portali/preventivatore/documenti/clienti")
      .then(r => r.ok ? r.json() : [])
      .then((d: string[]) => setClientiDisponibili(d))
      .catch(() => {})
  }, [])

  // ── Build query string ──────────────────────────────────────────────────────
  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (q.trim()) params.set("q", q.trim())
    if (filtroStato !== "tutti") params.set("stato", filtroStato)
    if (filtroTipo !== "tutti") params.set("tipo", filtroTipo)
    if (filtroCliente) params.set("cliente", filtroCliente)
    if (importoMin) params.set("importo_min", importoMin)
    if (importoMax) params.set("importo_max", importoMax)
    params.set("sort", sort)
    params.set("dir", dir)
    params.set("page", String(page))
    params.set("limit", String(PAGE_SIZE))
    return params.toString()
  }, [q, filtroStato, filtroTipo, filtroCliente, importoMin, importoMax, sort, dir, page])

  // ── Reset alla pagina 1 quando cambiano filtri (NON sort/dir/page) ──────────
  useEffect(() => {
    setPage(1)
  }, [q, filtroStato, filtroTipo, filtroCliente, importoMin, importoMax])

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
  }, [q, filtroStato, filtroCliente])

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
    (importoMin ? 1 : 0) +
    (importoMax ? 1 : 0)

  // ── Stato modal ─────────────────────────────────────────────────────────────
  const fetchMotiviRifiuto = async () => {
    if (motiviRifiuto.length > 0) return
    try {
      const res = await fetch("/api/portali/preventivatore/motivi-rifiuto")
      if (res.ok) setMotiviRifiuto(await res.json())
    } catch {}
  }

  const openModalRifiutato = async (id: string) => {
    setModalRifiutato(id); setMotivoSelezionato(""); setNoteRifiutato("")
    await fetchMotiviRifiuto()
  }

  const openModalOrdinato = (id: string) => {
    setModalOrdinato(id); setCodiciArticolo(""); setNoteOrdinato(""); setImportoOrdinato("")
  }

  const aggiornaStato = async (id: string, stato: StatoDocumento, extra: Record<string, unknown> = {}) => {
    setSavingStato(true)
    try {
      const res = await fetch(`/api/portali/preventivatore/documenti/${id}/stato`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stato, ...extra }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error ?? "Errore aggiornamento stato")
      }
      // Aggiorna locale (sia AI mode che lista)
      if (aiMode) {
        setAiResults((prev) => prev?.map((r) => r.documento_id === id ? { ...r, stato } : r) ?? null)
      } else {
        setData((prev) => prev ? { ...prev, items: prev.items.map((r) => r.id === id ? { ...r, stato } : r) } : prev)
      }
      setFeedbackMsg("Stato aggiornato con successo")
      setTimeout(() => setFeedbackMsg(null), 3000)
    } catch (err) {
      setFeedbackMsg(`Errore: ${err instanceof Error ? err.message : "Sconosciuto"}`)
      setTimeout(() => setFeedbackMsg(null), 4000)
    } finally {
      setSavingStato(false); setModalOrdinato(null); setModalRifiutato(null)
    }
  }

  const salvaOrdinato = () => {
    if (!modalOrdinato) return
    const parsedImporto = parseFloat(importoOrdinato)
    aggiornaStato(modalOrdinato, "ordinato", {
      codici_articolo: codiciArticolo.split(",").map((c) => c.trim()).filter(Boolean),
      note: noteOrdinato || undefined,
      importo_ordinato: !isNaN(parsedImporto) && parsedImporto > 0 ? parsedImporto : undefined,
    })
  }

  const salvaRifiutato = () => {
    if (!modalRifiutato || !motivoSelezionato) return
    aggiornaStato(modalRifiutato, "rifiutato", {
      motivo_rifiuto_id: motivoSelezionato,
      note: noteRifiutato || undefined,
    })
  }

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
                  <span className="truncate">{filtroCliente || "Tutti i clienti"}</span>
                  <ChevronDown className="w-3 h-3 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
                <DropdownMenuItem onClick={() => setFiltroCliente("")} className={!filtroCliente ? "font-medium" : ""}>
                  Tutti i clienti
                </DropdownMenuItem>
                {clientiDisponibili.map((c) => (
                  <DropdownMenuItem key={c} onClick={() => setFiltroCliente(c)} className={filtroCliente === c ? "font-medium" : ""}>
                    {c}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

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
                const badge = STATO_BADGE[r.stato] ?? STATO_BADGE.pending
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
                          {r.cliente && <span className="text-sm text-text-muted">· {r.cliente}</span>}
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

                    <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-1 text-xs">
                            Azioni
                            <ChevronDown className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem onSelect={() => openModalOrdinato(r.id)}>Segna come Ordinato</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => openModalRifiutato(r.id)}>Segna come Rifiutato</DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => aggiornaStato(r.id, "pending")}>Lascia Pending</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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

          {/* Modal: Ordinato */}
          <Dialog open={!!modalOrdinato} onOpenChange={() => setModalOrdinato(null)}>
            <DialogContent>
              <DialogHeader><DialogTitle>Segna come Ordinato</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="codici">Codici articolo <span className="text-text-muted font-normal">(separati da virgola)</span></Label>
                  <Input id="codici" value={codiciArticolo} onChange={(e) => setCodiciArticolo(e.target.value)} placeholder="ART001, ART002, ..." className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="importo-ordinato">Importo concordato (€) <span className="text-text-muted font-normal">opzionale</span></Label>
                  <Input id="importo-ordinato" type="number" step="0.01" min="0" value={importoOrdinato} onChange={(e) => setImportoOrdinato(e.target.value)} placeholder="es. 4800.00" className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="note-ordinato">Note</Label>
                  <textarea id="note-ordinato" value={noteOrdinato} onChange={(e) => setNoteOrdinato(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40 resize-none" placeholder="Note aggiuntive..." />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setModalOrdinato(null)}>Annulla</Button>
                  <Button onClick={salvaOrdinato} disabled={savingStato} style={{ backgroundColor: "#00a1be" }} className="text-white hover:opacity-90">
                    {savingStato ? <Loader2 className="w-4 h-4 animate-spin" /> : "Conferma"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Modal: Rifiutato */}
          <Dialog open={!!modalRifiutato} onOpenChange={() => setModalRifiutato(null)}>
            <DialogContent>
              <DialogHeader><DialogTitle>Segna come Rifiutato</DialogTitle></DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="motivo">Motivo rifiuto</Label>
                  <select id="motivo" value={motivoSelezionato} onChange={(e) => setMotivoSelezionato(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40">
                    <option value="">Seleziona un motivo...</option>
                    {motiviRifiuto.map((m) => (<option key={m.id} value={m.id}>{m.label}</option>))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="note-rifiutato">Note</Label>
                  <textarea id="note-rifiutato" value={noteRifiutato} onChange={(e) => setNoteRifiutato(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40 resize-none" placeholder="Note aggiuntive..." />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setModalRifiutato(null)}>Annulla</Button>
                  <Button onClick={salvaRifiutato} disabled={savingStato || !motivoSelezionato} className="bg-red-600 text-white hover:bg-red-700">
                    {savingStato ? <Loader2 className="w-4 h-4 animate-spin" /> : "Conferma rifiuto"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <ChatAI contesto="archivio" />
      </div>
    </div>
  )
}
