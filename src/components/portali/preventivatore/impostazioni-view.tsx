"use client"

import { useState, useEffect, useCallback } from "react"
import { Loader2, Save, AlertCircle, CheckCircle2, Database, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface AIConfig {
  id: string
  chiave: string
  valore: string
  descrizione: string | null
}

interface DocumentiStats {
  totale: number
  pending: number
  ordinato: number
  rifiutato: number
  total_chunks: number
}

type FeedbackType = { type: "success" | "error"; msg: string } | null

const CHIAVI_TEXTAREA = ["company_knowledge", "system_prompt_preciso", "system_prompt_creativo"]

const LABEL_MAP: Record<string, string> = {
  company_knowledge:     "Profilo aziendale (conoscenza AI)",
  system_prompt_preciso: "Comportamento modalità Preciso",
  system_prompt_creativo:"Comportamento modalità Creativo",
  soglia_similarity:     "Soglia similarità semantica",
  temperatura_precisa:   "Temperatura modalità Preciso",
  temperatura_creativa:  "Temperatura modalità Creativo",
  max_chunks_per_query:  "Max chunks per query",
  modello_embedding:     "Modello embedding",
  modello_generazione:   "Modello generazione",
}
const CHIAVI_SLIDER: Record<string, { min: number; max: number; step: number }> = {
  soglia_similarity: { min: 0, max: 1, step: 0.05 },
  temperatura_precisa: { min: 0, max: 1, step: 0.1 },
  temperatura_creativa: { min: 0, max: 1, step: 0.1 },
}
const CHIAVE_NUMBER = "max_chunks_per_query"

function configToMap(configs: AIConfig[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const c of configs) map[c.chiave] = c.valore
  return map
}

export function ImpostazioniView() {
  const [configs, setConfigs] = useState<AIConfig[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [loadingConfig, setLoadingConfig] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [feedback, setFeedback] = useState<FeedbackType>(null)

  const [stats, setStats] = useState<DocumentiStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)

  const fetchConfig = useCallback(async () => {
    setLoadingConfig(true)
    try {
      const res = await fetch("/api/portali/preventivatore/config")
      if (!res.ok) throw new Error("Errore fetch config")
      const data: AIConfig[] = await res.json()
      setConfigs(data)
      setValues(configToMap(data))
    } catch {
      setFeedback({ type: "error", msg: "Impossibile caricare le configurazioni." })
    } finally {
      setLoadingConfig(false)
    }
  }, [])

  const fetchStats = useCallback(async () => {
    setLoadingStats(true)
    try {
      const res = await fetch("/api/portali/preventivatore/documenti?stats=true")
      if (!res.ok) throw new Error()
      const data = await res.json()
      setStats(data)
    } catch {
      // ignore stats error
    } finally {
      setLoadingStats(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
    fetchStats()
  }, [fetchConfig, fetchStats])

  const handleChange = (chiave: string, valore: string) => {
    setValues((prev) => ({ ...prev, [chiave]: valore }))
  }

  const salvaConfig = async () => {
    setSavingConfig(true)
    setFeedback(null)
    try {
      const res = await fetch("/api/portali/preventivatore/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? "Errore salvataggio")
      }
      setFeedback({ type: "success", msg: "Configurazione salvata con successo." })
    } catch (err) {
      setFeedback({
        type: "error",
        msg: err instanceof Error ? err.message : "Errore sconosciuto",
      })
    } finally {
      setSavingConfig(false)
    }
  }

  const renderField = (chiave: string, valore: string, descrizione: string | null) => {
    if (CHIAVI_TEXTAREA.includes(chiave)) {
      const rows = chiave === "company_knowledge" ? 14 : 6
      return (
        <div key={chiave} className="space-y-1.5">
          <div>
            <Label htmlFor={chiave}>
              {LABEL_MAP[chiave] ?? chiave.replace(/_/g, " ")}
            </Label>
            {descrizione && (
              <p className="text-xs text-text-muted mt-0.5">{descrizione}</p>
            )}
          </div>
          <textarea
            id={chiave}
            value={valore}
            onChange={(e) => handleChange(chiave, e.target.value)}
            rows={rows}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40 resize-y font-mono"
          />
        </div>
      )
    }

    const sliderConfig = CHIAVI_SLIDER[chiave]
    if (sliderConfig) {
      const num = parseFloat(valore) || 0
      return (
        <div key={chiave} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor={chiave}>
              {LABEL_MAP[chiave] ?? chiave.replace(/_/g, " ")}
            </Label>
            <span className="text-sm font-medium text-text tabular-nums">
              {num.toFixed(sliderConfig.step < 0.1 ? 2 : 1)}
            </span>
          </div>
          {descrizione && (
            <p className="text-xs text-text-muted">{descrizione}</p>
          )}
          <input
            id={chiave}
            type="range"
            min={sliderConfig.min}
            max={sliderConfig.max}
            step={sliderConfig.step}
            value={num}
            onChange={(e) => handleChange(chiave, e.target.value)}
            className="w-full accent-[#00a1be]"
          />
        </div>
      )
    }

    if (chiave === CHIAVE_NUMBER) {
      return (
        <div key={chiave} className="space-y-1.5">
          <Label htmlFor={chiave}>
            {LABEL_MAP[chiave] ?? chiave.replace(/_/g, " ")}
          </Label>
          {descrizione && (
            <p className="text-xs text-text-muted mt-0.5">{descrizione}</p>
          )}
          <Input
            id={chiave}
            type="number"
            min={1}
            max={20}
            value={valore}
            onChange={(e) => handleChange(chiave, e.target.value)}
            className="w-32"
          />
        </div>
      )
    }

    // Default: text input
    return (
      <div key={chiave} className="space-y-1.5">
        <Label htmlFor={chiave}>
          {LABEL_MAP[chiave] ?? chiave.replace(/_/g, " ")}
        </Label>
        {descrizione && (
          <p className="text-xs text-text-muted mt-0.5">{descrizione}</p>
        )}
        <Input
          id={chiave}
          value={valore}
          onChange={(e) => handleChange(chiave, e.target.value)}
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-tenorite text-text">Impostazioni</h1>
        <p className="text-sm text-text-muted mt-1">
          Configura i parametri del motore AI del Preventivatore.
        </p>
      </div>

      {/* Config section */}
      <div className="border border-border rounded-xl bg-bg overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Configurazione AI</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchConfig}
            disabled={loadingConfig}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingConfig ? "animate-spin" : ""}`} />
            Ricarica
          </Button>
        </div>

        <div className="p-5">
          {loadingConfig ? (
            <div className="flex items-center justify-center py-10 gap-2 text-text-muted">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Caricamento configurazione...</span>
            </div>
          ) : (
            <div className="space-y-6">
              {configs.map((c) =>
                renderField(c.chiave, values[c.chiave] ?? c.valore, c.descrizione)
              )}

              {configs.length === 0 && (
                <p className="text-sm text-text-muted text-center py-6">
                  Nessuna configurazione trovata.
                </p>
              )}
            </div>
          )}
        </div>

        {!loadingConfig && configs.length > 0 && (
          <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
            {feedback ? (
              <div
                className={`flex items-center gap-2 text-sm ${
                  feedback.type === "success" ? "text-green-600" : "text-red-600"
                }`}
              >
                {feedback.type === "success" ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <AlertCircle className="w-4 h-4" />
                )}
                {feedback.msg}
              </div>
            ) : (
              <span />
            )}
            <Button
              onClick={salvaConfig}
              disabled={savingConfig}
              style={{ backgroundColor: "#00a1be" }}
              className="text-white hover:opacity-90 gap-2 ml-auto"
            >
              {savingConfig ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Salva configurazione
            </Button>
          </div>
        )}
      </div>

      {/* Stats section */}
      <div className="border border-border rounded-xl bg-bg overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Database className="w-4 h-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text">Statistiche Documenti</h2>
        </div>

        <div className="p-5">
          {loadingStats ? (
            <div className="flex items-center justify-center py-6 gap-2 text-text-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Caricamento statistiche...</span>
            </div>
          ) : stats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <StatCard label="Totale documenti" value={stats.totale} />
              <StatCard label="In attesa" value={stats.pending} color="yellow" />
              <StatCard label="Ordinati" value={stats.ordinato} color="green" />
              <StatCard label="Rifiutati" value={stats.rifiutato} color="red" />
              <StatCard label="Chunks totali" value={stats.total_chunks} />
            </div>
          ) : (
            <p className="text-sm text-text-muted text-center py-6">
              Impossibile caricare le statistiche.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color?: "yellow" | "green" | "red"
}) {
  const colorClass =
    color === "yellow"
      ? "text-yellow-700 bg-yellow-50"
      : color === "green"
      ? "text-green-700 bg-green-50"
      : color === "red"
      ? "text-red-700 bg-red-50"
      : "text-text bg-bg-page"

  return (
    <div className={`rounded-lg px-4 py-3 border border-border ${colorClass}`}>
      <p className="text-2xl font-tenorite">{value.toLocaleString("it-IT")}</p>
      <p className="text-xs mt-0.5 opacity-70">{label}</p>
    </div>
  )
}
