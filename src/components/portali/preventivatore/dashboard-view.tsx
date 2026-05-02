"use client"

import { TrendingUp, TrendingDown, Clock, CheckCircle2, FileText, Users, BarChart3, Sparkles } from "lucide-react"
import Link from "next/link"
import { Mascot } from "@/components/portali/preventivatore/mascot"

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

function Sparkline({
  data,
  color = "#00a1be",
  fill = true,
}: {
  data: number[]
  color?: string
  fill?: boolean
}) {
  if (data.length < 2) return null
  const w = 80
  const h = 28
  const pad = 2
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
      {fill && (
        <polygon points={area} fill={color} opacity={0.12} />
      )}
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
    <span
      className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {label}
    </span>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: string
  sub?: string
  trend?: number       // % change, positive = up
  sparkData?: number[]
  sparkColor?: string
  chipLabel?: string
  chipVariant?: ChipVariant
  icon: React.ElementType
}

function KpiCard({ label, value, sub, trend, sparkData, sparkColor, chipLabel, chipVariant, icon: Icon }: KpiCardProps) {
  const trendUp = trend !== undefined ? trend >= 0 : undefined

  return (
    <div
      className="bg-white rounded-2xl p-5 flex flex-col gap-3 relative overflow-hidden"
      style={{ boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)" }}
    >
      {/* Top row */}
      <div className="flex items-center justify-between">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,161,190,0.10)" }}
        >
          <Icon className="w-4 h-4" style={{ color: "#00a1be" }} />
        </div>
        {chipLabel && <Chip label={chipLabel} variant={chipVariant} />}
      </div>

      {/* Value */}
      <div>
        <p className="text-2xl font-tenorite font-bold text-[#0f1720] leading-none">{value}</p>
        {sub && <p className="text-xs text-text-muted mt-1">{sub}</p>}
      </div>

      {/* Bottom row */}
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-text-muted">{label}</p>
          {trend !== undefined && (
            <div className="flex items-center gap-1 mt-0.5">
              {trendUp ? (
                <TrendingUp className="w-3 h-3" style={{ color: "#95c11f" }} />
              ) : (
                <TrendingDown className="w-3 h-3" style={{ color: "#e73331" }} />
              )}
              <span
                className="text-[10px] font-semibold"
                style={{ color: trendUp ? "#6a9118" : "#b91c1c" }}
              >
                {trend > 0 ? "+" : ""}{trend}% vs mese prec.
              </span>
            </div>
          )}
        </div>
        {sparkData && (
          <Sparkline data={sparkData} color={sparkColor ?? "#00a1be"} />
        )}
      </div>
    </div>
  )
}

// ─── Top Clienti row ──────────────────────────────────────────────────────────

interface ClienteItem {
  nome: string
  preventivi: number
  valore: string
  stato: ChipVariant
}

const CLIENTI_STUB: ClienteItem[] = [
  { nome: "ALPHAMAC S.r.l.",      preventivi: 12, valore: "€ 148.200", stato: "ok"   },
  { nome: "Tecno Sistemi Group",  preventivi:  9, valore: "€  92.500", stato: "ok"   },
  { nome: "Edil Construct SpA",   preventivi:  7, valore: "€  67.000", stato: "warn" },
  { nome: "Officine Riunite",     preventivi:  5, valore: "€  44.300", stato: "info" },
  { nome: "MetalWork Srl",        preventivi:  4, valore: "€  31.100", stato: "muted"},
]

function TopClienti() {
  return (
    <div
      className="bg-white rounded-2xl p-5"
      style={{ boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: "#00a1be" }} />
          <h3 className="text-sm font-semibold text-[#0f1720]">Top Clienti</h3>
        </div>
        <Chip label="Ultimi 90 gg" variant="muted" />
      </div>

      <div className="space-y-2">
        {CLIENTI_STUB.map((c, i) => (
          <div key={i} className="flex items-center gap-3">
            {/* rank */}
            <span className="text-[10px] font-bold w-4 text-center" style={{ color: "rgba(100,116,139,0.5)" }}>
              {i + 1}
            </span>
            {/* bar */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-xs font-medium text-[#0f1720] truncate">{c.nome}</span>
                <span className="text-xs font-mono text-text-muted shrink-0 ml-2">{c.valore}</span>
              </div>
              <div className="h-1.5 rounded-full bg-[#f0f4f8] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round((c.preventivi / CLIENTI_STUB[0].preventivi) * 100)}%`,
                    backgroundColor: i === 0 ? "#00a1be" : `rgba(0,161,190,${0.7 - i * 0.12})`,
                  }}
                />
              </div>
            </div>
            <Chip label={`${c.preventivi}`} variant={c.stato} />
          </div>
        ))}
      </div>

      <p className="mt-4 text-[10px] text-text-muted text-center">
        — Dati di esempio — verrà agganciato al DB —
      </p>
    </div>
  )
}

