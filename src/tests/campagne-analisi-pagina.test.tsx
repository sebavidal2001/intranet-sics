import { beforeEach, describe, expect, it, vi } from "vitest"

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`)
})
const getSessionUser = vi.fn()
const getCampagneContext = vi.fn()
const elencoCampagne = vi.fn()
const analisiCampagna = vi.fn()

vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }))
vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => getSessionUser() }))
vi.mock("@/lib/portali/campagne/ruoli", async (orig) => ({
  ...(await orig<typeof import("@/lib/portali/campagne/ruoli")>()),
  getCampagneContext: (id: string) => getCampagneContext(id),
}))
vi.mock("@/lib/portali/campagne/dati", () => ({ elencoCampagne: () => elencoCampagne() }))
vi.mock("@/lib/portali/campagne/analisi-dati", () => ({ analisiCampagna: (...a: unknown[]) => analisiCampagna(...a) }))
vi.mock("@/components/portali/campagne/analisi-view", () => ({
  AnalisiView: () => null,
  SceltaCampagnaEFinestra: () => null,
}))

import AnalisiPage from "@/app/(intranet)/(portale-campagne)/campagne/analisi/page"

const camp = (id: string, consegnate: number, banco = 0) => ({ id, codice: id, nome: id, articoli_promossi: [], consegnate, consegnate_banco: banco })

beforeEach(() => {
  vi.clearAllMocks()
  getSessionUser.mockResolvedValue({ id: "u1" })
})

describe("pagina Analisi: solo admin", () => {
  it("senza sessione manda al login e non legge nulla", async () => {
    getSessionUser.mockResolvedValue(null)
    await expect(AnalisiPage({ searchParams: {} })).rejects.toThrow("REDIRECT:/auth/login")
    expect(elencoCampagne).not.toHaveBeenCalled()
  })

  it("il back office (livello viewer + ruolo backoffice) non la vede e torna alla home del portale", async () => {
    getCampagneContext.mockResolvedValue({ livello: "viewer", ruoli: ["backoffice"] })
    await expect(AnalisiPage({ searchParams: {} })).rejects.toThrow("REDIRECT:/campagne")
    expect(elencoCampagne).not.toHaveBeenCalled()
    expect(analisiCampagna).not.toHaveBeenCalled()
  })

  it("senza accesso al portale va alla home dell'intranet", async () => {
    getCampagneContext.mockResolvedValue({ livello: null, ruoli: [] })
    await expect(AnalisiPage({ searchParams: {} })).rejects.toThrow("REDIRECT:/")
    expect(elencoCampagne).not.toHaveBeenCalled()
  })
})

describe("pagina Analisi: scelte", () => {
  beforeEach(() => {
    getCampagneContext.mockResolvedValue({ livello: "admin", ruoli: [] })
    analisiCampagna.mockResolvedValue({})
  })

  it("di default prende la campagna con più buste consegnate, finestra 6 mesi", async () => {
    elencoCampagne.mockResolvedValue([camp("a", 2), camp("b", 5, 1), camp("c", 3)])
    await AnalisiPage({ searchParams: {} })
    expect(analisiCampagna).toHaveBeenCalledWith("b", 6)
  })

  it("rispetta campagna e finestra richieste, e ignora quelle inventate", async () => {
    elencoCampagne.mockResolvedValue([camp("a", 2), camp("b", 5)])
    await AnalisiPage({ searchParams: { campagna: "a", mesi: "12" } })
    expect(analisiCampagna).toHaveBeenLastCalledWith("a", 12)
    await AnalisiPage({ searchParams: { campagna: "zzz", mesi: "99" } })
    expect(analisiCampagna).toHaveBeenLastCalledWith("b", 6)
  })

  it("senza campagne non chiama l'analisi", async () => {
    elencoCampagne.mockResolvedValue([])
    await AnalisiPage({ searchParams: {} })
    expect(analisiCampagna).not.toHaveBeenCalled()
  })
})
