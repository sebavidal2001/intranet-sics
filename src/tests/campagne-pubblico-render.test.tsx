import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { FiltriInvii } from "@/components/portali/campagne/filtri-invii"
import { PubblicoView } from "@/components/portali/campagne/pubblico-view"
import { TabellaClienti } from "@/components/portali/campagne/tabella-clienti"
import type { ClienteConCampagne, PubblicoResponse } from "@/lib/portali/campagne/tipi"
import { installaFetchFinta, preparaDomTest } from "./helpers/fetch-finta"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}))

const cli = (codice: string, agente: string | null, comm: string | null, att: string | null) => ({
  codice_cliente: codice,
  ragione_sociale: `Cliente ${codice}`,
  agente_nome: agente,
  cat_commerciale: comm,
  cat_attivita: att,
})

const ID = "5b4d0e3a-7f6c-4a8d-9c9e-3f4a5b6c7d8e"
const URL_PUBBLICO = `/api/portali/campagne/pubblici/${ID}`

const dati = (over: Partial<PubblicoResponse["config"]> = {}, raggiunti = 3, campagne: PubblicoResponse["campagne"] = []): PubblicoResponse => ({
  campagne,
  config: {
    id: ID,
    nome: "Standard",
    descrizione: null,
    standard: true,
    agenti: ["AIRFLUID"],
    categorie_commerciali: ["Attivo"],
    categorie_attivita: [],
    clienti_extra: [],
    aggiornato_il: "2026-10-03T10:00:00Z",
    ...over,
  },
  raggiunti,
  clienti: [
    cli("1", "AIRFLUID", "Attivo", "COSTR. macch.automatiche"),
    cli("2", "AIRFLUID", "Attivo", "IMP. impiantisti"),
    cli("3", "AIRFLUID", "Attivo", "UT.FIN. tornerie/off.mecc."),
    cli("4", "AIRFLUID", "Potenziale", "COSTR. macch.automatiche"),
    cli("5", "DANIELE BONI", "Attivo", "COSTR. attrezzature"),
    cli("6", "DANIELE BONI", "Potenziale", "UT.FIN. altre produzioni"),
    cli("7", "VALERIA BATTELANI", "Attivo", "IMP. impiantisti"),
    cli("8", null, null, null),
  ],
})

const conta = () => screen.getByText("clienti raggiunti").previousElementSibling as HTMLElement
const gruppo = (agente: string) => screen.getByRole("radiogroup", { name: `Come prendere i clienti di ${agente}` })
const scegli = (agente: string, modo: string) => fireEvent.click(within(gruppo(agente)).getByRole("radio", { name: modo }))

beforeEach(preparaDomTest)

describe("pubblico standard: i commercialisti in accordion", () => {
  it("un accordion per commerciale, NON i clienti tutti esplosi", () => {
    render(<PubblicoView iniziale={dati()} />)
    for (const agente of ["AIRFLUID", "DANIELE BONI", "VALERIA BATTELANI"]) {
      expect(screen.getAllByText(agente).length).toBeGreaterThan(0)
      expect(gruppo(agente)).toBeInTheDocument()
    }
    // Nessun cliente di Boni o Battelani è visibile finché non si apre l'accordion.
    expect(screen.queryByText("Cliente 5")).not.toBeInTheDocument()
    expect(screen.queryByText("Cliente 7")).not.toBeInTheDocument()
  })

  it("parte dallo stato salvato: AIRFLUID «Tutti», gli altri «Nessuno»", () => {
    render(<PubblicoView iniziale={dati()} />)
    expect(within(gruppo("AIRFLUID")).getByRole("radio", { name: "Tutti" })).toHaveAttribute("aria-checked", "true")
    expect(within(gruppo("DANIELE BONI")).getByRole("radio", { name: "Nessuno" })).toHaveAttribute("aria-checked", "true")
  })

  it("«Scelti a mano» apre l'elenco dei clienti di quel commerciale, con ricerca e selezione dei visibili", () => {
    render(<PubblicoView iniziale={dati()} />)
    scegli("DANIELE BONI", "Scelti a mano")
    expect(screen.getByText("Cliente 5")).toBeInTheDocument()
    expect(screen.getByText("Cliente 6")).toBeInTheDocument()
    expect(screen.queryByText("Cliente 7")).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText("Cerca fra i clienti di DANIELE BONI"), { target: { value: "UT.FIN." } })
    expect(screen.queryByText("Cliente 5")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Scegli i 1 visibili/ }))
    expect(conta()).toHaveTextContent("4") // 3 di AIRFLUID + il cliente 6, scelto a mano
  })

  it("il conteggio in basso si aggiorna mentre si sceglie", () => {
    render(<PubblicoView iniziale={dati()} />)
    expect(conta()).toHaveTextContent("3")
    scegli("AIRFLUID", "Nessuno")
    expect(conta()).toHaveTextContent("0")
    expect(screen.getByText(/non raggiunge nessun cliente/)).toBeInTheDocument()
    scegli("AIRFLUID", "Tutti")
    expect(conta()).toHaveTextContent("3")
  })

  it("«senza agente» non si può prendere «Tutti»: non c'è un nome con cui riconoscerli", () => {
    render(<PubblicoView iniziale={dati()} />)
    expect(within(gruppo("(senza agente)")).getByRole("radio", { name: "Tutti" })).toBeDisabled()
  })
})

