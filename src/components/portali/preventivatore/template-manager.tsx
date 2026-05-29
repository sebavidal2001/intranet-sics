"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, Trash2, Save, Wand2, Loader2, FlaskConical, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fmtEur } from "@/components/portali/preventivatore/nuovo-view-types"
import { calcolaArticoli, calcolaServizi, type TemplateProdotto } from "@/lib/portali/preventivatore/template/types"
import { validateFormula } from "@/lib/portali/preventivatore/template/formula"

type ListItem = { id: string; nome: string; slug: string; attivo: boolean }

const BASE = "/api/portali/preventivatore/template"

function emptyDraft(): TemplateProdotto {
  return {
    nome: "", slug: "", descrizione: "", attivo: true, ordine: 999,
    consegna_settimane_min: null, consegna_settimane_max: null,
    imballaggio_pct: 1, tempi_accessori_pct: 2.8, spese_generali_pct: 24.2,
    margine_default_pct: 5, ricarico_materiale_default: 0.5, ricarico_manodopera_default: 0.7,
    parametri: [], righe_materiale: [], righe_manodopera: [],
  }
}

export function TemplateManager() {
  const [list, setList] = useState<ListItem[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [draft, setDraft] = useState<TemplateProdotto | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<Record<string, string | number | boolean>>({})
  const [aiText, setAiText] = useState("")
  const [aiLoading, setAiLoading] = useState(false)

  const caricaLista = useCallback(async () => {
    const res = await fetch(`${BASE}?all=1`)
    if (res.ok) setList(await res.json())
  }, [])
  useEffect(() => { caricaLista() }, [caricaLista])

  async function apri(id: string) {
    setLoading(true); setErr(null); setMsg(null)
    try {
      const res = await fetch(`${BASE}/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "Errore")
      setSelId(id); setDraft(normalize(data)); setPreview({})
    } catch (e) { setErr(e instanceof Error ? e.message : "Errore") } finally { setLoading(false) }
  }

  async function nuovo() {
    const nome = window.prompt("Nome del nuovo template (es. Protezioni):")
    if (!nome) return
    const slug = window.prompt("Slug (minuscolo, snake_case):", nome.toLowerCase().replace(/[^a-z0-9_]+/g, "_"))
    if (!slug) return
    const res = await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, slug }) })
    const data = await res.json()
    if (!res.ok) { setErr(data?.error ?? "Errore"); return }
    await caricaLista(); apri(data.id)
  }

  async function salva() {
    if (!draft || !selId) return
    setSaving(true); setErr(null); setMsg(null)
    try {
      const res = await fetch(`${BASE}/${selId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "Errore salvataggio")
      setDraft(normalize(data)); setMsg("Template salvato."); caricaLista()
    } catch (e) { setErr(e instanceof Error ? e.message : "Errore") } finally { setSaving(false) }
  }

  async function elimina() {
    if (!selId || !window.confirm("Eliminare il template?")) return
    const res = await fetch(`${BASE}/${selId}`, { method: "DELETE" })
    if (res.ok) { setSelId(null); setDraft(null); caricaLista() }
  }

  async function aiGenera() {
    if (!aiText.trim()) return
    setAiLoading(true); setErr(null)
    try {
      const res = await fetch(`${BASE}/ai-genera`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ richiesta: aiText, bozza: draft ? toAiShape(draft) : undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "Errore AI")
      setDraft((prev) => mergeAi(prev ?? emptyDraft(), data.template))
      setMsg("Bozza AI applicata: rivedi e salva.")
    } catch (e) { setErr(e instanceof Error ? e.message : "Errore AI") } finally { setAiLoading(false) }
  }

  // slug ammessi nelle formule
  const slugAmmessi = useMemo(() => {
    const s = new Set<string>()
    draft?.parametri.forEach((p) => p.slug && s.add(p.slug))
    draft?.righe_materiale.forEach((r) => r.slug && s.add(r.slug))
    return s
  }, [draft])

  // Anteprima live
  const anteprima = useMemo(() => {
    if (!draft) return null
    const articoli = calcolaArticoli(draft, preview)
    const servizi = calcolaServizi(draft, preview)
    const baseVend = articoli.reduce((s, a) => s + (a.coeff_ricarico > 0 ? a.ult_costo * a.qty / a.coeff_ricarico : 0), 0)
      + servizi.reduce((s, sv) => s + (sv.coeff_ricarico > 0 ? sv.tariffa_ora * sv.ore / sv.coeff_ricarico : 0), 0)
    const costo = articoli.reduce((s, a) => s + a.ult_costo * a.qty, 0)
      + servizi.reduce((s, sv) => s + sv.tariffa_ora * sv.ore, 0)
    const imb = baseVend * (draft.imballaggio_pct / 100)
    const tempi = costo * (draft.tempi_accessori_pct / 100)
    const spese = costo * (draft.spese_generali_pct / 100)
    const prezzo = (baseVend + imb + tempi + spese) * (1 + draft.margine_default_pct / 100)
    return { articoli, servizi, baseVend, costo, imb, tempi, spese, prezzo }
  }, [draft, preview])

  function patch(p: Partial<TemplateProdotto>) { setDraft((d) => (d ? { ...d, ...p } : d)) }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-tenorite text-text">Template Prodotti</h1>
        <p className="text-sm text-text-muted mt-1">Configura i template per tipologia di prodotto: parametri, distinta con formule e manodopera.</p>
      </div>

      {(err || msg) && (
        <div className={`rounded-lg px-4 py-2 text-sm ${err ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
          {err ?? msg}
        </div>
      )}

      <div className="flex gap-5 items-start">
        {/* Lista */}
        <div className="w-56 shrink-0 space-y-2">
          <Button onClick={nuovo} size="sm" className="w-full gap-1.5"><Plus className="w-4 h-4" />Nuovo template</Button>
          <div className="border border-border rounded-xl overflow-hidden">
            {list.map((t) => (
              <button key={t.id} onClick={() => apri(t.id)}
                className={`w-full text-left px-3 py-2 text-sm border-b border-border last:border-0 transition-colors ${selId === t.id ? "bg-[#00a1be]/10 text-[#007a91] font-medium" : "hover:bg-bg-page"}`}>
                {t.nome}
                {!t.attivo && <span className="text-[10px] text-text-muted ml-1">(off)</span>}
              </button>
            ))}
            {list.length === 0 && <div className="px-3 py-4 text-xs text-text-muted text-center">Nessun template</div>}
          </div>

          {/* Assistente AI */}
          <div className="border border-[#c82381]/30 rounded-xl p-3 bg-[#c82381]/5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#c82381]"><Wand2 className="w-3.5 h-3.5" />Assistente AI</div>
            <textarea value={aiText} onChange={(e) => setAiText(e.target.value)} rows={4}
              placeholder="Descrivi il template (es. 'protezione a pannelli con larghezza, altezza, opzione cerniere...')"
              className="w-full rounded-md border border-border bg-bg px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-[#c82381]/30" />
            <Button onClick={aiGenera} disabled={aiLoading || !aiText.trim()} size="sm" variant="outline" className="w-full gap-1.5 text-[#c82381] border-[#c82381]/30 hover:bg-[#c82381]/10">
              {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {draft ? "Migliora con AI" : "Genera con AI"}
            </Button>
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 min-w-0">
          {loading && <div className="flex items-center gap-2 text-text-muted text-sm"><Loader2 className="w-4 h-4 animate-spin" />Carico…</div>}
          {!draft && !loading && <div className="text-sm text-text-muted py-10 text-center">Seleziona o crea un template.</div>}
          {draft && (
            <div className="space-y-5">
              {/* Intestazione + costanti */}
              <div className="border border-border rounded-xl bg-bg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Input value={draft.nome} onChange={(e) => patch({ nome: e.target.value })} placeholder="Nome" className="text-base font-medium" />
                  <label className="flex items-center gap-1.5 text-xs text-text-muted shrink-0">
                    <input type="checkbox" checked={draft.attivo} onChange={(e) => patch({ attivo: e.target.checked })} /> attivo
                  </label>
                  <Button onClick={salva} disabled={saving} size="sm" className="gap-1.5 shrink-0">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Salva</Button>
                  <Button onClick={elimina} size="sm" variant="outline" className="gap-1.5 shrink-0 text-red-600 border-red-200 hover:bg-red-50"><Trash2 className="w-4 h-4" /></Button>
                </div>
                <Input value={draft.descrizione ?? ""} onChange={(e) => patch({ descrizione: e.target.value })} placeholder="Descrizione" className="text-sm" />
                <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                  <NumF label="Imballaggio %" v={draft.imballaggio_pct} on={(v) => patch({ imballaggio_pct: v })} />
                  <NumF label="Tempi acc. %" v={draft.tempi_accessori_pct} on={(v) => patch({ tempi_accessori_pct: v })} />
                  <NumF label="Spese gen. %" v={draft.spese_generali_pct} on={(v) => patch({ spese_generali_pct: v })} />
                  <NumF label="Margine %" v={draft.margine_default_pct} on={(v) => patch({ margine_default_pct: v })} />
                  <NumF label="Sett. min" v={draft.consegna_settimane_min ?? 0} on={(v) => patch({ consegna_settimane_min: v })} />
                  <NumF label="Sett. max" v={draft.consegna_settimane_max ?? 0} on={(v) => patch({ consegna_settimane_max: v })} />
                </div>
              </div>

              {/* Parametri */}
              <Sezione titolo="Parametri di input" onAdd={() => patch({ parametri: [...draft.parametri, { slug: "", label: "", tipo: "number", valore_default: "0" }] })}>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-text-muted">
                    <th className="py-1 pr-2">Slug</th><th className="pr-2">Label</th><th className="pr-2">Tipo</th><th className="pr-2">Unità</th><th className="pr-2">Default</th><th /></tr></thead>
                  <tbody>
                    {draft.parametri.map((p, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1 pr-2"><input value={p.slug} onChange={(e) => updArr("parametri", i, { slug: e.target.value })} className="w-full font-mono bg-transparent border border-border rounded px-1" /></td>
                        <td className="pr-2"><input value={p.label} onChange={(e) => updArr("parametri", i, { label: e.target.value })} className="w-full bg-transparent border border-border rounded px-1" /></td>
                        <td className="pr-2">
                          <select value={p.tipo} onChange={(e) => updArr("parametri", i, { tipo: e.target.value as "number"|"select"|"bool" })} className="bg-transparent border border-border rounded px-1">
                            <option value="number">number</option><option value="select">select</option><option value="bool">bool</option>
                          </select>
                        </td>
                        <td className="pr-2"><input value={p.unita ?? ""} onChange={(e) => updArr("parametri", i, { unita: e.target.value })} className="w-14 bg-transparent border border-border rounded px-1" /></td>
                        <td className="pr-2"><input value={p.valore_default ?? ""} onChange={(e) => updArr("parametri", i, { valore_default: e.target.value })} className="w-16 bg-transparent border border-border rounded px-1" /></td>
                        <td><button onClick={() => delArr("parametri", i)} className="text-text-muted hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Sezione>

              {/* Materiali */}
              <Sezione titolo="Righe materiale (distinta)" onAdd={() => patch({ righe_materiale: [...draft.righe_materiale, { descrizione: "", ricarico_default: draft.ricarico_materiale_default, qta_manuale: 0 }] })}>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-text-muted">
                    <th className="py-1 pr-2">Slug</th><th className="pr-2">Descrizione</th><th className="pr-2">Codice</th><th className="pr-2" title="Costo corrente da anagrafica (live)">Costo attuale</th><th className="pr-2">Costo man.</th><th className="pr-2">Ricarico</th><th className="pr-2">Formula q.tà</th><th /></tr></thead>
                  <tbody>
                    {draft.righe_materiale.map((r, i) => {
                      const f = r.qta_formula ? validateFormula(r.qta_formula, slugAmmessi) : { ok: true }
                      return (
                        <tr key={i} className="border-t border-border">
                          <td className="py-1 pr-2"><input value={r.slug ?? ""} onChange={(e) => updArr("righe_materiale", i, { slug: e.target.value })} className="w-16 font-mono bg-transparent border border-border rounded px-1" /></td>
                          <td className="pr-2"><input value={r.descrizione} onChange={(e) => updArr("righe_materiale", i, { descrizione: e.target.value })} className="w-full bg-transparent border border-border rounded px-1" /></td>
                          <td className="pr-2"><input value={r.codice_articolo ?? ""} onChange={(e) => updArr("righe_materiale", i, { codice_articolo: e.target.value })} onBlur={(e) => lookupCosto(i, e.target.value)} className="w-24 font-mono bg-transparent border border-border rounded px-1" /></td>
                          <td className="pr-2 text-right tabular-nums whitespace-nowrap">{r.codice_articolo ? (r.costo_corrente != null ? fmtEur(r.costo_corrente) : <span className="text-amber-600" title="Codice non trovato in anagrafica">n/d</span>) : <span className="text-text-muted">—</span>}</td>
                          <td className="pr-2"><input type="number" value={r.costo_manuale ?? 0} onChange={(e) => updArr("righe_materiale", i, { costo_manuale: Number(e.target.value) })} className="w-16 bg-transparent border border-border rounded px-1 text-right" title="Usato come fallback se il codice non è in anagrafica" /></td>
                          <td className="pr-2"><input type="number" step={0.01} value={r.ricarico_default} onChange={(e) => updArr("righe_materiale", i, { ricarico_default: Number(e.target.value) })} className="w-14 bg-transparent border border-border rounded px-1 text-right" /></td>
                          <td className="pr-2">
                            <input value={r.qta_formula ?? ""} onChange={(e) => updArr("righe_materiale", i, { qta_formula: e.target.value })} placeholder={`man. ${r.qta_manuale ?? 0}`}
                              className={`w-44 font-mono bg-transparent border rounded px-1 ${f.ok ? "border-border" : "border-red-400"}`} title={f.ok ? "" : ("error" in f ? f.error : "")} />
                            {!f.ok && <AlertTriangle className="inline w-3 h-3 text-red-500 ml-1" />}
                          </td>
                          <td><button onClick={() => delArr("righe_materiale", i)} className="text-text-muted hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </Sezione>

              {/* Manodopera */}
              <Sezione titolo="Righe manodopera" onAdd={() => patch({ righe_manodopera: [...draft.righe_manodopera, { label: "", tariffa_default: 27.98, unita_tempo: "h", modalita: "per_pezzo", ricarico_default: draft.ricarico_manodopera_default }] })}>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-text-muted">
                    <th className="py-1 pr-2">Lavorazione</th><th className="pr-2">Tariffa €/h</th><th className="pr-2">Unità</th><th className="pr-2">Tempo def.</th><th className="pr-2">Formula tempo</th><th className="pr-2">Modalità</th><th className="pr-2">Ricarico</th><th /></tr></thead>
                  <tbody>
                    {draft.righe_manodopera.map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1 pr-2"><input value={r.label} onChange={(e) => updArr("righe_manodopera", i, { label: e.target.value })} className="w-full bg-transparent border border-border rounded px-1" /></td>
                        <td className="pr-2"><input type="number" step={0.01} value={r.tariffa_default} onChange={(e) => updArr("righe_manodopera", i, { tariffa_default: Number(e.target.value) })} className="w-16 bg-transparent border border-border rounded px-1 text-right" /></td>
                        <td className="pr-2"><select value={r.unita_tempo} onChange={(e) => updArr("righe_manodopera", i, { unita_tempo: e.target.value as "min"|"h" })} className="bg-transparent border border-border rounded px-1"><option value="h">h</option><option value="min">min</option></select></td>
                        <td className="pr-2"><input type="number" value={r.tempo_default ?? 0} onChange={(e) => updArr("righe_manodopera", i, { tempo_default: Number(e.target.value) })} className="w-14 bg-transparent border border-border rounded px-1 text-right" /></td>
                        <td className="pr-2"><input value={r.tempo_formula ?? ""} onChange={(e) => updArr("righe_manodopera", i, { tempo_formula: e.target.value })} className="w-32 font-mono bg-transparent border border-border rounded px-1" /></td>
                        <td className="pr-2"><select value={r.modalita} onChange={(e) => updArr("righe_manodopera", i, { modalita: e.target.value as "per_pezzo"|"una_tantum" })} className="bg-transparent border border-border rounded px-1"><option value="per_pezzo">per pezzo</option><option value="una_tantum">una tantum</option></select></td>
                        <td className="pr-2"><input type="number" step={0.01} value={r.ricarico_default} onChange={(e) => updArr("righe_manodopera", i, { ricarico_default: Number(e.target.value) })} className="w-14 bg-transparent border border-border rounded px-1 text-right" /></td>
                        <td><button onClick={() => delArr("righe_manodopera", i)} className="text-text-muted hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Sezione>

              {/* Anteprima live */}
              {anteprima && (
                <div className="border border-[#00a1be]/30 rounded-xl bg-[#00a1be]/5 p-4 space-y-3">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-[#007a91]"><FlaskConical className="w-4 h-4" />Anteprima (valori di prova)</div>
                  <div className="flex flex-wrap gap-2">
                    {draft.parametri.map((p) => (
                      <label key={p.slug || p.label} className="text-xs text-text-muted flex items-center gap-1">
                        {p.label || p.slug}
                        <input value={String(preview[p.slug] ?? p.valore_default ?? "")} onChange={(e) => setPreview((pv) => ({ ...pv, [p.slug]: e.target.value }))}
                          className="w-20 bg-bg border border-border rounded px-1 py-0.5" />
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
                    <Kpi label="Costo" v={anteprima.costo} />
                    <Kpi label="Vendita base" v={anteprima.baseVend} />
                    <Kpi label="Imb.+Tempi+Spese" v={anteprima.imb + anteprima.tempi + anteprima.spese} />
                    <Kpi label="Prezzo finale" v={anteprima.prezzo} accent />
                  </div>
                  <div className="text-[11px] text-text-muted">
                    {anteprima.articoli.filter((a) => a.qty !== 0).length} materiali con q.tà · {anteprima.servizi.length} lavorazioni
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )

  // helpers di update array tipizzati
  function updArr<K extends "parametri" | "righe_materiale" | "righe_manodopera">(key: K, idx: number, patchRow: Partial<TemplateProdotto[K][number]>) {
    setDraft((d) => {
      if (!d) return d
      const arr = [...d[key]] as TemplateProdotto[K]
      arr[idx] = { ...arr[idx], ...patchRow } as TemplateProdotto[K][number]
      return { ...d, [key]: arr }
    })
  }
  function delArr(key: "parametri" | "righe_materiale" | "righe_manodopera", idx: number) {
    setDraft((d) => (d ? { ...d, [key]: d[key].filter((_, i) => i !== idx) } : d))
  }
  // Lookup costo "live" dall'anagrafica al cambio codice (svuota se codice tolto)
  async function lookupCosto(idx: number, codice: string) {
    const c = codice.trim()
    if (!c) { updArr("righe_materiale", idx, { costo_corrente: null, data_ult_costo: null }); return }
    try {
      const res = await fetch(`/api/portali/preventivatore/prodotti/costo?codice=${encodeURIComponent(c)}`)
      const d = await res.json()
      updArr("righe_materiale", idx, {
        costo_corrente: d?.trovato ? (d.ult_costo ?? null) : null,
        data_ult_costo: d?.trovato ? (d.data_ult_costo ?? null) : null,
      })
    } catch { /* ignora */ }
  }
}

// ─── sub-components / utils ──────────────────────────────────────────────────
function Sezione({ titolo, onAdd, children }: { titolo: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-xl bg-bg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-text">{titolo}</h3>
        <Button onClick={onAdd} size="sm" variant="outline" className="gap-1 text-xs"><Plus className="w-3.5 h-3.5" />Aggiungi</Button>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  )
}
function NumF({ label, v, on }: { label: string; v: number; on: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      <input type="number" step={0.01} value={v} onChange={(e) => on(Number(e.target.value))} className="bg-bg border border-border rounded px-1.5 py-1 text-sm" />
    </label>
  )
}
function Kpi({ label, v, accent }: { label: string; v: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`text-base font-bold tabular-nums ${accent ? "" : "text-text"}`} style={accent ? { color: "#00a1be" } : undefined}>{fmtEur(v)}</div>
    </div>
  )
}

function normalize(d: Record<string, unknown>): TemplateProdotto {
  const n = (x: unknown, def = 0) => (x == null ? def : Number(x))
  return {
    id: d.id as string, nome: (d.nome as string) ?? "", slug: (d.slug as string) ?? "",
    descrizione: (d.descrizione as string) ?? "", attivo: Boolean(d.attivo), ordine: n(d.ordine, 999),
    consegna_settimane_min: d.consegna_settimane_min as number | null,
    consegna_settimane_max: d.consegna_settimane_max as number | null,
    imballaggio_pct: n(d.imballaggio_pct, 1), tempi_accessori_pct: n(d.tempi_accessori_pct, 2.8),
    spese_generali_pct: n(d.spese_generali_pct, 24.2), margine_default_pct: n(d.margine_default_pct, 5),
    ricarico_materiale_default: n(d.ricarico_materiale_default, 0.5), ricarico_manodopera_default: n(d.ricarico_manodopera_default, 0.7),
    parametri: ((d.parametri as Array<Record<string, unknown>>) ?? []).map((p) => ({
      slug: (p.slug as string) ?? "", label: (p.label as string) ?? "", tipo: (p.tipo as "number"|"select"|"bool") ?? "number",
      unita: (p.unita as string) ?? "", valore_default: (p.valore_default as string) ?? "", opzioni: (p.opzioni as string[]) ?? null,
    })),
    righe_materiale: ((d.righe_materiale as Array<Record<string, unknown>>) ?? []).map((r) => ({
      slug: (r.slug as string) ?? "", descrizione: (r.descrizione as string) ?? "", codice_articolo: (r.codice_articolo as string) ?? "",
      costo_manuale: r.costo_manuale as number | null, usa_listino: Boolean(r.usa_listino), ricarico_default: n(r.ricarico_default, 0.5),
      qta_formula: (r.qta_formula as string) ?? "", qta_manuale: n(r.qta_manuale, 0), gruppo: (r.gruppo as string) ?? "",
      costo_corrente: r.costo_corrente as number | null, data_ult_costo: r.data_ult_costo as string | null,
    })),
    righe_manodopera: ((d.righe_manodopera as Array<Record<string, unknown>>) ?? []).map((r) => ({
      label: (r.label as string) ?? "", tariffa_default: n(r.tariffa_default, 0), unita_tempo: (r.unita_tempo as "min"|"h") ?? "h",
      tempo_formula: (r.tempo_formula as string) ?? "", tempo_default: n(r.tempo_default, 0),
      modalita: (r.modalita as "per_pezzo"|"una_tantum") ?? "per_pezzo", ricarico_default: n(r.ricarico_default, 0.7),
    })),
  }
}

function toAiShape(d: TemplateProdotto) {
  return { nome: d.nome, descrizione: d.descrizione, parametri: d.parametri, righe_materiale: d.righe_materiale, righe_manodopera: d.righe_manodopera }
}

type AiTpl = Partial<TemplateProdotto> & { costanti?: Record<string, number> }
function mergeAi(prev: TemplateProdotto, ai: AiTpl): TemplateProdotto {
  const c = ai.costanti ?? {}
  return {
    ...prev,
    nome: ai.nome || prev.nome,
    descrizione: ai.descrizione ?? prev.descrizione,
    parametri: Array.isArray(ai.parametri) ? ai.parametri : prev.parametri,
    righe_materiale: Array.isArray(ai.righe_materiale) ? ai.righe_materiale : prev.righe_materiale,
    righe_manodopera: Array.isArray(ai.righe_manodopera) ? ai.righe_manodopera : prev.righe_manodopera,
    imballaggio_pct: c.imballaggio_pct ?? prev.imballaggio_pct,
    tempi_accessori_pct: c.tempi_accessori_pct ?? prev.tempi_accessori_pct,
    spese_generali_pct: c.spese_generali_pct ?? prev.spese_generali_pct,
    margine_default_pct: c.margine_default_pct ?? prev.margine_default_pct,
    consegna_settimane_min: c.consegna_settimane_min ?? prev.consegna_settimane_min,
    consegna_settimane_max: c.consegna_settimane_max ?? prev.consegna_settimane_max,
  }
}
