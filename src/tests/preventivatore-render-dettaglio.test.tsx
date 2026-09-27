import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { DettaglioPreventivoView } from "@/components/portali/preventivatore/dettaglio-view"
import type { PreventivoDettaglio } from "@/components/portali/preventivatore/dettaglio-view-types"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("next/link", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
vi.mock("next/dynamic", () => ({ default: () => () => null }))

function dettaglio(tipo: "generato" | "storico"): PreventivoDettaglio {
  return {
    documento: { id: `doc-${tipo}`, codice: tipo === "generato" ? "G-101" : "S-202", cliente: "ACME S.p.A.", cliente_master_id: null, tipo, categoria: "nastri", tipo_prodotto: "Nastro", anno: 2026, stato: tipo === "generato" ? "aperta" : "storico", motivo_rifiuto_id: null, stato_note: null, numero_offerta: "OFF-1", data_offerta: null, importo_preventivo: tipo === "generato" ? "1250.50" : null, importo_ordinato: null, importo_finale_raw: null, importo_source: null, codici_articolo: [], tags: [], note: "", versione_ingest: null, consegna_settimane_min: null, consegna_settimane_max: null, margine_trattativa_pct: null, tempo_preventivazione_sec: null, created_at: "2026-09-27T08:00:00.000Z", updated_at: "2026-09-27T08:00:00.000Z" },
    chunks: tipo === "storico" ? [{ id: "c1", chunk_index: 0, contenuto: "Descrizione offerta storica", metadata: { source_type: "word", ruolo_file: "preventivo_commerciale" } }] : [],
    righe_distinta: tipo === "generato" ? [{ id: "r1", sheet_name: "builder", codice_articolo: "ART-1", descrizione: "Rullo", quantita: "2", prezzo_unitario: "100", ricarico_pct: "1.2", ricarico_coefficiente: "1.2", tipo_riga: "materiale", scala_con_quantita: null, totale_riga: "240", codice_blocco: "Nastro 1" }] : [],
    blocchi: tipo === "generato" ? [{ id: "b1", codice_blocco: "Nastro 1", sheet_name: "builder", totale_ceil_2: "240", note: "", incluso_offerta: true, created_at: "2026-09-27T08:00:00.000Z", quantita_pezzi: 1, imballaggio_pct: null, tempi_accessori_pct: null, spese_generali_pct: null, margine_trattativa_pct: null, costo_complessivo: null }] : [],
    motivo_rifiuto_label: null,
    puo_modificare: true,
  }
}

describe("render Dettaglio Preventivo", () => {
  it("disegna un documento generato con numeri stringa e null", () => {
    render(<DettaglioPreventivoView dettaglio={dettaglio("generato")} />)
    expect(screen.getAllByText("G-101")).not.toHaveLength(0)
    expect(screen.getByText("Rullo")).toBeInTheDocument()
  })
  it("disegna un documento storico con liste limite", () => {
    render(<DettaglioPreventivoView dettaglio={dettaglio("storico")} />)
    expect(screen.getAllByText("S-202")).not.toHaveLength(0)
    expect(screen.queryByText(/^Crash:/)).not.toBeInTheDocument()
  })
})
