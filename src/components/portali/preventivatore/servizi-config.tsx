"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Plus, Trash2, Save, RefreshCw, Wrench, CheckCircle2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface Servizio {
  id: string
  nome: string
  categoria: string
  tariffa_ora: number
  unita: string
  ordine: number
  is_attivo: boolean
}

type Feedback = { type: "success" | "error"; msg: string } | null

/**
 * Gestione servizi/lavorazioni del builder preventivi.
 * CRUD completo su `preventivatore.servizi_manodopera`: nome, categoria,
 * tariffa oraria, unità, ordine, attivo/disattivo.
 */
export function ServiziConfig() {
  const [servizi, setServizi] = useState<Servizio[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  // mappa modifiche locali non ancora salvate
  const [draft, setDraft] = useState<Record<string, Partial<Servizio>>>({})

  const fetchServizi = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/portali/preventivatore/servizi?all=1")
      if (!res.ok) throw new Error()
      const data: Servizio[] = await res.json()
      setServizi(data)
      setDraft({})
    } catch {
      setFeedback({ type: "error", msg: "Impossibile caricare i servizi." })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchServizi() }, [fetchServizi])

  function setCampo(id: string, campo: keyof Servizio, valore: string | number | boolean) {
    setDraft((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: valore } }))
  }

  function valore<K extends keyof Servizio>(s: Servizio, campo: K): Servizio[K] {
    const d = draft[s.id]
    return (d && campo in d ? (d[campo] as Servizio[K]) : s[campo])
  }

  const haDraft = (id: string) => draft[id] && Object.keys(draft[id]).length > 0

  async function salvaRiga(s: Servizio) {
    if (!haDraft(s.id)) return
    setSavingId(s.id)
    setFeedback(null)
    try {
      const res = await fetch(`/api/portali/preventivatore/servizi/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft[s.id]),
      })
      if (!res.ok) throw new Error()
      const aggiornato: Servizio = await res.json()
      setServizi((prev) => prev.map((x) => (x.id === s.id ? aggiornato : x)))
      setDraft((prev) => { const n = { ...prev }; delete n[s.id]; return n })
      setFeedback({ type: "success", msg: `"${aggiornato.nome}" salvato.` })
    } catch {
      setFeedback({ type: "error", msg: "Errore nel salvataggio." })
    } finally {
      setSavingId(null)
    }
  }

  async function toggleAttivo(s: Servizio) {
    const nuovo = !valore(s, "is_attivo")
    setSavingId(s.id)
    try {
      const res = await fetch(`/api/portali/preventivatore/servizi/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_attivo: nuovo }),
      })
      if (!res.ok) throw new Error()
      const aggiornato: Servizio = await res.json()
      setServizi((prev) => prev.map((x) => (x.id === s.id ? { ...aggiornato, ...draft[s.id] } : x)))
    } catch {
      setFeedback({ type: "error", msg: "Errore nel cambio stato." })
    } finally {
      setSavingId(null)
    }
  }

  async function elimina(s: Servizio) {
    if (!confirm(`Eliminare "${s.nome}"? L'azione è definitiva.`)) return
    setSavingId(s.id)
    try {
      const res = await fetch(`/api/portali/preventivatore/servizi/${s.id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      setServizi((prev) => prev.filter((x) => x.id !== s.id))
      setFeedback({ type: "success", msg: `"${s.nome}" eliminato.` })
    } catch {
      setFeedback({ type: "error", msg: "Errore nell'eliminazione." })
    } finally {
      setSavingId(null)
    }
  }

  async function aggiungi() {
    setSavingId("new")
    setFeedback(null)
    try {
      const ordineMax = servizi.reduce((m, s) => Math.max(m, s.ordine), 0)
      const res = await fetch("/api/portali/preventivatore/servizi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: "Nuova lavorazione",
          categoria: "Manodopera",
          tariffa_ora: 50,
          unita: "h",
          ordine: ordineMax + 1,
          is_attivo: true,
        }),
      })
      if (!res.ok) throw new Error()
      const nuovo: Servizio = await res.json()
      setServizi((prev) => [...prev, nuovo])
      setFeedback({ type: "success", msg: "Lavorazione aggiunta — modifica nome e tariffa." })
    } catch {
      setFeedback({ type: "error", msg: "Errore nella creazione." })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="border border-border rounded-xl bg-bg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text">Servizi e Lavorazioni</h2>
        </div>
        <Button variant="outline" size="sm" onClick={fetchServizi} disabled={loading} className="gap-1.5 text-xs">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Ricarica
        </Button>
      </div>

      <div className="p-5">
        <p className="text-xs text-text-muted mb-4">
          Voci di manodopera disponibili nel builder preventivi. Le tariffe e i nomi sono
          modificabili; le voci disattivate non compaiono nei nuovi blocchi.
        </p>

        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-text-muted">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Caricamento servizi...</span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-text-muted uppercase tracking-wide">
                  <th className="text-left font-medium px-2 py-1.5 w-16">Ordine</th>
                  <th className="text-left font-medium px-2 py-1.5">Nome</th>
                  <th className="text-left font-medium px-2 py-1.5">Categoria</th>
                  <th className="text-right font-medium px-2 py-1.5 w-28">Tariffa/h</th>
                  <th className="text-center font-medium px-2 py-1.5 w-16">Unità</th>
                  <th className="text-center font-medium px-2 py-1.5 w-20">Attivo</th>
                  <th className="px-2 py-1.5 w-24" />
                </tr>
              </thead>
              <tbody>
                {servizi.map((s) => {
                  const attivo = Boolean(valore(s, "is_attivo"))
                  return (
                    <tr key={s.id} className="border-t border-border">
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          value={valore(s, "ordine")}
                          onChange={(e) => setCampo(s.id, "ordine", Number(e.target.value))}
                          className="h-8 text-sm w-14"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={valore(s, "nome")}
                          onChange={(e) => setCampo(s.id, "nome", e.target.value)}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={valore(s, "categoria")}
                          onChange={(e) => setCampo(s.id, "categoria", e.target.value)}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          type="number"
                          step={0.5}
                          value={valore(s, "tariffa_ora")}
                          onChange={(e) => setCampo(s.id, "tariffa_ora", Number(e.target.value))}
                          className="h-8 text-sm text-right"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input
                          value={valore(s, "unita")}
                          onChange={(e) => setCampo(s.id, "unita", e.target.value)}
                          className="h-8 text-sm text-center"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={attivo}
                          onClick={() => toggleAttivo(s)}
                          disabled={savingId === s.id}
                          className="relative h-6 w-11 rounded-full transition-colors mx-auto block"
                          style={{ backgroundColor: attivo ? "#00a1be" : "rgba(100,116,139,0.35)" }}
                        >
                          <span
                            className="absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all"
                            style={{ left: attivo ? "23px" : "4px" }}
                          />
                        </button>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => salvaRiga(s)}
                            disabled={!haDraft(s.id) || savingId === s.id}
                            title="Salva modifiche"
                            className="p-1.5 rounded text-text-muted hover:text-[#00a1be] disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            {savingId === s.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Save className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => elimina(s)}
                            disabled={savingId === s.id}
                            title="Elimina"
                            className="p-1.5 rounded text-text-muted hover:text-red-500 disabled:opacity-30"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {servizi.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-text-muted py-6 text-sm">
                      Nessun servizio configurato.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
        {feedback ? (
          <div className={`flex items-center gap-2 text-sm ${feedback.type === "success" ? "text-green-600" : "text-red-600"}`}>
            {feedback.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {feedback.msg}
          </div>
        ) : (
          <span />
        )}
        <Button
          onClick={aggiungi}
          disabled={savingId === "new"}
          variant="outline"
          className="gap-2 ml-auto"
        >
          {savingId === "new" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Aggiungi lavorazione
        </Button>
      </div>
    </div>
  )
}
