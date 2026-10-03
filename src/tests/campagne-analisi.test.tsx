import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AnalisiView, SceltaCampagnaEFinestra } from "@/components/portali/campagne/analisi-view"
import {
  confrontabile,
  finestraValida,
  motivoEsclusione,
  ordina,
  ordineValido,
  riassumi,
  type RigaAnalisi,
} from "@/lib/portali/campagne/analisi"
import type { AnalisiCampagna } from "@/lib/portali/campagne/analisi-dati"
import type { CampagnaRiepilogo } from "@/lib/portali/campagne/tipi"

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))

const riga = (codice: string, over: Partial<RigaAnalisi> = {}): RigaAnalisi => ({
  codice_cliente: codice,
  ragione_sociale: `Cliente ${codice}`,
  agente_nome: "AIRFLUID",
  data_invio: "2026-01-23",
  prima_tot: 1000,
  dopo_tot: 1500,
  prima_prom: null,
  dopo_prom: null,
  mai_prima_prom: null,
  prima_completa: true,
  dopo_completa: true,
  ...over,
})

describe("riassumi", () => {
  it("confronta solo i clienti con entrambe le finestre complete", () => {
    const r = riassumi(
      [
        riga("A", { prima_tot: 1000, dopo_tot: 1500 }),
        riga("B", { prima_tot: 500, dopo_tot: 100 }),
        // busta di un mese fa: il «dopo» e' parziale, non deve far sembrare un calo
        riga("C", { prima_tot: 800, dopo_tot: 0, dopo_completa: false }),
        // storico troppo corto prima
        riga("D", { prima_tot: 0, dopo_tot: 900, prima_completa: false }),
      ],
      6,
      false
    )
    expect(r.ricevuti).toBe(4)
    expect(r.confrontabili).toBe(2)
    expect(r.prima).toBe(1500)
    expect(r.dopo).toBe(1600)
    expect(r.variazione).toBeCloseTo(100 / 1500)
    expect(r.in_aumento).toBe(1)
    expect(r.in_calo).toBe(1)
    expect(r.senza_dopo).toBe(1)
    expect(r.senza_prima).toBe(1)
    expect(r.promossi).toBeNull()
  })

  it("variazione assente se prima vale zero, nessuna divisione per zero", () => {
    const r = riassumi([riga("A", { prima_tot: 0, dopo_tot: 300 })], 6, false)
    expect(r.variazione).toBeNull()
    expect(r.in_aumento).toBe(1)
  })

  it("invariati contati a parte", () => {
    const r = riassumi([riga("A", { prima_tot: 100, dopo_tot: 100 })], 3, false)
    expect(r.invariati).toBe(1)
    expect(r.in_aumento + r.in_calo).toBe(0)
  })

  it("promossi: i nuovi acquirenti si contano su chi ha il «dopo» completo, anche se il «prima» non lo e'", () => {
    const r = riassumi(
      [
        // mai comprati prima, ora si': nuovo
        riga("A", { prima_prom: 0, dopo_prom: 400, mai_prima_prom: true }),
        // li comprava gia': non e' nuovo
        riga("B", { prima_prom: 200, dopo_prom: 300, mai_prima_prom: false }),
        // nessun promosso ne' prima ne' dopo
        riga("C", { prima_prom: 0, dopo_prom: 0, mai_prima_prom: true }),
        // «prima» incompleto ma «dopo» completo e mai comprati: nuovo comunque
        riga("D", { prima_prom: 0, dopo_prom: 90, mai_prima_prom: true, prima_completa: false }),
        // «dopo» incompleto: fuori da tutto cio' che riguarda il «dopo»
        riga("E", { prima_prom: 0, dopo_prom: 50, mai_prima_prom: true, dopo_completa: false }),
      ],
      6,
      true
    )
    expect(r.promossi).not.toBeNull()
    expect(r.promossi!.nuovi_acquirenti).toBe(2)
    expect(r.promossi!.mai_acquistato_prima).toBe(3)
    expect(r.promossi!.con_dopo_completa).toBe(4)
    // valori in euro solo sui confrontabili (A, B, C)
    expect(r.promossi!.prima).toBe(200)
    expect(r.promossi!.dopo).toBe(700)
    expect(r.promossi!.acquirenti_dopo).toBe(2)
  })

  it("nessun cliente: niente NaN", () => {
    const r = riassumi([], 6, true)
    expect(r.ricevuti).toBe(0)
    expect(r.variazione).toBeNull()
    expect(r.promossi!.nuovi_acquirenti).toBe(0)
  })
})

