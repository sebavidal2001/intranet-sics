"use client"

import { History, Plus, Trash2, X, ChevronRight } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Sessione {
  id: string
  contesto: string
  titolo: string
  created_at: string
  updated_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  if (isToday) return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short" })
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

// ─── SessionsPanel ────────────────────────────────────────────────────────────

export function SessionsPanel({
  sessioni,
  currentId,
  onLoad,
  onDelete,
  onNew,
  onClose,
  loading,
}: {
  sessioni: Sessione[]
  currentId: string | null
  onLoad: (s: Sessione) => void
  onDelete: (id: string) => void
  onNew: () => void
  onClose: () => void
  loading: boolean
}) {
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col rounded-2xl overflow-hidden"
      style={{ background: "linear-gradient(180deg, #0f1720 0%, #18222e 100%)" }}
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

      {/* Header */}
      <div className="relative flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.09)" }}>
        <div className="flex items-center gap-2">
          <History className="w-3.5 h-3.5" style={{ color: "#00a1be" }} />
          <span className="text-sm font-semibold text-white font-tenorite">Storico chat</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg transition-colors" style={{ color: "rgba(255,255,255,0.50)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
          onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.50)")}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* New chat button */}
      <div className="relative px-3 py-2 shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-150"
          style={{ backgroundColor: "rgba(0,161,190,0.18)", border: "1px solid rgba(0,161,190,0.28)", color: "#ffffff" }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "rgba(0,161,190,0.28)")}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "rgba(0,161,190,0.18)")}
        >
          <Plus className="w-3.5 h-3.5" style={{ color: "#00a1be" }} />
          Nuova conversazione
        </button>
      </div>

      {/* List */}
      <div className="relative flex-1 overflow-y-auto py-2" style={{ scrollbarWidth: "none" }}>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <ThreeDots />
          </div>
        )}

        {!loading && sessioni.length === 0 && (
          <p className="text-center text-xs py-8" style={{ color: "rgba(255,255,255,0.35)" }}>
            Nessuna conversazione salvata
          </p>
        )}

        {!loading && sessioni.map((s) => {
          const isActive = s.id === currentId
          return (
            <div
              key={s.id}
              className="group flex items-center gap-2 mx-2 px-3 py-2 rounded-lg mb-0.5 cursor-pointer transition-all duration-150"
              style={{
                backgroundColor: isActive ? "rgba(0,161,190,0.18)" : "transparent",
                border: isActive ? "1px solid rgba(0,161,190,0.28)" : "1px solid transparent",
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.06)" }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = "transparent" }}
              onClick={() => onLoad(s)}
            >
              <ChevronRight className="w-3 h-3 shrink-0" style={{ color: isActive ? "#00a1be" : "rgba(255,255,255,0.30)" }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate" style={{ color: isActive ? "#ffffff" : "rgba(255,255,255,0.70)" }}>
                  {s.titolo}
                </p>
                <p className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {fmtDate(s.updated_at)} · {s.contesto}
                </p>
              </div>
              <button
                onClick={e => { e.stopPropagation(); onDelete(s.id) }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded transition-all duration-150"
                style={{ color: "rgba(231,51,49,0.70)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#e73331")}
                onMouseLeave={e => (e.currentTarget.style.color = "rgba(231,51,49,0.70)")}
                title="Elimina"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
