import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ArchivioView } from "@/components/portali/preventivatore/archivio-view"
import { installaFetchFinta, preparaDomTest, registraResilienzaFetch } from "./helpers/fetch-finta"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("next/dynamic", () => ({ default: () => () => <div data-testid="chat-archivio" /> }))

describe("render Archivio Preventivatore", () => {
  beforeEach(preparaDomTest)
  it("mostra un documento con numeri serializzati come stringhe", async () => {
    installaFetchFinta([
      { url: "/api/portali/preventivatore/documenti/clienti", risposta: ["ACME S.p.A."] },
      { url: /\/api\/portali\/preventivatore\/documenti\?/, risposta: { items: [{ id: "d1", codice: "P-001", cliente: "ACME S.p.A.", stato: "aperta", categoria: "nastri", tipo: "generato", numero_offerta: "O-1", data_offerta: null, importo_preventivo: "4500.00", importo_ordinato: null, created_at: "2026-09-27T08:00:00.000Z" }], total: 1, page: 1, limit: 20, total_pages: 1, sort: "created_at", dir: "desc" } },
    ])
    render(<ArchivioView />)
    expect(await screen.findByText("P-001")).toBeInTheDocument()
    expect(screen.queryByText(/^Errore/)).not.toBeInTheDocument()
  })
  registraResilienzaFetch("Archivio", () => <ArchivioView />)
})
