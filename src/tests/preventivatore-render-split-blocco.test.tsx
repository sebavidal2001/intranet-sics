import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { BloccoCard } from "@/components/portali/preventivatore/blocco-card"
import { applicaStandard, normalizzaSplit } from "@/components/portali/preventivatore/split-builder"
import type { Blocco } from "@/components/portali/preventivatore/nuovo-view-types"
import { installaFetchFinta, preparaDomTest } from "./helpers/fetch-finta"

const RULLO = { costo_totale: 40, materiale: 18, manodopera: 21.2, lavorazione: 0, lav_esterna: 0.8, altro: 0 }

function bloccoSplittato(): Blocco {
  const base: Blocco = {
    _key: "b1", tipo: "Altro", nome: "B1", note: "", espanso: true, quantita_pezzi: 3, margine_trattativa_pct: null,
    articoli: [{ _key: "a1", prodotto_id: "", codice: "AFD.00.2.00019.0", descrizione: "Rullo folle", ult_costo: 37.5, qty: 2, coeff_ricarico: 0.5 }],
    servizi: [{ _key: "m1", servizio_id: "1", nome: "Saldatura", categoria: "Manodopera", tariffa_ora: 40, ore: 2, coeff_ricarico: 0.5, scala_con_quantita: true }],
  }
  const mappa = new Map([["AFD.00.2.00019.0", RULLO]])
  return normalizzaSplit([{ ...base, articoli: base.articoli.map((a) => applicaStandard(a, RULLO)) }], mappa)?.[0] ?? { ...base, articoli: base.articoli.map((a) => applicaStandard(a, RULLO)) }
}

describe("render BloccoCard con split", () => {
  beforeEach(preparaDomTest)

  it("separa i costi da distinta dalle lavorazioni scelte a mano", () => {
    installaFetchFinta([{ url: /./, risposta: {} }])
    render(<BloccoCard blocco={bloccoSplittato()} indice={0} serviziDB={[]} onChange={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.getByText("Costi da distinta")).toBeInTheDocument()
    expect(screen.getByText("Manodopera da distinta")).toBeInTheDocument()
    expect(screen.getByText("Trattamenti esterni da distinta")).toBeInTheDocument()
    // La lavorazione manuale resta nella sua sezione, una volta sola.
    expect(screen.getAllByText("Saldatura")).toHaveLength(1)
  })

  it("mostra la composizione solo al passaggio del mouse sull'icona dell'articolo", () => {
    installaFetchFinta([{ url: /./, risposta: {} }])
    render(<BloccoCard blocco={bloccoSplittato()} indice={0} serviziDB={[]} onChange={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByLabelText("Composizione del costo dell'articolo"))
    const tip = screen.getByRole("tooltip")
    expect(tip).toHaveTextContent("Materia prima")
    expect(tip).toHaveTextContent("Manodopera")
    expect(tip).toHaveTextContent("Trattamenti esterni")
    fireEvent.mouseLeave(screen.getByLabelText("Composizione del costo dell'articolo"))
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  })

  it("non propone l'icona per un articolo senza split", () => {
    installaFetchFinta([{ url: /./, risposta: {} }])
    const b = bloccoSplittato()
    render(<BloccoCard blocco={{ ...b, articoli: [{ ...b.articoli[0], split: null }], servizi: [] }} indice={0} serviziDB={[]} onChange={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByLabelText("Composizione del costo dell'articolo")).not.toBeInTheDocument()
    expect(screen.queryByText("Costi da distinta")).not.toBeInTheDocument()
  })
})
