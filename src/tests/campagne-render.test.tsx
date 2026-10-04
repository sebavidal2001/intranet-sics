import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { SchedaClienteView } from "@/components/portali/campagne/scheda-cliente-view"
import { RicercaCliente } from "@/components/portali/campagne/ricerca-cliente"
import type { Campagna, Invio, SchedaCliente } from "@/lib/portali/campagne/tipi"
import { installaFetchFinta, preparaDomTest } from "./helpers/fetch-finta"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))

const campagna = (n: number, over: Partial<Campagna> = {}): Campagna => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  codice: `C_0${n}_26`,
  nome: ["CP SICS", "ZECA ZETEK", "AIGNEP"][n - 1],
  note: null,
  articolo_codice: "DOCUMENTAZIONE",
  testo_riconoscimento: [],
  riferimento: null,
  stato: "attiva",
  ordine: n,
  stato_cambiato_il: "2026-10-01T08:00:00Z",
  created_at: "2026-10-01T08:00:00Z",
  pubblico_id: "5b4d0e3a-7f6c-4a8d-9c9e-3f4a5b6c7d8e",
  pubblico: { nome: "Standard", standard: true },
  destinatari_automatici: false,
  ...over,
})

const invio = (over: Partial<Invio> = {}): Invio => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  campagna_id: campagna(1).id,
  codice_cliente: "05000002",
  ragione_sociale: "POLETTI srl",
  stato: "preparata",
  referente: "Mario Rossi",
  ordine_numero: "1117",
  ordine_anno: 2026,
  assegnata_il: "2026-10-02T09:30:00Z",
  data_consegna: null,
  consegna_registrata_il: null,
  fonte_consegna: null,
  origine: "app",
  note: null,
  annullata_il: null,
  motivo_annullo: null,
  assegnata_da_nome: null,
  consegna_registrata_da_nome: null,
  campagna: { codice: "C_01_26", nome: "CP SICS" },
  ordine_profilo: null,
  ordine_data: null,
  ordine_data_consegna: null,
  riga_vista_il: null,
  ddt_numero: null,
  ddt_metodo: null,
  ultimo_controllo_il: null,
  controllo_esito: null,
  ...over,
})

const scheda = (over: Partial<SchedaCliente> = {}): SchedaCliente => ({
  cliente: {
    codice_cliente: "05000002",
    ragione_sociale: "POLETTI srl",
    agente_nome: "AIRFLUID",
    cat_commerciale: "Attivo",
    cat_attivita: "COSTRU-COSTR.MACCH.UTENSILI",
    rivenditore: false,
  },
  invii: [],
  assegnabili: [campagna(1), campagna(2)],
  ordini_aperti: [],
  anomalie: [],
  ...over,
})

const vista = (s: SchedaCliente) => render(<SchedaClienteView scheda={s} annoCorrente={2026} oggi="2026-10-03" />)

