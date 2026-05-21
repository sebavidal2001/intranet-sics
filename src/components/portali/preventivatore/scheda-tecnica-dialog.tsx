"use client"

import { useState } from "react"
import { X, Loader2, FileText, Download, RefreshCw, ClipboardCopy, Wand2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { markdownToDocxBuffer } from "@/lib/portali/preventivatore/scheda-tecnica/md-to-docx"
import type { BuilderState } from "@/components/portali/preventivatore/nuovo-view-types"

// ─── Tipi risposta API ────────────────────────────────────────────────────────

interface Domanda {
  id: string
  testo: string
  tipo: "text" | "select" | "number"
  opzioni?: string[]
}

type SchedaApiResponse =
  | { tipo: "scheda"; contenuto_md: string; modello: string; provider: string; scheda_id: string }
  | { tipo: "domande"; motivo: string; domande: Domanda[] }

interface Props {
  open: boolean
  onClose: () => void
  builderState: BuilderState
}

// ─── Component ────────────────────────────────────────────────────────────────

export function SchedaTecnicaDialog({ open, onClose, builderState }: Props) {
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [domande, setDomande] = useState<Domanda[] | null>(null)
  const [motivoDomande, setMotivoDomande] = useState<string>("")
  const [risposte, setRisposte] = useState<Record<string, string>>({})
  const [schedaMd, setSchedaMd] = useState<string>("")
  const [info, setInfo] = useState<{ modello?: string; provider?: string } | null>(null)
  const [copiato, setCopiato] = useState(false)

  if (!open) return null

  async function genera(rispondi = false, forza = false) {
    setLoading(true)
    setErrore(null)
    try {
      const body: Record<string, unknown> = { builder_state: builderState }
      if (rispondi) {
        body.risposte_domande = Object.entries(risposte).map(([id, risposta]) => ({ id, risposta }))
      }
      if (forza) body.forza_generazione = true

      const res = await fetch("/api/portali/preventivatore/scheda-tecnica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? "Errore generazione scheda")
      }
      const data = (await res.json()) as SchedaApiResponse
      if (data.tipo === "domande") {
        setDomande(data.domande)
        setMotivoDomande(data.motivo)
        setSchedaMd("")
      } else {
        setSchedaMd(data.contenuto_md)
        setInfo({ modello: data.modello, provider: data.provider })
        setDomande(null)
      }
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore sconosciuto")
    } finally {
      setLoading(false)
    }
  }

  async function copiaTesto() {
    if (!schedaMd) return
    try {
      // Rimuovi markdown raw quando copiamo come testo
      const testoPulito = schedaMd
        .replace(/^#+\s+/gm, "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
      await navigator.clipboard.writeText(testoPulito)
      setCopiato(true)
      setTimeout(() => setCopiato(false), 2000)
    } catch {
      setErrore("Copia negli appunti non disponibile")
    }
  }

  async function scaricaDocx() {
    if (!schedaMd) return
    setLoading(true)
    try {
      const titolo = builderState.titolo || "Scheda tecnica preventivo"
      const cliente = builderState.cliente?.ragione_sociale
      const intest = [cliente, builderState.data_consegna && `consegna ${builderState.data_consegna}`]
        .filter(Boolean)
        .join("  ·  ")
      const buffer = await markdownToDocxBuffer({
        titoloDocumento: titolo,
        intestazione: intest || undefined,
        markdown: schedaMd,
      })
      // ArrayBuffer compatibile Blob (cast esplicito per type-checker)
      const blob = new Blob([new Uint8Array(buffer)], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const safe = (cliente ?? "preventivo").replace(/[^a-zA-Z0-9_-]+/g, "_")
      a.download = `scheda-tecnica_${safe}_${new Date().toISOString().slice(0, 10)}.docx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore download")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-4xl max-h-[90vh] bg-bg rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-bg-page">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#00a1be]" />
            <h2 className="text-sm font-semibold text-text">Scheda tecnica AI</h2>
            {info?.modello && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00a1be]/10 text-[#00a1be]">
                {info.provider} · {info.modello}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Stato iniziale */}
          {!loading && !domande && !schedaMd && !errore && (
            <div className="text-center py-8">
              <Wand2 className="w-10 h-10 mx-auto text-[#00a1be] mb-3" />
              <p className="text-sm text-text mb-1">Genera la scheda tecnica del preventivo in costruzione.</p>
              <p className="text-xs text-text-muted mb-4">
                L&apos;AI analizzerà cliente, blocchi, articoli e lavorazioni che hai inserito,
                e si baserà sulle schede storiche simili. Se servono info, te le chiederà.
              </p>
              <Button
                onClick={() => genera(false, false)}
                className="text-white"
                style={{ backgroundColor: "#00a1be" }}
              >
                <Wand2 className="w-4 h-4 mr-2" />
                Genera scheda
              </Button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-[#00a1be]" />
              <span className="ml-3 text-sm text-text-muted">Elaborazione in corso...</span>
            </div>
          )}

          {errore && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800 mb-4">
              {errore}
            </div>
          )}

          {/* Modale domande */}
          {!loading && domande && (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-900">
                <p className="font-medium mb-1">Servono alcune informazioni aggiuntive</p>
                <p className="text-xs">{motivoDomande}</p>
              </div>

              <div className="space-y-3">
                {domande.map((d) => (
                  <div key={d.id}>
                    <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
                      {d.testo}
                    </label>
                    {d.tipo === "select" && d.opzioni ? (
                      <select
                        value={risposte[d.id] ?? ""}
                        onChange={(e) => setRisposte({ ...risposte, [d.id]: e.target.value })}
                        className="w-full rounded-md border border-border bg-bg-page px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40"
                      >
                        <option value="">Seleziona...</option>
                        {d.opzioni.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        type={d.tipo === "number" ? "number" : "text"}
                        value={risposte[d.id] ?? ""}
                        onChange={(e) => setRisposte({ ...risposte, [d.id]: e.target.value })}
                        className="text-sm"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => genera(true, false)}
                  disabled={domande.some((d) => !risposte[d.id]?.trim())}
                  className="text-white"
                  style={{ backgroundColor: "#00a1be" }}
                >
                  Invia risposte e genera
                </Button>
                <Button
                  variant="outline"
                  onClick={() => genera(false, true)}
                >
                  Genera comunque
                </Button>
              </div>
            </div>
          )}

          {/* Anteprima scheda */}
          {!loading && schedaMd && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-muted">
                  Anteprima editabile (puoi modificare prima del download)
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => genera(false, true)}>
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    Rigenera
                  </Button>
                  <Button variant="outline" size="sm" onClick={copiaTesto}>
                    <ClipboardCopy className="w-3.5 h-3.5 mr-1.5" />
                    {copiato ? "Copiato!" : "Copia testo"}
                  </Button>
                  <Button
                    size="sm"
                    onClick={scaricaDocx}
                    className="text-white"
                    style={{ backgroundColor: "#00a1be" }}
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Scarica Word
                  </Button>
                </div>
              </div>
              <textarea
                value={schedaMd}
                onChange={(e) => setSchedaMd(e.target.value)}
                className="w-full h-[55vh] rounded-md border border-border bg-bg-page p-3 text-sm font-mono text-text focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40"
                spellCheck={false}
              />
              <p className="text-[10px] text-text-muted italic">
                Il file Word generato avrà heading veri, tabelle Word e testo formattato — niente markdown raw nel file scaricato.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
