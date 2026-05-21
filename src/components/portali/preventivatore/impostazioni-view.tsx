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

interface OpenRouterModel {
  id: string
  name: string
  context_length: number | null
  input_cost_per_million: number | null
  output_cost_per_million: number | null
  tags: string[]
  description: string
}

type FeedbackType = { type: "success" | "error"; msg: string } | null

const CHIAVI_TEXTAREA = [
  "company_knowledge",
  "system_prompt_preciso",
  "system_prompt_creativo",
  "system_prompt_builder",
  "system_prompt_scheda_tecnica",
  "system_prompt_domande_scheda",
]

const LABEL_MAP: Record<string, string> = {
  company_knowledge:     "Profilo aziendale (conoscenza AI)",
  system_prompt_preciso: "Comportamento modalità Preciso",
  system_prompt_creativo:"Comportamento modalità Creativo",
  system_prompt_builder: "Chat builder (configuratore)",
  system_prompt_scheda_tecnica: "Generazione scheda tecnica",
  system_prompt_domande_scheda: "Domande di completamento info (scheda tecnica)",
  soglia_similarity:     "Soglia similarità semantica",
  soglia_similarity_scheda: "Soglia similarità per esempi scheda tecnica",
  temperatura_precisa:   "Temperatura modalità Preciso",
  temperatura_creativa:  "Temperatura modalità Creativo",
  temperatura_scheda_tecnica: "Temperatura scheda tecnica",
  max_chunks_per_query:  "Max chunks per query",
  max_esempi_scheda:     "Numero esempi storici per scheda tecnica",
  modello_embedding:     "Modello embedding",
  modello_generazione:   "Modello generazione chat",
  modello_scheda_tecnica: "Modello generazione scheda tecnica",
  ai_cost_counter_enabled: "Contatore spesa AI",
}
const CHIAVI_SLIDER: Record<string, { min: number; max: number; step: number }> = {
  soglia_similarity: { min: 0, max: 1, step: 0.05 },
  soglia_similarity_scheda: { min: 0, max: 1, step: 0.05 },
  temperatura_precisa: { min: 0, max: 1, step: 0.1 },
  temperatura_creativa: { min: 0, max: 1, step: 0.1 },
  temperatura_scheda_tecnica: { min: 0, max: 1, step: 0.05 },
}
const CHIAVI_NUMBER = ["max_chunks_per_query", "max_esempi_scheda"]
const CHIAVI_BOOLEAN = ["ai_cost_counter_enabled"]
const CHIAVI_MODEL_SELECTOR = ["modello_generazione", "modello_scheda_tecnica"]
const OPENROUTER_PREFIX = "openrouter:"

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
  const [models, setModels] = useState<OpenRouterModel[]>([])
  const [loadingModels, setLoadingModels] = useState(true)
  const [modelsError, setModelsError] = useState<string | null>(null)

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

  const fetchModels = useCallback(async () => {
    setLoadingModels(true)
    setModelsError(null)
    try {
      const res = await fetch("/api/portali/preventivatore/config/models")
      if (!res.ok) throw new Error("Errore fetch modelli")
      const data = await res.json() as { models: OpenRouterModel[] }
      setModels(data.models ?? [])
    } catch {
      setModelsError("Impossibile caricare i modelli OpenRouter. Puoi comunque inserire manualmente l'ID.")
    } finally {
      setLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
    fetchStats()
    fetchModels()
  }, [fetchConfig, fetchStats, fetchModels])

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
    if (CHIAVI_MODEL_SELECTOR.includes(chiave)) {
      return (
        <ModelSelector
          key={chiave}
          value={valore}
          models={models}
          loading={loadingModels}
          error={modelsError}
          onChange={(nextValue) => handleChange(chiave, nextValue)}
          onRefresh={fetchModels}
          description={descrizione ?? (LABEL_MAP[chiave] ?? chiave)}
        />
      )
    }

    if (CHIAVI_BOOLEAN.includes(chiave)) {
      const checked = valore === "true"
      return (
        <div key={chiave} className="flex items-start justify-between gap-4 rounded-lg border border-border bg-bg-page px-4 py-3">
          <div>
            <Label htmlFor={chiave}>
              {LABEL_MAP[chiave] ?? chiave.replace(/_/g, " ")}
            </Label>
            <p className="text-xs text-text-muted mt-0.5">
              {descrizione ?? "Mostra agli utenti il contatore di spesa OpenRouter nella chat AI."}
            </p>
          </div>
          <button
            id={chiave}
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => handleChange(chiave, checked ? "false" : "true")}
            className="relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors"
            style={{ backgroundColor: checked ? "#00a1be" : "rgba(100,116,139,0.35)" }}
          >
            <span
              className="absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all"
              style={{ left: checked ? "23px" : "4px" }}
            />
          </button>
        </div>
      )
    }

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

    if (CHIAVI_NUMBER.includes(chiave)) {
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

function modelValueToOpenRouterId(value: string) {
  return value.startsWith(OPENROUTER_PREFIX) ? value.slice(OPENROUTER_PREFIX.length) : value
}

function formatCost(value: number | null) {
  if (value == null) return "-"
  if (value === 0) return "$0"
  return `$${value >= 10 ? value.toFixed(0) : value.toFixed(2)}`
}

function formatContext(value: number | null) {
  if (!value) return ""
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M token`
  if (value >= 1000) return `${Math.round(value / 1000)}k token`
  return `${value} token`
}

function ModelSelector({
  value,
  models,
  loading,
  error,
  description,
  onChange,
  onRefresh,
}: {
  value: string
  models: OpenRouterModel[]
  loading: boolean
  error: string | null
  description: string | null
  onChange: (value: string) => void
  onRefresh: () => void
}) {
  const [search, setSearch] = useState("")
  const selectedId = modelValueToOpenRouterId(value)
  const selectedModel = models.find((model) => model.id === selectedId)
  const normalizedSearch = search.trim().toLowerCase()
  const filteredModels = normalizedSearch
    ? models.filter((model) =>
        [
          model.name,
          model.id,
          model.description,
          ...model.tags,
        ].some((field) => field.toLowerCase().includes(normalizedSearch))
      )
    : models

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Label htmlFor="modello_generazione">
            {LABEL_MAP.modello_generazione}
          </Label>
          <p className="text-xs text-text-muted mt-0.5">
            {description ?? "Modello usato da OpenRouter per la chat del preventivatore."}
          </p>
          <p className="text-xs text-text-muted mt-1">
            Se OpenRouter non e disponibile, la chat usa Gemini come fallback.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="gap-1.5 text-xs shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Modelli
        </Button>
      </div>

      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Cerca modello, provider o specialita..."
        disabled={loading || models.length === 0}
      />

      <select
        id="modello_generazione"
        value={selectedModel ? selectedModel.id : ""}
        onChange={(event) => {
          if (event.target.value) onChange(`${OPENROUTER_PREFIX}${event.target.value}`)
        }}
        disabled={loading || models.length === 0}
        className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-[#00a1be]/40"
      >
        <option value="">
          {loading ? "Caricamento modelli OpenRouter..." : "Seleziona un modello OpenRouter"}
        </option>
        {filteredModels.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name} - {model.id}
          </option>
        ))}
      </select>

      {!loading && models.length > 0 && (
        <p className="text-[11px] text-text-muted">
          {filteredModels.length} modelli mostrati su {models.length}, ordinati alfabeticamente.
        </p>
      )}

      {selectedModel && (
        <div className="rounded-lg border border-border bg-bg-page px-4 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-text">{selectedModel.name}</p>
            {selectedModel.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ backgroundColor: "rgba(0,161,190,0.12)", color: "#007a91" }}
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="text-xs text-text-muted">{selectedModel.description}</p>
          <div className="flex flex-wrap gap-3 text-[11px] text-text-muted">
            <span>Input: {formatCost(selectedModel.input_cost_per_million)} / 1M token</span>
            <span>Output: {formatCost(selectedModel.output_cost_per_million)} / 1M token</span>
            {selectedModel.context_length && <span>Contesto: {formatContext(selectedModel.context_length)}</span>}
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="modello_generazione_manual" className="text-xs text-text-muted">
          ID modello salvato
        </Label>
        <Input
          id="modello_generazione_manual"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="openrouter:anthropic/claude-haiku-4-5"
          className="font-mono text-xs"
        />
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
