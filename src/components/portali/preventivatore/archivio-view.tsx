"use client"

import { useState, useEffect, useCallback } from "react"
import { Search, ChevronDown, Loader2, FileText, AlertCircle } from "lucide-react"
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
import { ChatAI } from "@/components/portali/preventivatore/chat-ai"

type StatoDocumento = "pending" | "ordinato" | "rifiutato"

interface RisultatoRicerca {
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

const STATO_BADGE: Record<StatoDocumento, { label: string; className: string }> = {
  pending: { label: "In attesa", className: "bg-yellow-100 text-yellow-800" },
  ordinato: { label: "Ordinato", className: "bg-green-100 text-green-800" },
  rifiutato: { label: "Rifiutato", className: "bg-red-100 text-red-800" },
}

const FILTRI_STATO: Array<{ value: string; label: string }> = [
  { value: "tutti", label: "Tutti gli stati" },
  { value: "pending", label: "In attesa" },
  { value: "ordinato", label: "Ordinato" },
  { value: "rifiutato", label: "Rifiutato" },
]

export function ArchivioView() {
  const [query, setQuery] = useState("")
  const [filtroStato, setFiltroStato] = useState("tutti")
  const [filtroCliente, setFiltroCliente] = useState("")
  const [clientiDisponibili, setClientiDisponibili] = useState<string[]>([])
  const [risultati, setRisultati] = useState<RisultatoRicerca[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)

  // Modal ordinato
  const [modalOrdinato, setModalOrdinato] = useState<string | null>(null)
  const [codiciArticolo, setCodiciArticolo] = useState("")
  const [noteOrdinato, setNoteOrdinato] = useState("")
  const [importoOrdinato, setImportoOrdinato] = useState("")

  // Modal rifiutato
  const [modalRifiutato, setModalRifiutato] = useState<string | null>(null)
  const [motiviRifiuto, setMotiviRifiuto] = useState<MotivoRifiuto[]>([])
  const [motivoSelezionato, setMotivoSelezionato] = useState("")
  const [noteRifiutato, setNoteRifiutato] = useState("")

  const [savingStato, setSavingStato] = useState(false)
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null)

  // Carica clienti unici presenti nell'archivio
  useEffect(() => {
    fetch("/api/portali/preventivatore/documenti/clienti")
      .then(r => r.ok ? r.json() : [])
      .then((data: string[]) => setClientiDisponibili(data))
      .catch(() => {})
  }, [])

  const cerca = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setHasSearched(true)

