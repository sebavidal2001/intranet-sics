"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Play, Pause, RotateCcw, Timer as TimerIcon } from "lucide-react"

/**
 * Cronometro di preventivazione: misura il tempo impiegato a costruire un
 * preventivo. Si può avviare, mettere in pausa e riprendere quante volte si vuole.
 *
 * Persistenza: lo stato (ms accumulati + se è in corsa + timestamp di avvio) è
 * salvato in `localStorage` sotto `storageKey`, così sopravvive a reload/navigazione.
 * Quando il preventivo viene salvato, il chiamante può azzerarlo con
 * `clearPreventivoTimer(storageKey)`.
 */

interface PersistedTimer {
  /** Millisecondi accumulati nelle sessioni già concluse (pause precedenti). */
  accumulatedMs: number
  /** Se true, il cronometro sta correndo da `startedAt`. */
  running: boolean
  /** Epoch ms dell'ultimo avvio/ripresa (valido solo se running). */
  startedAt: number | null
}

const EMPTY: PersistedTimer = { accumulatedMs: 0, running: false, startedAt: null }

function read(storageKey: string): PersistedTimer {
  if (typeof window === "undefined") return EMPTY
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<PersistedTimer>
    return {
      accumulatedMs: Math.max(0, Number(parsed.accumulatedMs) || 0),
      running: Boolean(parsed.running),
      startedAt: typeof parsed.startedAt === "number" ? parsed.startedAt : null,
    }
  } catch {
    return EMPTY
  }
}

function write(storageKey: string, state: PersistedTimer) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    /* localStorage non disponibile (private mode): il timer resta in memoria */
  }
}

/**
 * Secondi totali correnti del cronometro persistito (accumulati + sessione in
 * corso). Usato dalla pagina al salvataggio per registrare il tempo sul preventivo.
 * 0 se non avviato / non disponibile.
 */
export function getPreventivoTimerSeconds(storageKey: string): number {
  return Math.round(totalMs(read(storageKey)) / 1000)
}

/** Azzera il cronometro persistito per la chiave indicata. */
export function clearPreventivoTimer(storageKey: string) {
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    /* ignore */
  }
}

/** ms totali correnti dato lo stato persistito (accumulati + sessione in corso). */
function totalMs(s: PersistedTimer): number {
  if (s.running && s.startedAt != null) {
    return s.accumulatedMs + Math.max(0, Date.now() - s.startedAt)
  }
  return s.accumulatedMs
}

function format(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export function PreventivoTimer({
  storageKey,
  initialSeconds = 0,
}: {
  storageKey: string
  /** Secondi già accumulati da cui ripartire se non c'è nulla in storage (es. tempo salvato del preventivo che si sta modificando). */
  initialSeconds?: number
}) {
  const [state, setState] = useState<PersistedTimer>(EMPTY)
  const [display, setDisplay] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Idrata dallo storage al mount (e quando cambia la chiave, es. nuovo vs base).
  // Se in storage non c'è nulla ma è stato passato un tempo iniziale (modifica di
  // un preventivo con tempo già registrato), riparte da quel valore (in pausa).
  useEffect(() => {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null
    if (raw == null && initialSeconds > 0) {
      const seeded: PersistedTimer = { accumulatedMs: initialSeconds * 1000, running: false, startedAt: null }
      setState(seeded)
      setDisplay(seeded.accumulatedMs)
      write(storageKey, seeded)
      return
    }
    const restored = read(storageKey)
    setState(restored)
    setDisplay(totalMs(restored))
  }, [storageKey, initialSeconds])

  // Tick di refresh del display mentre è in corsa.
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (state.running) {
      intervalRef.current = setInterval(() => setDisplay(totalMs(state)), 250)
    }
    setDisplay(totalMs(state))
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [state])

  const persist = useCallback(
    (next: PersistedTimer) => {
      setState(next)
      write(storageKey, next)
    },
    [storageKey]
  )

  const start = () => persist({ accumulatedMs: state.accumulatedMs, running: true, startedAt: Date.now() })

  const pause = () =>
    persist({ accumulatedMs: totalMs(state), running: false, startedAt: null })

  const reset = () => persist({ ...EMPTY })

  return (
    <div className="inline-flex items-center gap-2 rounded-xl border border-border bg-bg px-3 py-1.5">
      <TimerIcon className="w-4 h-4 text-[#00a1be] shrink-0" aria-hidden />
      <span
        className="font-tenorite tabular-nums text-base font-semibold text-text min-w-[64px] text-center"
        aria-label="Tempo di preventivazione"
      >
        {format(display)}
      </span>
      {state.running ? (
        <button
          type="button"
          onClick={pause}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors"
          title="Metti in pausa"
        >
          <Pause className="w-3.5 h-3.5" /> Pausa
        </button>
      ) : (
        <button
          type="button"
          onClick={start}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 transition-colors"
          title={state.accumulatedMs > 0 ? "Riprendi" : "Avvia"}
        >
          <Play className="w-3.5 h-3.5" /> {state.accumulatedMs > 0 ? "Riprendi" : "Avvia"}
        </button>
      )}
      {(state.accumulatedMs > 0 || state.running) && (
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center rounded-lg p-1 text-text-muted hover:text-danger hover:bg-bg-page transition-colors"
          title="Azzera"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
