"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Send, History, ChevronRight } from "lucide-react"
import { Mascot, type MascotStato } from "@/components/portali/preventivatore/mascot"
import { SessionsPanel, type Sessione } from "@/components/portali/preventivatore/chat-ai-sessions-panel"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatAIProps {
  contesto: "archivio" | "nuovo"
  placeholder?: string
}

interface ListaRisultato {
  codice: string
  cliente: string | null
  stato: string | null
  importo_preventivo: number | null
  importo_ordinato: number | null
  numero_offerta?: string | null
}

interface SemanticaRisultato {
  documento_id: string
  codice: string | null
  cliente: string | null
  stato: string | null
  similarity: number
  estratto: string
}

interface ArticoloRisultato {
  documento_id: string
  codice: string | null
  cliente: string | null
  estratto: string
}

interface AggRisultato {
  gruppo: string
  count: number
  sum_importo: number
  avg_importo: number
  tasso_ordinato: number
}

interface TopArticoloRisultato {
  codice: string
  n_preventivi: number
  esempio_descrizione: string
}

interface RigaDistintaRisultato {
  codice_articolo: string | null
  descrizione: string
  prezzo_unitario: number | null
  quantita: number | null
  totale_riga: number | null
  codice_preventivo: string | null
  cliente: string | null
  n_utilizzi: number
}

interface DettaglioRigaDistinta {
  sheet_name: string | null
  codice_articolo: string | null
  descrizione: string
  quantita: number | null
  prezzo_unitario: number | null
  ricarico_pct: number | null
  totale_riga: number | null
}

interface DettaglioRisultato {
  documento: {
    codice: string
    cliente: string | null
    stato: string | null
    categoria: string | null
    importo_preventivo: number | null
    importo_ordinato: number | null
    data_offerta: string | null
  }
  testo_completo: string
  righe_distinta: DettaglioRigaDistinta[]
  n_chunks: number
}

type ToolUsato = "list_preventivi" | "cerca_simili" | "cerca_articolo" | "aggrega_preventivi" | "top_articoli" | "query_righe_distinta" | "dettaglio_preventivo" | null

interface ChatMessage {
  role: "user" | "assistant"
  content: string
  tool?: ToolUsato
  risultati?: ListaRisultato[] | SemanticaRisultato[] | ArticoloRisultato[] | AggRisultato[] | TopArticoloRisultato[] | RigaDistintaRisultato[] | DettaglioRisultato | null
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function parseBold(text: string): React.ReactNode[] {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  return parts.map((p, i) =>
    i % 2 === 1 ? <strong key={i} className="font-semibold">{p}</strong> : p
  )
}

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n")
  const nodes: React.ReactNode[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const isBullet = /^[*\-]\s/.test(line)
    if (isBullet) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^[*\-]\s/.test(lines[i])) {
        items.push(<li key={i} className="ml-3 list-disc">{parseBold(lines[i].slice(2))}</li>)
        i++
      }
      nodes.push(<ul key={`ul${i}`} className="my-1 space-y-0.5">{items}</ul>)
    } else {
      if (line.trim() === "") nodes.push(<div key={i} className="h-1.5" />)
      else nodes.push(<p key={i}>{parseBold(line)}</p>)
      i++
    }
  }
  return <div className="space-y-0">{nodes}</div>
}

// ─── Dark card style ──────────────────────────────────────────────────────────

const DARK_CARD: React.CSSProperties = {
  backgroundColor: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.10)",
}

// ─── Badges stato ─────────────────────────────────────────────────────────────

const STATO_BADGE: Record<string, { label: string; bg: string; color: string }> = {
  pending:   { label: "In attesa", bg: "rgba(238,115,38,0.18)",  color: "#ee7326" },
  ordinato:  { label: "Ordinato",  bg: "rgba(149,193,31,0.18)",  color: "#95c11f" },
  rifiutato: { label: "Rifiutato", bg: "rgba(231,51,49,0.18)",   color: "#e73331" },
}

function StatoBadge({ stato }: { stato: string | null }) {
  if (!stato) return null
  const cfg = STATO_BADGE[stato] ?? { label: stato, bg: "rgba(100,116,139,0.18)", color: "rgba(255,255,255,0.60)" }
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtEur(n: number | null | undefined): string | null {
  if (n == null) return null
  return new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n)
}

// ─── Result cards ─────────────────────────────────────────────────────────────

function ListaCards({ risultati }: { risultati: ListaRisultato[] }) {
  if (!risultati.length) return null
  return (
    <div className="mt-2 space-y-1.5">
      {risultati.map((r, i) => {
        const importo = r.importo_ordinato ?? r.importo_preventivo
        return (
          <div key={`${r.codice}-${i}`} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs" style={DARK_CARD}>
            <span className="font-mono font-semibold shrink-0" style={{ color: "#00a1be" }}>{r.codice}</span>
            {r.cliente && <span className="truncate flex-1" style={{ color: "rgba(255,255,255,0.55)" }}>{r.cliente}</span>}
            <StatoBadge stato={r.stato} />
            {importo != null && <span className="font-medium shrink-0 text-white">{fmtEur(importo)}</span>}
          </div>
        )
      })}
    </div>
  )
}

