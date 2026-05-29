"use client"

import { useState } from "react"
import { Boxes, Loader2, Sparkles } from "lucide-react"
import {
  calcolaArticoli, calcolaServizi, type TemplateProdotto,
} from "@/lib/portali/preventivatore/template/types"
import {
  genKey, type ArticoloBlocco, type ServizioBlocco,
} from "@/components/portali/preventivatore/nuovo-view-types"

export type TemplateListItem = { id: string; nome: string; slug: string }

/**
 * Pannello dentro il blocco: scegli un template, compila i parametri e applica
 * → genera articoli + lavorazioni nella distinta del blocco (sostituendole).
 */
export function BloccoTemplatePanel({
  templates,
  onApplica,
}: {
  templates: TemplateListItem[]
  onApplica: (
    articoli: ArticoloBlocco[],
    servizi: ServizioBlocco[],
    nome: string,
    meta: {
      slug: string
      parametri: Record<string, string | number | boolean>
      parametri_def: { slug: string; label: string; tipo: string; unita?: string | null; opzioni?: string[] | null }[]
      usa_catena_guida: boolean
    },
  ) => void
}) {
  const [tplId, setTplId] = useState("")
  const [tpl, setTpl] = useState<TemplateProdotto | null>(null)
  const [valori, setValori] = useState<Record<string, string | number | boolean>>({})
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function seleziona(id: string) {
    setTplId(id); setTpl(null); setErr(null)
    if (!id) return
    setLoading(true)
    try {
      const res = await fetch(`/api/portali/preventivatore/template/${id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? "Errore")
      setTpl(data as TemplateProdotto)
      const init: Record<string, string> = {}
      for (const p of (data.parametri ?? [])) init[p.slug] = p.valore_default ?? ""
      setValori(init)
    } catch (e) { setErr(e instanceof Error ? e.message : "Errore") } finally { setLoading(false) }
  }

  function applica() {
    if (!tpl) return
    // Includiamo TUTTE le righe del template (anche quelle a quantità 0 / manuali):
    // l'operatore completerà le quantità nelle righe manuali direttamente nel blocco.
    const articoli: ArticoloBlocco[] = calcolaArticoli(tpl, valori)
      .map((a) => ({
        _key: genKey(), prodotto_id: "", codice: a.codice, descrizione: a.descrizione,
        ult_costo: a.ult_costo, ult_costo_componente: a.ult_costo, qty: a.qty, coeff_ricarico: a.coeff_ricarico,
        manuale: a.manuale, data_ult_costo: a.data_ult_costo,
        slug: a.slug, qta_formula: a.qta_formula, qta_override: false,
        metri_catena: a.metri_catena, metri_guida: a.metri_guida,
      }))
    const servizi: ServizioBlocco[] = calcolaServizi(tpl, valori).map((s) => ({
      _key: genKey(), servizio_id: "", nome: s.nome, categoria: s.categoria,
      tariffa_ora: s.tariffa_ora, ore: s.ore, coeff_ricarico: s.coeff_ricarico,
      scala_con_quantita: s.scala_con_quantita,
    }))
    onApplica(articoli, servizi, tpl.nome, {
      slug: tpl.slug,
      parametri: { ...valori },
      parametri_def: tpl.parametri.map((p) => ({ slug: p.slug, label: p.label, tipo: p.tipo, unita: p.unita, opzioni: p.opzioni })),
      usa_catena_guida: !!tpl.usa_catena_guida,
    })
  }

  if (templates.length === 0) return null

  return (
    <div className="rounded-lg border border-[#00a1be]/25 bg-[#00a1be]/5 p-3 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#007a91]"><Boxes className="w-3.5 h-3.5" />Genera da template</span>
        <select
          value={tplId}
          onChange={(e) => seleziona(e.target.value)}
          className="text-sm rounded-md border border-border bg-bg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40"
        >
          <option value="">— scegli un template —</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-text-muted" />}
      </div>

      {err && <div className="text-xs text-red-600">{err}</div>}

      {tpl && (
        <>
          {tpl.parametri.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tpl.parametri.map((p) => (
                <label key={p.slug} className="text-xs text-text-muted flex items-center gap-1">
                  {p.label}{p.unita ? ` [${p.unita}]` : ""}
                  {p.tipo === "bool" ? (
                    <select value={String(valori[p.slug] ?? "no")} onChange={(e) => setValori((v) => ({ ...v, [p.slug]: e.target.value }))}
                      className="bg-bg border border-border rounded px-1 py-0.5">
                      <option value="SI">SI</option><option value="no">no</option>
                    </select>
                  ) : p.tipo === "select" ? (
                    <select value={String(valori[p.slug] ?? "")} onChange={(e) => setValori((v) => ({ ...v, [p.slug]: e.target.value }))}
                      className="bg-bg border border-border rounded px-1 py-0.5">
                      {(p.opzioni ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type="number" value={String(valori[p.slug] ?? "")} onChange={(e) => setValori((v) => ({ ...v, [p.slug]: e.target.value }))}
                      className="w-20 bg-bg border border-border rounded px-1 py-0.5" />
                  )}
                </label>
              ))}
            </div>
          )}
          <button
            onClick={applica}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#00a1be] text-white px-3 py-1.5 text-sm hover:bg-[#0091ad] transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Applica al blocco
          </button>
          <p className="text-[10px] text-text-muted">Sostituisce articoli e lavorazioni del blocco con quelli calcolati dal template (poi modificabili).</p>
        </>
      )}
    </div>
  )
}
