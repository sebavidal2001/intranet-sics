import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NuovoView } from "@/components/portali/preventivatore/nuovo-view"
import { installaFetchErrore, installaFetchFinta, installaFetchRete, preparaDomTest } from "./helpers/fetch-finta"

let query = ""
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(query),
}))
vi.mock("next/dynamic", () => ({ default: () => () => null }))

const documento = { documento: { codice: "G-77", tempo_preventivazione_sec: 15, updated_at: "2026-09-27T08:00:00.000Z" }, titolo: "Linea prova", cliente: null, note: "", margine_trattativa_pct: null, consegna_settimane_min: null, consegna_settimane_max: null, blocchi: [] }
const base = { ...documento, avvisi: { articoli_aggiornati: 0, servizi_aggiornati: 0, articoli_non_trovati: 0 } }

function vista() { return <NuovoView serviziIniziali={[]} templateIniziali={[]} /> }

describe("render Nuovo Preventivo", () => {
  beforeEach(() => { query = ""; preparaDomTest(); localStorage.clear() })
  it("disegna la creazione vuota", () => {
    render(vista())
    expect(screen.getByRole("heading", { name: "Nuovo Preventivo" })).toBeInTheDocument()
  })
  it("disegna la modifica con la risposta della route", async () => {
    query = "edit=doc-1"
    installaFetchFinta([{ url: "/api/portali/preventivatore/documenti/doc-1", risposta: documento }])
    render(vista())
    expect(await screen.findByRole("heading", { name: "Modifica preventivo G-77" })).toBeInTheDocument()
  })
  it("disegna la duplicazione da base", async () => {
    query = "base=doc-1"
    installaFetchFinta([{ url: "/api/portali/preventivatore/documenti/doc-1/duplica", risposta: base }])
    render(vista())
    expect(await screen.findByText(/Nessun prezzo è cambiato/)).toBeInTheDocument()
  })
  it.each(["500", "rete"])("resta utilizzabile in modifica con errore %s", async (caso) => {
    query = "edit=doc-1"
    caso === "500" ? installaFetchErrore() : installaFetchRete()
    render(vista())
    expect(await screen.findByText(caso === "500" ? "x" : "rete non disponibile")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Modifica preventivo" })).toBeInTheDocument()
  })
})
