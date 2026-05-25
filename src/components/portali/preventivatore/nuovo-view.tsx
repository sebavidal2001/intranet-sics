"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { PlusCircle, Loader2, Wand2, Package, Hammer, Sparkles } from "lucide-react"
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
  buildBuilderState,
  COLORI_BLOCCO,
  type Cliente,
  type ServizioDB,
  type Blocco,
} from "@/components/portali/preventivatore/nuovo-view-types"
import { useMemo } from "react"

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

const SchedaTecnicaDialog = dynamic(
  () =>
    import("@/components/portali/preventivatore/scheda-tecnica-dialog").then((m) => m.SchedaTecnicaDialog),
  { ssr: false }
)

export function NuovoView() {
  const [titolo, setTitolo] = useState("")
  const [cliente, setCliente] = useState<Cliente | null>(null)
  const [dataConsegna, setDataConsegna] = useState("")
  const [blocchi, setBlocchi] = useState<Blocco[]>([])
  const [serviziDB, setServiziDB] = useState<ServizioDB[]>([])
  const [loadingServizi, setLoadingServizi] = useState(true)
  const [schedaOpen, setSchedaOpen] = useState(false)
  const [savingPreventivo, setSavingPreventivo] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSalvaPreventivo() {
    if (savingPreventivo) return
    if (!cliente) {
      setSaveError("Seleziona un cliente prima di salvare")
      return
    }
    if (blocchi.length === 0 || blocchi.every((b) => b.articoli.length === 0 && b.servizi.length === 0)) {
      setSaveError("Aggiungi almeno un articolo o servizio in un blocco")
      return
    }
    setSavingPreventivo(true)
    setSaveError(null)
    try {
      const payload = {
        titolo: titolo.trim() || undefined,
        cliente_master_id: cliente.id,
        cliente_text: cliente.ragione_sociale,
        data_consegna: dataConsegna || undefined,
        blocchi: blocchi.map((b) => ({
          nome: b.nome || undefined,
          tipo: b.tipo,
          note: b.note || undefined,
          articoli: b.articoli.map((a) => ({
            codice: a.codice,
            descrizione: a.descrizione,
            qty: a.qty,
            ult_costo: a.ult_costo,
            coeff_ricarico: a.coeff_ricarico,
          })),
          servizi: b.servizi.map((s) => ({
            nome: s.nome,
            categoria: s.categoria,
            ore: s.ore,
            tariffa_ora: s.tariffa_ora,
            coeff_ricarico: s.coeff_ricarico,
          })),
        })),
      }
      const res = await fetch("/api/portali/preventivatore/documenti", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? "Errore salvataggio")
      }
      // Redirect alla scheda del nuovo preventivo creato
      const id = (data as { id?: string }).id
      if (id) {
        router.push(`/preventivatore/archivio/${id}`)
      } else {
        router.push("/preventivatore/archivio")
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Errore sconosciuto")
      setSavingPreventivo(false)
    }
  }

  // Blocco iniziale (i servizi non vengono precaricati nei blocchi)
  useEffect(() => {
    setBlocchi([creaBlocco()])
  }, [])

  // Carica il catalogo servizi (per il picker delle lavorazioni nei blocchi)
  useEffect(() => {
    async function caricaServizi() {
      try {
        const res = await fetch("/api/portali/preventivatore/servizi")
        if (res.ok) {
          const data: ServizioDB[] = await res.json()
          setServiziDB(data)
        }
      } catch {
        // silently ignore — il picker servizi resterà vuoto
      } finally {
        setLoadingServizi(false)
      }
    }
    caricaServizi()
  }, [])

  function aggiungiBlocco() {
    setBlocchi((prev) => [...prev, creaBlocco()])
  }

  function aggiornaBlocco(key: string, b: Blocco) {
    // Accordion: se il blocco viene appena espanso, gli altri si chiudono
    setBlocchi((prev) => {
      const precedente = prev.find((x) => x._key === key)
      const appenaEspanso = b.espanso && precedente !== undefined && !precedente.espanso
      return prev.map((x) => {
        if (x._key === key) return b
        return appenaEspanso ? { ...x, espanso: false } : x
      })
    })
  }

  function eliminaBlocco(key: string) {
    setBlocchi((prev) => prev.filter((x) => x._key !== key))
  }

  /** Espande un blocco e chiude tutti gli altri (usato dalla vista d'insieme). */
  function espandiBlocco(key: string) {
    setBlocchi((prev) => prev.map((x) => ({ ...x, espanso: x._key === key })))
    // scroll al blocco dopo il render
    requestAnimationFrame(() => {
      document.getElementById(`blocco-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
    })
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
    (ore, b) => ore + b.servizi.reduce((o, s) => o + s.ore, 0),
    0
  )

  const coeffRicaricoMedio =
    nArticoliTotali > 0
      ? blocchi
          .flatMap((b) => b.articoli)
          .reduce((sum, a) => sum + a.coeff_ricarico, 0) / nArticoliTotali
      : 0

  // Indicatore di completezza per la vista d'insieme
  const coseDaCompletare: string[] = []
  if (!cliente) coseDaCompletare.push("cliente")
  const nBlocchiVuoti = blocchi.filter(
    (b) => b.articoli.length === 0 && b.servizi.length === 0
  ).length
  if (nBlocchiVuoti > 0) {
    coseDaCompletare.push(`${nBlocchiVuoti} blocc${nBlocchiVuoti === 1 ? "o vuoto" : "hi vuoti"}`)
  }

  // Snapshot del preventivo per la chat AI builder-aware e per la scheda tecnica
  const builderState = useMemo(
    () => buildBuilderState({ titolo, cliente, dataConsegna, blocchi }),
    [titolo, cliente, dataConsegna, blocchi]
  )

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

          {/* Vista d'insieme blocchi */}
          {blocchi.length > 0 && (
            <div className="border border-border rounded-xl bg-bg-page p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                  Riepilogo blocchi
                </span>
                {coseDaCompletare.length > 0 && (
                  <span className="text-xs text-amber-600">
                    Da completare: {coseDaCompletare.join(" · ")}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {blocchi.map((b, i) => {
                  const vuoto = b.articoli.length === 0 && b.servizi.length === 0
                  return (
                    <button
                      key={b._key}
                      onClick={() => espandiBlocco(b._key)}
                      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                        b.espanso
                          ? "border-[#00a1be] bg-[#00a1be]/10"
                          : "border-border bg-bg hover:border-[#00a1be]/50"
                      }`}
                      title={vuoto ? "Blocco vuoto" : ""}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${COLORI_BLOCCO[i % COLORI_BLOCCO.length]}`} />
                      <span className="font-semibold text-text-muted">B{i + 1}</span>
                      <span className="text-text truncate max-w-[120px]">
                        {b.nome || b.tipo}
                      </span>
                      {vuoto ? (
                        <span className="text-amber-600">vuoto</span>
                      ) : (
                        <span className="font-medium text-text">{fmtEur(calcTotaleBlocco(b))}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Blocchi header + add button */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text uppercase tracking-wide">
              Blocchi progetto
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={aggiungiBlocco}
              className="gap-1.5 text-xs"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Aggiungi Blocco
            </Button>
          </div>

          {/* Blocchi list */}
          <div className="space-y-4">
            {blocchi.map((b, i) => (
              <div key={b._key} id={`blocco-${b._key}`} className="scroll-mt-6">
                <BloccoCard
                  blocco={b}
                  indice={i}
                  serviziDB={serviziDB}
                  onChange={(updated) => aggiornaBlocco(b._key, updated)}
                  onDelete={() => eliminaBlocco(b._key)}
                />
              </div>
            ))}

            {blocchi.length === 0 && !loadingServizi && (
              <div className="border-2 border-dashed border-border rounded-xl py-12 text-center">
                <p className="text-sm text-text-muted">
                  Nessun blocco. Clicca &quot;Aggiungi Blocco&quot; per iniziare.
                </p>
              </div>
            )}
          </div>

          {/* Footer totali + salva — moderno */}
          {blocchi.length > 0 && (
            <div className="sticky bottom-4 z-30">
              <div className="relative overflow-hidden rounded-2xl border border-[#00a1be]/20 bg-gradient-to-br from-white via-white to-[#00a1be]/5 shadow-[0_10px_40px_-15px_rgba(0,161,190,0.25)]">
                {/* Accent glow decorativo */}
                <div aria-hidden className="pointer-events-none absolute -top-12 -right-12 w-48 h-48 rounded-full bg-[#00a1be]/10 blur-3xl" />
                <div aria-hidden className="pointer-events-none absolute -bottom-12 -left-12 w-40 h-40 rounded-full bg-emerald-300/10 blur-3xl" />

                <div className="relative flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between p-3 lg:p-4">
                  {/* KPI cards */}
                  <div className="grid grid-cols-3 gap-2 flex-1 max-w-3xl">
                    {/* Materiali */}
                    <div className="group relative rounded-xl border border-slate-200/70 bg-white/70 backdrop-blur-sm px-3 py-2.5 transition-all hover:border-slate-300 hover:shadow-md">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center group-hover:bg-slate-200 transition-colors">
                            <Package className="w-3.5 h-3.5 text-slate-600" />
                          </div>
                          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Materiali</span>
                        </div>
                        {nArticoliTotali > 0 && (
                          <span className="text-[10px] text-slate-400 tabular-nums shrink-0">{nArticoliTotali} pz</span>
                        )}
                      </div>
                      <div className="mt-1 text-lg font-bold text-slate-800 tabular-nums">{fmtEur(totaleArticoli)}</div>
                    </div>

                    {/* Servizi */}
                    <div className="group relative rounded-xl border border-amber-200/60 bg-amber-50/40 backdrop-blur-sm px-3 py-2.5 transition-all hover:border-amber-300 hover:shadow-md">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center group-hover:bg-amber-200 transition-colors">
                            <Hammer className="w-3.5 h-3.5 text-amber-700" />
                          </div>
                          <span className="text-[10px] uppercase tracking-wider text-amber-700 font-semibold">Servizi</span>
                        </div>
                        {nArticoliTotali > 0 && coeffRicaricoMedio > 0 && (
                          <span className="text-[10px] text-amber-600/70 tabular-nums shrink-0">x{coeffRicaricoMedio.toFixed(2)}</span>
                        )}
                      </div>
                      <div className="mt-1 text-lg font-bold text-amber-900 tabular-nums">{fmtEur(totaleServizi)}</div>
                    </div>

                    {/* Totale — accent */}
                    <div className="group relative rounded-xl border border-[#00a1be]/30 bg-gradient-to-br from-[#00a1be]/8 to-[#00a1be]/15 backdrop-blur-sm px-3 py-2.5 transition-all hover:from-[#00a1be]/12 hover:to-[#00a1be]/20 hover:shadow-lg overflow-hidden">
                      <div aria-hidden className="absolute -right-4 -top-4 w-16 h-16 rounded-full bg-[#00a1be]/15 blur-xl group-hover:bg-[#00a1be]/25 transition-colors" />
                      <div className="relative flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-7 h-7 rounded-lg bg-[#00a1be]/20 flex items-center justify-center group-hover:bg-[#00a1be]/30 transition-colors">
                            <Sparkles className="w-3.5 h-3.5 text-[#007a91]" />
                          </div>
                          <span className="text-[10px] uppercase tracking-wider text-[#007a91] font-semibold">Totale</span>
                        </div>
                        <span className="text-[10px] text-[#007a91]/70 tabular-nums shrink-0">{blocchi.length} {blocchi.length === 1 ? "blocco" : "blocchi"}</span>
                      </div>
                      <div className="relative mt-1 text-xl font-bold tabular-nums bg-gradient-to-r from-[#007a91] to-[#00a1be] bg-clip-text text-transparent">
                        {fmtEur(totaleGlobale)}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 lg:pl-2 lg:border-l lg:border-[#00a1be]/15">
                    {saveError && (
                      <span className="text-xs text-danger max-w-[200px] truncate" title={saveError}>{saveError}</span>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => setSchedaOpen(true)}
                      className="gap-1.5 bg-white/80 backdrop-blur-sm border-slate-200 hover:bg-white hover:border-slate-300 hover:shadow-sm transition-all"
                      disabled={blocchi.length === 0}
                      title="Genera scheda tecnica AI con il preventivo corrente"
                    >
                      <Wand2 className="w-4 h-4" />
                      Scheda tecnica
                    </Button>
                    <Button
                      onClick={handleSalvaPreventivo}
                      disabled={savingPreventivo || !cliente || blocchi.length === 0}
                      className="text-white px-5 gap-1.5 shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.99] transition-all bg-gradient-to-r from-[#007a91] to-[#00a1be] hover:from-[#006578] hover:to-[#0091ad] disabled:opacity-50 disabled:hover:scale-100 disabled:shadow-md"
                    >
                      {savingPreventivo ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Salvataggio…
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          Salva Preventivo
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── AI Chat sidebar ── */}
        <ChatAI
          contesto="nuovo"
          placeholder="Chiedi suggerimenti sul preventivo, confronti storici, ottimizzazioni..."
          builderState={builderState}
        />
      </div>

      {/* ── Dialog scheda tecnica ── */}
      {schedaOpen && (
        <SchedaTecnicaDialog
          open={schedaOpen}
          onClose={() => setSchedaOpen(false)}
          builderState={builderState}
        />
      )}
    </div>
  )
}
