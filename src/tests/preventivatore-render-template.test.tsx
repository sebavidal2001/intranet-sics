import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { TemplateManager } from "@/components/portali/preventivatore/template-manager"
import { installaFetchFinta, preparaDomTest, registraResilienzaFetch } from "./helpers/fetch-finta"

describe("render Template manager", () => {
  beforeEach(preparaDomTest)
  it("disegna la lista vuota restituita dalla route", async () => {
    installaFetchFinta([{ url: "/api/portali/preventivatore/template?all=1", risposta: [] }])
    render(<TemplateManager />)
    expect(await screen.findByText("Nessun template")).toBeInTheDocument()
    expect(screen.queryByText(/^Errore/)).not.toBeInTheDocument()
  })
  registraResilienzaFetch("Template", () => <TemplateManager />)
})
