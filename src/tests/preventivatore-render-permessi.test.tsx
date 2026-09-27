import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { PreventivatorePermessiUtente } from "@/components/superadmin/preventivatore-permessi-utente"
import { installaFetchFinta, preparaDomTest, registraResilienzaFetch } from "./helpers/fetch-finta"

describe("render Permessi utente Preventivatore", () => {
  beforeEach(preparaDomTest)
  it("disegna ruoli e agente nullable della route", async () => {
    installaFetchFinta([{ url: /\/api\/superadmin\/preventivatore\/permessi-utente\//, risposta: { ruoli_slug: ["preventivatore"], agente_codice: null } }])
    render(<PreventivatorePermessiUtente utenteId="00000000-0000-0000-0000-000000000001" />)
    expect(await screen.findByText("Ruoli funzionali Preventivatore")).toBeInTheDocument()
    expect(screen.getByLabelText(/Preventivatore/)).toBeChecked()
  })
  registraResilienzaFetch("Permessi", () => <PreventivatorePermessiUtente utenteId="00000000-0000-0000-0000-000000000001" />)
})
