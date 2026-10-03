import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AlertRigheMancanti } from "@/components/portali/campagne/alert-righe-mancanti"
import { AnomalieView } from "@/components/portali/campagne/anomalie-view"
import { Ricontrolla } from "@/components/portali/campagne/ricontrolla"
import { SchedaClienteView } from "@/components/portali/campagne/scheda-cliente-view"
import type { Anomalia, Campagna, ControlloEseguito, SchedaCliente } from "@/lib/portali/campagne/tipi"
import { installaFetchFinta, preparaDomTest } from "./helpers/fetch-finta"

const refresh = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }))
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, ...r }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={onClick} {...r}>
      {children}
    </a>
  ),
}))

const rigaMancante = (over: Partial<Anomalia> = {}): Anomalia => ({
  id: "a1",
  tipo: "riga_mancante",
  gravita: "errore",
  codice_cliente: "K1",
  ragione_sociale: "POLETTI srl",
  invio_id: "i1",
  campagna_id: "c1",
  ordine_numero: "1117",
  ordine_anno: 2026,
  dettaglio: { articolo: "DOCUMENTAZIONE", testo_riga: "INVIO DOCUMENTAZIONE C_01_26 CP SICS", campagna_codice: "C_01_26", data_ordine: "2026-09-20" },
  stato: "aperta",
  aperta_il: "2026-10-03T03:30:00Z",
  ultima_vista_il: "2026-10-03T03:30:00Z",
  risolta_il: null,
  risolta_con: null,
  nota: null,
  ...over,
})

const inversione = (): Anomalia =>
  rigaMancante({
    id: "a2",
    tipo: "ordine_invertito",
    invio_id: null,
    ordine_numero: null,
    ordine_anno: null,
    dettaglio: {
      mosse: [
        { invio_id: "i1", campagna_codice: "C_01_26", campagna_nome: "CP SICS", da: { ordine_numero: "100", ordine_data_consegna: "2026-12-31" }, a: { ordine_numero: "200", ordine_data_consegna: "2026-11-01" } },
        { invio_id: "i2", campagna_codice: "C_02_26", campagna_nome: "ZECA", da: { ordine_numero: "200", ordine_data_consegna: "2026-11-01" }, a: { ordine_numero: "100", ordine_data_consegna: "2026-12-31" } },
      ],
    },
  })