describe("pubblico standard: categorie", () => {
  it("«Potenziale» allarga il pubblico", () => {
    render(<PubblicoView iniziale={dati()} />)
    fireEvent.click(screen.getByRole("button", { name: /Potenziale/ }))
    expect(conta()).toHaveTextContent("4")
  })

  it("una famiglia (Costruttori) restringe ai suoi clienti; senza scelte vale «tutte le categorie»", () => {
    render(<PubblicoView iniziale={dati()} />)
    expect(screen.getByText("Tutte le categorie")).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText("Seleziona tutte le categorie Costruttori"))
    expect(conta()).toHaveTextContent("1") // solo il cliente 1: attivo e costruttore
    expect(screen.getByText(/2 categorie scelte/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Togli tutte" }))
    expect(conta()).toHaveTextContent("3")
  })

  it("una singola categoria si sceglie aprendo la famiglia", () => {
    render(<PubblicoView iniziale={dati()} />)
    const riga = screen.getByLabelText("Seleziona tutte le categorie Impiantisti").closest("li")!
    fireEvent.click(within(riga).getByRole("button", { expanded: false }))
    fireEvent.click(within(riga).getByRole("checkbox", { name: /IMP\. impiantisti/ }))
    expect(conta()).toHaveTextContent("1")
  })

  it("la ricerca delle categorie le apre da sole e nasconde le altre", () => {
    render(<PubblicoView iniziale={dati()} />)
    fireEvent.change(screen.getByLabelText("Cerca una categoria"), { target: { value: "tornerie" } })
    expect(screen.getByText("UT.FIN. tornerie/off.mecc.")).toBeInTheDocument()
    expect(screen.queryByText("IMP. impiantisti")).not.toBeInTheDocument()
  })
})

/** Apre la famiglia e poi la categoria, e restituisce la sua riga. */
function apriCategoria(famiglia: string, categoria: RegExp) {
  const li = screen.getByLabelText(`Seleziona tutte le categorie ${famiglia}`).closest("li")!
  fireEvent.click(within(li).getByRole("button", { expanded: false }))
  fireEvent.click(within(li).getByRole("button", { name: categoria }))
  return li as HTMLElement
}

describe("pubblico: scegliere i singoli clienti dentro una categoria", () => {
  it("aprendo una categoria si vedono i suoi clienti, di tutti i commerciali, col nome del commerciale", () => {
    render(<PubblicoView iniziale={dati()} />)
    const li = apriCategoria("Costruttori", /Clienti della categoria COSTR\. attrezzature/)
    expect(within(li).getByText("Cliente 5")).toBeInTheDocument()
    expect(within(li).getByText(/DANIELE BONI/)).toBeInTheDocument()
    // Un cliente di un'altra categoria non c'e'.
    expect(within(li).queryByText("Cliente 2")).not.toBeInTheDocument()
  })

  it("spuntare un cliente lo aggiunge a mano, anche se il suo commerciale e' «Nessuno»", () => {
    render(<PubblicoView iniziale={dati()} />)
    const li = apriCategoria("Costruttori", /Clienti della categoria COSTR\. attrezzature/)
    expect(conta()).toHaveTextContent("3")
    fireEvent.click(within(li).getByText("Cliente 5").closest("label")!.querySelector("input")!)
    expect(conta()).toHaveTextContent("4")
    // Il commerciale ora risulta «Scelti a mano», senza averlo toccato.
    expect(within(gruppo("DANIELE BONI")).getByRole("radio", { name: "Scelti a mano" })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByText("Modifiche non salvate")).toBeInTheDocument()
  })

  it("chi e' gia' dentro per la regola si vede spuntato e bloccato, con «già dentro»", () => {
    render(<PubblicoView iniziale={dati()} />)
    const li = apriCategoria("Costruttori", /Clienti della categoria COSTR\. macch\.automatiche/)
    const riga = within(li).getByText("Cliente 1").closest("label")!
    expect(within(riga as HTMLElement).getByText("già dentro")).toBeInTheDocument()
    const casella = riga.querySelector("input")!
    expect(casella).toBeChecked()
    expect(casella).toBeDisabled()
    // Il cliente 4 (Potenziale) non rientra per regola: si puo' scegliere.
    expect(within(li).getByText("Cliente 4").closest("label")!.querySelector("input")).toBeEnabled()
  })

  it("«Scegli i visibili» non tocca chi e' gia' dentro per regola", () => {
    render(<PubblicoView iniziale={dati()} />)
    const li = apriCategoria("Costruttori", /Clienti della categoria COSTR\. macch\.automatiche/)
    fireEvent.click(within(li).getByRole("button", { name: /Scegli i 1 visibili/ }))
    expect(conta()).toHaveTextContent("4") // il cliente 4, che prima non rientrava
  })

  it("i clienti scelti a mano dentro una categoria si salvano, anche con la categoria non spuntata nel filtro", async () => {
    const fetchFinto = installaFetchFinta([{ url: URL_PUBBLICO, metodo: "PUT", risposta: dati({ clienti_extra: ["5"] }, 4) }])
    render(<PubblicoView iniziale={dati()} />)
    const li = apriCategoria("Costruttori", /Clienti della categoria COSTR\. attrezzature/)
    fireEvent.click(within(li).getByText("Cliente 5").closest("label")!.querySelector("input")!)
    fireEvent.click(screen.getByRole("button", { name: /Salva/ }))
    await waitFor(() => expect(fetchFinto).toHaveBeenCalled())
    const corpo = JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))
    expect(corpo.clienti_extra).toEqual(["5"])
    expect(corpo.categorie_attivita).toEqual([])
  })

  it("i clienti senza categoria si possono scegliere solo uno per uno", () => {
    render(<PubblicoView iniziale={dati()} />)
    fireEvent.click(screen.getByRole("button", { name: "Clienti della categoria (senza categoria)" }))
    expect(screen.getByText("Cliente 8")).toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: /Includi la categoria \(senza categoria\)/ })).not.toBeInTheDocument()
  })

  it("togliere un commerciale passa a «Nessuno» azzera anche le scelte fatte dalle categorie", () => {
    render(<PubblicoView iniziale={dati()} />)
    const li = apriCategoria("Costruttori", /Clienti della categoria COSTR\. attrezzature/)
    fireEvent.click(within(li).getByText("Cliente 5").closest("label")!.querySelector("input")!)
    expect(conta()).toHaveTextContent("4")
    scegli("DANIELE BONI", "Nessuno")
    expect(conta()).toHaveTextContent("3")
  })
})

