import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { AvvisoAnagrafica } from "@/components/portali/campagne/avviso-anagrafica"
import type { StatoAnagraficaClienti } from "@/lib/portali/campagne/impresa"

const stato = (over: Partial<StatoAnagraficaClienti> = {}): StatoAnagraficaClienti => ({
  stato: "attenzione",
  motivi: ["ultimo aggiornamento 40 ore fa"],
  ultimo_aggiornamento: "2026-10-05T01:30:00Z",
  ore_dall_aggiornamento: 40,
  clienti: 7282,
  falliti_48h: 0,
  ultimo_errore: null,
  ...over,
})

describe("AvvisoAnagrafica", () => {
  it("con lo stato ok non compare", () => {
    const { container } = render(<AvvisoAnagrafica stato={stato({ stato: "ok", motivi: [] })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("con lo stato sconosciuto (funzione assente, lettura fallita) non compare", () => {
    const { container } = render(<AvvisoAnagrafica stato={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("in attenzione avvisa che l'elenco clienti non si aggiorna e da quando", () => {
    render(<AvvisoAnagrafica stato={stato()} />)
    const barra = screen.getByRole("status")
    expect(barra).toHaveTextContent("non si aggiorna dal")
    expect(barra).toHaveTextContent("clienti nuovi o modificati")
    expect(barra.className).toContain("amber")
  })

  it("in critico e' rossa e riporta l'ultimo errore", () => {
    render(<AvvisoAnagrafica stato={stato({ stato: "critico", ultimo_errore: "file_troppo_piccolo" })} />)
    const barra = screen.getByRole("status")
    expect(barra.className).toContain("red")
    expect(barra).toHaveTextContent("Ultimo errore: file_troppo_piccolo")
  })

  it("se non c'e' mai stato un caricamento lo dice", () => {
    render(<AvvisoAnagrafica stato={stato({ stato: "critico", ultimo_aggiornamento: null, ore_dall_aggiornamento: null })} />)
    expect(screen.getByRole("status")).toHaveTextContent("non è ancora stato caricato da Impresa")
  })
})
