"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Loader2, Upload, FileSpreadsheet, AlertCircle, AlertTriangle, CheckCircle2,
  Trash2, Power, ChevronDown, ChevronRight, ShieldAlert, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  validaEParsa, TRACCIATI, FORNITORI_DISPONIBILI,
  type EsitoValidazione, type Problema,
} from "@/lib/portali/preventivatore/listini"

/**
 * Listini fornitore (migration 084/085).
 *
 * Per marchi come Dorner e Alusic l'ultimo costo (UC) del gestionale non è il
 * costo corretto da preventivare: qui si carica l'Excel del fornitore e il suo
 * prezzo prende il posto dell'UC per tutti i codici che contiene.
 *
 * Il formato di ogni fornitore è FISSO nel codice: qui non si scelgono colonne
 * né divisori. Un file che non corrisponde al tracciato viene rifiutato con il
 * motivo scritto per esteso — un listino sbagliato non darebbe errore, darebbe
 * prezzi sbagliati in silenzio su tutti i preventivi.
 *
 * Il caricamento richiede due conferme esplicite: sostituisce il listino in
 * vigore e cambia i costi di tutti i preventivi futuri.
 */

interface ListinoDB {
  id: string
  fornitore: string
  nome_file: string | null
  colonne: Record<string, string | number>
  righe_lette: number
  righe_valide: number
  attivo: boolean
  note: string | null
  validazione: { nomeFoglio?: string; log?: string[]; problemi?: Problema[] } | null
  caricato_il: string
}

interface Confronto {
  voci_totali: number
  in_anagrafica: number
  solo_listino: number
  uc_mancante: number
  delta_medio_pct: number | null
  fornitori_gestionale: { fornitore: string; articoli: number }[]
  campione: {
    codice: string
    descrizione: string | null
    ult_costo: number | null
    costo_listino: number
    data_ult_costo: string | null
    fornitore: string | null
    delta_pct: number | null
  }[]
}

type Feedback = { type: "success" | "error"; msg: string } | null

const fmtEur = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2 })