describe("scheda cliente", () => {
  beforeEach(() => {
    preparaDomTest()
    refresh.mockClear()
  })

  it("suggerisce la campagna più vecchia e offre le altre", () => {
    vista(scheda())
    expect(screen.getByText(/Preparare C_01_26 · CP SICS/)).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /C_01_26 · CP SICS \(suggerita\)/ })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: /C_02_26 · ZECA ZETEK/ })).toBeInTheDocument()
  })

  it("«Busta preparata» resta spenta finché mancano referente e ordine", () => {
    vista(scheda())
    const bottone = screen.getByRole("button", { name: /Busta preparata/ })
    expect(bottone).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText("Nome e cognome"), { target: { value: "Mario Rossi" } })
    expect(bottone).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText("es. 1117"), { target: { value: "1117" } })
    expect(bottone).toBeEnabled()
  })

  it("invia la busta con i dati inseriti e ricarica la pagina", async () => {
    const fetchFinto = installaFetchFinta([
      { url: "/api/portali/campagne/invii", metodo: "POST", risposta: { invio: invio() }, status: 201 },
    ])
    vista(scheda())
    fireEvent.change(screen.getByPlaceholderText("Nome e cognome"), { target: { value: "Mario Rossi" } })
    fireEvent.change(screen.getByPlaceholderText("es. 1117"), { target: { value: "1117" } })
    fireEvent.click(screen.getByRole("button", { name: /Busta preparata/ }))

    await waitFor(() => expect(refresh).toHaveBeenCalled())
    const corpo = JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))
    expect(corpo).toEqual({
      tipo: "ordine",
      codice_cliente: "05000002",
      campagna_id: campagna(1).id,
      referente: "Mario Rossi",
      ordine_numero: "1117",
      ordine_anno: 2026,
    })
    expect(await screen.findByText(/Busta C_01_26 preparata/)).toBeInTheDocument()
  })

  it("mostra all'operatrice il messaggio del server quando l'ordine è già usato", async () => {
    installaFetchFinta([
      {
        url: "/api/portali/campagne/invii",
        metodo: "POST",
        risposta: { error: "Su questo ordine c'è già una campagna: ogni ordine ne porta una sola." },
        status: 409,
      },
    ])
    vista(scheda())
    fireEvent.change(screen.getByPlaceholderText("Nome e cognome"), { target: { value: "Mario Rossi" } })
    fireEvent.change(screen.getByPlaceholderText("es. 1117"), { target: { value: "1117" } })
    fireEvent.click(screen.getByRole("button", { name: /Busta preparata/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("ogni ordine ne porta una sola")
    expect(refresh).not.toHaveBeenCalled()
  })

  it("senza campagne assegnabili dice che non c'è nulla da fare", () => {
    vista(scheda({ assegnabili: [], invii: [invio({ stato: "consegnata", data_consegna: "2026-04-15", fonte_consegna: "ddt" })] }))
    expect(screen.getByText("Nulla da fare")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Busta preparata/ })).not.toBeInTheDocument()
  })

  it("mostra le azioni giuste per ogni stato dello storico", () => {
    vista(
      scheda({
        assegnabili: [],
        invii: [
          invio({ id: "i1", stato: "preparata" }),
          invio({ id: "i2", stato: "consegnata", data_consegna: "2026-04-15", fonte_consegna: "ddt", campagna: { codice: "C_02_26", nome: "ZECA ZETEK" } }),
          invio({ id: "i3", stato: "annullata", motivo_annullo: "errore", campagna: { codice: "C_03_26", nome: "AIGNEP" } }),
        ],
      })
    )
    // Solo la busta in lavorazione ha pulsanti; la consegna da DDT e l'annullata no.
    expect(screen.getAllByRole("button", { name: "Annulla invio" })).toHaveLength(1)
    expect(screen.getAllByRole("button", { name: "Segna consegnata" })).toHaveLength(1)
    expect(screen.getByText("Consegnata")).toBeInTheDocument()
    expect(screen.getByText("Annullata")).toBeInTheDocument()
    expect(screen.getByText(/consegna 15\/04\/2026 \(da DDT\)/)).toBeInTheDocument()
  })

  it("segnala un rivenditore", () => {
    const s = scheda()
    s.cliente.rivenditore = true
    vista(s)
    expect(screen.getByText(/Rivenditore: di norma escluso/)).toBeInTheDocument()
  })
})

describe("ricerca cliente", () => {
  beforeEach(preparaDomTest)

  it("cerca per nome o codice e porta alla scheda", async () => {
    const fetchFinto = installaFetchFinta([
      {
        url: /\/api\/portali\/campagne\/clienti\?q=poletti/,
        risposta: {
          clienti: [
            { codice_cliente: "05000002", ragione_sociale: "POLETTI srl", agente_nome: "AIRFLUID", cat_commerciale: "Attivo", cat_attivita: null, rivenditore: false },
          ],
        },
      },
    ])
    render(<RicercaCliente />)
    fireEvent.change(screen.getByLabelText(/Cerca cliente/), { target: { value: "poletti" } })
    const link = await screen.findByRole("link", { name: /POLETTI srl/ })
    expect(link).toHaveAttribute("href", "/campagne/clienti/05000002")
    expect(fetchFinto).toHaveBeenCalledTimes(1)
  })

  it("sotto i due caratteri non chiama il server", () => {
    const fetchFinto = installaFetchFinta([])
    render(<RicercaCliente />)
    fireEvent.change(screen.getByLabelText(/Cerca cliente/), { target: { value: "p" } })
    expect(fetchFinto).not.toHaveBeenCalled()
  })

  it("mostra l'errore invece di restare muta", async () => {
    installaFetchFinta([{ url: /clienti\?q=/, risposta: { error: "Operazione non riuscita." }, status: 500 }])
    render(<RicercaCliente />)
    fireEvent.change(screen.getByLabelText(/Cerca cliente/), { target: { value: "rossi" } })
    expect(await screen.findByText("Operazione non riuscita.")).toBeInTheDocument()
  })
})
