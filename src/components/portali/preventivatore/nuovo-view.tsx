"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import { PlusCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AutocompleteCliente } from "@/components/portali/preventivatore/autocomplete-cliente"
import { BloccoCard } from "@/components/portali/preventivatore/blocco-card"
import {
  fmtEur,
  calcNettoArticolo,
  calcTotaleServizio,
  calcTotaleBlocco,
  creaBlocco,
  type Cliente,
  type ServizioDB,
  type Blocco,
} from "@/components/portali/preventivatore/nuovo-view-types"

// ─── Main component ───────────────────────────────────────────────────────────

const ChatAI = dynamic(
  () => import("@/components/portali/preventivatore/chat-ai").then((m) => m.ChatAI),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-80 shrink-0 sticky top-6 self-start rounded-2xl"
        style={{ height: "600px", background: "linear-gradient(180deg, #0f1720 0%, #18222e 100%)" }}
      />
    ),
  }
)

export function NuovoView() {
  const [titolo, setTitolo] = useState("")
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [dataConsegna, setDataConsegna] = useState("")
  const [blocchi, setBlocchi] = useState<Blocco[]>([])
  const [serviziDB, setServiziDB] = useState<ServizioDB[]>([])
  const [loadingServizi, setLoadingServizi] = useState(true)

  // Load servizi at mount
  useEffect(() => {
    async function caricaServizi() {
      try {
        const res = await fetch("/api/portali/preventivatore/servizi")
        if (res.ok) {
          const data: ServizioDB[] = await res.json()
          setServiziDB(data)
          // Create initial empty block with loaded services
          setBlocchi([creaBlocco(data)])
        }
      } catch {
        // silently ignore — blocchi inizializzeranno senza servizi
        setBlocchi([creaBlocco([])])
      } finally {
        setLoadingServizi(false)
      }
    }
    caricaServizi()
  }, [])

  function aggiungiBlocco() {
    setBlocchi((prev) => [...prev, creaBlocco(serviziDB)])
  }

  function aggiornaBlocco(key: string, b: Blocco) {
    setBlocchi((prev) => prev.map((x) => (x._key === key ? b : x)))
  }

  function eliminaBlocco(key: string) {
    setBlocchi((prev) => prev.filter((x) => x._key !== key))
  }

  // Aggregated totals
  const totaleArticoli = blocchi.reduce(
    (sum, b) => sum + b.articoli.reduce((s, a) => s + calcNettoArticolo(a), 0),
    0
  )
  const totaleServizi = blocchi.reduce(
    (sum, b) => sum + b.servizi.reduce((s, sv) => s + calcTotaleServizio(sv), 0),
    0
  )
  const totaleGlobale = totaleArticoli + totaleServizi

  const nArticoliTotali = blocchi.reduce((n, b) => n + b.articoli.length, 0)
  const oreTotali = blocchi.reduce(
    (ore, b) => ore + b.servizi.filter((s) => s.attivo).reduce((o, s) => o + s.ore, 0),
    0
  )

  const markupMedio =
    nArticoliTotali > 0
      ? blocchi
          .flatMap((b) => b.articoli)
          .reduce((sum, a) => sum + a.markup, 0) / nArticoliTotali
      : 0

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-tenorite text-text">Nuovo Preventivo</h1>
        <p className="text-sm text-text-muted mt-1">
          Costruisci il preventivo per blocchi, aggiungi articoli e lavorazioni.
        </p>
      </div>

      <div className="flex gap-6 items-start">
        {/* ── Main content ── */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* Header card */}
          <div className="border border-border rounded-xl bg-bg p-5 space-y-4">
            {/* Titolo */}
            <div>
              <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
                Titolo preventivo
              </label>
              <Input
                value={titolo}
                onChange={(e) => setTitolo(e.target.value)}
                placeholder="Es. Impianto scale Montenegro"
                className="text-base font-medium"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Cliente */}
              <div>
                <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
                  Cliente
                </label>
                <AutocompleteCliente valore={cliente} onSelect={setCliente} />
                {cliente && (
                  <p className="text-xs text-text-muted mt-1">
                    {[cliente.piva && `P.IVA ${cliente.piva}`, cliente.citta, cliente.provincia]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>

              {/* Data consegna */}
              <div>
                <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
                  Data consegna
                </label>
                <Input
                  type="date"
                  value={dataConsegna}
                  onChange={(e) => setDataConsegna(e.target.value)}
                  className="text-sm"
                />
              </div>
            </div>

            {/* Stats row */}
            <div className="flex gap-6 pt-1 border-t border-border">
              <div className="text-center">
                <div className="text-xl font-bold text-text">{blocchi.length}</div>
                <div className="text-xs text-text-muted">Blocchi</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-text">{nArticoliTotali}</div>
                <div className="text-xs text-text-muted">Articoli</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-text">{oreTotali.toFixed(1)}</div>
                <div className="text-xs text-text-muted">Ore totali</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold" style={{ color: "#00a1be" }}>
                  {fmtEur(totaleGlobale)}
                </div>
                <div className="text-xs text-text-muted">Totale</div>
              </div>
            </div>
          </div>

          {/* Blocchi header + add button */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
              Blocchi progetto
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={aggiungiBlocco}
              disabled={loadingServizi}
              className="gap-1.5 text-xs"
            >
              {loadingServizi ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <PlusCircle className="w-3.5 h-3.5" />
              )}
              Aggiungi Blocco
            </Button>
          </div>

          {/* Blocchi list */}
          <div className="space-y-4">
            {blocchi.map((b, i) => (
              <BloccoCard
                key={b._key}
                blocco={b}
                indice={i}
                onChange={(updated) => aggiornaBlocco(b._key, updated)}
                onDelete={() => eliminaBlocco(b._key)}
              />
            ))}

            {blocchi.length === 0 && !loadingServizi && (
              <div className="border-2 border-dashed border-border rounded-xl py-12 text-center">
                <p className="text-sm text-text-muted">
                  Nessun blocco. Clicca &quot;Aggiungi Blocco&quot; per iniziare.
                </p>
              </div>
            )}
          </div>

          {/* Footer totali + salva */}
          {blocchi.length > 0 && (
            <div className="border border-border rounded-xl bg-bg p-4 flex items-center justify-between">
              <div className="flex gap-6">
                <div>
                  <div className="text-xs text-text-muted uppercase tracking-wide">Materiali</div>
                  <div className="text-lg font-bold text-text">{fmtEur(totaleArticoli)}</div>
                </div>
                <div>
                  <div className="text-xs text-text-muted uppercase tracking-wide">Servizi</div>
                  <div className="text-lg font-bold text-text">{fmtEur(totaleServizi)}</div>
                </div>
                {nArticoliTotali > 0 && (
                  <div>
                    <div className="text-xs text-text-muted uppercase tracking-wide">Markup medio</div>
                    <div className="text-lg font-bold text-text">{markupMedio.toFixed(1)}%</div>
                  </div>
                )}
                <div>
                  <div className="text-xs text-text-muted uppercase tracking-wide">Totale</div>
                  <div className="text-xl font-bold" style={{ color: "#00a1be" }}>
                    {fmtEur(totaleGlobale)}
                  </div>
                </div>
              </div>

              <Button
                onClick={() => alert("Funzionalità di salvataggio in arrivo")}
                className="text-white px-6"
                style={{ backgroundColor: "#00a1be" }}
              >
                Salva Preventivo
              </Button>
            </div>
          )}
        </div>

        {/* ── AI Chat sidebar ── */}
        <ChatAI contesto="nuovo" placeholder="Chiedi ai preventivi storici..." />
      </div>
    </div>
  )
}
