"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Check, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { STATO_BOZZA, STATO_DEFINITIVO } from "@/lib/portali/preventivatore/stati"

/**
 * Passaggio fra i due soli stati vivi del preventivo: **bozza** (`aperta`) e
 * **definitivo** (`completato`).
 *
 * Sostituisce `workflow-actions.tsx`, che gestiva il ciclo offerta→esito
 * (invia offerta / marca ordinata / marca fallita). Quel ciclo è stato rimosso
 * il 17/09/2026: non era mai entrato in servizio — zero documenti negli stati
 * `inviata`/`ordinata`/`fallita`, e nessun pulsante per entrare in
 * `presa_in_carico` — mentre conversione, giorni di risposta e carico back
 * office li produce già il gestionale.
 */
export function ConfermaDefinitivo({
  documentoId,
  statoCorrente,
  tipo,
}: {
  documentoId: string
  statoCorrente: string
  tipo: string
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Lo storico e tutto ciò che non nasce dal builder non si muove.
  if (tipo !== "generato") return null
  if (statoCorrente !== STATO_BOZZA && statoCorrente !== STATO_DEFINITIVO) return null

  const definitivo = statoCorrente === STATO_DEFINITIVO
  const target = definitivo ? STATO_BOZZA : STATO_DEFINITIVO

  async function cambia() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portali/preventivatore/documenti/${documentoId}/stato`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stato: target }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Errore")
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant={definitivo ? "outline" : "default"}
        onClick={cambia}
        disabled={loading}
        className="gap-1.5"
        title={
          definitivo
            ? "Rimetti il preventivo in bozza per poterlo modificare"
            : "Segna il preventivo come definitivo"
        }
      >
        {loading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : definitivo ? (
          <Undo2 className="w-3.5 h-3.5" />
        ) : (
          <Check className="w-3.5 h-3.5" />
        )}
        {definitivo ? "Rimetti in bozza" : "Conferma definitivo"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  )
}