// ─── Monthly Bar Chart ────────────────────────────────────────────────────────

const MONTHS_STUB = [
  { m: "Nov", v: 38 },
  { m: "Dic", v: 29 },
  { m: "Gen", v: 45 },
  { m: "Feb", v: 52 },
  { m: "Mar", v: 41 },
  { m: "Apr", v: 58 },
]

function BarChartStub() {
  const max = Math.max(...MONTHS_STUB.map((d) => d.v))
  return (
    <div
      className="bg-white rounded-2xl p-5"
      style={{ boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4" style={{ color: "#00a1be" }} />
          <h3 className="text-sm font-semibold text-[#0f1720]">Preventivi mensili</h3>
        </div>
        <Chip label="6 mesi" variant="info" />
      </div>

      <div className="flex items-end gap-2 h-24">
        {MONTHS_STUB.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div
              className="w-full rounded-t-md transition-all duration-500"
              style={{
                height: `${Math.round((d.v / max) * 80)}px`,
                backgroundColor: i === MONTHS_STUB.length - 1 ? "#00a1be" : "rgba(0,161,190,0.25)",
              }}
            />
            <span className="text-[9px] font-medium text-text-muted">{d.m}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[10px] text-text-muted text-center">
        — Dati di esempio — verrà agganciato al DB —
      </p>
    </div>
  )
}

// ─── Recent Activity Timeline ─────────────────────────────────────────────────

interface ActivityItem {
  tipo: "nuovo" | "ordinato" | "rifiutato"
  codice: string
  cliente: string
  tempo: string
}

const TIMELINE_STUB: ActivityItem[] = [
  { tipo: "ordinato",  codice: "PRV-0441", cliente: "ALPHAMAC S.r.l.",    tempo: "2h fa"  },
  { tipo: "nuovo",     codice: "PRV-0442", cliente: "Tecno Sistemi Group", tempo: "4h fa"  },
  { tipo: "rifiutato", codice: "PRV-0438", cliente: "Edil Construct SpA",  tempo: "ieri"   },
  { tipo: "nuovo",     codice: "PRV-0440", cliente: "Officine Riunite",    tempo: "ieri"   },
]

const TIPO_CFG = {
  nuovo:     { label: "Nuovo",     dot: "#00a1be",  chip: "info"   as ChipVariant },
  ordinato:  { label: "Ordinato",  dot: "#95c11f",  chip: "ok"     as ChipVariant },
  rifiutato: { label: "Rifiutato", dot: "#e73331",  chip: "danger" as ChipVariant },
}

function Timeline() {
  return (
    <div
      className="bg-white rounded-2xl p-5"
      style={{ boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,161,190,.06)" }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4" style={{ color: "#00a1be" }} />
        <h3 className="text-sm font-semibold text-[#0f1720]">Attività recente</h3>
      </div>

      <div className="relative">
        {/* Vertical line */}
        <div
          className="absolute left-[7px] top-2 bottom-2 w-px"
          style={{ backgroundColor: "rgba(0,161,190,0.15)" }}
        />

        <div className="space-y-3.5">
          {TIMELINE_STUB.map((item, i) => {
            const cfg = TIPO_CFG[item.tipo]
            return (
              <div key={i} className="flex items-start gap-3 pl-0.5">
                {/* Dot */}
                <div
                  className="w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 ring-2 ring-white"
                  style={{ backgroundColor: cfg.dot }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-[#0f1720] font-mono">{item.codice}</span>
                    <Chip label={cfg.label} variant={cfg.chip} />
                  </div>
                  <p className="text-xs text-text-muted truncate mt-0.5">{item.cliente}</p>
                </div>
                <span className="text-[10px] text-text-muted shrink-0">{item.tempo}</span>
              </div>
            )
          })}
        </div>
      </div>

      <p className="mt-4 text-[10px] text-text-muted text-center">
        — Dati di esempio — verrà agganciato al DB —
      </p>
    </div>
  )
}

// ─── AI Quick Start card ──────────────────────────────────────────────────────

function AIQuickStart() {
  return (
    <div
      className="rounded-2xl p-5 relative overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #0f1720 0%, #18222e 100%)",
        boxShadow: "0 1px 0 rgba(15,23,32,.04), 0 8px 24px rgba(0,0,0,.18)",
      }}
    >
      {/* Grid pattern */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(0,161,190,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,161,190,0.06) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Glow */}
      <div
        className="absolute top-0 right-0 w-32 h-32 rounded-full pointer-events-none"
        style={{
          background: "radial-gradient(circle, rgba(0,161,190,0.15) 0%, transparent 70%)",
          transform: "translate(30%, -30%)",
        }}
      />

      <div className="relative flex items-start gap-4">
        <div className="shrink-0 mt-1">
          <Mascot stato="idle" size={52} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-3.5 h-3.5" style={{ color: "#00a1be" }} />
            <span className="text-xs font-semibold" style={{ color: "#00a1be" }}>
              AI Copilot
            </span>
            {/* Pulse dot */}
            <span className="relative flex h-2 w-2">
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: "#95c11f" }}
              />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: "#95c11f" }} />
            </span>
          </div>

          <p className="text-sm font-tenorite text-white leading-snug mb-3">
            Pronto ad aiutarti
          </p>
          <p className="text-xs leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.55)" }}>
            Usa il Copilot nell&apos;Archivio per trovare preventivi simili, cercare articoli e analizzare dati storici tramite linguaggio naturale.
          </p>

          <div className="flex gap-2 flex-wrap">
            <Link
              href="/preventivatore/archivio"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-all duration-150"
              style={{ backgroundColor: "rgba(0,161,190,0.25)", border: "1px solid rgba(0,161,190,0.35)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(0,161,190,0.38)"
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(0,161,190,0.25)"
              }}
            >
              Apri Archivio
            </Link>
            <Link
              href="/preventivatore/nuovo"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
              style={{
                color: "rgba(255,255,255,0.65)",
                border: "1px solid rgba(255,255,255,0.12)",
                backgroundColor: "transparent",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.07)"
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"
              }}
            >
              Nuovo preventivo
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export function DashboardView() {
  // Sparkline stub data (sostituire con dati reali)
  const sparkTotali  = [22, 28, 25, 34, 31, 38, 35, 42, 39, 48, 45, 58]
  const sparkValore  = [41, 55, 48, 62, 57, 71, 65, 79, 73, 88, 82, 104]
  const sparkTasso   = [51, 48, 53, 56, 49, 58, 62, 55, 61, 64, 68, 71]
  const sparkAttesa  = [8, 11, 9, 14, 12, 10, 13, 9, 11, 14, 12, 16]

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-tenorite font-bold text-[#0f1720]">Dashboard</h1>
          <p className="text-sm text-text-muted mt-0.5">Panoramica attività preventivatore</p>
        </div>
        <Chip label="Dati di esempio" variant="muted" />
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiCard
          label="Preventivi totali"
          value="348"
          sub="ultimi 12 mesi"
          trend={+12}
          sparkData={sparkTotali}
          sparkColor="#00a1be"
          chipLabel="Attivi"
          chipVariant="info"
          icon={FileText}
        />
        <KpiCard
          label="Valore totale"
          value="€ 1,04M"
          sub="preventivi emessi"
          trend={+8}
          sparkData={sparkValore}
          sparkColor="#95c11f"
          chipLabel="In crescita"
          chipVariant="ok"
          icon={TrendingUp}
        />
        <KpiCard
          label="Tasso ordinato"
          value="71%"
          sub="preventivi confermati"
          trend={+3}
          sparkData={sparkTasso}
          sparkColor="#00a1be"
          chipLabel="Buono"
          chipVariant="ok"
          icon={CheckCircle2}
        />
        <KpiCard
          label="In attesa"
          value="16"
          sub="richiesta risposta cliente"
          trend={-2}
          sparkData={sparkAttesa}
          sparkColor="#ee7326"
          chipLabel="Da seguire"
          chipVariant="warn"
          icon={Clock}
        />
      </div>

      {/* Middle row: Top Clienti + Bar chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopClienti />
        <BarChartStub />
      </div>

      {/* Bottom row: Timeline + AI Quick Start */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Timeline />
        <AIQuickStart />
      </div>

    </div>
  )
}
