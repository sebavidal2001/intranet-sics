import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DashboardView } from "@/components/portali/preventivatore/dashboard-view"
import { installaFetchFinta, preparaDomTest, registraResilienzaFetch } from "./helpers/fetch-finta"

vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

const dashboard = {
  window_months: 12,
  kpi: { tot_preventivi: 7, tot_preventivi_delta: null, valore_totale: 12500, valore_totale_delta: null, importo_medio: 1785.71, importo_medio_delta: null, clienti_attivi: 2, clienti_attivi_delta: null, tot_definitivi: 3, tot_bozze: 4 },
  top_clienti: [{ cliente: "ACME S.p.A.", preventivi: 2, valore: 4500, ordinati: 0 }],
  serie_mensile: [{ mese: "2026-09-01", preventivi: 2, valore: 4500, ordinati: 0, categorie: [] }],
  top_articoli: [{ codice: "ART-1", descrizione: "Rullo", occorrenze: 2, qta: 4, valore: 900 }],
  attivita_recente: [{ id: "d1", codice: "P-001", cliente: "ACME S.p.A.", stato: "aperta", tipo: "generato", importo: 4500, data_offerta: null, created_at: "2026-09-27T08:00:00.000Z" }],
  ai: { spesa_mese_corrente: null, currency: "usd" },
}

describe("render Dashboard Preventivatore", () => {
  beforeEach(preparaDomTest)
  it("disegna la risposta reale e tollera valori null", async () => {
    installaFetchFinta([{ url: "/api/portali/preventivatore/dashboard", risposta: dashboard }])
    render(<DashboardView />)
    expect(await screen.findAllByText("ACME S.p.A.")).not.toHaveLength(0)
    expect(screen.queryByText("Errore caricamento")).not.toBeInTheDocument()
  })
  registraResilienzaFetch("Dashboard", () => <DashboardView />)
})
