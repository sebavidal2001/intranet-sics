import { useState } from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { AlberoArticoli } from "@/components/portali/campagne/albero-articoli"
import { SelezioneCampagne } from "@/components/portali/campagne/selezione-campagne"
import type { SelettoreArticolo } from "@/lib/portali/campagne/albero"
import { installaFetchFinta, preparaDomTest } from "./helpers/fetch-finta"

const AIGNEP = "AIGNEP raccordi-tubi (53,5%)"
const SMC = "SMC 38% (ex 33%)"

const nodo = (livello: string, valore: string, n: number, descrizione: string | null = null) => ({ livello, valore, descrizione, n })
const risposta = (nodi: unknown[], totale = nodi.length) => ({ nodi, totale })

const radice = risposta([nodo("fornitore", AIGNEP, 780), nodo("fornitore", SMC, 385)])
const gruppiAignep = risposta([nodo("gruppo", "COMPONENTI", 780)])
const categorie = risposta([nodo("categoria", "AUTOMAZIONE pneumatica", 780)])
const articoli = risposta([nodo("articolo", "0056400001", 1, "INNESTO OTTURATO M.CIL.1/4"), nodo("articolo", "0028100002", 1, "INNESTO OTTURATO MIGNON")])

/** Le rotte di una sessione normale: albero, conteggio, ricerca. */
const rotte = () => [
  { url: /\/articoli\?limit=100&offset=0$/, risposta: radice },
  { url: /\/articoli\?f=[^&]+&limit=100&offset=0$/, risposta: gruppiAignep },
  { url: /\/articoli\?f=[^&]+&g=COMPONENTI&limit=100&offset=0$/, risposta: categorie },
  { url: /\/articoli\?f=[^&]+&g=COMPONENTI&c=[^&]+&limit=100&offset=0$/, risposta: articoli },
  { url: "/api/portali/campagne/articoli/conteggio", metodo: "POST", risposta: { articoli: 780, venduti: 486 } },
]

function Prova({ iniziale = [] as SelettoreArticolo[], onCambia = vi.fn(), disabled = false }) {
  // Un piccolo contenitore con stato, come la scheda campagna.
  const [sel, setSel] = useState(iniziale)
  return (
    <AlberoArticoli
      selezione={sel}
      onChange={(s) => {
        setSel(s)
        onCambia(s)
      }}
      disabled={disabled}
    />
  )
}

beforeEach(preparaDomTest)