describe("ordina e parametri", () => {
  const righe = [
    riga("A", { prima_tot: 100, dopo_tot: 150 }),
    riga("B", { prima_tot: 100, dopo_tot: 900 }),
    riga("C", { prima_tot: 500, dopo_tot: 10 }),
    riga("X", { prima_tot: 0, dopo_tot: 99999, dopo_completa: false }),
  ]
  it("più cresciuti: prima i confrontabili, per differenza", () => {
    expect(ordina(righe, "aumento").map((r) => r.codice_cliente)).toEqual(["B", "A", "C", "X"])
  })
  it("più calati", () => {
    expect(ordina(righe, "calo").map((r) => r.codice_cliente)).toEqual(["C", "A", "B", "X"])
  })
  it("per nome lascia l'ordine del database e non modifica l'originale", () => {
    const copia = [...righe]
    expect(ordina(righe, "nome").map((r) => r.codice_cliente)).toEqual(["A", "B", "C", "X"])
    expect(righe).toEqual(copia)
  })
  it("finestre e ordini sconosciuti tornano al valore sicuro", () => {
    expect(finestraValida("12")).toBe(12)
    expect(finestraValida("7")).toBe(6)
    expect(finestraValida(undefined)).toBe(6)
    expect(ordineValido("calo")).toBe("calo")
    expect(ordineValido("'; drop")).toBe("nome")
  })
  it("il motivo dell'esclusione dice quale finestra manca", () => {
    expect(motivoEsclusione(riga("A"), 6)).toBeNull()
    expect(confrontabile(riga("A"))).toBe(true)
    expect(motivoEsclusione(riga("A", { dopo_completa: false }), 6)).toMatch(/meno di 6 mesi dall'invio/)
    expect(motivoEsclusione(riga("A", { prima_completa: false }), 6)).toMatch(/disponibile da meno di 6 mesi/)
    expect(motivoEsclusione(riga("A", { prima_completa: false, dopo_completa: false }), 6)).toMatch(/troppo corto/)
  })
})

const campagna = (over: Partial<CampagnaRiepilogo> = {}): CampagnaRiepilogo => ({
  id: "00000000-0000-4000-8000-000000000001",
  codice: "C_01_26",
  nome: "CP SICS",
  note: null,
  articolo_codice: "DOCUMENTAZIONE",
  testo_riconoscimento: [],
  marchio: null,
  articoli_promossi: [],
  stato: "attiva",
  ordine: 1,
  stato_cambiato_il: "2026-10-01T08:00:00Z",
  created_at: "2026-10-01T08:00:00Z",
  destinatari: 100,
  preparate: 0,
  da_spedire: 0,
  consegnate: 2,
  consegnate_banco: 0,
  ...over,
})

const analisi = (righe: RigaAnalisi[], over: Partial<AnalisiCampagna> = {}): AnalisiCampagna => {
  const c = over.campagna ?? campagna()
  return {
    campagna: c,
    storico: { dal: "2025-01-13", al: "2026-09-30" },
    mesi: 6,
    righe,
    confronto: [3, 6, 12].map((m) => riassumi(righe, m, c.articoli_promossi.length > 0)),
    ...over,
  }
}

describe("AnalisiView", () => {
  it("senza clienti dice cosa manca invece di mostrare tabelle vuote", () => {
    render(<AnalisiView analisi={analisi([])} ordine="nome" />)
    expect(screen.getByText(/Nessun cliente ha ancora ricevuto/)).toBeTruthy()
  })

  it("senza articoli promossi lo dice e rimanda alla scheda, e non mostra la colonna dei promossi", () => {
    render(<AnalisiView analisi={analisi([riga("A")])} ordine="nome" />)
    const avviso = screen.getByText(/non sono indicati gli/).closest("div") as HTMLElement
    expect(within(avviso).getByRole("link", { name: /Indicali/ }).getAttribute("href")).toBe(
      "/campagne/gestione/00000000-0000-4000-8000-000000000001"
    )
    expect(screen.queryByText(/Promossi prima/)).toBeNull()
  })

  it("con gli articoli promossi mostra la colonna e il badge «nuovo»", () => {
    const c = campagna({ articoli_promossi: ["AFD.00.*"] })
    render(
      <AnalisiView
        analisi={analisi([riga("A", { prima_prom: 0, dopo_prom: 400, mai_prima_prom: true })], { campagna: c })}
        ordine="nome"
      />
    )
    expect(screen.getByText(/Promossi prima/)).toBeTruthy()
    expect(screen.getByText("nuovo")).toBeTruthy()
    expect(screen.queryByText(/non sono indicati gli/)).toBeNull()
  })

  it("un cliente col «dopo» incompleto non e' contato come calo ma spiegato", () => {
    render(
      <AnalisiView
        analisi={analisi([riga("A", { prima_tot: 800, dopo_tot: 0, dopo_completa: false }), riga("B")])}
        ordine="nome"
      />
    )
    expect(screen.getByText(/meno di 6 mesi dall'invio/)).toBeTruthy()
    // una sola riga e' confrontabile
    const confronto = screen.getByText("Clienti confrontati").closest("tr") as HTMLElement
    expect(within(confronto).getAllByRole("cell").slice(1).map((c) => c.textContent?.replace(/\s+/g, " ").trim())).toEqual(["1 / 2", "1 / 2", "1 / 2"])
  })

  it("se nessuno e' confrontabile suggerisce una finestra piu' corta", () => {
    render(
      <AnalisiView analisi={analisi([riga("A", { dopo_completa: false }), riga("B", { dopo_completa: false })])} ordine="nome" />
    )
    expect(screen.getByText(/Prova una finestra più corta/)).toBeTruthy()
  })

  it("dice da quando parte il fatturato", () => {
    render(<AnalisiView analisi={analisi([riga("A")])} ordine="nome" />)
    expect(screen.getByText("13/01/2025")).toBeTruthy()
  })
})

describe("SceltaCampagnaEFinestra", () => {
  it("i link tengono campagna, finestra e ordine", () => {
    render(
      <SceltaCampagnaEFinestra
        campagne={[campagna(), campagna({ id: "00000000-0000-4000-8000-000000000002", codice: "C_02_26", nome: "ZECA" })]}
        scelta="00000000-0000-4000-8000-000000000001"
        mesi={6}
        ordine="calo"
      />
    )
    expect(screen.getByRole("link", { name: /C_02_26/ }).getAttribute("href")).toBe(
      "/campagne/analisi?campagna=00000000-0000-4000-8000-000000000002&mesi=6&ordine=calo"
    )
    expect(screen.getByRole("link", { name: /12 mesi/ }).getAttribute("href")).toBe(
      "/campagne/analisi?campagna=00000000-0000-4000-8000-000000000001&mesi=12&ordine=calo"
    )
  })
})
