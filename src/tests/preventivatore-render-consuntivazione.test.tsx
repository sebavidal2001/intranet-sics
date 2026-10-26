import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { ConsuntivazioneView } from "@/components/portali/preventivatore/consuntivazione-view"
import { installaFetchFinta, preparaDomTest, registraResilienzaFetch } from "./helpers/fetch-finta"

const consuntivo = {
  id: "11111111-1111-1111-1111-111111111111",
  codice_articolo: "AFD.00.2.00019.0",
  descrizione: "RULLO FOLLE Ø50 L=115",
  documento_id: "22222222-2222-2222-2222-222222222222",
  documento_codice: "G_26_014",
  ambito: "blocchi",
  quantita_articolo: 3,
  stato: "aperto",
  note: null,
  prev_materiale: 216, prev_manodopera: 210, prev_lavorazione: 0, prev_lav_esterna: 30, prev_altro: 0, prev_totale: 456,
  rif_tipo: "S", rif_data: "2026-10-25T22:41:10Z",
  rif_materiale: 60, rif_manodopera: 30, rif_lavorazione: 0, rif_lav_esterna: 10, rif_altro: 0, rif_totale: 100,
  created_at: "2026-10-26T10:00:00Z",
}

describe("render Consuntivazione", () => {
  beforeEach(preparaDomTest)

  it("disegna una lista vuota con l'invito a crearne uno", async () => {
    installaFetchFinta([{ url: /\/api\/portali\/preventivatore\/consuntivi\?/, risposta: { consuntivi: [] } }])
    render(<ConsuntivazioneView />)
    expect(await screen.findByText(/Nessun consuntivo ancora/)).toBeInTheDocument()
  })

  it("mostra l'esito del confronto per ogni consuntivo e apre il dettaglio", async () => {
    installaFetchFinta([
      { url: /\/api\/portali\/preventivatore\/consuntivi\?/, risposta: { consuntivi: [consuntivo] } },
      {
        url: `/api/portali/preventivatore/consuntivi/${consuntivo.id}`,
        risposta: { consuntivo, righe: [] },
      },
    ])
    render(<ConsuntivazioneView />)
    // 456 € su 3 pezzi = 152 €/pz preventivati contro 100 € di standard: preventivo prudente.
    const riga = await screen.findByText("AFD.00.2.00019.0")
    expect(screen.getByText("Sovrastimato")).toBeInTheDocument()
    fireEvent.click(riga)
    expect(await screen.findByText(/Mostra le 0 righe del preventivato/)).toBeInTheDocument()
    expect(screen.getAllByText("Materia prima").length).toBeGreaterThan(0)
    expect(screen.getAllByText(/G_26_014/).length).toBeGreaterThan(1)
  })

  registraResilienzaFetch("Consuntivazione", () => <ConsuntivazioneView />)
})
