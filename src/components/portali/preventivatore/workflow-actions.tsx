"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Check, Send, XCircle, Truck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface MotivoRifiuto {
  id: string
  label: string
}

/**
 * Bottoni di transizione di stato per la scheda dettaglio del preventivo.
 * Mostra solo i bottoni validi per lo stato corrente. I form (numero+importo
 * per "Invia offerta", motivo per "Marca fallita") sono modali inline.
 *
 * Permessi: livello portale >= 'admin'. In futuro affineremo con ruoli funzionali.
 */
export function WorkflowActions({
  documentoId,
  statoCorrente,
  tipo,
  importoCorrente,
}: {
  documentoId: string
  statoCorrente: string
  tipo: string
  importoCorrente: number | null
}) {
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Form "Invia offerta"
  const [inviaOpen, setInviaOpen] = useState(false)
  const [numeroPreventivo, setNumeroPreventivo] = useState("")
  const [importoOfferta, setImportoOfferta] = useState<string>(importoCorrente?.toString() ?? "")
  const [noteOfferta, setNoteOfferta] = useState("")

  // Form "Marca fallita"
  const [falliscOpen, setFalliscOpen] = useState(false)
  const [motivi, setMotivi] = useState<MotivoRifiuto[]>([])
  const [motivoSel, setMotivoSel] = useState<string>("")
  const [noteFalli, setNoteFalli] = useState("")

  useEffect(() => {
    if (!falliscOpen || motivi.length > 0) return
    fetch("/api/portali/preventivatore/motivi-rifiuto")
      .then((r) => r.ok ? r.json() : [])
      .then((d: MotivoRifiuto[]) => {
        setMotivi(d ?? [])
        if (d?.[0]) setMotivoSel(d[0].id)
      })
      .catch(() => {})
  }, [falliscOpen, motivi.length])

  async function transizione(payload: Record<string, unknown>, key: string) {
    setLoading(key)
    setError(null)
    try {
      const res = await fetch(`/api/portali/preventivatore/documenti/${documentoId}/stato`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "Errore")
      router.refresh()
      setInviaOpen(false)
      setFalliscOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore")
    } finally {
      setLoading(null)
    }
  }

  // Stati legacy o storico: niente workflow attivo
  if (
    tipo === "storico" ||
    statoCorrente === "storico" ||
    statoCorrente === "pending" ||
    statoCorrente === "ordinato" ||
    statoCorrente === "rifiutato"
  ) {
    return null
  }

  // Stati finali del workflow
  if (statoCorrente === "ordinata" || statoCorrente === "fallita") {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Aperta o presa_in_carico → Conferma definitivo */}
        {(statoCorrente === "aperta" || statoCorrente === "presa_in_carico") && (
          <Button
            size="sm"
            onClick={() => transizione({ stato: "completato" }, "completato")}
            disabled={loading !== null}
            className="gap-1.5"
          >
            {loading === "completato" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Conferma definitivo
          </Button>
        )}

        {/* Completato → Invia offerta */}
        {statoCorrente === "completato" && (
          <Button
            size="sm"
            onClick={() => setInviaOpen(!inviaOpen)}
            disabled={loading !== null}
            className="gap-1.5"
            style={{ backgroundColor: "#00a1be", color: "white" }}
          >
            <Send className="w-3.5 h-3.5" />
            Invia offerta
          </Button>
        )}

        {/* Inviata → Marca ordinata / fallita */}
        {statoCorrente === "inviata" && (
          <>
            <Button
              size="sm"
              onClick={() => transizione({ stato: "ordinata" }, "ordinata")}
              disabled={loading !== null}
              className="gap-1.5 bg-success text-white hover:bg-success/90"
            >
              {loading === "ordinata" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Truck className="w-3.5 h-3.5" />}
              Marca ordinata
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setFalliscOpen(!falliscOpen)}
              disabled={loading !== null}
              className="gap-1.5 text-danger border-danger/30 hover:bg-danger/5"
            >
              <XCircle className="w-3.5 h-3.5" />
              Marca fallita
            </Button>
          </>
        )}

        {error && <span className="text-xs text-danger">{error}</span>}
      </div>

      {/* Form "Invia offerta" inline */}
      {inviaOpen && (
        <div className="rounded-lg border border-border bg-bg-page p-3 space-y-2 max-w-md">
          <div className="text-xs font-medium text-text-muted">Invio offerta al cliente</div>
          <div className="space-y-1.5">
            <label className="text-xs text-text-muted">Numero offerta (PC N°)</label>
            <Input
              value={numeroPreventivo}
              onChange={(e) => setNumeroPreventivo(e.target.value)}
              placeholder="es. 250485"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-text-muted">Importo offerta (EUR)</label>
            <Input
              type="number"
              step="0.01"
              value={importoOfferta}
              onChange={(e) => setImportoOfferta(e.target.value)}
              placeholder={importoCorrente ? importoCorrente.toFixed(2) : "0.00"}
            />
            {importoCorrente !== null && (
              <div className="text-[10px] text-text-muted">
                Importo preventivo iniziale: {importoCorrente.toFixed(2)} EUR
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-text-muted">Note scostamento (opzionale)</label>
            <Input
              value={noteOfferta}
              onChange={(e) => setNoteOfferta(e.target.value)}
              placeholder="es. trattativa -5%"
            />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="outline" onClick={() => setInviaOpen(false)} disabled={loading !== null}>
              Annulla
            </Button>
            <Button
              size="sm"
              disabled={loading !== null || !numeroPreventivo.trim()}
              onClick={() => {
                const importoNum = parseFloat(importoOfferta)
                transizione(
                  {
                    stato: "inviata",
                    numero_preventivo: numeroPreventivo.trim(),
                    importo_offerta: Number.isFinite(importoNum) ? importoNum : undefined,
                    note_offerta: noteOfferta.trim() || undefined,
                  },
                  "inviata"
                )
              }}
              style={{ backgroundColor: "#00a1be", color: "white" }}
            >
              {loading === "inviata" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Conferma invio"}
            </Button>
          </div>
        </div>
      )}

      {/* Form "Marca fallita" inline */}
      {falliscOpen && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 p-3 space-y-2 max-w-md">
          <div className="text-xs font-medium text-text-muted">Motivo del fallimento offerta</div>
          <select
            value={motivoSel}
            onChange={(e) => setMotivoSel(e.target.value)}
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-bg"
          >
            {motivi.length === 0 && <option value="">— caricamento —</option>}
            {motivi.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <Input
            value={noteFalli}
            onChange={(e) => setNoteFalli(e.target.value)}
            placeholder="Note (opzionali)"
          />
          <div className="flex gap-2 justify-end pt-1">
            <Button size="sm" variant="outline" onClick={() => setFalliscOpen(false)} disabled={loading !== null}>
              Annulla
            </Button>
            <Button
              size="sm"
              disabled={loading !== null || !motivoSel}
              onClick={() => transizione(
                {
                  stato: "fallita",
                  motivo_rifiuto_id: motivoSel,
                  note: noteFalli.trim() || undefined,
                },
                "fallita"
              )}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {loading === "fallita" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Conferma fallimento"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