function SemanticaCards({ risultati }: { risultati: SemanticaRisultato[] }) {
  if (!risultati.length) return null
  return (
    <div className="mt-2 space-y-1.5">
      {risultati.map((r, i) => (
        <div key={`${r.documento_id}-${i}`} className="rounded-lg px-2.5 py-2 text-xs space-y-1" style={DARK_CARD}>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold shrink-0" style={{ color: "#00a1be" }}>{r.codice ?? r.documento_id.slice(0, 8)}</span>
            {r.cliente && <span className="truncate flex-1" style={{ color: "rgba(255,255,255,0.55)" }}>{r.cliente}</span>}
            <StatoBadge stato={r.stato} />
            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "rgba(0,161,190,0.20)", color: "#00a1be" }}>
              {Math.round(r.similarity * 100)}%
            </span>
          </div>
          {r.estratto && <p className="leading-relaxed line-clamp-2" style={{ color: "rgba(255,255,255,0.45)" }}>{r.estratto}</p>}
        </div>
      ))}
    </div>
  )
}

function ArticoloCards({ risultati }: { risultati: ArticoloRisultato[] }) {
  if (!risultati.length) return null
  return (
    <div className="mt-2 space-y-1.5">
      {risultati.map((r, i) => (
        <div key={`${r.documento_id}-${i}`} className="rounded-lg px-2.5 py-2 text-xs space-y-1" style={DARK_CARD}>
          <div className="flex items-center gap-2">
            <span className="font-mono font-semibold shrink-0" style={{ color: "#00a1be" }}>{r.codice ?? r.documento_id.slice(0, 8)}</span>
            {r.cliente && <span className="truncate flex-1" style={{ color: "rgba(255,255,255,0.55)" }}>{r.cliente}</span>}
          </div>
          {r.estratto && <p className="leading-relaxed font-mono text-[10px] whitespace-pre-wrap line-clamp-3" style={{ color: "rgba(255,255,255,0.45)" }}>{r.estratto}</p>}
        </div>
      ))}
    </div>
  )
}

