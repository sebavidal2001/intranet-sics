import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CampagnaDettaglioView } from "@/components/portali/campagne/campagna-dettaglio-view"
import { FiltriInvii } from "@/components/portali/campagne/filtri-invii"
import { GestioneCampagneView } from "@/components/portali/campagne/gestione-campagne-view"
import { PubbliciElencoView } from "@/components/portali/campagne/pubblici-elenco-view"
import type { CampagnaRiepilogo, PubblicoRiepilogo } from "@/lib/portali/campagne/tipi"
import { installaFetchFinta, preparaDomTest } from "./helpers/fetch-finta"

const push = vi.fn()
const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))
vi.mock("@/components/portali/campagne/selezione-destinatari", () => ({ SelezioneDestinatari: () => <div>selezione destinatari</div> }))

const STD = "5b4d0e3a-7f6c-4a8d-9c9e-3f4a5b6c7d8e"
const MIR = "6c5e1f4b-8a7d-4b9e-8d0f-4a5b6c7d8e9f"

const pubblico = (over: Partial<PubblicoRiepilogo> = {}): PubblicoRiepilogo => ({
  id: STD,
  nome: "Standard",
  descrizione: null,
  standard: true,
  agenti: ["AIRFLUID"],
  categorie_commerciali: ["Attivo"],
  categorie_attivita: [],
  clienti_extra: [],
  aggiornato_il: "2026-10-03T10:00:00Z",
  raggiunti: 2439,
  campagne: 3,
  ...over,
})

beforeEach(() => {
  preparaDomTest()
  push.mockClear()
  refresh.mockClear()
})

