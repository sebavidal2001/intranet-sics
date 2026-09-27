import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ImpostazioniView } from "@/components/portali/preventivatore/impostazioni-view"
import { installaFetchFinta, preparaDomTest, registraResilienzaFetch } from "./helpers/fetch-finta"

vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const rotte = [
  { url: "/api/portali/preventivatore/config", risposta: [{ id: "c1", chiave: "max_chunks_per_query", valore: "8" }] },
  { url: "/api/portali/preventivatore/documenti?stats=true", risposta: { totale: 9, aperta: 2, completato: 3, storico: 4, total_chunks: 12 } },
  { url: "/api/portali/preventivatore/config/models", risposta: { models: [{ id: "openai/gpt", name: "GPT", context_length: null, input_cost_per_million: null, output_cost_per_million: null, tags: [], description: "" }] } },
  { url: "/api/portali/preventivatore/listini", risposta: { listini: [] } },
  { url: "/api/portali/preventivatore/servizi?all=1", risposta: [] },
]

describe("render Impostazioni Preventivatore", () => {
  beforeEach(preparaDomTest)
  it("disegna configurazione e statistiche reali", async () => {
    installaFetchFinta(rotte)
    render(<ImpostazioniView />)
    expect(await screen.findByText("Statistiche Documenti")).toBeInTheDocument()
    expect(await screen.findByText("Archivio storico")).toBeInTheDocument()
    expect(screen.queryByText("Impossibile caricare le statistiche.")).not.toBeInTheDocument()
  })
  registraResilienzaFetch("Impostazioni", () => <ImpostazioniView />)
})