function AggregaCards({ risultati }: { risultati: AggRisultato[] }) {
  if (!risultati.length) return null
  const maxCount = Math.max(...risultati.map(r => r.count), 1)
  return (
    <div className="mt-2 space-y-1.5">
      {risultati.map((r, i) => (
        <div key={i} className="rounded-lg px-2.5 py-2 text-xs space-y-1.5" style={DARK_CARD}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-white truncate">{r.gruppo}</span>
            <div className="flex items-center gap-2 shrink-0">
              <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "rgba(0,161,190,0.20)", color: "#00a1be" }}>
                {r.count} prev.
              </span>
              {r.tasso_ordinato > 0 && (
                <span className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "rgba(149,193,31,0.18)", color: "#95c11f" }}>
                  {r.tasso_ordinato}% ord.
                </span>
              )}
            </div>
          </div>
          {/* Progress bar */}
          <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${Math.round((r.count / maxCount) * 100)}%`, backgroundColor: "#00a1be" }}
            />
          </div>
          {r.sum_importo > 0 && (
            <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              Totale: {fmtEur(r.sum_importo)} · Media: {fmtEur(r.avg_importo)}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function RigheDistintaCards({ risultati }: { risultati: RigaDistintaRisultato[] }) {
  if (!risultati.length) return null
  return (
    <div className="mt-2 space-y-1.5">
      {risultati.map((r, i) => (
        <div key={i} className="rounded-lg px-2.5 py-2 text-xs space-y-1" style={DARK_CARD}>
          <div className="flex items-center gap-2 flex-wrap">
            {r.codice_articolo && (
              <span className="font-mono font-semibold shrink-0" style={{ color: "#00a1be" }}>
                {r.codice_articolo}
              </span>
            )}
            {r.prezzo_unitario != null && (
              <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: "rgba(149,193,31,0.20)", color: "#95c11f" }}>
                {fmtEur(r.prezzo_unitario)} / cad.
              </span>
            )}
            {r.n_utilizzi > 1 && (
              <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: "rgba(0,161,190,0.18)", color: "#00a1be" }}>
                {r.n_utilizzi} prev.
              </span>
            )}
          </div>
          <p className="truncate" style={{ color: "rgba(255,255,255,0.75)" }}>{r.descrizione}</p>
          <div className="flex items-center gap-3 flex-wrap" style={{ color: "rgba(255,255,255,0.40)" }}>
            {r.quantita != null && <span>Qt. {r.quantita}</span>}
            {r.totale_riga != null && <span>Tot. riga: {fmtEur(r.totale_riga)}</span>}
            {r.codice_preventivo && (
              <span className="font-mono" style={{ color: "rgba(0,161,190,0.70)" }}>{r.codice_preventivo}</span>
            )}
            {r.cliente && <span className="truncate">{r.cliente}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function TopArticoliCards({ risultati }: { risultati: TopArticoloRisultato[] }) {
  if (!risultati.length) return null
  const maxN = risultati[0].n_preventivi // già ordinati desc
  return (
    <div className="mt-2 space-y-1.5">
      {risultati.map((r, i) => (
        <div key={i} className="rounded-lg px-2.5 py-2 text-xs space-y-1.5" style={DARK_CARD}>
          <div className="flex items-center gap-2">
            {/* rank */}
            <span className="text-[10px] font-bold w-4 text-center shrink-0" style={{ color: "rgba(255,255,255,0.30)" }}>
              {i + 1}
            </span>
            <span className="font-mono font-semibold" style={{ color: "#00a1be" }}>{r.codice}</span>
            <span
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ml-auto"
              style={{ backgroundColor: "rgba(0,161,190,0.20)", color: "#00a1be" }}
            >
              {r.n_preventivi} prev.
            </span>
          </div>
          {/* progress bar */}
          <div className="h-1 rounded-full overflow-hidden ml-6" style={{ backgroundColor: "rgba(255,255,255,0.08)" }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.round((r.n_preventivi / maxN) * 100)}%`,
                backgroundColor: i === 0 ? "#00a1be" : `rgba(0,161,190,${0.75 - i * 0.06})`,
              }}
            />
          </div>
          {r.esempio_descrizione && (
            <p className="text-[10px] ml-6 truncate" style={{ color: "rgba(255,255,255,0.40)" }}>
              {r.esempio_descrizione}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Chunk text parser ────────────────────────────────────────────────────────
// Parses the structured text format produced by ingest-scale.mjs into tables.
// This lets the user verify the source numbers directly, bypassing AI interpretation.

interface ParsedRiga {
  descrizione: string
  codice: string | null
  qta: number | null
  costo: number | null
  totale: number | null
}

interface ParsedManodopera {
  voce: string
  ore: number
  costoH: number
  totale: number
}

interface ParsedSheet {
  titolo: string
  qt: number | null
  tecnici: string
  righe: ParsedRiga[]
  totMat: number | null
  ricaricMatPct: number | null
  ricaricMatVal: number | null
  manodopera: ParsedManodopera[]
  totMan: number | null
  ricaricManPct: number | null
  ricaricManVal: number | null
  prezzoFinale: number | null
  margine: number | null
}

function parseSheetChunk(text: string): ParsedSheet | null {
  if (!text.includes("DISTINTA MATERIALI:")) return null
  const lines = text.split("\n")

  const titleLine = lines[0] ?? ""
  const qtMatch = titleLine.match(/\|\s*qt[.:]?\s*(\d+)/i)
  const titolo = titleLine.split("|")[0].trim()
  const qt = qtMatch ? parseInt(qtMatch[1]) : null
  const tecnici = lines.find(l => /LARGHEZZA|LUNGHEZZA|N°\s*(PALI|GRADINI)|ALTEZZA/i.test(l))?.trim() ?? ""

  const righe: ParsedRiga[] = []
  const manodopera: ParsedManodopera[] = []
  let totMat: number | null = null
  let ricaricMatPct: number | null = null
  let ricaricMatVal: number | null = null
  let totMan: number | null = null
  let ricaricManPct: number | null = null
  let ricaricManVal: number | null = null
  let prezzoFinale: number | null = null
  let margine: number | null = null

  type Phase = "none" | "distinta" | "manodopera"
  let phase: Phase = "none"
  let lastSection: "mat" | "man" | null = null

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (line === "DISTINTA MATERIALI:") { phase = "distinta"; continue }
    if (line === "MANODOPERA:") { phase = "manodopera"; continue }
    if (line.startsWith("ALTRI COSTI:") || line.startsWith("TOTALE COSTI:") || line.startsWith("TOTALE:")) { phase = "none" }

    if (phase === "distinta" && line.startsWith("-")) {
      // "- DESCRIZIONE (CODICE), q.tà N, costo €X, totale €Y"
      const m = line.match(/^-\s+(.+?)\s*\(([^)]+)\)(?:,\s*q\.tà\s*([\d.]+))?,\s*costo\s*€([\d.]+),\s*totale\s*€([\d.]+)/)
      if (m) {
        righe.push({ descrizione: m[1].trim(), codice: m[2].trim(), qta: m[3] != null ? parseFloat(m[3]) : null, costo: parseFloat(m[4]), totale: parseFloat(m[5]) })
      } else {
        const m2 = line.match(/^-\s+(.+?)(?:,\s*q\.tà\s*([\d.]+))?,\s*costo\s*€([\d.]+),\s*totale\s*€([\d.]+)/)
        if (m2) righe.push({ descrizione: m2[1].trim(), codice: null, qta: m2[2] ? parseFloat(m2[2]) : null, costo: parseFloat(m2[3]), totale: parseFloat(m2[4]) })
      }
    }

    if (phase === "manodopera" && line.startsWith("-")) {
      // "- PROGETTAZIONE: 3h × €33.61/h = €50.41"
      const m = line.match(/^-\s+(.+?):\s*([\d.]+)h\s*[×x*]\s*€([\d.]+)\/h\s*=\s*€([\d.]+)/)
      if (m) manodopera.push({ voce: m[1].trim(), ore: parseFloat(m[2]), costoH: parseFloat(m[3]), totale: parseFloat(m[4]) })
    }

    const totMatM = line.match(/^TOTALE MATERIALE:\s*€([\d.]+)/)
    if (totMatM) { totMat = parseFloat(totMatM[1]); lastSection = "mat" }

    const totManM = line.match(/^TOTALE MANODOPERA:\s*€([\d.]+)/)
    if (totManM) { totMan = parseFloat(totManM[1]); lastSection = "man" }

    const ricaricM = line.match(/ricarico\s*([\d.]+)%\s*→\s*€([\d.]+)/)
    if (ricaricM) {
      if (lastSection === "mat") { ricaricMatPct = parseFloat(ricaricM[1]); ricaricMatVal = parseFloat(ricaricM[2]); lastSection = null }
      else if (lastSection === "man") { ricaricManPct = parseFloat(ricaricM[1]); ricaricManVal = parseFloat(ricaricM[2]); lastSection = null }
    }

    const pfM = line.match(/^PREZZO FINALE:\s*€([\d.,]+)/)
    if (pfM) prezzoFinale = parseFloat(pfM[1].replace(/,/g, ""))

    const margM = line.match(/^MARGINE TRATTATIVA:\s*([\d.]+)%/)
    if (margM) margine = parseFloat(margM[1])
  }

  return { titolo, qt, tecnici, righe, totMat, ricaricMatPct, ricaricMatVal, manodopera, totMan, ricaricManPct, ricaricManVal, prezzoFinale, margine }
}