describe("albero degli articoli promossi", () => {
  it("parte dai fornitori, con quanti articoli hanno", async () => {
    installaFetchFinta(rotte())
    render(<Prova />)
    expect(await screen.findByText(AIGNEP)).toBeInTheDocument()
    expect(screen.getByText(SMC)).toBeInTheDocument()
    expect(screen.getByText("780 articoli")).toBeInTheDocument()
    expect(screen.getByText("Nessuna scelta")).toBeInTheDocument()
  })

  it("si scende fornitore > gruppo > categoria > articolo, un livello alla volta", async () => {
    const f = installaFetchFinta(rotte())
    render(<Prova />)
    fireEvent.click(await screen.findByRole("button", { name: `Apri fornitore ${AIGNEP}` }))
    fireEvent.click(await screen.findByRole("button", { name: "Apri gruppo COMPONENTI" }))
    fireEvent.click(await screen.findByRole("button", { name: "Apri categoria AUTOMAZIONE pneumatica" }))
    expect(await screen.findByText("0056400001")).toBeInTheDocument()
    expect(screen.getByText(/INNESTO OTTURATO M\.CIL/)).toBeInTheDocument()
    // Ogni livello si legge solo quando lo si apre: SMC non e' stato espanso.
    const urls = f.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes("SMC"))).toBe(false)
  })

  it("spuntare un fornitore sceglie tutto il suo ramo e il totale si aggiorna", async () => {
    const cambia = vi.fn()
    const f = installaFetchFinta(rotte())
    render(<Prova onCambia={cambia} />)
    fireEvent.click(await screen.findByRole("checkbox", { name: `Scegli fornitore ${AIGNEP}` }))
    expect(cambia).toHaveBeenLastCalledWith([{ f: AIGNEP }])
    expect(await screen.findByText(/486/)).toBeInTheDocument()
    expect(screen.getByText(/venduti dal 13\/01\/2025/)).toBeInTheDocument()
    const conteggio = f.mock.calls.find((c) => String(c[0]).endsWith("/conteggio"))!
    expect(JSON.parse(String(conteggio[1]?.body))).toEqual({ selettori: [{ f: AIGNEP }] })
  })

  it("un nodo sotto un fornitore scelto risulta «già compreso» e non si può spuntare da solo", async () => {
    installaFetchFinta(rotte())
    render(<Prova iniziale={[{ f: AIGNEP }]} />)
    fireEvent.click(await screen.findByRole("button", { name: `Apri fornitore ${AIGNEP}` }))
    const gruppo = await screen.findByRole("checkbox", { name: "Scegli gruppo COMPONENTI" })
    expect(gruppo).toBeChecked()
    expect(gruppo).toBeDisabled()
    expect(screen.getAllByText("già compreso").length).toBeGreaterThan(0)
  })

  it("scegliere un gruppo dopo un articolo assorbe l'articolo: una sola scelta", async () => {
    const cambia = vi.fn()
    installaFetchFinta(rotte())
    render(<Prova iniziale={[{ f: AIGNEP, g: "COMPONENTI", c: "AUTOMAZIONE pneumatica", a: "0056400001" }]} onCambia={cambia} />)
    fireEvent.click(await screen.findByRole("button", { name: `Apri fornitore ${AIGNEP}` }))
    const gruppo = await screen.findByRole("checkbox", { name: "Scegli gruppo COMPONENTI" })
    // Con una scelta sotto il gruppo e' «parziale»: non e' spuntato ma nemmeno vuoto.
    expect((gruppo as HTMLInputElement).indeterminate).toBe(true)
    fireEvent.click(gruppo)
    expect(cambia).toHaveBeenLastCalledWith([{ f: AIGNEP, g: "COMPONENTI" }])
  })

  it("la scelta si toglie dalla sua etichetta e il fornitore torna libero", async () => {
    const cambia = vi.fn()
    installaFetchFinta(rotte())
    render(<Prova iniziale={[{ f: AIGNEP }, { f: SMC }]} onCambia={cambia} />)
    await screen.findByText(AIGNEP, { selector: "li span" })
    fireEvent.click(screen.getByRole("button", { name: `Togli ${AIGNEP}` }))
    expect(cambia).toHaveBeenLastCalledWith([{ f: SMC }])
  })

  it("togliere la spunta a un nodo scelto in proprio lo toglie", async () => {
    const cambia = vi.fn()
    installaFetchFinta(rotte())
    render(<Prova iniziale={[{ f: AIGNEP }]} onCambia={cambia} />)
    const casella = await screen.findByRole("checkbox", { name: `Scegli fornitore ${AIGNEP}` })
    expect(casella).toBeChecked()
    fireEvent.click(casella)
    expect(cambia).toHaveBeenLastCalledWith([])
  })

  it("se la selezione non ha nessun articolo venduto lo dice", async () => {
    installaFetchFinta([...rotte().slice(0, -1), { url: "/api/portali/campagne/articoli/conteggio", metodo: "POST", risposta: { articoli: 12, venduti: 0 } }])
    render(<Prova iniziale={[{ f: SMC }]} />)
    expect(await screen.findByText(/Nessuno di questi articoli compare nel fatturato/)).toBeInTheDocument()
  })

  it("con 780 articoli sotto un livello si mostrano a pagine", async () => {
    installaFetchFinta([
      { url: /\/articoli\?limit=100&offset=0$/, risposta: risposta([nodo("fornitore", AIGNEP, 780)], 250) },
      { url: /\/articoli\?limit=100&offset=1$/, risposta: risposta([nodo("fornitore", SMC, 385)], 250) },
    ])
    render(<Prova />)
    expect(await screen.findByText(AIGNEP)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Mostra altri/ }))
    expect(await screen.findByText(SMC)).toBeInTheDocument()
  })

  it("la ricerca filtra l'albero e propone gli articoli col loro percorso", async () => {
    const f = installaFetchFinta([
      ...rotte(),
      { url: /\/articoli\?q=raccord&limit=100&offset=0$/, risposta: risposta([nodo("fornitore", AIGNEP, 40)]) },
      {
        url: /\/articoli\?cerca=raccord&limit=8$/,
        risposta: { totale: 1, articoli: [{ codice: "0056400001", descrizione: "RACCORDO", fornitore: AIGNEP, gruppo: "COMPONENTI", categoria: "AUTOMAZIONE pneumatica" }] },
      },
    ])
    render(<Prova />)
    await screen.findByText(SMC)
    fireEvent.change(screen.getByLabelText("Cerca nell'anagrafica articoli"), { target: { value: "raccord" } })
    await waitFor(() => expect(screen.queryByText(SMC)).not.toBeInTheDocument(), { timeout: 3000 })
    expect(await screen.findByText("Articoli che corrispondono")).toBeInTheDocument()
    expect(screen.getByText(`${AIGNEP} › COMPONENTI › AUTOMAZIONE pneumatica`)).toBeInTheDocument()
    expect(f.mock.calls.some((c) => String(c[0]).includes("q=raccord&limit=100"))).toBe(true)
  })

  it("un articolo trovato dalla ricerca si sceglie col suo percorso completo", async () => {
    const cambia = vi.fn()
    installaFetchFinta([
      ...rotte(),
      { url: /\/articoli\?q=0056400001&limit=100&offset=0$/, risposta: risposta([nodo("fornitore", AIGNEP, 1)]) },
      {
        url: /\/articoli\?cerca=0056400001&limit=8$/,
        risposta: { totale: 1, articoli: [{ codice: "0056400001", descrizione: "INNESTO", fornitore: AIGNEP, gruppo: "COMPONENTI", categoria: "AUTOMAZIONE pneumatica" }] },
      },
    ])
    render(<Prova onCambia={cambia} />)
    await screen.findByText(SMC)
    fireEvent.change(screen.getByLabelText("Cerca nell'anagrafica articoli"), { target: { value: "0056400001" } })
    fireEvent.click(await screen.findByRole("checkbox", { name: "Scegli l'articolo 0056400001" }, { timeout: 3000 }))
    expect(cambia).toHaveBeenLastCalledWith([{ f: AIGNEP, g: "COMPONENTI", c: "AUTOMAZIONE pneumatica", a: "0056400001" }])
  })

  it("cercando un marchio si possono scegliere tutti i suoi fornitori in un colpo", async () => {
    const cambia = vi.fn()
    installaFetchFinta([
      ...rotte(),
      { url: /\/articoli\?q=aignep&limit=100&offset=0$/, risposta: risposta([nodo("fornitore", "AIGNEP 55000 (62%)", 46), nodo("fornitore", AIGNEP, 780)]) },
      { url: /\/articoli\?cerca=aignep&limit=8$/, risposta: { totale: 0, articoli: [] } },
    ])
    render(<Prova onCambia={cambia} />)
    await screen.findByText(SMC)
    fireEvent.change(screen.getByLabelText("Cerca nell'anagrafica articoli"), { target: { value: "aignep" } })
    fireEvent.click(await screen.findByRole("button", { name: "Scegli tutti i 2 fornitori" }, { timeout: 3000 }))
    expect(cambia).toHaveBeenLastCalledWith([{ f: "AIGNEP 55000 (62%)" }, { f: AIGNEP }])
  })

  it("«Scegli tutti i fornitori» resta spento se non sono stati caricati tutti: la ricerca va ristretta", async () => {
    installaFetchFinta([
      ...rotte(),
      { url: /\/articoli\?q=aignep&limit=100&offset=0$/, risposta: risposta([nodo("fornitore", AIGNEP, 780)], 250) },
      { url: /\/articoli\?cerca=aignep&limit=8$/, risposta: { totale: 0, articoli: [] } },
    ])
    render(<Prova />)
    await screen.findByText(SMC)
    fireEvent.change(screen.getByLabelText("Cerca nell'anagrafica articoli"), { target: { value: "aignep" } })
    expect(await screen.findByRole("button", { name: "Scegli tutti i 1 fornitori" }, { timeout: 3000 })).toBeDisabled()
  })

  it("disabilitato (campagna terminata): non si può né scegliere né togliere", async () => {
    installaFetchFinta(rotte())
    render(<Prova iniziale={[{ f: SMC }]} disabled />)
    expect(await screen.findByRole("checkbox", { name: `Scegli fornitore ${AIGNEP}` })).toBeDisabled()
    expect(screen.queryByRole("button", { name: `Togli ${SMC}` })).not.toBeInTheDocument()
    expect(screen.getByLabelText("Cerca nell'anagrafica articoli")).toBeDisabled()
  })

  it("se un livello non si carica lo dice e si può riprovare", async () => {
    let n = 0
    vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0 ? new Response("{}", { status: 500 }) : new Response(JSON.stringify(radice), { status: 200 }))))
    render(<Prova />)
    expect(await screen.findByText(/Non riesco a caricare questo livello/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Riprova" }))
    expect(await screen.findByText(AIGNEP)).toBeInTheDocument()
  })
})

