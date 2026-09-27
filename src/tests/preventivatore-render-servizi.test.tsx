import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { ServiziConfig } from "@/components/portali/preventivatore/servizi-config"
import { installaFetchFinta, preparaDomTest, registraResilienzaFetch } from "./helpers/fetch-finta"

describe("render Servizi", () => {
  beforeEach(preparaDomTest)
  it("disegna valori numerici e booleani della route", async () => {
    installaFetchFinta([{ url: "/api/portali/preventivatore/servizi?all=1", risposta: [{ id: "s1", nome: "Montaggio", categoria: "Manodopera", tariffa_ora: 52.5, unita: "h", ordine: 1, is_attivo: true }] }])
    render(<ServiziConfig />)
    expect(await screen.findByDisplayValue("Montaggio")).toBeInTheDocument()
    expect(screen.queryByText("Impossibile caricare i servizi.")).not.toBeInTheDocument()
  })
  registraResilienzaFetch("Servizi", () => <ServiziConfig />)
})