describe("pubblico: non standard e campagne che lo usano", () => {
  it("lo standard ha l'etichetta «predefinito» e non si elimina", () => {
    render(<PubblicoView iniziale={dati()} />)
    expect(screen.getByText("Predefinito per le nuove campagne")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Elimina/ })).not.toBeInTheDocument()
  })

  it("un pubblico non standard usato da una campagna: la elenca e non si puo' eliminare", () => {
    render(<PubblicoView iniziale={dati({ standard: false, nome: "Mirata" }, 3, [{ id: "c1", codice: "C_04_26", nome: "Quattro", stato: "attiva" }])} />)
    expect(screen.getByRole("heading", { name: "Mirata" })).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /C_04_26/ })).toHaveAttribute("href", "/campagne/gestione/c1")
    expect(screen.getByRole("button", { name: /Elimina/ })).toBeDisabled()
  })

  it("un pubblico non standard e libero si elimina dopo conferma", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true))
    const fetchFinto = installaFetchFinta([{ url: URL_PUBBLICO, metodo: "DELETE", risposta: { ok: true } }])
    render(<PubblicoView iniziale={dati({ standard: false, nome: "Mirata" })} />)
    fireEvent.click(screen.getByRole("button", { name: /Elimina/ }))
    await waitFor(() => expect(fetchFinto).toHaveBeenCalled())
  })

  it("rinominare il pubblico e' una modifica: si salva con il nuovo nome", async () => {
    const fetchFinto = installaFetchFinta([{ url: URL_PUBBLICO, metodo: "PUT", risposta: dati({ nome: "Nuovo nome" }) }])
    render(<PubblicoView iniziale={dati()} />)
    fireEvent.change(screen.getByLabelText("Nome del pubblico"), { target: { value: "Nuovo nome" } })
    expect(screen.getByText("Modifiche non salvate")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Salva/ }))
    await waitFor(() => expect(fetchFinto).toHaveBeenCalled())
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body)).nome).toBe("Nuovo nome")
  })

  it("senza nome non si salva", () => {
    render(<PubblicoView iniziale={dati()} />)
    fireEvent.change(screen.getByLabelText("Nome del pubblico"), { target: { value: "   " } })
    expect(screen.getByRole("button", { name: /Salva/ })).toBeDisabled()
  })
})

