import type { ReactNode } from "react"
import React from "react"
import { expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"

export type RottaFinta = {
  url: string | RegExp
  metodo?: string
  risposta: unknown | (() => unknown)
  status?: number
}

function coincide(rotta: RottaFinta, url: string, metodo: string) {
  const urlOk = typeof rotta.url === "string" ? url === rotta.url : rotta.url.test(url)
  return urlOk && (rotta.metodo ?? "GET") === metodo
}

export function installaFetchFinta(rotte: RottaFinta[]) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const metodo = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    const rotta = rotte.find((r) => coincide(r, url, metodo))
    if (!rotta) throw new Error(`Fetch finta non configurata: ${metodo} ${url}`)
    const body = typeof rotta.risposta === "function" ? rotta.risposta() : rotta.risposta
    return new Response(JSON.stringify(body), {
      status: rotta.status ?? 200,
      headers: { "Content-Type": "application/json" },
    })
  })
  vi.stubGlobal("fetch", mock)
  return mock
}

export function installaFetchErrore(status = 500) {
  const mock = vi.fn(async () => new Response(JSON.stringify({ error: "x" }), {
    status,
    headers: { "Content-Type": "application/json" },
  }))
  vi.stubGlobal("fetch", mock)
  return mock
}

export function installaFetchRete() {
  const mock = vi.fn(async () => { throw new Error("rete non disponibile") })
  vi.stubGlobal("fetch", mock)
  return mock
}

export class ConfineErrori extends React.Component<
  { children: ReactNode },
  { errore: Error | null }
> {
  state: { errore: Error | null } = { errore: null }

  static getDerivedStateFromError(errore: Error) {
    return { errore }
  }

  render() {
    return this.state.errore
      ? React.createElement("div", { role: "alert" }, `Crash: ${this.state.errore.message}`)
      : this.props.children
  }
}

export function preparaDomTest() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  })
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  })
  class ResizeObserverFinto {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverFinto)
}

export function registraResilienzaFetch(nome: string, vista: () => ReactNode) {
  it(`${nome}: gestisce una risposta 500 senza crash`, async () => {
    const fetchMock = installaFetchErrore()
    render(React.createElement(ConfineErrori, null, vista()))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/^Crash:/)).not.toBeInTheDocument())
    cleanup()
  })

  it(`${nome}: gestisce un errore di rete senza crash`, async () => {
    const fetchMock = installaFetchRete()
    render(React.createElement(ConfineErrori, null, vista()))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/^Crash:/)).not.toBeInTheDocument())
    cleanup()
  })
}