describe("elenco dei pubblici", () => {
  const elenco = [pubblico(), pubblico({ id: MIR, nome: "Costruttori Nord", standard: false, raggiunti: 120, campagne: 1, descrizione: "Solo costruttori", clienti_extra: ["1", "2"] })]

  it("mostra lo standard (predefinito) e gli altri, con quanti clienti raggiungono e quante campagne li usano", () => {
    render(<PubbliciElencoView iniziale={elenco} />)
    const std = screen.getByRole("link", { name: /Standard/ })
    expect(std).toHaveAttribute("href", `/campagne/pubblico/${STD}`)
    expect(std).toHaveTextContent("predefinito")
    expect(std).toHaveTextContent(/2.?439/)
    expect(std).toHaveTextContent("3 campagne")
    const mirata = screen.getByRole("link", { name: /Costruttori Nord/ })
    expect(mirata).toHaveTextContent("1 campagna")
    expect(mirata).toHaveTextContent("2 scelti a mano")
    expect(mirata).not.toHaveTextContent("predefinito")
  })

  it("crea partendo da una copia dello standard e porta alla pagina del nuovo pubblico", async () => {
    const fetchFinto = installaFetchFinta([{ url: "/api/portali/campagne/pubblici", metodo: "POST", risposta: { pubblico: { id: MIR } } }])
    render(<PubbliciElencoView iniziale={elenco} />)
    fireEvent.click(screen.getByRole("button", { name: /Nuovo pubblico/ }))
    const crea = screen.getByRole("button", { name: /Crea e continua/ })
    expect(crea).toBeDisabled() // senza nome
    fireEvent.change(screen.getByLabelText("Nome del nuovo pubblico"), { target: { value: "  Costruttori Nord " } })
    fireEvent.click(crea)
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/campagne/pubblico/${MIR}`))
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))).toEqual({ nome: "Costruttori Nord", descrizione: null, copia_da: STD })
  })

  it("«vuoto» non copia lo standard", async () => {
    const fetchFinto = installaFetchFinta([{ url: "/api/portali/campagne/pubblici", metodo: "POST", risposta: { pubblico: { id: MIR } } }])
    render(<PubbliciElencoView iniziale={elenco} />)
    fireEvent.click(screen.getByRole("button", { name: /Nuovo pubblico/ }))
    fireEvent.change(screen.getByLabelText("Nome del nuovo pubblico"), { target: { value: "Da zero" } })
    fireEvent.change(screen.getByLabelText("Da dove partire"), { target: { value: "vuoto" } })
    fireEvent.click(screen.getByRole("button", { name: /Crea e continua/ }))
    await waitFor(() => expect(push).toHaveBeenCalled())
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))).not.toHaveProperty("copia_da")
  })

  it("un nome già usato mostra il messaggio e non cambia pagina", async () => {
    installaFetchFinta([{ url: "/api/portali/campagne/pubblici", metodo: "POST", risposta: { error: "Esiste già un pubblico con questo nome." }, status: 409 }])
    render(<PubbliciElencoView iniziale={elenco} />)
    fireEvent.click(screen.getByRole("button", { name: /Nuovo pubblico/ }))
    fireEvent.change(screen.getByLabelText("Nome del nuovo pubblico"), { target: { value: "Standard" } })
    fireEvent.click(screen.getByRole("button", { name: /Crea e continua/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Esiste già un pubblico")
    expect(push).not.toHaveBeenCalled()
  })
})

const campagna = (over: Partial<CampagnaRiepilogo> = {}): CampagnaRiepilogo => ({
  id: "11111111-1111-4111-8111-111111111111",
  codice: "C_04_26",
  nome: "Quattro",
  note: null,
  articolo_codice: "ART-04",
  testo_riconoscimento: [],
  riferimento: null,
  stato: "attiva",
  ordine: 4,
  stato_cambiato_il: "2026-10-01T08:00:00Z",
  created_at: "2026-10-01T08:00:00Z",
  pubblico_id: STD,
  pubblico: { nome: "Standard", standard: true },
  destinatari_automatici: false,
  destinatari: 100,
  preparate: 0,
  da_spedire: 0,
  consegnate: 0,
  consegnate_banco: 0,
  ...over,
})
const scelta = [
  { id: STD, nome: "Standard", standard: true },
  { id: MIR, nome: "Costruttori Nord", standard: false },
]

describe("scheda campagna: il suo pubblico", () => {
  it("mostra il pubblico della campagna e, se l'aggiornamento automatico è spento, quanti clienti rientrano e non sono destinatari", () => {
    render(<CampagnaDettaglioView iniziale={campagna()} pubblici={scelta} mancanti={34} />)
    expect(screen.getByLabelText("Pubblico della campagna")).toHaveValue(STD)
    expect(screen.getByText(/Spenta: 34 clienti rientrano nel pubblico e non sono destinatari/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Modifica questo pubblico/ })).toHaveAttribute("href", `/campagne/pubblico/${STD}`)
  })

  it("non c'è più il pulsante manuale: c'è l'interruttore dell'aggiornamento automatico", () => {
    render(<CampagnaDettaglioView iniziale={campagna()} pubblici={scelta} mancanti={0} />)
    expect(screen.queryByRole("button", { name: /Aggiungi i clienti che rientrano/ })).not.toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: /Aggiungi da sola i clienti che rientrano/ })).not.toBeChecked()
    expect(screen.getByText(/campagna mirata/)).toBeInTheDocument()
  })

  it("con l'aggiornamento automatico acceso lo dice e non parla di mancanti", () => {
    render(<CampagnaDettaglioView iniziale={campagna({ destinatari_automatici: true })} pubblici={scelta} mancanti={0} />)
    expect(screen.getByRole("checkbox", { name: /Aggiungi da sola i clienti che rientrano/ })).toBeChecked()
    expect(screen.getByText(/Ogni notte, dopo il caricamento di Impresa/)).toBeInTheDocument()
  })

  it("cambiare pubblico lo salva, aggiorna il conto dei mancanti e dice che i destinatari non sono stati toccati", async () => {
    const fetchFinto = installaFetchFinta([
      {
        url: "/api/portali/campagne/campagne/11111111-1111-4111-8111-111111111111",
        metodo: "PATCH",
        risposta: { campagna: campagna({ pubblico_id: MIR, pubblico: { nome: "Costruttori Nord", standard: false } }), mancanti: 120 },
      },
    ])
    render(<CampagnaDettaglioView iniziale={campagna()} pubblici={scelta} mancanti={0} />)
    fireEvent.change(screen.getByLabelText("Pubblico della campagna"), { target: { value: MIR } })
    await waitFor(() => expect(screen.getByText(/120 clienti rientrano/)).toBeInTheDocument())
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))).toEqual({ pubblico_id: MIR })
    expect(screen.getByText(/destinatari che la campagna ha già non sono stati toccati/)).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Modifica questo pubblico/ })).toHaveAttribute("href", `/campagne/pubblico/${MIR}`)
  })

  it("accendere l'interruttore lo salva sulla campagna e aggiorna i mancanti", async () => {
    const fetchFinto = installaFetchFinta([
      {
        url: "/api/portali/campagne/campagne/11111111-1111-4111-8111-111111111111",
        metodo: "PATCH",
        risposta: { campagna: campagna({ destinatari_automatici: true, destinatari: 134 }), mancanti: 0 },
      },
    ])
    render(<CampagnaDettaglioView iniziale={campagna()} pubblici={scelta} mancanti={34} />)
    fireEvent.click(screen.getByRole("checkbox", { name: /Aggiungi da sola i clienti che rientrano/ }))
    await waitFor(() => expect(screen.getByText(/Aggiornamento automatico acceso/)).toBeInTheDocument())
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))).toEqual({ destinatari_automatici: true })
    expect(screen.getByRole("checkbox", { name: /Aggiungi da sola i clienti che rientrano/ })).toBeChecked()
  })

  it("una campagna terminata non permette di cambiare pubblico né l'aggiornamento automatico", () => {
    render(<CampagnaDettaglioView iniziale={campagna({ stato: "terminata" })} pubblici={scelta} mancanti={5} />)
    expect(screen.getByLabelText("Pubblico della campagna")).toBeDisabled()
    expect(screen.queryByRole("checkbox", { name: /Aggiungi da sola i clienti che rientrano/ })).not.toBeInTheDocument()
  })
})

describe("nuova campagna: il pubblico", () => {
  async function apri(pubblici = scelta) {
    render(<GestioneCampagneView campagne={[]} pubblici={pubblici} />)
    fireEvent.click(screen.getByRole("button", { name: /Nuova campagna/ }))
  }
  const compila = () => {
    const campi = screen.getAllByRole("textbox")
    fireEvent.change(campi[0], { target: { value: "C_05_26" } })
    fireEvent.change(campi[1], { target: { value: "Cinque" } })
    fireEvent.change(campi[2], { target: { value: "ART-05" } })
  }

  it("di default è scelto lo standard e i destinatari si aggiungono subito", async () => {
    const fetchFinto = installaFetchFinta([{ url: "/api/portali/campagne/campagne", metodo: "POST", risposta: { campagna: {} } }])
    await apri()
    expect(screen.getByLabelText("Pubblico della campagna")).toHaveValue(STD)
    compila()
    fireEvent.click(screen.getByRole("button", { name: /Crea campagna/ }))
    await waitFor(() => expect(fetchFinto).toHaveBeenCalled())
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))).toMatchObject({ pubblico_id: STD, applica_pubblico: true, codice: "C_05_26" })
  })

  it("si può scegliere un altro pubblico e non aggiungere subito i destinatari", async () => {
    const fetchFinto = installaFetchFinta([{ url: "/api/portali/campagne/campagne", metodo: "POST", risposta: { campagna: {} } }])
    await apri()
    fireEvent.change(screen.getByLabelText("Pubblico della campagna"), { target: { value: MIR } })
    fireEvent.click(screen.getByRole("checkbox"))
    compila()
    fireEvent.click(screen.getByRole("button", { name: /Crea campagna/ }))
    await waitFor(() => expect(fetchFinto).toHaveBeenCalled())
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))).toMatchObject({ pubblico_id: MIR, applica_pubblico: false })
  })

  it("lo standard è segnato nel menu", async () => {
    await apri()
    const menu = screen.getByLabelText("Pubblico della campagna")
    expect(within(menu).getByRole("option", { name: "Standard (standard)" })).toBeInTheDocument()
    expect(within(menu).getByRole("option", { name: "Costruttori Nord" })).toBeInTheDocument()
  })
})

describe("filtro «seguita da» degli invii", () => {
  const camp = [{ id: "a", codice: "C_01_26", nome: "CP SICS" }]
  const utenti = [
    { id: "u1", nome: "Lucia Roda" },
    { id: "u2", nome: "Silvia Varas" },
  ]

  it("nella vista per invio c'è il menu con i nomi intranet, e quello scelto è selezionato", () => {
    render(<FiltriInvii vista="invii" campagne={camp} selezionate={[]} q="" utenti={utenti} utente="u2" />)
    const menu = screen.getByLabelText("Seguita da") as HTMLSelectElement
    expect(menu.name).toBe("utente_id")
    expect(menu.value).toBe("u2")
    expect(within(menu).getAllByRole("option").map((o) => o.textContent)).toEqual(["Tutti", "Lucia Roda", "Silvia Varas"])
  })

  it("nella vista per cliente non c'è: li' non esiste «chi l'ha seguita»", () => {
    render(<FiltriInvii vista="clienti" campagne={camp} selezionate={[]} q="" utenti={utenti} />)
    expect(screen.queryByLabelText("Seguita da")).not.toBeInTheDocument()
  })

  it("«Azzera» compare anche quando c'è solo l'utente", () => {
    render(<FiltriInvii vista="invii" campagne={camp} selezionate={[]} q="" utenti={utenti} utente="u1" />)
    expect(screen.getByText("Azzera")).toBeInTheDocument()
  })
})

describe("scheda campagna: a cosa si riferisce", () => {
  it("«Salva» manda il testo scritto a mano e non ci sono più pannelli di articoli", async () => {
    const fetchFinto = installaFetchFinta([
      { url: "/api/portali/campagne/campagne/11111111-1111-4111-8111-111111111111", metodo: "PATCH", risposta: { campagna: campagna(), mancanti: 0 } },
    ])
    render(<CampagnaDettaglioView iniziale={campagna({ riferimento: "Cilindri ISO 15552" })} pubblici={scelta} mancanti={0} />)
    expect(screen.queryByText(/Articoli promossi/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /^Salva$/ }))
    await waitFor(() => expect(fetchFinto).toHaveBeenCalled())
    const corpo = JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))
    expect(corpo.riferimento).toBe("Cilindri ISO 15552")
    expect(corpo).not.toHaveProperty("articoli_promossi")
    expect(corpo).not.toHaveProperty("promossi_albero")
  })
})
