"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { X, Loader2, FileText, Download, RefreshCw, ClipboardCopy, Wand2, Send, Undo2, AlertTriangle, GitCompare, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { markdownToDocxBuffer } from "@/lib/portali/preventivatore/scheda-tecnica/md-to-docx"
import { diffRighe, diffCompatto, contaModifiche, type RigaDiff } from "@/lib/portali/preventivatore/scheda-tecnica/diff"
import type { BuilderState } from "@/components/portali/preventivatore/nuovo-view-types"

// ─── Tipi risposta API ────────────────────────────────────────────────────────

interface Domanda {
  id: string
  testo: string
  tipo: "text" | "select" | "number"
  opzioni?: string[]
}

type SchedaApiResponse =
  | { tipo: "scheda"; contenuto_md: string; modello: string; provider: string; scheda_id: string; costo?: number | null }
  | { tipo: "domande"; motivo: string; domande: Domanda[] }

type MessaggioRevisione = { ruolo: "utente" | "ai"; testo: string }

type UsageSummary = { enabled: boolean; today: number; last_30_days: number; currency: string }

interface Props {
  open: boolean
  onClose: () => void
  builderState: BuilderState
}

const fmtUsd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2)}`

// ─── Component ────────────────────────────────────────────────────────────────

export function SchedaTecnicaDialog({ open, onClose, builderState }: Props) {
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [domande, setDomande] = useState<Domanda[] | null>(null)
  const [motivoDomande, setMotivoDomande] = useState<string>("")
  const [risposte, setRisposte] = useState<Record<string, string>>({})
  const [schedaMd, setSchedaMd] = useState<string>("")
  const [schedaId, setSchedaId] = useState<string>("")
  const [info, setInfo] = useState<{ modello?: string; provider?: string } | null>(null)
  const [copiato, setCopiato] = useState(false)

  // ── Chat di revisione ──
  const [messaggi, setMessaggi] = useState<MessaggioRevisione[]>([])
  const [istruzione, setIstruzione] = useState("")
  const [revLoading, setRevLoading] = useState(false)
  /** Versione precedente: permette di annullare l'ultima revisione. */
  const [versionePrecedente, setVersionePrecedente] = useState<string | null>(null)
  const [diff, setDiff] = useState<RigaDiff[] | null>(null)
  const [mostraDiff, setMostraDiff] = useState(false)
  const [approvata, setApprovata] = useState(false)

  // ── Contatore spesa AI ──
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [costoScheda, setCostoScheda] = useState(0)

  const chatEndRef = useRef<HTMLDivElement>(null)

  const caricaUsage = useCallback(async () => {
    try {
      const res = await fetch("/api/portali/preventivatore/usage")
      if (!res.ok) return
      const data = (await res.json()) as UsageSummary
      setUsage(data)
    } catch {
      // il contatore è accessorio: se non si carica, non blocca nulla
    }
  }, [])

  useEffect(() => { if (open) caricaUsage() }, [open, caricaUsage])
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messaggi, revLoading])

  if (!open) return null

  function registraCosto(costo: number | null | undefined) {
    if (typeof costo === "number" && costo > 0) setCostoScheda((c) => c + costo)
    caricaUsage()
  }

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
        setSchedaId(data.scheda_id)
        setInfo({ modello: data.modello, provider: data.provider })
        setDomande(null)
        // Nuova stesura: azzero cronologia revisioni e stato di approvazione
        setMessaggi([])
        setVersionePrecedente(null)
        setDiff(null)
        setApprovata(false)
        registraCosto(data.costo)
      }
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore sconosciuto")
    } finally {
      setLoading(false)
    }
  }

  /** Invia un feedback: l'AI riscrive l'intera scheda partendo dal testo corrente. */
  async function inviaRevisione() {
    const testo = istruzione.trim()
    if (!testo || !schedaMd || revLoading) return
    setRevLoading(true)
    setErrore(null)
    setIstruzione("")
    setMessaggi((m) => [...m, { ruolo: "utente", testo }])
    const precedente = schedaMd
    try {
      const res = await fetch("/api/portali/preventivatore/scheda-tecnica/revisiona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Il testo CORRENTE dell'anteprima: così le modifiche manuali non si perdono
          scheda_corrente: schedaMd,
          istruzione: testo,
          storico: messaggi.slice(-6),
          scheda_id: schedaId || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? "Errore revisione")
      }
      const data = (await res.json()) as { contenuto_md: string; costo?: number | null }
      const nuovo = data.contenuto_md
      const d = diffRighe(precedente, nuovo)
      const { aggiunte, rimosse } = contaModifiche(d)

      setVersionePrecedente(precedente)
      setSchedaMd(nuovo)
      setDiff(d)
      setMostraDiff(true)
      setApprovata(false)
      setMessaggi((m) => [
        ...m,
        { ruolo: "ai", testo: `Scheda aggiornata — ${aggiunte} righe aggiunte, ${rimosse} rimosse.` },
      ])
      registraCosto(data.costo)
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore revisione")
      setMessaggi((m) => [...m, { ruolo: "ai", testo: "Revisione non riuscita: la scheda è rimasta invariata." }])
    } finally {
      setRevLoading(false)
    }
  }

  function annullaUltimaRevisione() {
    if (!versionePrecedente) return
    setSchedaMd(versionePrecedente)
    setVersionePrecedente(null)
    setDiff(null)
    setMostraDiff(false)
    setMessaggi((m) => [...m, { ruolo: "ai", testo: "Ultima revisione annullata: ripristinata la versione precedente." }])
  }

  async function copiaTesto() {
    if (!schedaMd) return
    try {
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

  /**
   * Salva la scheda come ESEMPIO APPROVATO: da qui in poi verrà usata come
   * riferimento prioritario nelle generazioni successive (loop di apprendimento).
   */
  async function approva(silenzioso = false) {
    if (!schedaMd) return
    try {
      const res = await fetch("/api/portali/preventivatore/scheda-tecnica/approva", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheda_id: schedaId || null,
          contenuto_md: schedaMd,
          builder_state: builderState,
          n_revisioni: messaggi.filter((m) => m.ruolo === "utente").length,
        }),
      })
      if (!res.ok) throw new Error("Errore salvataggio esempio")
      setApprovata(true)
    } catch (e) {
      if (!silenzioso) setErrore(e instanceof Error ? e.message : "Errore approvazione")
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
      // Scaricarla equivale ad approvarla: diventa esempio per le prossime schede.
      approva(true)
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore download")
    } finally {
      setLoading(false)
    }
  }

  const diffDaMostrare = diff ? diffCompatto(diff) : []

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-6xl max-h-[92vh] bg-bg rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-bg-page">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-[#00a1be] shrink-0" />
            <h2 className="text-sm font-semibold text-text shrink-0">Scheda tecnica AI</h2>
            {info?.modello && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00a1be]/10 text-[#00a1be] truncate">
                {info.provider} · {info.modello}
              </span>
            )}
            {approvata && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 flex items-center gap-1 shrink-0">
                <Check className="w-3 h-3" /> approvata
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Contatore spesa AI (visibile solo se abilitato in Impostazioni) */}
            {usage?.enabled && (
              <div className="hidden sm:flex items-center gap-2 text-[10px] text-text-muted tabular-nums">
                <span title="Spesa AI di oggi (tutte le funzioni)">Oggi <b className="text-text">{fmtUsd(usage.today)}</b></span>
                <span className="text-border">|</span>
                <span title="Spesa AI ultimi 30 giorni">30 gg <b className="text-text">{fmtUsd(usage.last_30_days)}</b></span>
                <span className="text-border">|</span>
                <span title="Costo di questa scheda: generazione + revisioni">
                  Questa scheda <b style={{ color: "#00a1be" }}>{fmtUsd(costoScheda)}</b>
                </span>
              </div>
            )}
            <button onClick={onClose} className="text-text-muted hover:text-text">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Stato iniziale */}
          {!loading && !domande && !schedaMd && !errore && (
            <div className="text-center py-10 px-5 overflow-y-auto">
              <Wand2 className="w-10 h-10 mx-auto text-[#00a1be] mb-3" />
              <p className="text-sm text-text mb-1">Genera la scheda tecnica del preventivo in costruzione.</p>
              <p className="text-xs text-text-muted mb-4 max-w-lg mx-auto">
                L&apos;AI analizzerà cliente, blocchi, articoli e lavorazioni che hai inserito, e si baserà
                sulle schede già approvate e su quelle storiche simili. Se servono info, te le chiederà.
              </p>
              <Button onClick={() => genera(false, false)} className="text-white" style={{ backgroundColor: "#00a1be" }}>
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
            <div className="mx-5 mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-800">
              {errore}
            </div>
          )}

          {/* Domande */}
          {!loading && domande && (
            <div className="space-y-4 p-5 overflow-y-auto">
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
                <Button variant="outline" onClick={() => genera(false, true)}>
                  Genera comunque
                </Button>
              </div>
            </div>
          )}

          {/* Anteprima + chat di revisione */}
          {!loading && schedaMd && (
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
              {/* Colonna sinistra: anteprima / diff */}
              <div className="flex-1 min-w-0 flex flex-col p-5 gap-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-xs text-text-muted">Anteprima editabile (puoi modificare prima del download)</p>
                  <div className="flex gap-2 flex-wrap">
                    {diff && (
                      <Button variant="outline" size="sm" onClick={() => setMostraDiff((v) => !v)}>
                        <GitCompare className="w-3.5 h-3.5 mr-1.5" />
                        {mostraDiff ? "Nascondi modifiche" : "Vedi modifiche"}
                      </Button>
                    )}
                    {versionePrecedente && (
                      <Button variant="outline" size="sm" onClick={annullaUltimaRevisione} title="Ripristina la versione prima dell'ultima revisione">
                        <Undo2 className="w-3.5 h-3.5 mr-1.5" />
                        Annulla revisione
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => genera(false, true)}>
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                      Rigenera
                    </Button>
                    <Button variant="outline" size="sm" onClick={copiaTesto}>
                      <ClipboardCopy className="w-3.5 h-3.5 mr-1.5" />
                      {copiato ? "Copiato!" : "Copia testo"}
                    </Button>
                    <Button size="sm" onClick={scaricaDocx} className="text-white" style={{ backgroundColor: "#00a1be" }}>
                      <Download className="w-3.5 h-3.5 mr-1.5" />
                      Scarica Word
                    </Button>
                  </div>
                </div>

                {mostraDiff && diff && (
                  <div className="rounded-md border border-border bg-bg-page p-2 max-h-40 overflow-y-auto font-mono text-[11px] leading-relaxed">
                    {diffDaMostrare.length === 0 ? (
                      <p className="text-text-muted italic">Nessuna differenza rilevata.</p>
                    ) : (
                      diffDaMostrare.map((r, i) => (
                        <div
                          key={i}
                          className={
                            r.tipo === "aggiunta"
                              ? "bg-emerald-50 text-emerald-800"
                              : r.tipo === "rimossa"
                                ? "bg-red-50 text-red-800 line-through"
                                : "text-text-muted"
                          }
                        >
                          {r.tipo === "aggiunta" ? "+ " : r.tipo === "rimossa" ? "− " : "  "}
                          {r.testo || " "}
                        </div>
                      ))
                    )}
                  </div>
                )}

                <textarea
                  value={schedaMd}
                  onChange={(e) => { setSchedaMd(e.target.value); setApprovata(false) }}
                  className="w-full flex-1 min-h-[280px] rounded-md border border-border bg-bg-page p-3 text-sm font-mono text-text focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40"
                  spellCheck={false}
                />
                <p className="text-[10px] text-text-muted italic">
                  Il file Word avrà intestazione SICS, font Tenorite e formattazione completa — niente markdown raw.
                </p>
              </div>

              {/* Colonna destra: chat di revisione */}
              <div className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-l border-border bg-bg-page flex flex-col">
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-xs font-semibold text-text flex items-center gap-1.5">
                    <Wand2 className="w-3.5 h-3.5 text-[#00a1be]" />
                    Migliora con l&apos;AI
                  </p>
                </div>

                {/* Disclaimer discreto ma esplicito */}
                <div className="mx-3 mt-2 rounded-md border border-amber-200 bg-amber-50/70 p-2">
                  <p className="text-[10px] leading-snug text-amber-900 flex gap-1.5">
                    <AlertTriangle className="w-3 h-3 shrink-0 mt-[1px]" />
                    <span>
                      <b>Come funziona:</b> ogni richiesta fa <b>riscrivere l&apos;intera scheda</b> da capo
                      (tabula rasa), partendo dal testo che vedi ora. Non è una modifica chirurgica:
                      l&apos;AI può <b>alterare o perdere parti che andavano bene</b>, comprese le tue
                      correzioni manuali. Dopo ogni revisione controlla <b>&ldquo;Vedi modifiche&rdquo;</b>;
                      se qualcosa non va usa <b>&ldquo;Annulla revisione&rdquo;</b>. Ogni richiesta ha un
                      costo AI.
                    </span>
                  </p>
                </div>

                <div className="flex-1 min-h-[120px] overflow-y-auto p-3 space-y-2">
                  {messaggi.length === 0 && (
                    <p className="text-[11px] text-text-muted italic">
                      Esempi: &ldquo;togli le quantità dai componenti&rdquo;, &ldquo;accorpa le due sezioni
                      caratteristiche&rdquo;, &ldquo;rendi la descrizione più discorsiva&rdquo;.
                    </p>
                  )}
                  {messaggi.map((m, i) => (
                    <div
                      key={i}
                      className={
                        m.ruolo === "utente"
                          ? "ml-4 rounded-lg bg-[#00a1be]/10 px-2.5 py-1.5 text-[11px] text-text"
                          : "mr-4 rounded-lg bg-bg border border-border px-2.5 py-1.5 text-[11px] text-text-muted"
                      }
                    >
                      {m.testo}
                    </div>
                  ))}
                  {revLoading && (
                    <div className="mr-4 rounded-lg bg-bg border border-border px-2.5 py-1.5 text-[11px] text-text-muted flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin" /> Riscrittura in corso…
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="p-3 border-t border-border">
                  <div className="flex gap-1.5">
                    <textarea
                      value={istruzione}
                      onChange={(e) => setIstruzione(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); inviaRevisione() }
                      }}
                      placeholder="Cosa vuoi migliorare?"
                      rows={2}
                      disabled={revLoading}
                      className="flex-1 resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40 disabled:opacity-60"
                    />
                    <Button
                      size="sm"
                      onClick={inviaRevisione}
                      disabled={revLoading || !istruzione.trim()}
                      className="text-white self-end"
                      style={{ backgroundColor: "#00a1be" }}
                      title="Invia (Invio) · A capo: Shift+Invio"
                    >
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {usage?.enabled && costoScheda > 0 && (
                    <p className="mt-1.5 text-[10px] text-text-muted tabular-nums">
                      Costo di questa scheda finora: <b style={{ color: "#00a1be" }}>{fmtUsd(costoScheda)}</b>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