export function ListiniFornitore() {
  const [listini, setListini] = useState<ListinoDB[]>([])
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<Feedback>(null)

  // Nessun fornitore preselezionato: sceglierlo è una decisione, non un default.
  const [fornitore, setFornitore] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [esito, setEsito] = useState<EsitoValidazione | null>(null)
  const [parsing, setParsing] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [dragAttivo, setDragAttivo] = useState(false)
  /** 0 = nessuna conferma in corso, 1 = primo passaggio, 2 = conferma finale. */
  const [conferma, setConferma] = useState<0 | 1 | 2>(0)

  const [dettaglioId, setDettaglioId] = useState<string | null>(null)
  const [confronto, setConfronto] = useState<Confronto | null>(null)
  const [loadingConfronto, setLoadingConfronto] = useState(false)

  const inputFileRef = useRef<HTMLInputElement>(null)

  const caricaListini = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/portali/preventivatore/listini")
      if (res.ok) {
        const json = await res.json()
        setListini(json.listini ?? [])
      }
    } catch { /* ignora */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void caricaListini() }, [caricaListini])

  const listinoAttivoStesso = listini.find((l) => l.attivo && l.fornitore === fornitore)

  /**
   * Legge il file e lo valida contro il tracciato del fornitore. È lo stesso
   * controllo che rifarà il server: serve a mostrare subito l'esito, non a
   * decidere (la decisione è del server, che rilegge il file).
   */
  const analizza = useCallback(async (f: File, forn: string) => {
    setParsing(true)
    setConferma(0)
    setFeedback(null)
    try {
      const XLSX = await import("xlsx")
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" })
      const nomeFoglio = wb.SheetNames[0] ?? null
      const righe = nomeFoglio
        ? XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nomeFoglio], { header: 1, raw: true, defval: null })
        : []
      setEsito(validaEParsa(righe, forn, nomeFoglio))
    } catch (e) {
      setEsito({
        ok: false, fornitore: forn || null, nomeFoglio: null,
        problemi: [{
          gravita: "errore", codice: "file_illeggibile",
          messaggio: `Il file non è un foglio di calcolo leggibile: ${(e as Error).message}`,
          azione: "Salvalo come .xlsx da Excel e riprova.",
        }],
        log: [], voci: [], righe_lette: 0, righe_scartate: 0, codici_in_conflitto: [],
      })
    } finally {
      setParsing(false)
    }
  }, [])

  function onFornitoreChange(v: string) {
    setFornitore(v)
    setConferma(0)
    // Cambiando fornitore il file va rivalidato: il tracciato è diverso.
    if (file) void analizza(file, v)
    else setEsito(null)
  }

  function onFile(f: File) {
    setFile(f)
    void analizza(f, fornitore)
  }

  function annulla() {
    setFile(null)
    setEsito(null)
    setConferma(0)
    if (inputFileRef.current) inputFileRef.current.value = ""
  }

  async function carica() {
    if (!file || !esito?.ok) return
    setSalvando(true)
    setFeedback(null)
    try {
      const fd = new FormData()
      fd.append("fornitore", fornitore)
      fd.append("file", file)
      const res = await fetch("/api/portali/preventivatore/listini", { method: "POST", body: fd })
      const json = await res.json()
      if (!res.ok) {
        // Il server ha rifiutato: mostriamo i suoi problemi, non i nostri.
        if (json.problemi) {
          setEsito({ ...esito, ok: false, problemi: json.problemi, log: json.log ?? esito.log })
        }
        throw new Error(json.error ?? "Errore caricamento")
      }
      setFeedback({
        type: "success",
        msg: `Listino ${fornitore} attivo: ${json.voci_salvate} codici useranno questo costo al posto dell'UC.`,
      })
      annulla()
      await caricaListini()
    } catch (e) {
      setFeedback({ type: "error", msg: (e as Error).message })
      setConferma(0)
    } finally {
      setSalvando(false)
    }
  }

  async function apriDettaglio(id: string) {
    if (dettaglioId === id) { setDettaglioId(null); setConfronto(null); return }
    setDettaglioId(id)
    setConfronto(null)
    setLoadingConfronto(true)
    try {
      const res = await fetch(`/api/portali/preventivatore/listini/${id}`)
      if (res.ok) setConfronto((await res.json()).confronto ?? null)
    } catch { /* ignora */ } finally {
      setLoadingConfronto(false)
    }
  }

  async function cambiaAttivo(l: ListinoDB) {
    const res = await fetch(`/api/portali/preventivatore/listini/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attivo: !l.attivo }),
    })
    if (res.ok) {
      setFeedback({
        type: "success",
        msg: l.attivo
          ? `Listino ${l.fornitore} disattivato: si torna all'UC del gestionale.`
          : `Listino ${l.fornitore} riattivato.`,
      })
      await caricaListini()
    }
  }

  async function elimina(l: ListinoDB) {
    if (!confirm(`Eliminare il listino ${l.fornitore} (${l.righe_valide} voci)? I preventivi già salvati non cambiano.`)) return
    const res = await fetch(`/api/portali/preventivatore/listini/${l.id}`, { method: "DELETE" })
    if (res.ok) {
      setFeedback({ type: "success", msg: `Listino ${l.fornitore} eliminato.` })
      if (dettaglioId === l.id) { setDettaglioId(null); setConfronto(null) }
      await caricaListini()
    }
  }

  const errori = esito?.problemi.filter((p) => p.gravita === "errore") ?? []
  const avvisi = esito?.problemi.filter((p) => p.gravita === "avviso") ?? []

  return (
    <div className="border border-border rounded-xl bg-bg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2">
        <FileSpreadsheet className="w-4 h-4 text-text-muted" />
        <div>
          <h2 className="text-sm font-semibold text-text">Listini fornitore</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Per i marchi il cui costo corretto non è l&apos;UC del gestionale: carica l&apos;Excel del
            fornitore e il suo prezzo sostituirà l&apos;UC per tutti i codici che contiene.
          </p>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* 1. Fornitore — nessun default: va scelto */}
        <div className="space-y-1.5">
          <Label htmlFor="listino_fornitore">Fornitore</Label>
          <select
            id="listino_fornitore"
            value={fornitore}
            onChange={(e) => onFornitoreChange(e.target.value)}
            className="w-full sm:w-72 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40"
          >
            <option value="">— seleziona il fornitore —</option>
            {FORNITORI_DISPONIBILI.map((f) => (
              <option key={f} value={f}>
                {TRACCIATI[f] ? TRACCIATI[f]!.etichetta : `${f} (formato non ancora configurato)`}
              </option>
            ))}
          </select>
          <p className="text-xs text-text-muted">
            Ogni fornitore ha un formato di file diverso, fissato nel programma: colonne e calcolo
            non si impostano a mano. Un file che non corrisponde viene rifiutato.
          </p>
        </div>

        {/* 2. Trascinamento */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragAttivo(true) }}
          onDragLeave={() => setDragAttivo(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragAttivo(false)
            const f = e.dataTransfer.files?.[0]
            if (f) onFile(f)
          }}
          onClick={() => inputFileRef.current?.click()}
          className={`rounded-xl border-2 border-dashed px-6 py-8 text-center cursor-pointer transition-colors ${
            dragAttivo ? "border-[#00a1be] bg-[#00a1be]/5" : "border-border bg-bg-page hover:border-[#00a1be]/50"
          }`}
        >
          <input
            ref={inputFileRef}
            type="file"
            accept=".xlsx,.xls,.xlsm,.csv"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
          />
          {parsing ? (
            <div className="flex items-center justify-center gap-2 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Controllo del file…</span>
            </div>
          ) : (
            <>
              <Upload className="w-6 h-6 mx-auto text-text-muted mb-2" />
              <p className="text-sm text-text font-medium">
                {file?.name ?? "Trascina qui l'Excel del listino"}
              </p>
              <p className="text-xs text-text-muted mt-1">oppure clicca per sceglierlo — .xlsx, .xls, .csv</p>
            </>
          )}
        </div>

        {/* 3. Esito dei controlli */}
        {esito && (
          <div className="space-y-3">
            {errori.map((p) => (
              <Alert key={p.codice} gravita="errore" problema={p} />
            ))}
            {avvisi.map((p) => (
              <Alert key={p.codice} gravita="avviso" problema={p} />
            ))}

            {/* Log dei controlli: cosa ha letto, riga per riga */}
            {esito.log.length > 0 && (
              <div className="rounded-lg border border-border bg-bg-page p-3">
                <p className="text-xs font-semibold text-text mb-1.5">Controlli eseguiti</p>
                <ul className="space-y-0.5">
                  {esito.log.map((r, i) => (
                    <li key={i} className="text-xs text-text-muted font-mono flex gap-2">
                      <span className="text-[#00a1be] shrink-0">›</span>{r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {esito.ok && (
              <div className="rounded-lg border border-border bg-bg-page p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm text-green-700">
                  <CheckCircle2 className="w-4 h-4" />
                  <span><strong>{esito.voci.length}</strong> codici pronti da {esito.nomeFoglio ? `«${esito.nomeFoglio}»` : "il file"}</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-text-muted">
                        <th className="py-1 pr-3">Codice</th>
                        <th className="py-1 pr-3">Descrizione dal listino</th>
                        <th className="py-1 pr-3 text-right">Prezzo sul file</th>
                        <th className="py-1 text-right">Costo applicato</th>
                      </tr>
                    </thead>
                    <tbody>
                      {esito.voci.slice(0, 5).map((v) => (
                        <tr key={v.codice} className="border-t border-border">
                          <td className="py-1 pr-3 font-mono text-[#00a1be]">{v.codice}</td>
                          <td className="py-1 pr-3 text-text-muted truncate max-w-xs">{v.descrizione ?? "—"}</td>
                          <td className="py-1 pr-3 text-right text-text-muted">{fmtEur(v.prezzo_origine)}</td>
                          <td className="py-1 text-right font-medium">{fmtEur(v.costo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 4. Doppia conferma */}
                {conferma === 0 && (
                  <div className="flex items-center gap-2">
                    <Button onClick={() => setConferma(1)} style={{ backgroundColor: "#00a1be" }}
                      className="text-white hover:opacity-90 gap-2">
                      Carica listino {fornitore}
                    </Button>
                    <Button variant="outline" onClick={annulla}>Annulla</Button>
                  </div>
                )}

                {conferma === 1 && (
                  <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-700 mt-0.5 shrink-0" />
                      <div className="space-y-1.5">
                        <p className="text-sm font-semibold text-amber-900">Conferma 1 di 2 — cosa stai per cambiare</p>
                        <ul className="text-xs text-amber-900 space-y-1 list-disc pl-4">
                          <li><strong>{esito.voci.length} codici</strong> useranno il prezzo di questo file al posto dell&apos;ultimo costo del gestionale.</li>
                          <li>Il cambiamento vale per <strong>tutti i preventivi futuri</strong>, per la funzione «Aggiorna prezzi» e per le duplicazioni.</li>
                          {listinoAttivoStesso ? (
                            <li>Sostituisce il listino <strong>{listinoAttivoStesso.fornitore}</strong> ora in uso ({listinoAttivoStesso.righe_valide} codici, caricato il {new Date(listinoAttivoStesso.caricato_il).toLocaleDateString("it-IT")}), che resterà a storico.</li>
                          ) : (
                            <li>È il primo listino {fornitore}: nessun listino attivo viene sostituito.</li>
                          )}
                          <li>I preventivi <strong>già salvati non cambiano</strong>: il costo è congelato sulla riga.</li>
                          {avvisi.length > 0 && (
                            <li>Ci sono <strong>{avvisi.length} avvisi</strong> qui sopra: leggili prima di proseguire.</li>
                          )}
                        </ul>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button onClick={() => setConferma(2)} className="bg-amber-600 text-white hover:bg-amber-700 gap-2">
                        Ho letto, prosegui
                      </Button>
                      <Button variant="outline" onClick={() => setConferma(0)}>Torna indietro</Button>
                    </div>
                  </div>
                )}

                {conferma === 2 && (
                  <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 text-red-700 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-red-900">Conferma 2 di 2 — ultima possibilità di fermarsi</p>
                        <p className="text-xs text-red-900 mt-1">
                          Carico <strong>{file?.name}</strong> come listino <strong>{fornitore}</strong> e lo attivo subito.
                          Da questo momento i preventivi useranno questi costi.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button onClick={carica} disabled={salvando}
                        className="bg-red-600 text-white hover:bg-red-700 gap-2">
                        {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                        Sì, carica e attiva
                      </Button>
                      <Button variant="outline" onClick={() => setConferma(0)} disabled={salvando}>Annulla</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!esito.ok && (
              <Button variant="outline" onClick={annulla} className="gap-1.5">
                <X className="w-3.5 h-3.5" />Togli il file
              </Button>
            )}
          </div>
        )}

        {feedback && (
          <div className={`flex items-center gap-2 text-sm ${feedback.type === "success" ? "text-green-600" : "text-red-600"}`}>
            {feedback.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {feedback.msg}
          </div>
        )}

        {/* Listini già caricati */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-text border-b border-border pb-1.5">Listini caricati</h3>
          {loading ? (
            <div className="flex items-center gap-2 text-text-muted py-4">
              <Loader2 className="w-4 h-4 animate-spin" /><span className="text-sm">Caricamento…</span>
            </div>
          ) : listini.length === 0 ? (
            <p className="text-sm text-text-muted py-4">
              Nessun listino caricato: tutti gli articoli usano l&apos;ultimo costo del gestionale.
            </p>
          ) : (
            listini.map((l) => (
              <div key={l.id} className="rounded-lg border border-border">
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => apriDettaglio(l.id)} className="text-text-muted hover:text-text"
                    aria-label={dettaglioId === l.id ? "Chiudi dettaglio" : "Apri dettaglio"}>
                    {dettaglioId === l.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text">{l.fornitore}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                        l.attivo ? "bg-green-50 text-green-700" : "bg-bg-page text-text-muted"
                      }`}>
                        {l.attivo ? "in uso" : "spento"}
                      </span>
                    </div>
                    <p className="text-xs text-text-muted truncate">
                      {l.righe_valide} codici · {l.nome_file ?? "file senza nome"} ·{" "}
                      {new Date(l.caricato_il).toLocaleDateString("it-IT")}
                      {l.validazione?.nomeFoglio && ` · foglio «${l.validazione.nomeFoglio}»`}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => cambiaAttivo(l)} className="gap-1.5 text-xs">
                    <Power className="w-3.5 h-3.5" />{l.attivo ? "Disattiva" : "Attiva"}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => elimina(l)}
                    className="gap-1.5 text-xs text-red-600 hover:text-red-700" aria-label="Elimina listino">
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {dettaglioId === l.id && (
                  <div className="border-t border-border px-4 py-3 bg-bg-page">
                    {loadingConfronto ? (
                      <div className="flex items-center gap-2 text-text-muted text-sm">
                        <Loader2 className="w-4 h-4 animate-spin" />Confronto con l&apos;anagrafica…
                      </div>
                    ) : confronto ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-4 text-xs">
                          <span><strong>{confronto.in_anagrafica}</strong> codici sostituiscono l&apos;UC</span>
                          <span><strong>{confronto.solo_listino}</strong> codici nuovi (solo a listino, cercabili nel builder)</span>
                          {confronto.uc_mancante > 0 && (
                            <span className="text-text-muted">{confronto.uc_mancante} in anagrafica senza UC</span>
                          )}
                          {confronto.delta_medio_pct != null && (
                            <span className={confronto.delta_medio_pct >= 0 ? "text-amber-700" : "text-green-700"}>
                              scostamento medio dall&apos;UC {confronto.delta_medio_pct > 0 ? "+" : ""}
                              {confronto.delta_medio_pct}%
                            </span>
                          )}
                        </div>

                        {confronto.fornitori_gestionale.length > 0 && (
                          <p className="text-xs text-text-muted">
                            Fornitori del gestionale toccati:{" "}
                            {confronto.fornitori_gestionale.map((f) => `${f.fornitore} (${f.articoli})`).join(" · ")}
                          </p>
                        )}

                        {l.validazione?.log && l.validazione.log.length > 0 && (
                          <details className="text-xs">
                            <summary className="cursor-pointer text-text-muted hover:text-text">
                              Controlli eseguiti al caricamento
                            </summary>
                            <ul className="mt-1.5 space-y-0.5 pl-3">
                              {l.validazione.log.map((r, i) => (
                                <li key={i} className="text-text-muted font-mono">› {r}</li>
                              ))}
                            </ul>
                          </details>
                        )}

                        {confronto.campione.length > 0 && (
                          <div className="overflow-x-auto">
                            <p className="text-xs text-text-muted mb-1">Gli scostamenti più grandi rispetto all&apos;UC:</p>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-left text-text-muted">
                                  <th className="py-1 pr-3">Codice</th>
                                  <th className="py-1 pr-3">Descrizione</th>
                                  <th className="py-1 pr-3 text-right">UC</th>
                                  <th className="py-1 pr-3 text-right">Listino</th>
                                  <th className="py-1 text-right">Δ</th>
                                </tr>
                              </thead>
                              <tbody>
                                {confronto.campione.map((c) => (
                                  <tr key={c.codice} className="border-t border-border">
                                    <td className="py-1 pr-3 font-mono text-[#00a1be]">{c.codice}</td>
                                    <td className="py-1 pr-3 text-text-muted truncate max-w-xs">{c.descrizione ?? "—"}</td>
                                    <td className="py-1 pr-3 text-right text-text-muted line-through">{fmtEur(c.ult_costo)}</td>
                                    <td className="py-1 pr-3 text-right font-medium">{fmtEur(c.costo_listino)}</td>
                                    <td className={`py-1 text-right ${(c.delta_pct ?? 0) >= 0 ? "text-amber-700" : "text-green-700"}`}>
                                      {c.delta_pct == null ? "—" : `${c.delta_pct > 0 ? "+" : ""}${c.delta_pct}%`}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-text-muted">Confronto non disponibile.</p>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function Alert({ gravita, problema }: { gravita: "errore" | "avviso"; problema: Problema }) {
  const errore = gravita === "errore"
  return (
    <div
      role="alert"
      className={`rounded-lg border-2 p-4 flex items-start gap-3 ${
        errore ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"
      }`}
    >
      {errore
        ? <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        : <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${errore ? "text-red-900" : "text-amber-900"}`}>
          {errore ? "Caricamento bloccato" : "Attenzione"} — {problema.messaggio}
        </p>
        {problema.azione && (
          <p className={`text-xs mt-1 ${errore ? "text-red-800" : "text-amber-800"}`}>{problema.azione}</p>
        )}
      </div>
    </div>
  )
}
