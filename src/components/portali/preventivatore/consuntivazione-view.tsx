"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Loader2, Plus, RefreshCw, Trash2, Search, X, Lock, Unlock, ExternalLink, Scale } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  COMPONENTI,
  ETICHETTA_VERDETTO,
  SPLIT_VUOTO,
  confrontaConsuntivo,
  totaleSplit,
  type ConsuntivoNumeri,
  type SplitCosti,
  type Verdetto,
} from "@/lib/portali/preventivatore/split-costi"

/**
 * Consuntivazione: confronto fra il costo PREVENTIVATO (snapshot di un preventivo, diviso in
 * materia prima / manodopera / lavorazioni) e il costo standard di Impresa per lo stesso
 * codice articolo (migration 157). Lo scostamento dice se il lavoro è stato sotto o
 * sovrastimato.
 */

const COLORI: Record<keyof SplitCosti, string> = {
  materiale: "#00a1be",
  manodopera: "#f59e0b",
  lavorazione: "#8b5cf6",
  lav_esterna: "#ef4444",
  altro: "#94a3b8",
}

const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 })
const num = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 3 })
const fmtEur = (n: number | null | undefined) => (n == null ? "—" : eur.format(n))
const fmtPct = (n: number | null | undefined) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1).replace(".", ",")}%`)
const fmtData = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("it-IT") : "—")

const BADGE: Record<Verdetto, string> = {
  in_linea: "bg-green-50 text-green-700 border-green-200",
  sottostimato: "bg-red-50 text-red-700 border-red-200",
  sovrastimato: "bg-amber-50 text-amber-700 border-amber-200",
  senza_riferimento: "bg-slate-100 text-slate-600 border-slate-200",
}

interface ConsuntivoRiga extends ConsuntivoNumeri {
  id: string
  codice_articolo: string
  descrizione: string | null
  documento_id: string | null
  documento_codice: string | null
  ambito: "preventivo" | "blocchi" | "righe"
  stato: "aperto" | "chiuso"
  note?: string | null
  rif_tipo: string | null
  rif_data: string | null
  created_at: string
}

interface RigaSnapshot {
  id: string
  codice_blocco: string | null
  tipo_riga: string | null
  codice_articolo: string | null
  descrizione: string
  quantita: number | null
  quantita_pezzi_blocco: number | null
  costo_unitario: number | null
  split_fonte: string | null
  costo_materiale: number
  costo_manodopera: number
  costo_lavorazione: number
  costo_lav_esterna: number
  costo_altro: number
  costo_totale: number
}

async function leggiErrore(res: Response, fallback: string): Promise<string> {
  try {
    const j = await res.json()
    return typeof j?.error === "string" ? j.error : fallback
  } catch {
    return fallback
  }
}

function numeri(c: ConsuntivoRiga): ConsuntivoNumeri {
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    quantita_articolo: Number(c.quantita_articolo),
    prev_materiale: Number(c.prev_materiale), prev_manodopera: Number(c.prev_manodopera),
    prev_lavorazione: Number(c.prev_lavorazione), prev_lav_esterna: Number(c.prev_lav_esterna),
    prev_altro: Number(c.prev_altro), prev_totale: Number(c.prev_totale),
    rif_materiale: n(c.rif_materiale), rif_manodopera: n(c.rif_manodopera), rif_lavorazione: n(c.rif_lavorazione),
    rif_lav_esterna: n(c.rif_lav_esterna), rif_altro: n(c.rif_altro), rif_totale: n(c.rif_totale),
  }
}

/** Barra a segmenti proporzionali alle cinque componenti. */
function BarraSplit({ split, max }: { split: SplitCosti; max?: number }) {
  const tot = totaleSplit(split)
  const base = max && max > 0 ? max : tot
  if (!(tot > 0)) return <div className="h-3 rounded bg-slate-100" />
  return (
    <div className="h-3 rounded bg-slate-100 overflow-hidden flex" style={{ width: `${Math.min(100, (tot / base) * 100)}%` }}>
      {COMPONENTI.map((k) =>
        split[k.chiave] > 0 ? (
          <div key={k.chiave} title={`${k.etichetta}: ${fmtEur(split[k.chiave])}`} style={{ width: `${(split[k.chiave] / tot) * 100}%`, background: COLORI[k.chiave] }} />
        ) : null
      )}
    </div>
  )
}

function Legenda() {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
      {COMPONENTI.map((k) => (
        <span key={k.chiave} className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORI[k.chiave] }} />
          {k.etichetta}
        </span>
      ))}
    </div>
  )
}

function Confronto({ n, titoloRif }: { n: ConsuntivoNumeri; titoloRif: string }) {
  const { righe, totale, verdetto } = confrontaConsuntivo(n)
  const prev: SplitCosti = {
    materiale: righe[0].preventivato, manodopera: righe[1].preventivato, lavorazione: righe[2].preventivato,
    lav_esterna: righe[3].preventivato, altro: righe[4].preventivato,
  }
  const rif: SplitCosti | null = totale.riferimento == null ? null : {
    materiale: righe[0].riferimento ?? 0, manodopera: righe[1].riferimento ?? 0, lavorazione: righe[2].riferimento ?? 0,
    lav_esterna: righe[3].riferimento ?? 0, altro: righe[4].riferimento ?? 0,
  }
  const max = Math.max(totaleSplit(prev), rif ? totaleSplit(rif) : 0)
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BADGE[verdetto]}`}>
          {ETICHETTA_VERDETTO[verdetto]}
        </span>
        {totale.scostamento != null && (
          <span className="text-sm text-text">
            {titoloRif} {totale.scostamento >= 0 ? "supera" : "è sotto"} il preventivato di{" "}
            <strong>{fmtEur(Math.abs(totale.scostamento))}</strong> per pezzo ({fmtPct(totale.scostamentoPct)})
          </span>
        )}
        {verdetto === "senza_riferimento" && (
          <span className="text-sm text-text-muted">Impresa non ha uno standard per questo codice (articolo non costificato o codice diverso).</span>
        )}
      </div>

      <div className="space-y-2">
        <div>
          <p className="text-xs text-text-muted mb-1">Preventivato · {fmtEur(totale.preventivato)} per pezzo</p>
          <BarraSplit split={prev} max={max} />
        </div>
        <div>
          <p className="text-xs text-text-muted mb-1">{titoloRif} · {fmtEur(totale.riferimento)} per pezzo</p>
          {rif ? <BarraSplit split={rif} max={max} /> : <div className="h-3 rounded bg-slate-100" />}
        </div>
        <Legenda />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-text-muted border-b border-border">
              <th className="text-left py-1.5 pr-3 font-medium">Per pezzo</th>
              <th className="text-right py-1.5 px-3 font-medium">Preventivato</th>
              <th className="text-right py-1.5 px-3 font-medium">{titoloRif}</th>
              <th className="text-right py-1.5 px-3 font-medium">Scostamento</th>
              <th className="text-right py-1.5 pl-3 font-medium">%</th>
            </tr>
          </thead>
          <tbody>
            {[...righe, totale].map((r) => (
              <tr key={r.chiave} className={`border-b border-border/60 ${r.chiave === "totale" ? "font-semibold" : ""}`}>
                <td className="py-1.5 pr-3">
                  {r.chiave !== "totale" && <span className="inline-block w-2 h-2 rounded-sm mr-2" style={{ background: COLORI[r.chiave] }} />}
                  {r.etichetta}
                </td>
                <td className="py-1.5 px-3 text-right tabular-nums">{fmtEur(r.preventivato)}</td>
                <td className="py-1.5 px-3 text-right tabular-nums">{fmtEur(r.riferimento)}</td>
                <td className={`py-1.5 px-3 text-right tabular-nums ${r.scostamento == null ? "" : r.scostamento > 0.005 ? "text-red-700" : r.scostamento < -0.005 ? "text-amber-700" : ""}`}>
                  {r.scostamento == null ? "—" : `${r.scostamento > 0 ? "+" : ""}${eur.format(r.scostamento)}`}
                </td>
                <td className="py-1.5 pl-3 text-right tabular-nums">{fmtPct(r.scostamentoPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-text-muted">
        Solo costi diretti: il preventivato non include imballaggio, tempi accessori, spese generali e margine. Scostamento positivo = il costo di Impresa supera il preventivo (preventivo sottostimato).
      </p>
    </div>
  )
}

/* ─────────────────────────── Dettaglio ─────────────────────────── */

function Dettaglio({ id, onChiudi, onCambiato }: { id: string; onChiudi: () => void; onCambiato: () => void }) {
  const [c, setC] = useState<ConsuntivoRiga | null>(null)
  const [righe, setRighe] = useState<RigaSnapshot[]>([])
  const [errore, setErrore] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mostraRighe, setMostraRighe] = useState(false)
  const [note, setNote] = useState("")

  const carica = useCallback(async () => {
    setErrore(null)
    try {
      const res = await fetch(`/api/portali/preventivatore/consuntivi/${id}`)
      if (!res.ok) throw new Error(await leggiErrore(res, "Errore lettura consuntivo"))
      const j = await res.json()
      setC(j.consuntivo)
      setRighe(j.righe)
      setNote(j.consuntivo.note ?? "")
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore lettura consuntivo")
    }
  }, [id])

  useEffect(() => { void carica() }, [carica])

  async function azione(fn: () => Promise<Response>, fallback: string, ricarica = true) {
    setBusy(true); setErrore(null)
    try {
      const res = await fn()
      if (!res.ok) throw new Error(await leggiErrore(res, fallback))
      if (ricarica) await carica()
      onCambiato()
    } catch (e) {
      setErrore(e instanceof Error ? e.message : fallback)
    } finally { setBusy(false) }
  }

  if (!c) {
    return (
      <div className="border border-border rounded-xl bg-bg p-8 text-center text-sm text-text-muted">
        {errore ? <span className="text-red-700">{errore}</span> : <Loader2 className="w-4 h-4 animate-spin inline" />}
      </div>
    )
  }

  const patch = (body: object) => fetch(`/api/portali/preventivatore/consuntivi/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

  return (
    <div className="border border-border rounded-xl bg-bg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-tenorite text-base font-bold text-text">{c.codice_articolo}</h2>
          <p className="text-xs text-text-muted mt-0.5 truncate">{c.descrizione ?? "—"}</p>
        </div>
        <button onClick={onChiudi} className="text-text-muted hover:text-text" aria-label="Chiudi dettaglio"><X className="w-4 h-4" /></button>
      </div>

      <div className="p-5 space-y-5">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><dt className="text-xs text-text-muted">Preventivo</dt><dd>{c.documento_id ? (
            <Link href={`/preventivatore/archivio/${c.documento_id}`} className="text-primary hover:underline inline-flex items-center gap-1">{c.documento_codice ?? "apri"}<ExternalLink className="w-3 h-3" /></Link>
          ) : (c.documento_codice ?? "—")}</dd></div>
          <div><dt className="text-xs text-text-muted">Ambito</dt><dd>{c.ambito === "preventivo" ? "Intero preventivo" : c.ambito === "blocchi" ? "Blocchi" : "Righe scelte"}</dd></div>
          <div><dt className="text-xs text-text-muted">Pezzi coperti</dt><dd>{num.format(Number(c.quantita_articolo))}</dd></div>
          <div><dt className="text-xs text-text-muted">Standard Impresa</dt><dd>{c.rif_data ? `del ${fmtData(c.rif_data)}` : "non disponibile"}</dd></div>
        </dl>

        <Confronto n={numeri(c)} titoloRif="Standard Impresa" />

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => azione(() => fetch(`/api/portali/preventivatore/consuntivi/${id}/riferimento`, { method: "POST" }), "Errore aggiornamento riferimento")}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />Aggiorna standard
          </Button>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => azione(() => patch({ stato: c.stato === "aperto" ? "chiuso" : "aperto" }), "Errore cambio stato")}>
            {c.stato === "aperto" ? <><Lock className="w-3.5 h-3.5 mr-1.5" />Chiudi</> : <><Unlock className="w-3.5 h-3.5 mr-1.5" />Riapri</>}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} className="text-red-700"
            onClick={() => {
              if (!confirm(`Eliminare il consuntivo di ${c.codice_articolo}? Il preventivo non viene toccato.`)) return
              void azione(() => fetch(`/api/portali/preventivatore/consuntivi/${id}`, { method: "DELETE" }), "Errore eliminazione", false).then(onChiudi)
            }}>
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />Elimina
          </Button>
          {busy && <Loader2 className="w-4 h-4 animate-spin text-text-muted" />}
        </div>
        {errore && <p className="text-sm text-red-700">{errore}</p>}

        <div className="space-y-1.5">
          <label htmlFor="note-consuntivo" className="text-xs text-text-muted">Note</label>
          <textarea id="note-consuntivo" value={note} onChange={(e) => setNote(e.target.value)} rows={2}
            onBlur={() => { if ((c.note ?? "") !== note) void azione(() => patch({ note: note || null }), "Errore salvataggio note") }}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40" />
        </div>

        <div>
          <button onClick={() => setMostraRighe((v) => !v)} className="text-sm text-primary hover:underline">
            {mostraRighe ? "Nascondi" : "Mostra"} le {righe.length} righe del preventivato (snapshot)
          </button>
          {mostraRighe && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-muted border-b border-border">
                    <th className="text-left py-1.5 pr-2 font-medium">Blocco</th>
                    <th className="text-left py-1.5 px-2 font-medium">Articolo</th>
                    <th className="text-right py-1.5 px-2 font-medium">Q.tà</th>
                    {COMPONENTI.map((k) => <th key={k.chiave} className="text-right py-1.5 px-2 font-medium">{k.breve}</th>)}
                    <th className="text-right py-1.5 pl-2 font-medium">Totale</th>
                  </tr>
                </thead>
                <tbody>
                  {righe.map((r) => (
                    <tr key={r.id} className="border-b border-border/50">
                      <td className="py-1 pr-2 text-text-muted">{r.codice_blocco ?? "—"}</td>
                      <td className="py-1 px-2"><span className="font-medium">{r.codice_articolo ?? (r.tipo_riga === "manodopera" ? "Servizio" : "")}</span> <span className="text-text-muted">{r.descrizione}</span></td>
                      <td className="py-1 px-2 text-right tabular-nums">{r.quantita == null ? "—" : num.format(r.quantita)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{fmtEur(r.costo_materiale)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{fmtEur(r.costo_manodopera)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{fmtEur(r.costo_lavorazione)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{fmtEur(r.costo_lav_esterna)}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{fmtEur(r.costo_altro)}</td>
                      <td className="py-1 pl-2 text-right tabular-nums font-medium">{fmtEur(r.costo_totale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── Nuovo consuntivo ─────────────────────────── */

interface ArticoloStd {
  codice: string
  descrizione: string | null
  data_elaborazione: string
  costo_totale: number
  costo_materiale: number
  costo_manodopera: number
  costo_lavorazione: number
  costo_lav_esterna: number
  costo_altro: number
}
interface DocumentoTrovato { id: string; codice: string; cliente: string | null; tipo_prodotto: string | null; tipo: string; stato: string | null }
interface BloccoSrc { codice_blocco: string | null; quantita_pezzi: number | null }
interface RigaSrc {
  id: string
  codice_blocco: string | null
  tipo_riga: string
  codice_articolo: string | null
  descrizione: string
  quantita: number | null
  prezzo_unitario: number | null
  costo_materiale: number | null
  costo_manodopera: number | null
  costo_lavorazione: number | null
  costo_lav_esterna: number | null
  costo_altro: number | null
  split_fonte: string | null
}

/** Stessa regola di preventivatore.crea_consuntivo: materiali × pezzi del blocco, manodopera × 1. */
function sommaSelezione(righe: RigaSrc[], pezzi: Map<string | null, number>): SplitCosti {
  const tot = { ...SPLIT_VUOTO }
  for (const r of righe) {
    const mult = r.tipo_riga === "materiale" ? pezzi.get(r.codice_blocco) ?? 1 : 1
    const q = (r.quantita ?? 0) * mult
    if (r.split_fonte) {
      tot.materiale += q * (r.costo_materiale ?? 0)
      tot.manodopera += q * (r.costo_manodopera ?? 0)
      tot.lavorazione += q * (r.costo_lavorazione ?? 0)
      tot.lav_esterna += q * (r.costo_lav_esterna ?? 0)
      tot.altro += q * (r.costo_altro ?? 0)
    } else if (r.tipo_riga === "manodopera") {
      tot.manodopera += q * (r.prezzo_unitario ?? 0)
    } else {
      tot.materiale += q * (r.prezzo_unitario ?? 0)
    }
  }
  return tot
}

function useDebounced<T>(valore: T, ms = 250): T {
  const [v, setV] = useState(valore)
  useEffect(() => { const t = setTimeout(() => setV(valore), ms); return () => clearTimeout(t) }, [valore, ms])
  return v
}

function Nuovo({ onAnnulla, onCreato }: { onAnnulla: () => void; onCreato: (id: string) => void }) {
  const [qArt, setQArt] = useState("")
  const [articoli, setArticoli] = useState<ArticoloStd[]>([])
  const [articolo, setArticolo] = useState<ArticoloStd | null>(null)

  const [qDoc, setQDoc] = useState("")
  const [docs, setDocs] = useState<DocumentoTrovato[]>([])
  const [doc, setDoc] = useState<DocumentoTrovato | null>(null)
  const [blocchi, setBlocchi] = useState<BloccoSrc[]>([])
  const [righe, setRighe] = useState<RigaSrc[]>([])

  const [ambito, setAmbito] = useState<"preventivo" | "blocchi" | "righe">("preventivo")
  const [selBlocchi, setSelBlocchi] = useState<Set<string>>(new Set())
  const [selRighe, setSelRighe] = useState<Set<string>>(new Set())
  const [qta, setQta] = useState("")
  const [note, setNote] = useState("")
  const [errore, setErrore] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const dArt = useDebounced(qArt)
  const dDoc = useDebounced(qDoc)

  useEffect(() => {
    if (articolo || dArt.trim().length < 2) { setArticoli([]); return }
    let vivo = true
    fetch(`/api/portali/preventivatore/consuntivi/articoli?q=${encodeURIComponent(dArt.trim())}`)
      .then((r) => (r.ok ? r.json() : { articoli: [] }))
      .then((j) => { if (vivo) setArticoli(j.articoli ?? []) })
      .catch(() => { if (vivo) setArticoli([]) })
    return () => { vivo = false }
  }, [dArt, articolo])

  useEffect(() => {
    if (doc || dDoc.trim().length < 2) { setDocs([]); return }
    let vivo = true
    fetch(`/api/portali/preventivatore/consuntivi/sorgente?q=${encodeURIComponent(dDoc.trim())}`)
      .then((r) => (r.ok ? r.json() : { documenti: [] }))
      .then((j) => { if (vivo) setDocs(j.documenti ?? []) })
      .catch(() => { if (vivo) setDocs([]) })
    return () => { vivo = false }
  }, [dDoc, doc])

  async function scegliDoc(d: DocumentoTrovato) {
    setDoc(d); setErrore(null); setBlocchi([]); setRighe([]); setSelBlocchi(new Set()); setSelRighe(new Set())
    try {
      const res = await fetch(`/api/portali/preventivatore/consuntivi/sorgente?documento_id=${d.id}`)
      if (!res.ok) throw new Error(await leggiErrore(res, "Errore lettura preventivo"))
      const j = await res.json()
      setBlocchi(j.blocchi ?? []); setRighe(j.righe ?? [])
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore lettura preventivo")
    }
  }

  const pezzi = useMemo(() => new Map<string | null, number>(blocchi.map((b) => [b.codice_blocco, b.quantita_pezzi ?? 1])), [blocchi])

  const selezionate = useMemo(() => {
    if (ambito === "preventivo") return righe
    if (ambito === "blocchi") return righe.filter((r) => r.codice_blocco != null && selBlocchi.has(r.codice_blocco))
    return righe.filter((r) => selRighe.has(r.id))
  }, [ambito, righe, selBlocchi, selRighe])

  // Pezzi suggeriti come lato server: un solo blocco → i suoi pezzi, altrimenti 1.
  const pezziSuggeriti = useMemo(() => {
    const codici = new Set(selezionate.map((r) => r.codice_blocco))
    return codici.size === 1 ? pezzi.get(Array.from(codici)[0]) ?? 1 : 1
  }, [selezionate, pezzi])
  const qtaEffettiva = Number(qta.replace(",", ".")) > 0 ? Number(qta.replace(",", ".")) : pezziSuggeriti

  const prev = useMemo(() => sommaSelezione(selezionate, pezzi), [selezionate, pezzi])
  const anteprima: ConsuntivoNumeri | null = selezionate.length === 0 ? null : {
    quantita_articolo: qtaEffettiva,
    prev_materiale: prev.materiale, prev_manodopera: prev.manodopera, prev_lavorazione: prev.lavorazione,
    prev_lav_esterna: prev.lav_esterna, prev_altro: prev.altro, prev_totale: totaleSplit(prev),
    rif_materiale: articolo ? articolo.costo_materiale : null, rif_manodopera: articolo ? articolo.costo_manodopera : null,
    rif_lavorazione: articolo ? articolo.costo_lavorazione : null, rif_lav_esterna: articolo ? articolo.costo_lav_esterna : null,
    rif_altro: articolo ? articolo.costo_altro : null, rif_totale: articolo ? articolo.costo_totale : null,
  }

  async function crea() {
    if (!articolo || !doc) return
    setBusy(true); setErrore(null)
    try {
      const res = await fetch("/api/portali/preventivatore/consuntivi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codice_articolo: articolo.codice,
          descrizione: articolo.descrizione ?? undefined,
          documento_id: doc.id,
          ambito,
          blocchi: ambito === "blocchi" ? Array.from(selBlocchi) : undefined,
          righe: ambito === "righe" ? Array.from(selRighe) : undefined,
          quantita_articolo: Number(qta.replace(",", ".")) > 0 ? Number(qta.replace(",", ".")) : undefined,
          note: note.trim() || undefined,
        }),
      })
      if (!res.ok) throw new Error(await leggiErrore(res, "Errore creazione consuntivo"))
      const j = await res.json()
      onCreato(j.id)
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore creazione consuntivo")
    } finally { setBusy(false) }
  }

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, k: string) => {
    const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); setter(n)
  }
  const blocchiUnici = Array.from(new Set(blocchi.map((b) => b.codice_blocco).filter((c): c is string => c != null)))

  return (
    <div className="border border-border rounded-xl bg-bg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <h2 className="font-tenorite text-base font-bold text-text flex-1">Nuovo consuntivo</h2>
        <button onClick={onAnnulla} className="text-text-muted hover:text-text" aria-label="Annulla"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-5 space-y-6">
        {/* 1. Articolo */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-text">1. Codice articolo di Impresa</h3>
          {articolo ? (
            <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
              <div className="min-w-0 flex-1"><strong>{articolo.codice}</strong> <span className="text-text-muted">{articolo.descrizione}</span></div>
              <span className="text-xs text-text-muted">standard {fmtEur(articolo.costo_totale)} del {fmtData(articolo.data_elaborazione)}</span>
              <button onClick={() => { setArticolo(null); setQArt("") }} className="text-text-muted hover:text-text" aria-label="Cambia articolo"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input value={qArt} onChange={(e) => setQArt(e.target.value)} placeholder="Codice o descrizione (es. AFD.00.2)"
                  className="w-full rounded-md border border-border bg-bg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40" />
              </div>
              {articoli.length > 0 && (
                <ul className="border border-border rounded-md divide-y divide-border max-h-56 overflow-auto">
                  {articoli.map((a) => (
                    <li key={a.codice}>
                      <button onClick={() => setArticolo(a)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-3">
                        <span className="font-medium">{a.codice}</span>
                        <span className="text-text-muted truncate flex-1">{a.descrizione}</span>
                        <span className="tabular-nums text-xs">{fmtEur(a.costo_totale)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-text-muted">Si cercano i codici che Impresa ha costificato (standard sincronizzato). Se il codice non compare, non ha ancora uno standard.</p>
            </>
          )}
        </section>

        {/* 2. Preventivo */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-text">2. Preventivo di origine</h3>
          {doc ? (
            <div className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
              <div className="min-w-0 flex-1"><strong>{doc.codice}</strong> <span className="text-text-muted">{doc.cliente} · {doc.tipo_prodotto}</span></div>
              <button onClick={() => { setDoc(null); setQDoc(""); setBlocchi([]); setRighe([]) }} className="text-text-muted hover:text-text" aria-label="Cambia preventivo"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input value={qDoc} onChange={(e) => setQDoc(e.target.value)} placeholder="Codice commessa, cliente o titolo"
                  className="w-full rounded-md border border-border bg-bg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40" />
              </div>
              {docs.length > 0 && (
                <ul className="border border-border rounded-md divide-y divide-border max-h-56 overflow-auto">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <button onClick={() => void scegliDoc(d)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-3">
                        <span className="font-medium">{d.codice}</span>
                        <span className="text-text-muted truncate flex-1">{d.cliente} · {d.tipo_prodotto}</span>
                        <span className="text-xs text-text-muted">{d.tipo === "generato" ? "builder" : "storico"}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* 3. Ambito */}
        {doc && righe.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-text">3. Cosa compone l&apos;articolo</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              {([["preventivo", "Intero preventivo"], ["blocchi", "Alcuni blocchi"], ["righe", "Singole righe"]] as const).map(([v, l]) => (
                <label key={v} className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="ambito" checked={ambito === v} onChange={() => setAmbito(v)} />{l}
                </label>
              ))}
            </div>

            {ambito === "blocchi" && (
              <ul className="border border-border rounded-md divide-y divide-border max-h-56 overflow-auto">
                {blocchiUnici.map((b) => (
                  <li key={b}>
                    <label className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={selBlocchi.has(b)} onChange={() => toggle(selBlocchi, setSelBlocchi, b)} />
                      <span className="flex-1">{b}</span>
                      <span className="text-xs text-text-muted">{pezzi.get(b) ?? 1} pz</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {ambito === "righe" && (
              <ul className="border border-border rounded-md divide-y divide-border max-h-72 overflow-auto">
                {righe.map((r) => (
                  <li key={r.id}>
                    <label className="flex items-center gap-3 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={selRighe.has(r.id)} onChange={() => toggle(selRighe, setSelRighe, r.id)} />
                      <span className="text-xs text-text-muted w-28 truncate">{r.codice_blocco}</span>
                      <span className="flex-1 truncate"><strong>{r.codice_articolo ?? "Servizio"}</strong> {r.descrizione}</span>
                      <span className="text-xs tabular-nums">{r.quantita == null ? "" : `${num.format(r.quantita)} × ${fmtEur(r.prezzo_unitario)}`}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="qta-articolo" className="text-xs text-text-muted">Pezzi di articolo coperti dalla selezione</label>
                <input id="qta-articolo" value={qta} onChange={(e) => setQta(e.target.value)} placeholder={String(pezziSuggeriti)} inputMode="decimal"
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40" />
                <p className="text-xs text-text-muted">Vuoto = {pezziSuggeriti} (i pezzi del blocco se ne scegli uno solo, altrimenti 1). Il confronto è sempre per pezzo.</p>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="note-nuovo" className="text-xs text-text-muted">Note</label>
                <input id="note-nuovo" value={note} onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40" />
              </div>
            </div>
          </section>
        )}
        {doc && righe.length === 0 && !errore && <p className="text-sm text-text-muted">Questo preventivo non ha righe di distinta da consuntivare.</p>}

        {/* Anteprima */}
        {anteprima && articolo && (
          <section className="space-y-2 border-t border-border pt-5">
            <h3 className="text-sm font-semibold text-text">Anteprima ({selezionate.length} righe)</h3>
            <Confronto n={anteprima} titoloRif="Standard Impresa" />
          </section>
        )}

        {errore && <p className="text-sm text-red-700">{errore}</p>}
        <div className="flex gap-2">
          <Button disabled={busy || !articolo || !doc || selezionate.length === 0} onClick={() => void crea()}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <Scale className="w-4 h-4 mr-1.5" />}Crea consuntivo
          </Button>
          <Button variant="outline" onClick={onAnnulla}>Annulla</Button>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────── Elenco ─────────────────────────── */

export function ConsuntivazioneView() {
  const [lista, setLista] = useState<ConsuntivoRiga[] | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [stato, setStato] = useState<"" | "aperto" | "chiuso">("")
  const [aperto, setAperto] = useState<string | null>(null)
  const [nuovo, setNuovo] = useState(false)
  const dq = useDebounced(q)

  const carica = useCallback(async () => {
    setErrore(null)
    try {
      const sp = new URLSearchParams()
      if (dq.trim()) sp.set("q", dq.trim())
      if (stato) sp.set("stato", stato)
      const res = await fetch(`/api/portali/preventivatore/consuntivi?${sp}`)
      if (!res.ok) throw new Error(await leggiErrore(res, "Errore lettura consuntivi"))
      setLista((await res.json()).consuntivi)
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Errore lettura consuntivi")
      setLista([])
    }
  }, [dq, stato])

  useEffect(() => { void carica() }, [carica])

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[16rem]">
          <h1 className="font-tenorite text-xl font-bold text-text">Consuntivazione</h1>
          <p className="text-sm text-text-muted mt-1">
            Confronta il costo preventivato di un articolo, diviso in materia prima, manodopera e trattamenti esterni,
            con lo standard di Impresa: dice se il lavoro è stato sotto o sovrastimato.
          </p>
        </div>
        {!nuovo && <Button onClick={() => { setNuovo(true); setAperto(null) }}><Plus className="w-4 h-4 mr-1.5" />Nuovo consuntivo</Button>}
      </div>

      {nuovo && <Nuovo onAnnulla={() => setNuovo(false)} onCreato={(id) => { setNuovo(false); setAperto(id); void carica() }} />}
      {aperto && !nuovo && <Dettaglio id={aperto} onChiudi={() => setAperto(null)} onCambiato={() => void carica()} />}

      <div className="border border-border rounded-xl bg-bg overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[12rem] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca articolo, descrizione o preventivo"
              className="w-full rounded-md border border-border bg-bg pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40" />
          </div>
          <select value={stato} onChange={(e) => setStato(e.target.value as "" | "aperto" | "chiuso")}
            className="rounded-md border border-border bg-bg px-3 py-1.5 text-sm" aria-label="Filtra per stato">
            <option value="">Tutti</option><option value="aperto">Aperti</option><option value="chiuso">Chiusi</option>
          </select>
        </div>
        {errore && <p className="px-5 py-3 text-sm text-red-700">{errore}</p>}
        {lista === null ? (
          <div className="p-8 text-center text-text-muted"><Loader2 className="w-4 h-4 animate-spin inline" /></div>
        ) : lista.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-muted">Nessun consuntivo{dq || stato ? " con questi filtri" : " ancora: creane uno dal pulsante in alto"}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-text-muted border-b border-border">
                  <th className="text-left py-2 px-5 font-medium">Articolo</th>
                  <th className="text-left py-2 px-3 font-medium">Preventivo</th>
                  <th className="text-right py-2 px-3 font-medium">Preventivato/pz</th>
                  <th className="text-right py-2 px-3 font-medium">Standard/pz</th>
                  <th className="text-right py-2 px-3 font-medium">Scostamento</th>
                  <th className="text-left py-2 px-5 font-medium">Esito</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((c) => {
                  const { totale, verdetto } = confrontaConsuntivo(numeri(c))
                  return (
                    <tr key={c.id} onClick={() => { setAperto(c.id); setNuovo(false) }}
                      className={`border-b border-border/60 cursor-pointer hover:bg-slate-50 ${aperto === c.id ? "bg-slate-50" : ""}`}>
                      <td className="py-2 px-5"><span className="font-medium">{c.codice_articolo}</span><span className="block text-xs text-text-muted truncate max-w-xs">{c.descrizione}</span></td>
                      <td className="py-2 px-3 text-text-muted">{c.documento_codice ?? "—"}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtEur(totale.preventivato)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtEur(totale.riferimento)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{fmtPct(totale.scostamentoPct)}</td>
                      <td className="py-2 px-5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${BADGE[verdetto]}`}>{ETICHETTA_VERDETTO[verdetto]}</span>
                        {c.stato === "chiuso" && <Lock className="w-3 h-3 inline ml-2 text-text-muted" aria-label="Chiuso" />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
