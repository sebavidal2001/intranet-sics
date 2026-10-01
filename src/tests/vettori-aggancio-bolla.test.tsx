import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AggancioBolla } from "@/components/portali/vettori/aggancio-bolla";

const candidata = (id: string, numero: string, extra: Record<string, unknown> = {}) => ({
  etichetta: "C1", spedizioneId: id, numero, protocollo: null, data: "2026-05-27",
  controparte: "DIVERSEY EUROPE", localita: "BREUKELEN", provincia: null, colli: 2, peso: 48,
  vettore: "trading_post", giaAgganciataA: 0, congelata: false, indizi: ["stesso numero"], ...extra,
});

function dettaglio(puoDecidere: boolean) {
  return {
    riga: {},
    puoDecidere,
    proposta: { esito: "scelta", spedizioneId: "b1", sicurezza: "alta", motivo: "Stesso numero 1484, stessa data, 48 kg in fattura e in bolla." },
    candidate: [candidata("b1", "1484"), candidata("b2", "1485", { congelata: true })],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("aggancio di una riga di fattura alla bolla", () => {
  it("mostra la proposta dell'AI con il motivo, e aggancia la bolla scelta", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => (init?.method === "POST" ? { agganciata: true } : dettaglio(true)),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onAgganciata = vi.fn();
    render(<AggancioBolla rigaId="r1" onAgganciata={onAgganciata} />);

    expect(await screen.findByText(/sicurezza alta/)).toBeTruthy();
    expect(screen.getByText(/48 kg in fattura e in bolla/)).toBeTruthy();
    const pulsanti = screen.getAllByRole("button", { name: /Aggancia questa/ });
    // La bolla gia' agganciata a un'altra fattura non si puo' scegliere.
    expect((pulsanti[1] as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(pulsanti[0]);
    await waitFor(() => expect(onAgganciata).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(JSON.parse(String(post[1].body))).toEqual({ azione: "conferma", riga: "r1", spedizione: "b1" });
  });

  it("chi non e' dell'amministrazione vede le candidate ma non decide", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => dettaglio(false) }));
    render(<AggancioBolla rigaId="r1" onAgganciata={() => {}} />);
    expect(await screen.findByText(/sicurezza alta/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Aggancia questa/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Nessuna di queste/ })).toBeNull();
  });

  it("senza proposta offre di chiederla all'AI", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => (init?.method === "POST" ? { proposta: {} } : { ...dettaglio(true), proposta: null }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AggancioBolla rigaId="r1" onAgganciata={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /Chiedi all'AI/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST" && String(c[1].body).includes("proponi"))).toBe(true));
  });
});

describe("ricerca libera di una bolla", () => {
  it("cerca per numero o fornitore e aggancia un risultato", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => ({
      ok: true,
      json: async () => {
        if (init?.method === "POST") return { agganciata: true };
        if (String(url).includes("cerca=")) return { risultati: [{ ...candidata("b9", "2734"), etichetta: "R1", controparte: "AIRON srl", indizi: ["3 giorni dalla fattura"] }] };
        return { ...dettaglio(true), candidate: [] };
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const onAgganciata = vi.fn();
    render(<AggancioBolla rigaId="r1" onAgganciata={onAgganciata} />);
    fireEvent.change(await screen.findByLabelText(/Cercala per numero/), { target: { value: "2734" } });
    fireEvent.click(screen.getByRole("button", { name: /Cerca/ }));
    expect(await screen.findByText(/AIRON srl/)).toBeTruthy();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("cerca=2734"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Aggancia questa/ }));
    await waitFor(() => expect(onAgganciata).toHaveBeenCalled());
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST")!;
    expect(JSON.parse(String(post[1].body))).toEqual({ azione: "conferma", riga: "r1", spedizione: "b9" });
  });
});
