import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { ListiniFornitore } from "@/components/portali/preventivatore/listini-fornitore"
import { installaFetchFinta, preparaDomTest, registraResilienzaFetch } from "./helpers/fetch-finta"

describe("render Listini fornitore", () => {
  beforeEach(preparaDomTest)
  it("disegna anche una lista vuota", async () => {
    installaFetchFinta([{ url: "/api/portali/preventivatore/listini", risposta: { listini: [] } }])
    render(<ListiniFornitore />)
    expect(await screen.findByText(/Nessun listino caricato/)).toBeInTheDocument()
    expect(screen.queryByText(/^Errore/)).not.toBeInTheDocument()
  })
  registraResilienzaFetch("Listini", () => <ListiniFornitore />)
})