describe("pubblico standard: salvataggio", () => {
  it("«Salva» è spento finché non si cambia qualcosa, e poi manda la regola completa", async () => {
    const risposta = dati({ categorie_attivita: ["COSTR. macch.automatiche", "COSTR. attrezzature"] }, 1)
    const fetchFinto = installaFetchFinta([{ url: URL_PUBBLICO, metodo: "PUT", risposta }])
    render(<PubblicoView iniziale={dati()} />)
    const salva = screen.getByRole("button", { name: /Salva/ })
    expect(salva).toBeDisabled()

    fireEvent.click(screen.getByLabelText("Seleziona tutte le categorie Costruttori"))
    expect(screen.getByText("Modifiche non salvate")).toBeInTheDocument()
    fireEvent.click(salva)

    await waitFor(() => expect(screen.getByText(/Salvato\. Questo pubblico raggiunge 1 clienti/)).toBeInTheDocument())
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body))).toEqual({
      nome: "Standard",
      descrizione: null,
      agenti: ["AIRFLUID"],
      categorie_commerciali: ["Attivo"],
      categorie_attivita: expect.arrayContaining(["COSTR. attrezzature", "COSTR. macch.automatiche"]),
      clienti_extra: [],
    })
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body)).categorie_attivita).toHaveLength(2)
  })

  it("un commerciale passato a «Nessuno» perde le sue scelte a mano: non si salvano", async () => {
    const fetchFinto = installaFetchFinta([{ url: URL_PUBBLICO, metodo: "PUT", risposta: dati({ clienti_extra: [] }, 3) }])
    render(<PubblicoView iniziale={dati()} />)
    scegli("DANIELE BONI", "Scelti a mano")
    for (const nome of ["Cliente 5", "Cliente 6"]) fireEvent.click(screen.getByText(nome).closest("label")!.querySelector("input")!)
    expect(conta()).toHaveTextContent("5")
    // Boni torna a «Nessuno»: le scelte singole non servono piu'.
    scegli("DANIELE BONI", "Nessuno")
    expect(conta()).toHaveTextContent("3")
    // Alla fine la regola e' uguale a quella salvata: «Salva» resta spento. Serve una modifica vera.
    expect(screen.getByRole("button", { name: /Salva/ })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /Potenziale/ }))
    fireEvent.click(screen.getByRole("button", { name: /Salva/ }))
    await waitFor(() => expect(fetchFinto).toHaveBeenCalled())
    expect(JSON.parse(String(fetchFinto.mock.calls[0][1]?.body)).clienti_extra).toEqual([])
  })

  it("se il conteggio del server non coincide con quello mostrato lo dice, invece di tacere", async () => {
    installaFetchFinta([{ url: URL_PUBBLICO, metodo: "PUT", risposta: dati({ categorie_commerciali: ["Attivo", "Potenziale"] }, 99) }])
    render(<PubblicoView iniziale={dati()} />)
    fireEvent.click(screen.getByRole("button", { name: /Potenziale/ }))
    fireEvent.click(screen.getByRole("button", { name: /Salva/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("è diverso da quello mostrato")
  })

  it("mostra l'errore del server e lascia le modifiche", async () => {
    installaFetchFinta([{ url: URL_PUBBLICO, metodo: "PUT", risposta: { error: "Accesso negato" }, status: 403 }])
    render(<PubblicoView iniziale={dati()} />)
    fireEvent.click(screen.getByRole("button", { name: /Potenziale/ }))
    fireEvent.click(screen.getByRole("button", { name: /Salva/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Accesso negato")
    expect(screen.getByText("Modifiche non salvate")).toBeInTheDocument()
  })

  it("«Annulla» riporta tutto allo stato salvato", () => {
    render(<PubblicoView iniziale={dati()} />)
    scegli("AIRFLUID", "Nessuno")
    fireEvent.click(screen.getByRole("button", { name: /Annulla/ }))
    expect(conta()).toHaveTextContent("3")
    expect(within(gruppo("AIRFLUID")).getByRole("radio", { name: "Tutti" })).toHaveAttribute("aria-checked", "true")
  })
})

describe("filtri della pagina Invii", () => {
  const camp = [
    { id: "a", codice: "C_01_26", nome: "CP SICS" },
    { id: "b", codice: "C_02_26", nome: "ZECA ZETEK" },
    { id: "c", codice: "C_03_26", nome: "AIGNEP" },
  ]

  it("le campagne sono caselle che si possono scegliere in più, quelle scelte risultano accese", () => {
    render(<FiltriInvii vista="clienti" campagne={camp} selezionate={["a", "c"]} q="" modo="almeno_una" min={2} />)
    const caselle = screen.getAllByRole("checkbox") as HTMLInputElement[]
    expect(caselle.map((x) => [x.value, x.checked])).toEqual([["a", true], ["b", false], ["c", true]])
    expect(caselle.every((x) => x.name === "campagna_id")).toBe(true)
  })

  it("nella vista per cliente offre le tre modalità e il numero minimo", () => {
    render(<FiltriInvii vista="clienti" campagne={camp} selezionate={[]} q="" modo="tutte" min={3} />)
    const radio = screen.getAllByRole("radio") as HTMLInputElement[]
    expect(radio.map((x) => [x.value, x.checked])).toEqual([["almeno_una", false], ["tutte", true], ["nessuna", false]])
    expect(screen.getByLabelText("Quante campagne almeno")).toHaveValue(3)
    expect(document.querySelector('input[name="vista"]')).toHaveValue("clienti")
  })

  it("nella vista per invio niente modalità, e lo stato scelto resta nel modulo", () => {
    render(<FiltriInvii vista="invii" campagne={camp} selezionate={[]} q="rossi" stato="preparata" modo="almeno_una" min={1} />)
    expect(screen.queryAllByRole("radio")).toHaveLength(0)
    expect(document.querySelector('input[name="stato"]')).toHaveValue("preparata")
    expect(document.querySelector('input[name="vista"]')).toBeNull()
    expect(screen.getByPlaceholderText("Nome o codice")).toHaveValue("rossi")
  })

  it("«Azzera» compare solo se c'è qualcosa da azzerare", () => {
    const { unmount } = render(<FiltriInvii vista="invii" campagne={camp} selezionate={[]} q="" modo="almeno_una" min={1} />)
    expect(screen.queryByText("Azzera")).not.toBeInTheDocument()
    unmount()
    render(<FiltriInvii vista="invii" campagne={camp} selezionate={["a"]} q="" modo="almeno_una" min={1} />)
    expect(screen.getByText("Azzera")).toBeInTheDocument()
  })
})

describe("elenco dei clienti per campagne ricevute", () => {
  const righe: ClienteConCampagne[] = [
    {
      codice_cliente: "05000204",
      ragione_sociale: "FERRARI AUTOMAZIONI srl",
      agente_nome: "AIRFLUID",
      cat_attivita: "COSTR. macch.automatiche",
      n_ricevute: 2,
      campagne: [
        { codice: "C_01_26", nome: "CP SICS", stato: "consegnata", data: "2026-01-19", selezionata: true },
        { codice: "C_02_26", nome: "ZECA", stato: "preparata", data: null, selezionata: false },
      ],
    },
    { codice_cliente: "05000001", ragione_sociale: "SENZA srl", agente_nome: null, cat_attivita: null, n_ricevute: 0, campagne: [] },
  ]

  it("dice quali campagne ha ricevuto, con la data, e quali sono ancora in lavorazione", () => {
    render(<TabellaClienti clienti={righe} />)
    expect(screen.getByText("FERRARI AUTOMAZIONI srl")).toHaveAttribute("href", "/campagne/clienti/05000204")
    expect(screen.getByText("C_01_26").closest("span")).toHaveTextContent("19/01")
    expect(screen.getByText("C_02_26").closest("span")).toHaveTextContent("in corso")
    expect(screen.getByText("nessuna ancora")).toBeInTheDocument()
  })

  it("le campagne scelte nel filtro hanno il contorno, le altre no", () => {
    render(<TabellaClienti clienti={righe} />)
    expect(screen.getByText("C_01_26").closest("span")!.className).toContain("ring-2")
    expect(screen.getByText("C_02_26").closest("span")!.className).not.toContain("ring-2")
  })
})