describe("menu di selezione delle campagne", () => {
  const camp = [
    { id: "a", codice: "C_01_26", nome: "CP SICS" },
    { id: "b", codice: "C_02_26", nome: "ZECA ZETEK" },
    { id: "c", codice: "C_03_26", nome: "AIGNEP" },
  ]
  const tante = Array.from({ length: 12 }, (_, i) => ({ id: `id${i}`, codice: `C_${String(i + 1).padStart(2, "0")}_26`, nome: `Campagna ${i + 1}` }))

  it("chiuso riassume la scelta: tutte, i codici (fino a due) o quante", () => {
    const { unmount } = render(<SelezioneCampagne campagne={camp} selezionate={[]} />)
    expect(screen.getByRole("button", { name: /Tutte le campagne/ })).toBeInTheDocument()
    unmount()
    const due = render(<SelezioneCampagne campagne={camp} selezionate={["a", "c"]} />)
    expect(screen.getByRole("button", { name: /C_01_26, C_03_26/ })).toBeInTheDocument()
    due.unmount()
    render(<SelezioneCampagne campagne={camp} selezionate={["a", "b", "c"]} />)
    expect(screen.getByRole("button", { name: /3 campagne scelte/ })).toBeInTheDocument()
  })

  it("le caselle ci sono anche a menu chiuso (il modulo le invia), e il menu si apre e si chiude", () => {
    render(
      <form>
        <SelezioneCampagne campagne={camp} selezionate={["b"]} />
      </form>
    )
    const dati = new FormData(document.querySelector("form")!)
    expect(dati.getAll("campagna_id")).toEqual(["b"])
    const pulsante = screen.getByRole("button", { name: /C_02_26/ })
    expect(pulsante).toHaveAttribute("aria-expanded", "false")
    // Chiuso, il pannello e' nascosto (non e' leggibile ne' cliccabile), ma le caselle sono nel modulo.
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0)
    fireEvent.click(pulsante)
    expect(pulsante).toHaveAttribute("aria-expanded", "true")
    expect(screen.getAllByRole("checkbox")).toHaveLength(3)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(pulsante).toHaveAttribute("aria-expanded", "false")
  })

  it("scegliere in più campagne cambia cosa invia il modulo", () => {
    render(
      <form>
        <SelezioneCampagne campagne={camp} selezionate={[]} />
      </form>
    )
    fireEvent.click(screen.getByRole("button", { name: /Tutte le campagne/ }))
    fireEvent.click(screen.getByLabelText(/C_01_26/, { selector: "input" }))
    fireEvent.click(screen.getByLabelText(/C_03_26/, { selector: "input" }))
    expect(new FormData(document.querySelector("form")!).getAll("campagna_id")).toEqual(["a", "c"])
    expect(screen.getByRole("button", { name: /C_01_26, C_03_26/ })).toBeInTheDocument()
  })

  it("«Scegli tutte» e «Nessuna»", () => {
    render(
      <form>
        <SelezioneCampagne campagne={camp} selezionate={[]} />
      </form>
    )
    fireEvent.click(screen.getByRole("button", { name: /Tutte le campagne/ }))
    fireEvent.click(screen.getByRole("button", { name: "Scegli tutte" }))
    expect(new FormData(document.querySelector("form")!).getAll("campagna_id")).toEqual(["a", "b", "c"])
    fireEvent.click(screen.getByRole("button", { name: "Nessuna" }))
    expect(new FormData(document.querySelector("form")!).getAll("campagna_id")).toEqual([])
  })

  it("con tante campagne compare la ricerca, che nasconde le altre ma non perde le scelte nascoste", () => {
    render(
      <form>
        <SelezioneCampagne campagne={tante} selezionate={["id0"]} />
      </form>
    )
    fireEvent.click(screen.getByRole("button", { name: /C_01_26/ }))
    fireEvent.change(screen.getByLabelText("Cerca una campagna"), { target: { value: "Campagna 12" } })
    const visibili = screen.getAllByRole("checkbox").filter((c) => !c.closest("li")!.hidden)
    expect(visibili).toHaveLength(1)
    expect((visibili[0] as HTMLInputElement).value).toBe("id11")
    // La C_01_26 e' nascosta dalla ricerca ma resta scelta e si invia lo stesso.
    expect(new FormData(document.querySelector("form")!).getAll("campagna_id")).toEqual(["id0"])
    fireEvent.click(screen.getByRole("button", { name: "Scegli i visibili" }))
    expect(new FormData(document.querySelector("form")!).getAll("campagna_id")).toEqual(["id0", "id11"])
  })

  it("con poche campagne non c'è la ricerca", () => {
    render(<SelezioneCampagne campagne={camp} selezionate={[]} />)
    expect(screen.queryByLabelText("Cerca una campagna")).not.toBeInTheDocument()
  })

  it("cliccando fuori si chiude", () => {
    render(
      <div>
        <p>fuori</p>
        <SelezioneCampagne campagne={camp} selezionate={[]} />
      </div>
    )
    const pulsante = screen.getByRole("button", { name: /Tutte le campagne/ })
    fireEvent.click(pulsante)
    fireEvent.mouseDown(screen.getByText("fuori"))
    expect(pulsante).toHaveAttribute("aria-expanded", "false")
  })
})
