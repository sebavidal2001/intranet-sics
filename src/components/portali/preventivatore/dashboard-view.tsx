"use client"

import { useEffect, useState } from "react"
import {
  TrendingUp,
  TrendingDown,
  Clock,
  CheckCircle2,
  FileText,
  Users,
  BarChart3,
  Sparkles,
  Package,
  CircleDashed,
  Wallet,
} from "lucide-react"
import Link from "next/link"
import { Mascot } from "@/components/portali/preventivatore/mascot"

// ─── Types ────────────────────────────────────────────────────────────────────

type DashboardData = {
  window_months: number
  kpi: {
    tot_preventivi: number
    tot_preventivi_delta: number | null
    valore_totale: number
    valore_totale_delta: number | null
    importo_medio: number
    importo_medio_delta: number | null
    clienti_attivi: number
    clienti_attivi_delta: number | null
    tot_ordinati: number
    tot_rifiutati: number
    tot_pending: number
    tasso_ordinato: number | null
    workflow_stati_attivo: boolean
  }
  top_clienti: { cliente: string; preventivi: number; valore: number; ordinati: number }[]
  serie_mensile: {
    mese: string
    preventivi: number
    valore: number
    ordinati: number
    categorie?: { categoria: string; preventivi: number; valore: number }[]
  }[]
  top_articoli: { codice: string; descrizione: string; occorrenze: number; qta: number; valore: number }[]
  attivita_recente: {
    id: string
    codice: string | null
    cliente: string | null
    stato: string
    tipo: string
    importo: number | null
    data_offerta: string | null
    created_at: string
  }[]
  ai: { spesa_mese_corrente: number; currency: string }
}

// ─── Format helpers ───────────────────────────────────────────────────────────

const fmtEuro = (v: number) => {
  if (v >= 1_000_000) return `€ ${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `€ ${(v / 1_000).toFixed(1)}k`
  return `€ ${v.toFixed(0)}`
}

const fmtEuroFull = (v: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v)

const fmtUsd = (v: number) => {
  if (v < 0.01 && v > 0) return "< $0.01"
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v)
}

const MONTH_LABELS = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"]
const monthLabel = (iso: string) => {
  const d = new Date(iso)
  return MONTH_LABELS[d.getUTCMonth()]
}

const CATEGORY_COLORS: Record<string, string> = {
  nastri: "#00a1be",
  scale: "#95c11f",
  protezioni: "#ee7326",
  strutture: "#747373",
  automazioni: "#c82381",
  altro: "#e73331",
}

const CATEGORY_LABELS: Record<string, string> = {
  nastri: "Nastri",
  scale: "Scale",
  protezioni: "Protezioni",
  strutture: "Strutture",
  automazioni: "Automazioni",
  altro: "Altro",
}

const categoryColor = (categoria: string) => CATEGORY_COLORS[categoria] ?? "#007a91"
const categoryLabel = (categoria: string) => CATEGORY_LABELS[categoria] ?? categoria.replace(/_/g, " ")

const fmtRelativeIt = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return "ora"
  if (min < 60) return `${min}m fa`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h fa`
  const d = Math.floor(h / 24)
  if (d === 1) return "ieri"
  if (d < 30) return `${d}gg fa`
  return new Date(iso).toLocaleDateString("it-IT", { day: "2-digit", month: "short" })
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color = "#00a1be", fill = true }: { data: number[]; color?: string; fill?: boolean }) {
  if (data.length < 2) return null
  const w = 80, h = 28, pad = 2
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v - min) / range) * (h - pad * 2)
    return `${x},${y}`
  })
  const polyline = pts.join(" ")
  const area = `${pad},${h} ${polyline} ${w - pad},${h} Z`
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none" xmlns="http://www.w3.org/2000/svg">
      {fill && <polygon points={area} fill={color} opacity={0.12} />}
      <polyline points={polyline} stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

// ─── Chip ─────────────────────────────────────────────────────────────────────

type ChipVariant = "ok" | "warn" | "info" | "muted" | "danger"

const CHIP_STYLES: Record<ChipVariant, { bg: string; text: string }> = {
  ok:     { bg: "rgba(149,193,31,0.14)",  text: "#6a9118" },
  warn:   { bg: "rgba(238,115,38,0.14)",  text: "#b85a15" },
  info:   { bg: "rgba(0,161,190,0.14)",   text: "#007a91" },
  muted:  { bg: "rgba(100,116,139,0.12)", text: "#64748b" },
  danger: { bg: "rgba(231,51,49,0.14)",   text: "#b91c1c" },
}

