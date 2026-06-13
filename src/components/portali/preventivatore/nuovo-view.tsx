"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import dynamic from "next/dynamic"
import { PlusCircle, Loader2, Wand2, Package, Hammer, Sparkles, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AutocompleteCliente } from "@/components/portali/preventivatore/autocomplete-cliente"
import { BloccoCard } from "@/components/portali/preventivatore/blocco-card"
import { PreventivoTimer, clearPreventivoTimer, getPreventivoTimerSeconds } from "@/components/portali/preventivatore/preventivo-timer"
import type { TemplateListItem } from "@/components/portali/preventivatore/blocco-template-panel"
import {
  fmtEur,
  calcNettoArticolo,
  calcTotaleServizio,
  calcTotaleBlocco,
  calcBloccoVendita,
  calcBloccoCosto,
  calcBloccoPrezzoFinale,
  calcImballaggio,
  calcTempiAccessori,
  calcSpeseGenerali,
  creaBlocco,
  buildBuilderState,
  genKey,
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
  const [settimaneMin, setSettimaneMin] = useState("")
  const [settimaneMax, setSettimaneMax] = useState("")
  const [margineGlobale, setMargineGlobale] = useState(0)
  const [blocchi, setBlocchi] = useState<Blocco[]>([])
  const [serviziDB, setServiziDB] = useState<ServizioDB[]>([])
  const [loadingServizi, setLoadingServizi] = useState(true)
  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [schedaOpen, setSchedaOpen] = useState(false)
  const [savingPreventivo, setSavingPreventivo] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [baseLoading, setBaseLoading] = useState(false)
  const [baseAvviso, setBaseAvviso] = useState<string | null>(null)
  const [editCodice, setEditCodice] = useState<string | null>(null)
  const [editTempoIniziale, setEditTempoIniziale] = useState(0)
  const [refreshingPrezzi, setRefreshingPrezzi] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const baseId = searchParams.get("base")
  // Modifica in place di un preventivo generato già salvato (?edit=<id>).
  const editId = searchParams.get("edit")
  // Chiave di persistenza del cronometro: distinta per modifica (per id), nuovo
  // vuoto e duplicazione da base, così non si mescolano i tempi.
  const timerKey = editId
    ? `prev-timer:edit:${editId}`
    : `prev-timer:${baseId ?? "nuovo"}`

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
        consegna_settimane_min: settimaneMin ? Number(settimaneMin) : undefined,
        consegna_settimane_max: settimaneMax ? Number(settimaneMax) : undefined,
        margine_trattativa_pct: margineGlobale || 0,
        // Tempo cronometrato per redigere il preventivo (produttività). Inviato
        // solo se > 0 (cronometro effettivamente usato).
        tempo_preventivazione_sec: getPreventivoTimerSeconds(timerKey) || undefined,
        blocchi: blocchi.map((b) => ({
          nome: b.nome || undefined,
          tipo: b.tipo,
          note: b.note || undefined,
          quantita_pezzi: b.quantita_pezzi ?? 1,
          margine_trattativa_pct: b.margine_trattativa_pct ?? undefined,
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
            scala_con_quantita: s.scala_con_quantita,
          })),
        })),
      }
      const res = await fetch(
        editId ? `/api/portali/preventivatore/documenti/${editId}` : "/api/portali/preventivatore/documenti",
        {
          method: editId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? "Errore salvataggio")
      }
      // Preventivo salvato: azzera il cronometro di questa bozza.
      clearPreventivoTimer(timerKey)
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

  // Blocco iniziale, oppure prefill da un preventivo esistente (?base=<id>).
  useEffect(() => {
    if (!baseId) {
      setBlocchi([creaBlocco()])
      return
    }
    let annullato = false
    setBaseLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/portali/preventivatore/documenti/${baseId}/duplica`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data as { error?: string }).error ?? "Errore caricamento base")
        if (annullato) return

        const d = data as {
          titolo?: string
          cliente?: Cliente | null
          margine_trattativa_pct?: number | null
          consegna_settimane_min?: number | null
          consegna_settimane_max?: number | null
          blocchi?: Array<{
            nome?: string; tipo?: string; note?: string
            quantita_pezzi?: number; margine_trattativa_pct?: number | null
            articoli: Array<{ codice: string; descrizione: string; qty: number; ult_costo: number; coeff_ricarico: number; data_ult_costo?: string | null }>
            servizi: Array<{ nome: string; categoria: string; ore: number; tariffa_ora: number; coeff_ricarico: number; scala_con_quantita?: boolean }>
          }>
          avvisi?: { articoli_aggiornati: number; servizi_aggiornati: number; articoli_non_trovati: number }
        }

        if (d.titolo) setTitolo(d.titolo)
        if (d.cliente) setCliente(d.cliente)
        if (d.margine_trattativa_pct != null) setMargineGlobale(d.margine_trattativa_pct)
        if (d.consegna_settimane_min != null) setSettimaneMin(String(d.consegna_settimane_min))
        if (d.consegna_settimane_max != null) setSettimaneMax(String(d.consegna_settimane_max))

        const nuoviBlocchi: Blocco[] = (d.blocchi ?? []).map((b, i) => ({
          _key: genKey(),
          tipo: b.tipo || "Altro",
          nome: b.nome || "",
          note: b.note || "",
          espanso: i === 0,
          quantita_pezzi: b.quantita_pezzi ?? 1,
          margine_trattativa_pct: b.margine_trattativa_pct ?? null,
          articoli: b.articoli.map((a) => ({
            _key: genKey(),
            prodotto_id: "",
            codice: a.codice,
            descrizione: a.descrizione,
            ult_costo: a.ult_costo,
            qty: a.qty,
            coeff_ricarico: a.coeff_ricarico,
            manuale: !a.codice,
            data_ult_costo: a.data_ult_costo ?? null,
          })),
          servizi: b.servizi.map((s) => ({
            _key: genKey(),
            servizio_id: "",
            nome: s.nome,
            categoria: s.categoria,
            tariffa_ora: s.tariffa_ora,
            ore: s.ore,
            coeff_ricarico: s.coeff_ricarico,
            scala_con_quantita: s.scala_con_quantita ?? true,
          })),
        }))
        setBlocchi(nuoviBlocchi.length > 0 ? nuoviBlocchi : [creaBlocco()])

        const av = d.avvisi
        if (av && (av.articoli_aggiornati > 0 || av.servizi_aggiornati > 0 || av.articoli_non_trovati > 0)) {
          const parti: string[] = []
          if (av.articoli_aggiornati > 0) parti.push(`${av.articoli_aggiornati} prezzi articolo aggiornati`)
          if (av.servizi_aggiornati > 0) parti.push(`${av.servizi_aggiornati} tariffe manodopera aggiornate`)
          if (av.articoli_non_trovati > 0) parti.push(`${av.articoli_non_trovati} codici non più in anagrafica (mantenuto il costo originale)`)
          setBaseAvviso(`Preventivo duplicato. ${parti.join(" · ")}.`)
        } else {
          setBaseAvviso("Preventivo duplicato. Nessun prezzo è cambiato rispetto all'originale.")
        }
      } catch (err) {
        if (!annullato) {
          setBaseAvviso(null)
          setSaveError(err instanceof Error ? err.message : "Errore caricamento base")
          setBlocchi([creaBlocco()])
        }
      } finally {
        if (!annullato) setBaseLoading(false)
      }
    })()
    return () => { annullato = true }
  }, [baseId])

  // Modifica in place: ricarica un preventivo generato (?edit=<id>) a PREZZI
  // CONGELATI (i costi salvati, non quelli correnti). Si aggiornano on-demand col
  // pulsante "Aggiorna prezzi".
  useEffect(() => {
    if (!editId) return
    let annullato = false
    setBaseLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/portali/preventivatore/documenti/${editId}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error((data as { error?: string }).error ?? "Errore caricamento preventivo")
        if (annullato) return

        const d = data as {
          documento?: { codice?: string | null; tempo_preventivazione_sec?: number | null }
          titolo?: string
          cliente?: Cliente | null
          note?: string
          margine_trattativa_pct?: number | null
          consegna_settimane_min?: number | null
          consegna_settimane_max?: number | null
          blocchi?: Array<{
            nome?: string; tipo?: string; note?: string
            quantita_pezzi?: number; margine_trattativa_pct?: number | null
            articoli: Array<{ codice: string; descrizione: string; qty: number; ult_costo: number; coeff_ricarico: number; data_ult_costo?: string | null }>
            servizi: Array<{ nome: string; categoria: string; ore: number; tariffa_ora: number; coeff_ricarico: number; scala_con_quantita?: boolean }>
          }>
        }

        setEditCodice(d.documento?.codice ?? null)
        setEditTempoIniziale(d.documento?.tempo_preventivazione_sec ?? 0)
        if (d.titolo) setTitolo(d.titolo)
        if (d.cliente) setCliente(d.cliente)
        if (d.margine_trattativa_pct != null) setMargineGlobale(d.margine_trattativa_pct)
        if (d.consegna_settimane_min != null) setSettimaneMin(String(d.consegna_settimane_min))
        if (d.consegna_settimane_max != null) setSettimaneMax(String(d.consegna_settimane_max))

        const nuoviBlocchi: Blocco[] = (d.blocchi ?? []).map((b, i) => ({
          _key: genKey(),
          tipo: b.tipo || "Altro",
          nome: b.nome || "",
          note: b.note || "",
          espanso: i === 0,
          quantita_pezzi: b.quantita_pezzi ?? 1,
          margine_trattativa_pct: b.margine_trattativa_pct ?? null,
          articoli: b.articoli.map((a) => ({
            _key: genKey(),
            prodotto_id: "",
            codice: a.codice,
            descrizione: a.descrizione,
            ult_costo: a.ult_costo,
            qty: a.qty,
            coeff_ricarico: a.coeff_ricarico,
            manuale: !a.codice,
            data_ult_costo: a.data_ult_costo ?? null,
          })),
          servizi: b.servizi.map((s) => ({
            _key: genKey(),
            servizio_id: "",
            nome: s.nome,
            categoria: s.categoria,
            tariffa_ora: s.tariffa_ora,
            ore: s.ore,
            coeff_ricarico: s.coeff_ricarico,
            scala_con_quantita: s.scala_con_quantita ?? true,
          })),
        }))
        setBlocchi(nuoviBlocchi.length > 0 ? nuoviBlocchi : [creaBlocco()])
      } catch (err) {
        if (!annullato) {
          setSaveError(err instanceof Error ? err.message : "Errore caricamento preventivo")
          setBlocchi([creaBlocco()])
        }
      } finally {
        if (!annullato) setBaseLoading(false)
      }
    })()
    return () => { annullato = true }
  }, [editId])

  // Aggiorna i prezzi (costi articoli + tariffe lavorazioni) ai valori correnti,
  // preservando la struttura del preventivo. Usato in modifica (prezzi congelati).
  async function aggiornaPrezzi() {
    if (refreshingPrezzi) return
    setRefreshingPrezzi(true)
    setBaseAvviso(null)
    setSaveError(null)
    try {
      const codici = Array.from(
        new Set(
          blocchi.flatMap((b) => b.articoli.filter((a) => a.codice && !a.manuale).map((a) => a.codice))
        )
      )
      const costi = new Map<string, { costo: number; data: string | null }>()
      if (codici.length > 0) {
        const res = await fetch(`/api/portali/preventivatore/prodotti/costo?codici=${encodeURIComponent(codici.join(","))}`)
        if (res.ok) {
          const data = await res.json()
          for (const it of ((data.items ?? []) as Array<{ codice: string; ult_costo: number | null; data_ult_costo: string | null }>)) {
            if (it.ult_costo != null) costi.set(it.codice, { costo: Number(it.ult_costo), data: it.data_ult_costo })
          }
        }
      }
      // Tariffe correnti dal catalogo già caricato (match per nome).
      const tariffe = new Map<string, number>()
      for (const s of serviziDB) tariffe.set(s.nome.trim().toLowerCase(), Number(s.tariffa_ora))

      let nArt = 0
      let nSrv = 0
      setBlocchi((prev) =>
        prev.map((b) => ({
          ...b,
          articoli: b.articoli.map((a) => {
            const cur = a.codice ? costi.get(a.codice) : undefined
            if (cur && Math.abs(cur.costo - a.ult_costo) > 0.001) {
              nArt++
              return { ...a, ult_costo: cur.costo, data_ult_costo: cur.data ?? a.data_ult_costo }
            }
            return a
          }),
          servizi: b.servizi.map((s) => {
            const t = tariffe.get(s.nome.trim().toLowerCase())
            if (t != null && Math.abs(t - s.tariffa_ora) > 0.001) {
              nSrv++
              return { ...s, tariffa_ora: t }
            }
            return s
          }),
        }))
      )
      setBaseAvviso(
        nArt === 0 && nSrv === 0
          ? "Prezzi già allineati ai costi correnti: nessuna variazione."
          : `Prezzi aggiornati ai costi correnti: ${nArt} articol${nArt === 1 ? "o" : "i"}, ${nSrv} lavorazion${nSrv === 1 ? "e" : "i"}.`
      )
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Errore aggiornamento prezzi")
    } finally {
      setRefreshingPrezzi(false)
    }
  }

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

  // Carica i template prodotti attivi (per la generazione distinta nei blocchi)
  useEffect(() => {
    fetch("/api/portali/preventivatore/template")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setTemplates(Array.isArray(d) ? d : []))
      .catch(() => {})
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

  // ── Totali COMPLESSIVI (× quantità pezzi per blocco) ──────────────────────
  const qPezzi = (b: Blocco) => b.quantita_pezzi ?? 1
  // Materiali e servizi a prezzo di vendita (con ricarico), complessivi
  const totaleArticoli = blocchi.reduce(
    (sum, b) => sum + b.articoli.reduce((s, a) => s + calcNettoArticolo(a) * qPezzi(b), 0),
    0
  )
  const totaleServizi = blocchi.reduce(
    (sum, b) => sum + b.servizi.reduce((s, sv) => s + calcTotaleServizio(sv) * (sv.scala_con_quantita ? qPezzi(b) : 1), 0),
    0
  )
  // Add-on complessivi: imballaggio sul prezzo di vendita; tempi accessori e spese sul costo
  const imballaggioTotale = blocchi.reduce((sum, b) => sum + calcImballaggio(calcBloccoVendita(b, qPezzi(b))), 0)
  const tempiAccessoriTotale = blocchi.reduce((sum, b) => sum + calcTempiAccessori(calcBloccoCosto(b, qPezzi(b))), 0)
  const speseGeneraliTotale = blocchi.reduce((sum, b) => sum + calcSpeseGenerali(calcBloccoCosto(b, qPezzi(b))), 0)
  // Prezzo finale complessivo (include imballaggio, spese e margine trattativa)
  const totaleGlobale = blocchi.reduce((sum, b) => sum + calcBloccoPrezzoFinale(b, qPezzi(b), margineGlobale), 0)

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

  // Coeff. di ricarico medio dei SERVIZI (prezzo = costo ÷ coeff). Distinto da
  // quello dei materiali: la card Servizi deve mostrare il proprio, non quello articoli.
  const nServiziTotali = blocchi.reduce((n, b) => n + b.servizi.length, 0)
  const coeffRicaricoMedioServizi =
    nServiziTotali > 0
      ? blocchi
          .flatMap((b) => b.servizi)
          .reduce((sum, s) => sum + s.coeff_ricarico, 0) / nServiziTotali
      : 0

  // Costi "vergini" (senza ricarico) complessivi → margine progetto sul costo.
  const costoVergineMateriale = blocchi.reduce(
    (sum, b) => sum + b.articoli.reduce((s, a) => s + a.ult_costo * a.qty * qPezzi(b), 0),
    0
  )
  const costoVergineManodopera = blocchi.reduce(
    (sum, b) => sum + b.servizi.reduce((s, sv) => s + sv.tariffa_ora * sv.ore * (sv.scala_con_quantita ? qPezzi(b) : 1), 0),
    0
  )
  const costoVergineTotale = costoVergineMateriale + costoVergineManodopera
  const margineEuro = totaleGlobale - costoVergineTotale
  const marginePct =
    costoVergineTotale > 0 ? (margineEuro / costoVergineTotale) * 100 : null

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
    () => buildBuilderState({ titolo, cliente, dataConsegna: "", blocchi }),
    [titolo, cliente, blocchi]
  )

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-tenorite text-text">
            {editId
              ? `Modifica preventivo${editCodice ? ` ${editCodice}` : ""}`
              : baseId
                ? "Nuovo Preventivo (da base)"
                : "Nuovo Preventivo"}
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {editId
              ? "Riprendi e modifica il preventivo. I prezzi sono congelati: usa “Aggiorna prezzi” per allinearli ai costi correnti."
              : "Costruisci il preventivo per blocchi, aggiungi articoli e lavorazioni."}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editId && (
            <Button
              size="sm"
              variant="outline"
              onClick={aggiornaPrezzi}
              disabled={refreshingPrezzi}
              className="gap-1.5"
              title="Allinea costi articoli e tariffe lavorazioni ai valori correnti dell'anagrafica"
            >
              {refreshingPrezzi ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
              Aggiorna prezzi
            </Button>
          )}
          <PreventivoTimer storageKey={timerKey} initialSeconds={editTempoIniziale} />
        </div>
      </div>

      {baseLoading && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-[#00a1be]/30 bg-[#00a1be]/5 px-4 py-3 text-sm text-[#007a91]">
          <Loader2 className="w-4 h-4 animate-spin" />
          Carico il preventivo di base e aggiorno i prezzi correnti…
        </div>
      )}
      {baseAvviso && !baseLoading && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <Sparkles className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {baseAvviso}{" "}
            <button onClick={() => setBaseAvviso(null)} className="underline underline-offset-2 hover:text-emerald-900">
              ok
            </button>
          </span>
        </div>
      )}

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

              {/* Consegna stimata (range settimane) + margine trattativa */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
                    Consegna stimata (settimane)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      value={settimaneMin}
                      onChange={(e) => setSettimaneMin(e.target.value)}
                      placeholder="6"
                      className="text-sm text-center"
                    />
                    <span className="text-text-muted">–</span>
                    <Input
                      type="number"
                      min={1}
                      value={settimaneMax}
                      onChange={(e) => setSettimaneMax(e.target.value)}
                      placeholder="8"
                      className="text-sm text-center"
                    />
                    <span className="text-xs text-text-muted shrink-0">sett.</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted uppercase tracking-wide mb-1">
                    Margine trattativa (%)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={margineGlobale}
                    onChange={(e) => setMargineGlobale(Math.max(0, Number(e.target.value) || 0))}
                    placeholder="0"
                    className="text-sm"
                  />
                </div>
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
                  templates={templates}
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
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 flex-1 min-w-0">
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
                          <span className="flex items-center gap-1.5 shrink-0 text-[10px] text-slate-400 tabular-nums">
                            {coeffRicaricoMedio > 0 && (
                              <span title="Coefficiente di ricarico medio dei materiali (prezzo = costo ÷ coeff)">
                                x{coeffRicaricoMedio.toFixed(2)}
                              </span>
                            )}
                            <span>{nArticoliTotali} pz</span>
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-lg font-bold text-slate-800 tabular-nums">{fmtEur(totaleArticoli)}</div>
                      {costoVergineMateriale > 0 && (
                        <div className="text-[10px] text-slate-400 tabular-nums">costo {fmtEur(costoVergineMateriale)}</div>
                      )}
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
                        {nServiziTotali > 0 && coeffRicaricoMedioServizi > 0 && (
                          <span
                            className="text-[10px] text-amber-600/70 tabular-nums shrink-0"
                            title="Coefficiente di ricarico medio dei servizi (prezzo = costo ÷ coeff)"
                          >
                            x{coeffRicaricoMedioServizi.toFixed(2)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-lg font-bold text-amber-900 tabular-nums">{fmtEur(totaleServizi)}</div>
                      {costoVergineManodopera > 0 && (
                        <div className="text-[10px] text-amber-600/60 tabular-nums">costo {fmtEur(costoVergineManodopera)}</div>
                      )}
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
                      {(imballaggioTotale > 0 || tempiAccessoriTotale > 0 || speseGeneraliTotale > 0 || margineGlobale > 0) && (
                        <div className="relative text-[10px] text-[#007a91]/70 tabular-nums leading-tight">
                          incl. imb. {fmtEur(imballaggioTotale)} · tempi {fmtEur(tempiAccessoriTotale)} · spese {fmtEur(speseGeneraliTotale)}
                          {margineGlobale > 0 && ` · marg. +${margineGlobale}%`}
                        </div>
                      )}
                    </div>

                    {/* Margine progetto */}
                    <div className="group relative rounded-xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white backdrop-blur-sm px-3 py-2.5 transition-all hover:border-emerald-300 hover:shadow-md overflow-hidden">
                      <div aria-hidden className="absolute -right-4 -top-4 w-16 h-16 rounded-full bg-emerald-300/15 blur-xl" />
                      <div className="relative flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-700" />
                          </div>
                          <span className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold">Margine</span>
                        </div>
                        {marginePct != null && (
                          <span className="text-[10px] text-emerald-600/70 tabular-nums shrink-0">+{marginePct.toFixed(0)}%</span>
                        )}
                      </div>
                      <div className="relative mt-1 text-lg font-bold text-emerald-700 tabular-nums">{fmtEur(margineEuro)}</div>
                      {costoVergineTotale > 0 && (
                        <div className="text-[10px] text-emerald-600/60 tabular-nums">su costo {fmtEur(costoVergineTotale)}</div>
                      )}
                    </div>
                  </div>

                  {/* Actions — impilati in verticale per lasciare spazio alle card */}
                  <div className="flex flex-col gap-2 shrink-0 lg:pl-3 lg:border-l lg:border-[#00a1be]/15 lg:w-44">
                    {saveError && (
                      <span className="text-xs text-danger truncate" title={saveError}>{saveError}</span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSchedaOpen(true)}
                      className="w-full gap-1.5 bg-white/80 backdrop-blur-sm border-slate-200 hover:bg-white hover:border-slate-300 hover:shadow-sm transition-all"
                      disabled={blocchi.length === 0}
                      title="Genera scheda tecnica AI con il preventivo corrente"
                    >
                      <Wand2 className="w-4 h-4" />
                      Scheda tecnica
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSalvaPreventivo}
                      disabled={savingPreventivo || !cliente || blocchi.length === 0}
                      className="w-full text-white gap-1.5 shadow-md hover:shadow-lg active:scale-[0.99] transition-all bg-gradient-to-r from-[#007a91] to-[#00a1be] hover:from-[#006578] hover:to-[#0091ad] disabled:opacity-50 disabled:shadow-md"
                    >
                      {savingPreventivo ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Salvataggio…
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          {editId ? "Salva modifiche" : "Salva Preventivo"}
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