beforeEach(() => {
  preparaDomTest()
  refresh.mockClear()
  window.sessionStorage.clear()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe("popup «manca la riga DOCUMENTAZIONE»", () => {
  it("dice cliente, ordine, data e campagna, con articolo e descrizione pronti da copiare", async () => {
    render(<AlertRigheMancanti anomalie={[rigaMancante()]} />)
    const dialogo = await screen.findByRole("dialog")
    expect(within(dialogo).getByText("Manca una riga DOCUMENTAZIONE")).toBeInTheDocument()
    expect(within(dialogo).getByText("POLETTI srl")).toBeInTheDocument()
    expect(dialogo).toHaveTextContent("Ordine 1117/2026 del 20/09/2026")
    expect(dialogo).toHaveTextContent("C_01_26")

    fireEvent.click(within(dialogo).getByRole("button", { name: "Copia Descrizione" }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("INVIO DOCUMENTAZIONE C_01_26 CP SICS")
    fireEvent.click(within(dialogo).getByRole("button", { name: "Copia Articolo" }))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("DOCUMENTAZIONE")
  })

  it("non compare se non ci sono casi", () => {
    render(<AlertRigheMancanti anomalie={[]} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("«Ho capito» lo chiude e non torna per gli stessi casi nella stessa sessione", async () => {
    const { unmount } = render(<AlertRigheMancanti anomalie={[rigaMancante()]} />)
    fireEvent.click(await screen.findByRole("button", { name: "Ho capito" }))
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    unmount()
    render(<AlertRigheMancanti anomalie={[rigaMancante()]} />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("torna se compare un caso NUOVO", async () => {
    const { unmount } = render(<AlertRigheMancanti anomalie={[rigaMancante()]} />)
    fireEvent.click(await screen.findByRole("button", { name: "Ho capito" }))
    unmount()
    render(<AlertRigheMancanti anomalie={[rigaMancante(), rigaMancante({ id: "a9", ragione_sociale: "ALTRO srl" })]} />)
    expect(await screen.findByRole("dialog")).toHaveTextContent("Mancano 2 righe DOCUMENTAZIONE")
  })

  it("funziona anche se lo storage del browser non è disponibile", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    render(<AlertRigheMancanti anomalie={[rigaMancante()]} />)
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    vi.restoreAllMocks()
  })
})

describe("elenco anomalie", () => {
  it("senza anomalie lo dice", () => {
    render(<AnomalieView anomalie={[]} />)
    expect(screen.getByText("Nessuna anomalia")).toBeInTheDocument()
  })

  it("raggruppa per tipo con le più urgenti per prime", () => {
    render(<AnomalieView anomalie={[rigaMancante({ id: "x", tipo: "evasa_senza_ddt" }), rigaMancante(), inversione()]} />)
    const titoli = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
    expect(titoli[0]).toContain("Manca la riga DOCUMENTAZIONE")
    expect(titoli[1]).toContain("Campagne in ordine sbagliato")
    expect(titoli[2]).toContain("Riga evasa ma DDT non trovato")
  })

  it("lo scambio chiede conferma e poi chiama il server", async () => {
    const fetchFinto = installaFetchFinta([
      { url: "/api/portali/campagne/anomalie/a2", metodo: "PATCH", risposta: { anomalia: { ...inversione(), stato: "risolta" } } },
    ])
    const conferma = vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<AnomalieView anomalie={[inversione()]} />)
    fireEvent.click(screen.getByRole("button", { name: /Applica scambio/ }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(conferma.mock.calls[0][0]).toContain("scambiato le buste fisiche")
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))).toEqual({ azione: "applica_scambio" })
  })

  it("se non si conferma, non parte niente", () => {
    const fetchFinto = installaFetchFinta([])
    vi.spyOn(window, "confirm").mockReturnValue(false)
    render(<AnomalieView anomalie={[inversione()]} />)
    fireEvent.click(screen.getByRole("button", { name: /Applica scambio/ }))
    expect(fetchFinto).not.toHaveBeenCalled()
  })

  it("«Lascia così» vuole il motivo", async () => {
    const fetchFinto = installaFetchFinta([
      { url: "/api/portali/campagne/anomalie/a1", metodo: "PATCH", risposta: { anomalia: rigaMancante({ stato: "ignorata" }) } },
    ])
    render(<AnomalieView anomalie={[rigaMancante()]} />)
    fireEvent.click(screen.getByRole("button", { name: "Lascia così" }))
    const conferma = screen.getByRole("button", { name: "Conferma" })
    expect(conferma).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Perché la lasci così/), { target: { value: "Il cliente ritira al banco" } })
    fireEvent.click(conferma)
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))).toEqual({ azione: "ignora", nota: "Il cliente ritira al banco" })
  })

  it("mostra il messaggio del server se lo scambio non è più valido", async () => {
    installaFetchFinta([
      { url: "/api/portali/campagne/anomalie/a2", metodo: "PATCH", risposta: { error: "Gli invii sono cambiati dopo l'ultimo controllo: ricontrolla e riprova." }, status: 409 },
    ])
    vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<AnomalieView anomalie={[inversione()]} />)
    fireEvent.click(screen.getByRole("button", { name: /Applica scambio/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("sono cambiati")
    expect(refresh).not.toHaveBeenCalled()
  })
})

describe("scheda cliente con i dati di Impresa", () => {
  const campagna: Campagna = {
    id: "00000000-0000-4000-8000-000000000001",
    codice: "C_01_26",
    nome: "CP SICS",
    note: null,
    articolo_codice: "DOCUMENTAZIONE",
    testo_riconoscimento: ["SICS"],
    marchio: null,
    articoli_promossi: [],
    stato: "attiva",
    ordine: 1,
    stato_cambiato_il: "2026-10-01T08:00:00Z",
    created_at: "2026-10-01T08:00:00Z",
  }
  const scheda = (over: Partial<SchedaCliente> = {}): SchedaCliente => ({
    cliente: { codice_cliente: "05000002", ragione_sociale: "POLETTI srl", agente_nome: "AIRFLUID", cat_commerciale: "Attivo", cat_attivita: null, rivenditore: false },
    invii: [],
    assegnabili: [campagna],
    ordini_aperti: [],
    anomalie: [],
    ...over,
  })
  const vista = (s: SchedaCliente) => render(<SchedaClienteView scheda={s} annoCorrente={2026} oggi="2026-10-03" />)

  it("gli ordini aperti compilano numero e anno con un clic", () => {
    vista(
      scheda({
        ordini_aperti: [
          { profilo: "OC", numero: "2946", anno: 2026, data_ordine: "2026-09-25", consegna_prevista: "2026-10-30", invio_id: null, ha_documentazione: false },
          { profilo: "OC", numero: "2900", anno: 2026, data_ordine: "2026-09-10", consegna_prevista: null, invio_id: "gia", ha_documentazione: true },
        ],
      })
    )
    // L'ordine che ha già una busta non si offre: se ne porta una sola.
    expect(screen.queryByText(/OC 2900\/2026/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /OC 2946\/2026/ }))
    expect(screen.getByPlaceholderText("es. 1117")).toHaveValue("2946")
  })

  it("mostra articolo e descrizione da incollare in Impresa, con il pulsante copia", () => {
    vista(scheda())
    expect(screen.getByRole("button", { name: "Copia Articolo" })).toBeInTheDocument()
    expect(screen.getByText("INVIO DOCUMENTAZIONE C_01_26 CP SICS")).toBeInTheDocument()
  })

  it("le anomalie del cliente stanno in cima, con le azioni", () => {
    vista(scheda({ anomalie: [rigaMancante()] }))
    expect(screen.getByText(/Da sistemare · 1/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Lascia così" })).toBeInTheDocument()
  })

  it("nello storico dice cosa ha trovato il controllo e da dove viene la data di consegna", () => {
    const base = scheda().cliente
    void base
    const invio = (over: Record<string, unknown>) => ({
      id: String(over.id),
      campagna_id: campagna.id,
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
    vista(
      scheda({
        assegnabili: [],
        invii: [
          invio({ id: "1", controllo_esito: "attesa_dati" }),
          invio({ id: "2", stato: "consegnata", data_consegna: "2026-10-01", fonte_consegna: "ddt", ddt_numero: "500", ddt_metodo: "euristico", controllo_esito: "consegnata" }),
        ] as SchedaCliente["invii"],
      })
    )
    expect(screen.getByText(/In attesa del prossimo aggiornamento dei dati di Impresa/)).toBeInTheDocument()
    expect(screen.getByText(/DDT 500 \(abbinato per data\)/)).toBeInTheDocument()
  })
})

describe("ricontrolla", () => {
  const controllo = (over: Partial<ControlloEseguito> = {}): ControlloEseguito => ({
    id: "c1",
    origine: "notturno",
    iniziato_il: "2026-10-03T01:30:00Z",
    finito_il: "2026-10-03T01:30:05Z",
    esito: "ok",
    dati_del: "2026-10-02T23:31:00Z",
    invii_controllati: 10,
    invii_aggiornati: 2,
    anomalie_aperte: 1,
    anomalie_risolte: 0,
    errore: null,
    ...over,
  })

  it("dice di quando sono i dati di Impresa e quando è stato l'ultimo controllo", () => {
    render(<Ricontrolla ultimo={controllo()} />)
    expect(screen.getByText(/Dati di Impresa del/)).toBeInTheDocument()
    expect(screen.getByText(/03\/10\/2026, 01:31/)).toBeInTheDocument()
  })

  it("senza controlli lo dice, e segnala uno fallito", () => {
    const { unmount } = render(<Ricontrolla ultimo={null} />)
    expect(screen.getByText(/non è ancora stato eseguito/)).toBeInTheDocument()
    unmount()
    render(<Ricontrolla ultimo={controllo({ esito: "errore" })} />)
    expect(screen.getByText(/\(fallito\)/)).toBeInTheDocument()
  })

  it("il pulsante lancia il controllo e ricarica; se un altro è in corso mostra il motivo", async () => {
    installaFetchFinta([{ url: "/api/portali/campagne/controllo", metodo: "POST", risposta: { controllo: {} } }])
    const { unmount } = render(<Ricontrolla ultimo={null} />)
    fireEvent.click(screen.getByRole("button", { name: /Ricontrolla/ }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    unmount()

    installaFetchFinta([{ url: "/api/portali/campagne/controllo", metodo: "POST", risposta: { error: "Un controllo è già in corso" }, status: 409 }])
    render(<Ricontrolla ultimo={null} />)
    fireEvent.click(screen.getByRole("button", { name: /Ricontrolla/ }))
    expect(await screen.findByText(/già in corso/)).toBeInTheDocument()
  })
})