function fmtQta(n: number): string {
  // Show decimals only if meaningful
  return n % 1 === 0 ? String(n) : n.toFixed(3).replace(/\.?0+$/, "")
}

function SheetTable({ sheet }: { sheet: ParsedSheet }) {
  const [collapsed, setCollapsed] = useState(false)
  const activeRighe = sheet.righe.filter(r => (r.totale ?? 0) > 0)
  const zeroRighe = sheet.righe.filter(r => (r.totale ?? 0) === 0)

  return (
    <div className="rounded-lg overflow-hidden text-xs" style={{ border: "1px solid rgba(255,255,255,0.09)" }}>
      {/* Sheet header */}
      <button
        onClick={() => setCollapsed(v => !v)}
        className="w-full flex items-center justify-between px-2.5 py-2 gap-2 text-left"
        style={{ backgroundColor: "rgba(0,161,190,0.12)", borderBottom: collapsed ? "none" : "1px solid rgba(0,161,190,0.15)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <ChevronRight className={`w-3 h-3 shrink-0 transition-transform`} style={{ color: "#00a1be", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)" }} />
          <span className="font-semibold text-[11px] truncate" style={{ color: "#00a1be" }}>{sheet.titolo}</span>
          {sheet.qt != null && (
            <span className="shrink-0 text-[10px] rounded-full px-1.5 py-0.5 font-medium" style={{ backgroundColor: "rgba(0,161,190,0.18)", color: "#00a1be" }}>
              ×{sheet.qt}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {sheet.prezzoFinale != null && (
            <span className="font-bold text-[11px]" style={{ color: "#95c11f" }}>{fmtEur(sheet.prezzoFinale)}</span>
          )}
        </div>
      </button>

      {!collapsed && (
        <div>
          {/* Tecnici */}
          {sheet.tecnici && (
            <p className="px-2.5 py-1.5 text-[10px]" style={{ color: "rgba(255,255,255,0.35)", backgroundColor: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
              {sheet.tecnici}
            </p>
          )}

          {/* Distinta materiali */}
          {activeRighe.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.30)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                Distinta materiali
              </div>
              {activeRighe.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  {r.codice && (
                    <span className="font-mono text-[10px] shrink-0 w-[88px] truncate" style={{ color: "#00a1be" }} title={r.codice}>
                      {r.codice}
                    </span>
                  )}
                  <span className="flex-1 truncate" style={{ color: "rgba(255,255,255,0.75)" }} title={r.descrizione}>{r.descrizione}</span>
                  {r.qta != null && (
                    <span className="shrink-0 font-mono text-[10px] text-right w-8" style={{ color: "rgba(255,255,255,0.45)" }}>
                      {fmtQta(r.qta)}
                    </span>
                  )}
                  {r.costo != null && (
                    <span className="shrink-0 text-[10px] text-right w-14" style={{ color: "rgba(255,255,255,0.35)" }}>
                      {fmtEur(r.costo)}
                    </span>
                  )}
                  {r.totale != null && (
                    <span className="shrink-0 font-semibold text-right w-14" style={{ color: "#95c11f" }}>
                      {fmtEur(r.totale)}
                    </span>
                  )}
                </div>
              ))}
              {zeroRighe.length > 0 && (
                <p className="px-2.5 py-1 text-[10px]" style={{ color: "rgba(255,255,255,0.20)" }}>
                  + {zeroRighe.length} voci con q.tà 0
                </p>
              )}
              {(sheet.totMat != null || sheet.ricaricMatVal != null) && (
                <div className="flex items-center justify-between px-2.5 py-1.5 gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.03)" }}>
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>
                    Totale mat. {sheet.ricaricMatPct != null ? `+${sheet.ricaricMatPct}%` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    {sheet.totMat != null && <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>{fmtEur(sheet.totMat)}</span>}
                    {sheet.ricaricMatVal != null && <span className="font-bold text-[11px]" style={{ color: "#95c11f" }}>→ {fmtEur(sheet.ricaricMatVal)}</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Manodopera */}
          {sheet.manodopera.length > 0 && (
            <div>
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.30)", borderBottom: "1px solid rgba(255,255,255,0.05)", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                Manodopera
              </div>
              {sheet.manodopera.map((m, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <span className="flex-1" style={{ color: "rgba(255,255,255,0.70)" }}>{m.voce}</span>
                  <span className="shrink-0 text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>{m.ore}h × {fmtEur(m.costoH)}/h</span>
                  <span className="shrink-0 font-semibold w-14 text-right" style={{ color: "#95c11f" }}>{fmtEur(m.totale)}</span>
                </div>
              ))}
              {(sheet.totMan != null || sheet.ricaricManVal != null) && (
                <div className="flex items-center justify-between px-2.5 py-1.5 gap-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.03)" }}>
                  <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>
                    Totale man. {sheet.ricaricManPct != null ? `+${sheet.ricaricManPct}%` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    {sheet.totMan != null && <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.40)" }}>{fmtEur(sheet.totMan)}</span>}
                    {sheet.ricaricManVal != null && <span className="font-bold text-[11px]" style={{ color: "#95c11f" }}>→ {fmtEur(sheet.ricaricManVal)}</span>}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Prezzo finale */}
          {sheet.prezzoFinale != null && (
            <div className="flex items-center justify-between px-2.5 py-2" style={{ borderTop: "1px solid rgba(255,255,255,0.08)", backgroundColor: "rgba(149,193,31,0.06)" }}>
              <span className="text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.60)" }}>
                Prezzo finale {sheet.margine != null ? `(margine ${sheet.margine}%)` : ""}
              </span>
              <span className="font-bold text-sm" style={{ color: "#95c11f" }}>{fmtEur(sheet.prezzoFinale)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DettaglioCard({ risultato }: { risultato: DettaglioRisultato }) {
  const doc = risultato.documento
  const hasRigheStrutturate = risultato.righe_distinta.length > 0

  // Parse text chunks into structured sheets
  const rawChunks = risultato.testo_completo.split("\n\n---\n\n")
  const parsedSheets = rawChunks.map(parseSheetChunk).filter((s): s is ParsedSheet => s !== null)
  const textChunks = rawChunks.filter(c => !c.includes("DISTINTA MATERIALI:"))

  // Raggruppa righe strutturate per sheet (post re-ingestion)
  const bySheet: Record<string, DettaglioRigaDistinta[]> = {}
  if (hasRigheStrutturate) {
    for (const r of risultato.righe_distinta) {
      const key = r.sheet_name ?? "Distinta"
      if (!bySheet[key]) bySheet[key] = []
      bySheet[key].push(r)
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {/* Header documento */}
      <div className="rounded-lg px-3 py-2.5 text-xs space-y-1.5" style={DARK_CARD}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono font-bold text-sm" style={{ color: "#00a1be" }}>{doc.codice}</span>
          <StatoBadge stato={doc.stato} />
          {doc.categoria && (
            <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.55)" }}>
              {doc.categoria}
            </span>
          )}
        </div>
        {doc.cliente && <p style={{ color: "rgba(255,255,255,0.70)" }}>{doc.cliente}</p>}
        <div className="flex items-center gap-3 flex-wrap" style={{ color: "rgba(255,255,255,0.40)" }}>
          {doc.data_offerta && <span>{new Date(doc.data_offerta).toLocaleDateString("it-IT")}</span>}
          {doc.importo_preventivo != null && (
            <span>Preventivo: <span className="font-semibold" style={{ color: "#95c11f" }}>{fmtEur(doc.importo_preventivo)}</span></span>
          )}
          {doc.importo_ordinato != null && (
            <span>Ordinato: <span className="font-semibold" style={{ color: "#00a1be" }}>{fmtEur(doc.importo_ordinato)}</span></span>
          )}
        </div>
      </div>

      {/* Tabella righe strutturate (post re-ingestion) */}
      {hasRigheStrutturate && Object.entries(bySheet).map(([sheet, righe]) => {
        const totSheet = righe.reduce((s, r) => s + (r.totale_riga ?? 0), 0)
        return (
          <div key={sheet} className="rounded-lg overflow-hidden text-xs" style={{ border: "1px solid rgba(255,255,255,0.09)" }}>
            <div className="px-2.5 py-1.5 flex items-center justify-between" style={{ backgroundColor: "rgba(0,161,190,0.12)", borderBottom: "1px solid rgba(0,161,190,0.15)" }}>
              <span className="font-semibold text-[11px]" style={{ color: "#00a1be" }}>{sheet}</span>
              {totSheet > 0 && <span className="font-bold" style={{ color: "#95c11f" }}>{fmtEur(totSheet)}</span>}
            </div>
            <div className="divide-y divide-white/5">
              {righe.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-2.5 py-1.5">
                  {r.codice_articolo && <span className="font-mono text-[10px] shrink-0 w-[88px] truncate" style={{ color: "#00a1be" }}>{r.codice_articolo}</span>}
                  <span className="flex-1 truncate" style={{ color: "rgba(255,255,255,0.75)" }}>{r.descrizione}</span>
                  {r.quantita != null && <span className="shrink-0 font-mono text-[10px] w-8 text-right" style={{ color: "rgba(255,255,255,0.45)" }}>{fmtQta(r.quantita)}</span>}
                  {r.prezzo_unitario != null && <span className="shrink-0 text-[10px] w-14 text-right" style={{ color: "rgba(255,255,255,0.35)" }}>{fmtEur(r.prezzo_unitario)}</span>}
                  {r.totale_riga != null && <span className="shrink-0 font-semibold w-14 text-right" style={{ color: "#95c11f" }}>{fmtEur(r.totale_riga)}</span>}
                </div>
              ))}
            </div>
          </div>
        )
      })}

      {/* Sheet tables parsed from chunk text */}
      {!hasRigheStrutturate && parsedSheets.map((sheet, i) => (
        <SheetTable key={i} sheet={sheet} />
      ))}

      {/* Testo non-BOM (copertina offerta, descrizione) */}
      {textChunks.length > 0 && (
        <TextToggle chunks={textChunks} />
      )}
    </div>
  )
}

function TextToggle({ chunks }: { chunks: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-[10px] font-medium px-2 py-1 rounded-md"
        style={{ color: "rgba(255,255,255,0.30)" }}
        onMouseEnter={e => (e.currentTarget.style.color = "rgba(0,161,190,0.70)")}
        onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.30)")}
      >
        <ChevronRight className={`w-3 h-3 transition-transform`} style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }} />
        {open ? "Nascondi testo offerta" : `Testo offerta (${chunks.length} sezioni)`}
      </button>
      {open && (
        <div className="mt-1 space-y-1.5">
          {chunks.map((c, i) => (
            <div key={i} className="rounded-lg px-2.5 py-2 text-[10px] whitespace-pre-wrap leading-relaxed" style={{ ...DARK_CARD, color: "rgba(255,255,255,0.40)" }}>
              {c.slice(0, 600)}{c.length > 600 ? "…" : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ThreeDots() {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full animate-bounce"
          style={{ backgroundColor: "rgba(0,161,190,0.70)", animationDelay: `${i * 150}ms` }}
        />
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ChatAI({ contesto, placeholder }: ChatAIProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [mascotStato, setMascotStato] = useState<MascotStato>("idle")
  const [modalita, setModalita] = useState<"preciso" | "creativo">("preciso")

  // Session state
  const [sessioneId, setSessioneId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [sessioni, setSessioni] = useState<Sessione[]>([])
  const [loadingSessioni, setLoadingSessioni] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  // ─── Carica lista sessioni ──────────────────────────────────────────────────

  const fetchSessioni = useCallback(async () => {
    setLoadingSessioni(true)
    try {
      const res = await fetch("/api/portali/preventivatore/sessioni")
      if (res.ok) {
        const data = await res.json() as { sessioni: Sessione[] }
        setSessioni(data.sessioni ?? [])
      }
    } catch {
      // silenzioso
    } finally {
      setLoadingSessioni(false)
    }
  }, [])

  const handleOpenHistory = useCallback(() => {
    setShowHistory(true)
    void fetchSessioni()
  }, [fetchSessioni])

  // ─── Carica sessione ────────────────────────────────────────────────────────

  const handleLoadSession = useCallback(async (s: Sessione) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/portali/preventivatore/sessioni/${s.id}`)
      if (!res.ok) return
      const data = await res.json() as {
        messaggi: Array<{
          ruolo: string
          contenuto: string
          tool_usato: ToolUsato
          risultati: unknown
        }>
      }
      const loaded: ChatMessage[] = (data.messaggi ?? []).map(m => ({
        role: m.ruolo as "user" | "assistant",
        content: m.contenuto,
        tool: m.tool_usato,
        risultati: m.risultati as ChatMessage["risultati"],
      }))
      setMessages(loaded)
      setSessioneId(s.id)
      setShowHistory(false)
    } catch {
      // silenzioso
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [])

  // ─── Elimina sessione ───────────────────────────────────────────────────────

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      await fetch(`/api/portali/preventivatore/sessioni/${id}`, { method: "DELETE" })
      setSessioni(prev => prev.filter(s => s.id !== id))
      if (sessioneId === id) {
        setSessioneId(null)
        setMessages([])
      }
    } catch {
      // silenzioso
    }
  }, [sessioneId])

  // ─── Nuova chat ─────────────────────────────────────────────────────────────

  const handleNewChat = useCallback(() => {
    setMessages([])
    setSessioneId(null)
    setShowHistory(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  // ─── Crea sessione al primo messaggio ───────────────────────────────────────

  const ensureSession = useCallback(async (firstMessage: string): Promise<string | null> => {
    if (sessioneId) return sessioneId
    try {
      const res = await fetch("/api/portali/preventivatore/sessioni", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contesto,
          titolo: firstMessage.slice(0, 100),
        }),
      })
      if (!res.ok) return null
      const data = await res.json() as { sessione: Sessione }
      const id = data.sessione.id
      setSessioneId(id)
      // Aggiunge in cima alla lista locale
      setSessioni(prev => [data.sessione, ...prev])
      return id
    } catch {
      return null
    }
  }, [sessioneId, contesto])

  // ─── Invia messaggio ────────────────────────────────────────────────────────

  const invia = useCallback(async () => {
    const testo = input.trim()
    if (!testo || loading) return

    const userMsg: ChatMessage = { role: "user", content: testo }
    const nextMessages = [...messages, userMsg]
    setMessages(nextMessages)
    setInput("")
    setLoading(true)
    setMascotStato("loading")

    // Crea sessione al primo messaggio (se non esiste)
    const isFirstMessage = messages.length === 0
    let activeSessId = sessioneId
    if (isFirstMessage) {
      activeSessId = await ensureSession(testo)
    }

    try {
      const res = await fetch("/api/portali/preventivatore/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          contesto,
          modalita,
          sessione_id: activeSessId,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error((data as { error?: string }).error ?? "Errore risposta AI")
      }

      const data = (await res.json()) as {
        risposta: string
        tool_usato: ToolUsato
        risultati: ListaRisultato[] | SemanticaRisultato[] | AggRisultato[] | TopArticoloRisultato[] | RigaDistintaRisultato[] | DettaglioRisultato | null
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.risposta,
        tool: data.tool_usato,
        risultati: data.risultati,
      }

      setMessages((prev) => [...prev, assistantMsg])
      setMascotStato("success")
    } catch (err) {
      const errMsg: ChatMessage = {
        role: "assistant",
        content: `Errore: ${err instanceof Error ? err.message : "Sconosciuto"}`,
      }
      setMessages((prev) => [...prev, errMsg])
      setMascotStato("idle")
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, messages, contesto, modalita, sessioneId, ensureSession])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); invia() }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  const darkBorder = "1px solid rgba(255,255,255,0.09)"
  const darkBg = { background: "linear-gradient(180deg, #0f1720 0%, #18222e 100%)" }

  return (
    <div className="w-80 shrink-0 sticky top-6 self-start relative">

      {/* Mascot */}
      <div className="absolute -top-5 -left-4 z-20 pointer-events-none">
        <Mascot stato={mascotStato} size={50} successDuration={1800} />
      </div>

      <div
        className="rounded-2xl overflow-hidden flex flex-col relative"
        style={{ ...darkBg, height: "600px", boxShadow: "0 2px 0 rgba(0,0,0,.24), 0 16px 40px rgba(0,0,0,.28)" }}
      >
        {/* Grid overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,161,190,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,161,190,0.05) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />

        {/* Sessions panel overlay */}
        {showHistory && (
          <SessionsPanel
            sessioni={sessioni}
            currentId={sessioneId}
            onLoad={handleLoadSession}
            onDelete={handleDeleteSession}
            onNew={handleNewChat}
            onClose={() => setShowHistory(false)}
            loading={loadingSessioni}
          />
        )}

        {/* Header */}
        <div
          className="relative px-4 py-3 flex items-center justify-between shrink-0"
          style={{ borderBottom: darkBorder }}
        >
          <div className="flex items-center gap-2 pl-10">
            <span className="text-sm font-semibold text-white font-tenorite">AI Copilot</span>
            {sessioneId && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(0,161,190,0.20)", color: "#00a1be" }}>
                salvata
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* History button */}
            <button
              onClick={handleOpenHistory}
              className="p-1 rounded-lg transition-colors"
              style={{ color: "rgba(255,255,255,0.45)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#00a1be")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.45)")}
              title="Storico conversazioni"
            >
              <History className="w-3.5 h-3.5" />
            </button>
            {/* Pulse dot */}
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: "#95c11f" }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: "#95c11f" }} />
              </span>
              <span className="text-[10px] font-medium" style={{ color: "rgba(255,255,255,0.40)" }}>live</span>
            </div>
          </div>
        </div>

        {/* Modalita toggle */}
        <div className="relative flex shrink-0" style={{ borderBottom: darkBorder }}>
          {(["preciso", "creativo"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setModalita(m)}
              className="flex-1 px-3 py-1.5 text-xs font-medium transition-all duration-150 capitalize"
              style={{
                color: modalita === m ? "#ffffff" : "rgba(255,255,255,0.40)",
                backgroundColor: modalita === m ? "rgba(0,161,190,0.20)" : "transparent",
                borderBottom: modalita === m ? "2px solid #00a1be" : "2px solid transparent",
              }}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div className="relative flex-1 overflow-y-auto p-3 space-y-3" style={{ scrollbarWidth: "none" }}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center py-8 px-4 gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: "rgba(0,161,190,0.15)", border: "1px solid rgba(0,161,190,0.25)" }}
              >
                <Send className="w-4 h-4" style={{ color: "#00a1be" }} />
              </div>
              <p className="text-xs leading-relaxed text-center" style={{ color: "rgba(255,255,255,0.45)" }}>
                {contesto === "archivio"
                  ? "Chiedi sui preventivi: 'Quanti preventivi per cliente?', 'Trova scale simili con ballatoio', 'Chi usa l\'articolo 4505000?'..."
                  : "Cerca ispirazione: 'Scale con profilato 170×40', 'Trova configurazioni con balaustra alluminio'..."}
              </p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className="max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed"
                style={
                  msg.role === "user"
                    ? { backgroundColor: "rgba(0,161,190,0.22)", border: "1px solid rgba(0,161,190,0.35)", color: "#ffffff" }
                    : { backgroundColor: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.85)" }
                }
              >
                <SimpleMarkdown text={msg.content} />
                {msg.role === "assistant" && msg.tool === "list_preventivi" && msg.risultati && (
                  <ListaCards risultati={msg.risultati as ListaRisultato[]} />
                )}
                {msg.role === "assistant" && msg.tool === "cerca_simili" && msg.risultati && (
                  <SemanticaCards risultati={msg.risultati as SemanticaRisultato[]} />
                )}
                {msg.role === "assistant" && msg.tool === "cerca_articolo" && msg.risultati && (
                  <ArticoloCards risultati={msg.risultati as ArticoloRisultato[]} />
                )}
                {msg.role === "assistant" && msg.tool === "aggrega_preventivi" && msg.risultati && (
                  <AggregaCards risultati={msg.risultati as AggRisultato[]} />
                )}
                {msg.role === "assistant" && msg.tool === "top_articoli" && msg.risultati && (
                  <TopArticoliCards risultati={msg.risultati as TopArticoloRisultato[]} />
                )}
                {msg.role === "assistant" && msg.tool === "query_righe_distinta" && msg.risultati && (
                  <RigheDistintaCards risultati={msg.risultati as RigaDistintaRisultato[]} />
                )}
                {msg.role === "assistant" && msg.tool === "dettaglio_preventivo" && msg.risultati && (
                  <DettaglioCard risultato={msg.risultati as DettaglioRisultato} />
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start items-end gap-2 pl-1">
              <div className="rounded-xl px-3 py-2 mb-1" style={{ backgroundColor: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.10)" }}>
                <ThreeDots />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="relative p-3 flex gap-2 shrink-0" style={{ borderTop: darkBorder }}>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "Chiedi ai preventivi..."}
            disabled={loading}
            className="flex-1 text-xs h-8 rounded-lg px-3 outline-none transition-all duration-150"
            style={{
              backgroundColor: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#ffffff",
              caretColor: "#00a1be",
            }}
            onFocus={e => { e.currentTarget.style.borderColor = "rgba(0,161,190,0.55)"; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.11)" }}
            onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.08)" }}
          />
          <button
            onClick={invia}
            disabled={loading || !input.trim()}
            className="h-8 w-8 p-0 shrink-0 rounded-lg flex items-center justify-center transition-all duration-150 disabled:opacity-40"
            style={{ backgroundColor: "#00a1be", color: "#ffffff" }}
            aria-label="Invia"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
