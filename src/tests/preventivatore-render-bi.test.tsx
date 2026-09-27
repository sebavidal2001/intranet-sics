import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { BiDashboardView } from "@/components/portali/preventivatore/bi-dashboard-view"
import { installaFetchFinta, preparaDomTest, registraResilienzaFetch } from "./helpers/fetch-finta"

const config = { version: 1 as const, filters: [], widgets: [{ id: "k1", title: "Totale offerte", type: "kpi" as const, dataset: "documenti" as const, x: 0, y: 0, w: 3, h: 2, metric: { op: "count" as const, label: "Preventivi" } }] }

describe("render BI Preventivatore", () => {
  beforeEach(preparaDomTest)
  it("disegna dashboard, filtri e risultati nella forma delle route", async () => {
    installaFetchFinta([
      { url: "/api/portali/preventivatore/bi/filters-options", risposta: { anni: [2026], clienti: ["ACME"], categorie: [] } },
      { url: "/api/portali/preventivatore/bi?scope=user", risposta: { dashboard: { id: "b1", scope: "user", user_id: "u1", title: "La mia dashboard", config, updated_at: "2026-09-27T08:00:00.000Z" } } },
      { url: "/api/portali/preventivatore/bi/data", metodo: "POST", risposta: { results: [{ widget_id: "k1", data: [{ label: "Totale", value: 7 }], total: 7 }], meta: { datasets: { documenti: { total_in_db: 7, truncated: false, limit: 50000 } }, rejected: [] } } },
    ])
    render(<BiDashboardView />)
    expect(await screen.findByText("Totale offerte")).toBeInTheDocument()
    expect(screen.queryByText(/^Errore/)).not.toBeInTheDocument()
  })
  registraResilienzaFetch("BI", () => <BiDashboardView />)
})