function Chip({ label, variant = "info" }: { label: string; variant?: ChipVariant }) {
  const s = CHIP_STYLES[variant]
  return (
    <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: s.bg, color: s.text }}>
      {label}
    </span>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: string
  sub?: string
  trend?: number | null
  sparkData?: number[]
  sparkColor?: string
  chipLabel?: string
  chipVariant?: ChipVariant
  icon: React.ElementType
  loading?: boolean
}

function KpiCard({ label, value, sub, trend, sparkData, sparkColor, chipLabel, chipVariant, icon: Icon, loading }: KpiCardProps) {
  const trendUp = trend != null ? trend >= 0 : undefined

  return (
    <div className="bg-white rounded-2xl p-5 flex flex-col gap-3 relative overflow-hidden" style={{ boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)" }}>
      <div className="flex items-center justify-between">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(0,161,190,0.10)" }}>
          <Icon className="w-4 h-4" style={{ color: "#00a1be" }} />
        </div>
        {chipLabel && <Chip label={chipLabel} variant={chipVariant} />}
      </div>

      <div>
        {loading ? (
          <div className="h-7 w-24 rounded bg-[#f0f4f8] animate-pulse" />
        ) : (
          <p className="text-2xl font-tenorite font-bold text-[#0f1720] leading-none">{value}</p>
        )}
        {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
      </div>

      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-text-muted">{label}</p>
          {trend != null && !loading && (
            <div className="flex items-center gap-1 mt-0.5">
              {trendUp ? (
                <TrendingUp className="w-3 h-3" style={{ color: "#95c11f" }} />
              ) : (
                <TrendingDown className="w-3 h-3" style={{ color: "#e73331" }} />
              )}
              <span className="text-[10px] font-semibold" style={{ color: trendUp ? "#6a9118" : "#b91c1c" }}>
                {trend > 0 ? "+" : ""}{trend}% vs periodo prec.
              </span>
            </div>
          )}
          {trend == null && !loading && (
            <p className="text-[10px] text-text-muted mt-0.5">— periodo prec. n/d</p>
          )}
        </div>
        {sparkData && sparkData.length > 1 && (
          <Sparkline data={sparkData} color={sparkColor ?? "#00a1be"} />
        )}
      </div>
    </div>
  )
}

// ─── KPI Card placeholder (workflow non attivo) ───────────────────────────────

function KpiCardPlaceholder({ label, hint, icon: Icon }: { label: string; hint: string; icon: React.ElementType }) {
  return (
    <div className="bg-white rounded-2xl p-5 flex flex-col gap-3 relative overflow-hidden" style={{ boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)", borderLeft: "3px solid rgba(238,115,38,0.45)" }}>
      <div className="flex items-center justify-between">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: "rgba(238,115,38,0.10)" }}>
          <Icon className="w-4 h-4" style={{ color: "#ee7326" }} />
        </div>
        <Chip label="In arrivo" variant="warn" />
      </div>
      <div>
        <p className="text-2xl font-tenorite font-bold text-[#0f1720] leading-none">—</p>
        <p className="text-xs text-text-muted mt-1">non disponibile</p>
      </div>
      <div>
        <p className="text-xs font-medium text-text-muted">{label}</p>
        <p className="text-[10px] text-text-muted mt-0.5 leading-snug">{hint}</p>
      </div>
    </div>
  )
}

// ─── Top Clienti ──────────────────────────────────────────────────────────────

function TopClienti({ data }: { data: DashboardData["top_clienti"] }) {
  const max = data[0]?.valore ?? 1
  return (
    <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: "#00a1be" }} />
          <h3 className="text-sm font-semibold text-[#0f1720]">Top Clienti</h3>
        </div>
        <Chip label="Ultimi 12 mesi" variant="muted" />
      </div>

      {data.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-6">Nessun cliente nel periodo</p>
      ) : (
        <div className="space-y-2">
          {data.map((c, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="text-[10px] font-bold w-4 text-center" style={{ color: "rgba(100,116,139,0.5)" }}>{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs font-medium text-[#0f1720] truncate">{c.cliente}</span>
                  <span className="text-xs font-mono text-text-muted shrink-0 ml-2">{fmtEuroFull(c.valore)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-[#f0f4f8] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.max(6, Math.round((c.valore / max) * 100))}%`,
                      backgroundColor: i === 0 ? "#00a1be" : `rgba(0,161,190,${Math.max(0.25, 0.7 - i * 0.12)})`,
                    }}
                  />
                </div>
              </div>
              <Chip label={`${c.preventivi}`} variant="info" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Bar chart serie mensile ─────────────────────────────────────────────────

function BarSerieMensile({ data }: { data: DashboardData["serie_mensile"] }) {
  const last12 = data.slice(-12)
  const max = Math.max(1, ...last12.map((d) => d.preventivi))
  const categories = Array.from(
    new Set(last12.flatMap((d) => (d.categorie ?? []).filter((c) => c.preventivi > 0).map((c) => c.categoria)))
  ).sort((a, b) => {
    const order = ["nastri", "scale", "protezioni", "strutture", "automazioni", "altro"]
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
  return (
    <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: "#00a1be" }} />
          <h3 className="text-sm font-semibold text-[#0f1720]">Preventivi mensili</h3>
        </div>
        <Chip label="12 mesi" variant="info" />
      </div>

      <div className="flex items-end justify-around gap-1.5 sm:gap-2 h-36 px-2 overflow-x-auto">
        {last12.map((d) => {
          const height = Math.round((d.preventivi / max) * 118)
          const stacked = categories
            .map((categoria) => ({
              categoria,
              item: (d.categorie ?? []).find((c) => c.categoria === categoria),
            }))
            .filter((entry) => entry.item && entry.item.preventivi > 0)
          return (
            <div
              key={d.mese}
              className="flex flex-col items-center gap-1 shrink-0"
              style={{ width: 32 }}
              title={`${d.preventivi} preventivi · ${fmtEuroFull(d.valore)}`}
            >
              <span className="text-[10px] font-semibold text-text-muted leading-none">{d.preventivi || ""}</span>
              <div
                className="w-full rounded-t-md overflow-hidden transition-all duration-500 flex flex-col-reverse shadow-sm"
                style={{
                  height: `${Math.max(d.preventivi > 0 ? 8 : 2, height)}px`,
                  backgroundColor: "rgba(0,161,190,0.08)",
                }}
              >
                {stacked.map(({ categoria, item }) => (
                  <div
                    key={`${d.mese}-${categoria}`}
                    style={{
                      height: `${Math.round(((item?.preventivi ?? 0) / d.preventivi) * 100)}%`,
                      backgroundColor: categoryColor(categoria),
                    }}
                    title={`${categoryLabel(categoria)}: ${item?.preventivi ?? 0} preventivi - ${fmtEuroFull(item?.valore ?? 0)}`}
                  />
                ))}
              </div>
              <span className="text-[9px] font-medium text-text-muted">{monthLabel(d.mese)}</span>
            </div>
          )
        })}
      </div>

      {categories.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t border-[#e2e8f0] pt-3">
          {categories.map((categoria) => (
            <div key={categoria} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: categoryColor(categoria) }} />
              <span className="text-[10px] font-medium text-text-muted">{categoryLabel(categoria)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Top articoli ─────────────────────────────────────────────────────────────

function TopArticoli({ data }: { data: DashboardData["top_articoli"] }) {
  return (
    <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)" }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4" style={{ color: "#00a1be" }} />
          <h3 className="text-sm font-semibold text-[#0f1720]">Articoli più ricorrenti</h3>
        </div>
        <Chip label={`${data.length} top`} variant="muted" />
      </div>

      {data.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-6">Nessun articolo in distinta</p>
      ) : (
        <div className="space-y-2.5">
          {data.map((a) => (
            <div key={a.codice} className="flex items-center gap-3">
              <span className="text-[10px] font-mono font-semibold text-[#0f1720] truncate max-w-[110px]" title={a.codice}>{a.codice}</span>
              <span className="text-xs text-text-muted truncate flex-1" title={a.descrizione}>{a.descrizione}</span>
              <Chip label={`${a.occorrenze}×`} variant="info" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Timeline attività recente ───────────────────────────────────────────────

const STATO_CFG: Record<string, { label: string; dot: string; chip: ChipVariant }> = {
  pending:   { label: "Pending",   dot: "#94a3b8", chip: "muted"  },
  ordinato:  { label: "Ordinato",  dot: "#95c11f", chip: "ok"     },
  rifiutato: { label: "Rifiutato", dot: "#e73331", chip: "danger" },
}

function Timeline({ data }: { data: DashboardData["attivita_recente"] }) {
  return (
    <div className="bg-white rounded-2xl p-5" style={{ boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)" }}>
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4" style={{ color: "#00a1be" }} />
        <h3 className="text-sm font-semibold text-[#0f1720]">Attività recente</h3>
      </div>

      {data.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-6">Nessuna attività</p>
      ) : (
        <div className="relative">
          <div className="absolute left-[7px] top-2 bottom-2 w-px" style={{ backgroundColor: "rgba(0,161,190,0.15)" }} />
          <div className="space-y-3.5">
            {data.map((item) => {
              const cfg = STATO_CFG[item.stato] ?? STATO_CFG.pending
              return (
                <div key={item.id} className="flex items-start gap-3 pl-0.5">
                  <div className="w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 ring-2 ring-white" style={{ backgroundColor: cfg.dot }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold text-[#0f1720] font-mono">{item.codice ?? "—"}</span>
                      <Chip label={cfg.label} variant={cfg.chip} />
                      {item.tipo === "generato" && <Chip label="Generato" variant="info" />}
                    </div>
                    <p className="text-xs text-text-muted truncate mt-0.5">
                      {item.cliente ?? "Cliente n/d"}{item.importo != null ? ` · ${fmtEuroFull(item.importo)}` : ""}
                    </p>
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0">{fmtRelativeIt(item.created_at)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── AI Quick Start ───────────────────────────────────────────────────────────

function AIQuickStart({ spesaMese, currency }: { spesaMese: number; currency: string }) {
  return (
    <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: "linear-gradient(180deg, #0f1720 0%, #18222e 100%)", boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,0,0,.18)" }}>
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: "linear-gradient(rgba(0,161,190,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,161,190,0.06) 1px, transparent 1px)", backgroundSize: "28px 28px" }} />
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(0,161,190,0.15) 0%, transparent 70%)", transform: "translate(30%, -30%)" }} />

      <div className="relative flex items-start gap-4">
        <div className="shrink-0 mt-1">
          <Mascot stato="idle" size={52} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-3.5 h-3.5" style={{ color: "#00a1be" }} />
            <span className="text-xs font-semibold" style={{ color: "#00a1be" }}>AI Copilot</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: "#95c11f" }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: "#95c11f" }} />
            </span>
            {spesaMese > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(149,193,31,0.18)", color: "#bfe25e" }} title="Spesa AI nel mese corrente">
                <Wallet className="w-3 h-3" />{currency === "usd" ? fmtUsd(spesaMese) : spesaMese.toFixed(2)}
              </span>
            )}
          </div>

          <p className="text-sm font-tenorite text-white leading-snug mb-3">Pronto ad aiutarti</p>
          <p className="text-xs leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.55)" }}>
            Usa il Copilot nell&apos;Archivio per trovare preventivi simili, cercare articoli e analizzare dati storici tramite linguaggio naturale.
          </p>

          <div className="flex gap-2 flex-wrap">
            <Link href="/preventivatore/archivio" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all duration-150" style={{ backgroundColor: "rgba(0,161,190,0.25)", border: "1px solid rgba(0,161,190,0.35)" }}>
              Apri Archivio
            </Link>
            <Link href="/preventivatore/nuovo" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150" style={{ color: "rgba(255,255,255,0.65)", border: "1px solid rgba(255,255,255,0.12)", backgroundColor: "transparent" }}>
              Nuovo preventivo
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Banner workflow stati ───────────────────────────────────────────────────

function WorkflowStatiBanner({ pending }: { pending: number }) {
  return (
    <div className="rounded-2xl p-4 flex items-start gap-3" style={{ backgroundColor: "rgba(238,115,38,0.06)", border: "1px solid rgba(238,115,38,0.20)" }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "rgba(238,115,38,0.14)" }}>
        <CircleDashed className="w-4 h-4" style={{ color: "#ee7326" }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#0f1720]">Workflow stati non attivo</p>
        <p className="text-xs text-text-muted mt-0.5 leading-snug">
          Tutti i {pending} preventivi sono ancora <code className="text-[10px] font-mono">pending</code>. Inizia a marcare gli stati (ordinato/rifiutato) dall&apos;archivio per popolare il <strong>tasso di conversione</strong> e i KPI commerciali.
        </p>
      </div>
      <Link href="/preventivatore/archivio" className="text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0" style={{ backgroundColor: "#ee7326", color: "white" }}>
        Vai all&apos;archivio
      </Link>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function DashboardView() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/portali/preventivatore/dashboard", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? `HTTP ${r.status}`)
        return r.json() as Promise<DashboardData>
      })
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : "Errore caricamento") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const sparkSerie = data?.serie_mensile.map((s) => s.preventivi) ?? []
  const sparkValore = data?.serie_mensile.map((s) => s.valore) ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-tenorite font-bold text-[#0f1720]">Dashboard</h1>
          <p className="text-sm text-text-muted mt-0.5">Panoramica attività preventivatore · ultimi 12 mesi</p>
        </div>
        {data && <Chip label={`${data.kpi.tot_preventivi} preventivi · live`} variant="ok" />}
        {!data && !error && <Chip label="Caricamento…" variant="muted" />}
        {error && <Chip label="Errore caricamento" variant="danger" />}
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Preventivi totali"
          value={loading || !data ? "…" : String(data.kpi.tot_preventivi)}
          sub="ultimi 12 mesi"
          trend={data?.kpi.tot_preventivi_delta ?? null}
          sparkData={sparkSerie}
          sparkColor="#00a1be"
          chipLabel="Live"
          chipVariant="ok"
          icon={FileText}
          loading={loading}
        />
        <KpiCard
          label="Valore totale"
          value={loading || !data ? "…" : fmtEuro(data.kpi.valore_totale)}
          sub="preventivi emessi"
          trend={data?.kpi.valore_totale_delta ?? null}
          sparkData={sparkValore}
          sparkColor="#95c11f"
          chipLabel="Live"
          chipVariant="ok"
          icon={TrendingUp}
          loading={loading}
        />
        <KpiCard
          label="Clienti attivi"
          value={loading || !data ? "…" : String(data.kpi.clienti_attivi)}
          sub="distinti nel periodo"
          trend={data?.kpi.clienti_attivi_delta ?? null}
          chipLabel="Live"
          chipVariant="ok"
          icon={Users}
          loading={loading}
        />
        {data?.kpi.workflow_stati_attivo && data.kpi.tasso_ordinato != null ? (
          <KpiCard
            label="Tasso ordinato"
            value={`${data.kpi.tasso_ordinato}%`}
            sub={`${data.kpi.tot_ordinati} ord · ${data.kpi.tot_rifiutati} rif`}
            chipLabel="Live"
            chipVariant="ok"
            icon={CheckCircle2}
            loading={loading}
          />
        ) : (
          <KpiCardPlaceholder
            label="Tasso ordinato"
            hint="Marca i preventivi come ordinato/rifiutato per attivare il KPI conversione."
            icon={CheckCircle2}
          />
        )}
      </div>

      {/* Banner workflow se non attivo */}
      {data && !data.kpi.workflow_stati_attivo && data.kpi.tot_pending > 0 && (
        <WorkflowStatiBanner pending={data.kpi.tot_pending} />
      )}

      {/* Middle row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data ? <TopClienti data={data.top_clienti} /> : <SkeletonCard h={280} />}
        {data ? <BarSerieMensile data={data.serie_mensile} /> : <SkeletonCard h={200} />}
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data ? <Timeline data={data.attivita_recente} /> : <SkeletonCard h={280} />}
        <AIQuickStart spesaMese={data?.ai.spesa_mese_corrente ?? 0} currency={data?.ai.currency ?? "usd"} />
      </div>

      {/* Articoli più ricorrenti (full width sotto) */}
      {data && data.top_articoli.length > 0 && <TopArticoli data={data.top_articoli} />}
    </div>
  )
}

function SkeletonCard({ h }: { h: number }) {
  return (
    <div className="bg-white rounded-2xl animate-pulse" style={{ height: `${h}px`, boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)" }} />
  )
}