    try {
      const res = await fetch("/api/portali/preventivatore/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: query.trim(),
          filtro_stato: filtroStato === "tutti" ? undefined : filtroStato,
          filtro_cliente: filtroCliente || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Errore durante la ricerca")
      }

      const data = await res.json()
      setRisultati(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore sconosciuto")
      setRisultati([])
    } finally {
      setLoading(false)
    }
  }, [query, filtroStato, filtroCliente])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") cerca()
  }

  const fetchMotiviRifiuto = async () => {
    if (motiviRifiuto.length > 0) return
    try {
      const res = await fetch("/api/portali/preventivatore/motivi-rifiuto")
      if (res.ok) {
        const data = await res.json()
        setMotiviRifiuto(data)
      }
    } catch {
      // ignore
    }
  }

  const openModalRifiutato = async (id: string) => {
    setModalRifiutato(id)
    setMotivoSelezionato("")
    setNoteRifiutato("")
    await fetchMotiviRifiuto()
  }

  const openModalOrdinato = (id: string) => {
    setModalOrdinato(id)
    setCodiciArticolo("")
    setNoteOrdinato("")
    setImportoOrdinato("")
  }

  const aggiornaStato = async (
    id: string,
    stato: StatoDocumento,
    extra: Record<string, unknown> = {}
  ) => {
    setSavingStato(true)
    try {
      const res = await fetch(
        `/api/portali/preventivatore/documenti/${id}/stato`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stato, ...extra }),
        }
      )

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Errore aggiornamento stato")
      }

      setRisultati((prev) =>
        prev.map((r) =>
          r.documento_id === id ? { ...r, stato } : r
        )
      )
      setFeedbackMsg("Stato aggiornato con successo")
      setTimeout(() => setFeedbackMsg(null), 3000)
    } catch (err) {
      setFeedbackMsg(
        `Errore: ${err instanceof Error ? err.message : "Sconosciuto"}`
      )
      setTimeout(() => setFeedbackMsg(null), 4000)
    } finally {
      setSavingStato(false)
      setModalOrdinato(null)
      setModalRifiutato(null)
    }
  }

  const salvaOrdinato = () => {
    if (!modalOrdinato) return
    const parsedImporto = parseFloat(importoOrdinato)
    aggiornaStato(modalOrdinato, "ordinato", {
      codici_articolo: codiciArticolo
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean),
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

  const filtroLabel =
    FILTRI_STATO.find((f) => f.value === filtroStato)?.label ?? "Tutti gli stati"

  return (
    <div className="max-w-7xl mx-auto">
    <div className="flex gap-6 items-start">
    <div className="flex-1 min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-tenorite text-text">Archivio Preventivi</h1>
        <p className="text-sm text-text-muted mt-1">
          Cerca preventivi passati tramite ricerca semantica.
        </p>
      </div>

      {/* Search bar */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Es: scala a chiocciola in acciaio inox, pedana elevatrice industriale..."
            className="pl-9"
          />
        </div>

        {/* Filtro stato */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="shrink-0 gap-1.5">
              {filtroLabel}
              <ChevronDown className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {FILTRI_STATO.map((f) => (
              <DropdownMenuItem
                key={f.value}
                onClick={() => setFiltroStato(f.value)}
                className={filtroStato === f.value ? "font-medium" : ""}
              >
                {f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          onClick={cerca}
          disabled={loading || !query.trim()}
          style={{ backgroundColor: "#00a1be" }}
          className="text-white hover:opacity-90 shrink-0"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "Cerca"
          )}
        </Button>
      </div>

      {/* Feedback message */}
      {feedbackMsg && (
        <div
          className={`text-sm px-3 py-2 rounded-lg ${
            feedbackMsg.startsWith("Errore")
              ? "bg-red-50 text-red-700"
              : "bg-green-50 text-green-700"
          }`}
        >
          {feedbackMsg}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Results */}
      {hasSearched && !loading && (
        <div className="space-y-3">
          {risultati.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Nessun risultato trovato per questa ricerca.</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-text-muted">
                {risultati.length} result{risultati.length !== 1 ? "i" : "o"} trovat{risultati.length !== 1 ? "i" : "o"}
              </p>
              {risultati.map((r) => {
                const badge = STATO_BADGE[r.stato] ?? STATO_BADGE.pending
                return (
                  <div
                    key={r.documento_id}
                    className="border border-border rounded-xl p-4 bg-bg space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-text text-sm truncate">
                          {r.codice}{r.cliente ? ` · ${r.cliente}` : ""}
                        </p>
                        {r.numero_offerta && (
                          <p className="text-xs text-text-muted">
                            Offerta: {r.numero_offerta}
                            {r.data_offerta ? ` — ${r.data_offerta}` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                        <span className="text-xs text-text-muted bg-bg-page px-2 py-0.5 rounded-full border border-border">
                          {Math.round(r.similarity * 100)}%
                        </span>
                        <span className="text-xs text-text-muted">
                          {r.n_chunks} chunk{r.n_chunks !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>

                    {r.top_chunk_contenuto && (
                      <p className="text-xs text-text-muted leading-relaxed line-clamp-3">
                        {r.top_chunk_contenuto.slice(0, 200)}
                        {r.top_chunk_contenuto.length > 200 ? "…" : ""}
                      </p>
                    )}

                    {/* Actions */}
                    <div className="flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="gap-1 text-xs">
                            Azioni
                            <ChevronDown className="w-3 h-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => openModalOrdinato(r.documento_id)}
                          >
                            Segna come Ordinato
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => openModalRifiutato(r.documento_id)}
                          >
                            Segna come Rifiutato
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              aggiornaStato(r.documento_id, "pending")
                            }
                          >
                            Lascia Pending
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* Modals: rendered inside the inner div so they can reference state */}

      {/* Modal: Ordinato */}
      <Dialog open={!!modalOrdinato} onOpenChange={() => setModalOrdinato(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Segna come Ordinato</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="codici">
                Codici articolo{" "}
                <span className="text-text-muted font-normal">(separati da virgola)</span>
              </Label>
              <Input
                id="codici"
                value={codiciArticolo}
                onChange={(e) => setCodiciArticolo(e.target.value)}
                placeholder="ART001, ART002, ..."
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="importo-ordinato">
                Importo concordato (€){" "}
                <span className="text-text-muted font-normal">opzionale</span>
              </Label>
              <Input
                id="importo-ordinato"
                type="number"
                step="0.01"
                min="0"
                value={importoOrdinato}
                onChange={(e) => setImportoOrdinato(e.target.value)}
                placeholder="es. 4800.00"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="note-ordinato">Note</Label>
              <textarea
                id="note-ordinato"
                value={noteOrdinato}
                onChange={(e) => setNoteOrdinato(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40 resize-none"
                placeholder="Note aggiuntive..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setModalOrdinato(null)}>
                Annulla
              </Button>
              <Button
                onClick={salvaOrdinato}
                disabled={savingStato}
                style={{ backgroundColor: "#00a1be" }}
                className="text-white hover:opacity-90"
              >
                {savingStato ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Conferma"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Rifiutato */}
      <Dialog open={!!modalRifiutato} onOpenChange={() => setModalRifiutato(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Segna come Rifiutato</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="motivo">Motivo rifiuto</Label>
              <select
                id="motivo"
                value={motivoSelezionato}
                onChange={(e) => setMotivoSelezionato(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40"
              >
                <option value="">Seleziona un motivo...</option>
                {motiviRifiuto.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="note-rifiutato">Note</Label>
              <textarea
                id="note-rifiutato"
                value={noteRifiutato}
                onChange={(e) => setNoteRifiutato(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40 resize-none"
                placeholder="Note aggiuntive..."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setModalRifiutato(null)}>
                Annulla
              </Button>
              <Button
                onClick={salvaRifiutato}
                disabled={savingStato || !motivoSelezionato}
                className="bg-red-600 text-white hover:bg-red-700"
              >
                {savingStato ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  "Conferma rifiuto"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>

      {/* AI Chat sidebar */}
      <ChatAI contesto="archivio" />
    </div>
    </div>
  )
}
