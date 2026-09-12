import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SimulazioneView } from "@/components/portali/vettori/simulazione-view";

afterEach(() => { cleanup(); vi.unstubAllGlobals() });

const capMilano = { cap: "20121", province: ["MI"], comuni: ["Milano"], fonte: "anci_istat", certo: true, estero: false };
const calcolo = { pesoReale: 42.5, pesoVolumetrico: 138, pesoTassabile: 138, pesoApplicato: "volumetrico", nolo: 25, fasciaDescrizione: "fino a 150 kg", supplementi: [], imponibileNolo: 25, adeguamento: 0, carburante: 6.4, fuoriBase: 0, totale: 31.4, avvertenze: [] };
const risposta = {
  data: "2026-09-12", cap: "20121", provincia: "MI", fonteProvincia: "cap",
  risultati: [
    { vettoreId: "v1", vettoreCodice: "GLS", vettoreNome: "GLS Italy", disponibile: true, listino: { etichetta: "Listino 2026", validoDal: "2026-01-01", validoAl: null }, calcolo, riaddebito: { importo: 26.4, pesoUsato: 138, basePeso: "tassabile", regola: "scaglione", avvertenza: null }, margine: -5 },
    { vettoreId: "v2", vettoreCodice: "TNT", vettoreNome: "TNT", disponibile: true, calcolo: { ...calcolo, totale: 40 }, riaddebito: { importo: null, pesoUsato: 115, basePeso: "tassabile", regola: "oltre soglia", avvertenza: "Serve una quotazione." }, margine: null },
  ],
};

function compilaSpedizione() {
  fireEvent.change(screen.getByLabelText("CAP di destinazione"), { target: { value: "20121" } });
  fireEvent.change(screen.getByLabelText("Peso totale (kg)"), { target: { value: "42,5" } });
  fireEvent.change(screen.getByLabelText("Quantità gruppo 1"), { target: { value: "2" } });
  fireEvent.change(screen.getByLabelText("Lunghezza (cm) gruppo 1"), { target: { value: "100" } });
  fireEvent.change(screen.getByLabelText("Profondità (cm) gruppo 1"), { target: { value: "50" } });
  fireEvent.change(screen.getByLabelText("Altezza (cm) gruppo 1"), { target: { value: "40" } });
}

describe("simulazione vettori", () => {
  it("risolve il CAP, somma gruppi diversi e invia tutti i colli", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => ({
      ok: true, status: 200,
      json: async () => init?.method === "POST" ? risposta : capMilano,
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SimulazioneView />);
    compilaSpedizione();
    expect(await screen.findByText("Milano (MI)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Aggiungi gruppo" }));
    fireEvent.change(screen.getByLabelText("Quantità gruppo 2"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("Lunghezza (cm) gruppo 2"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("Profondità (cm) gruppo 2"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Altezza (cm) gruppo 2"), { target: { value: "30" } });
    expect(screen.getByText("0,46 m³")).toBeTruthy();
    expect(screen.getByText("138 kg")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Confronta i vettori" }));
    const gls = await screen.findByRole("article", { name: "Vettore GLS Italy" });
    expect(within(gls).getByText("-5,00 €")).toBeTruthy();
    expect(screen.getByText("Chiedere offerta")).toBeTruthy();
    const richiesta = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(richiesta?.[1]?.body))).toMatchObject({ cap: "20121", provincia: "MI", colli: 3, gruppi: [{ quantita: 2, lunghezzaCm: 100, larghezzaCm: 50, altezzaCm: 40 }, { quantita: 1, lunghezzaCm: 50, larghezzaCm: 40, altezzaCm: 30 }] });
  });

  it("chiede la provincia quando il CAP è a cavallo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...capMilano, cap: "12071", province: ["CN", "SV"], comuni: ["Battifollo"], certo: false }) }));
    render(<SimulazioneView />);
    fireEvent.change(screen.getByLabelText("CAP di destinazione"), { target: { value: "12071" } });
    expect(await screen.findByText(/a cavallo di più province/)).toBeTruthy();
    expect(screen.getByLabelText("Provincia CN")).not.toBeChecked();
    expect(screen.getByLabelText("Provincia SV")).not.toBeChecked();
  });

  it("conferma anche senza numero e invia null esplicito", async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/cap/")) return { ok: true, status: 200, json: async () => capMilano };
      if (url.endsWith("/simula")) return { ok: true, status: 200, json: async () => risposta };
      return { ok: true, status: 201, json: async () => ({ simulazioneId: "s1", spedizioneId: "b1", daNumerare: true }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<SimulazioneView />);
    compilaSpedizione();
    await screen.findByText("Milano (MI)");
    fireEvent.click(screen.getByRole("button", { name: "Confronta i vettori" }));
    const gls = await screen.findByRole("article", { name: "Vettore GLS Italy" });
    fireEvent.click(within(gls).getByRole("button", { name: "Scegli" }));
    fireEvent.click(screen.getByRole("button", { name: "Conferma e crea la bolla" }));
    fireEvent.click(screen.getByLabelText("Lo inserisco dopo"));
    fireEvent.change(screen.getByLabelText("Controparte"), { target: { value: "Cliente Alfa" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea bolla" }));

    await screen.findByText("Bolla creata");
    const richiesta = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/simulazioni"));
    expect(JSON.parse(String(richiesta?.[1]?.body))).toMatchObject({ simulazione: { vettoreSceltoId: "v1", costoPrevisto: 31.4, riaddebitoPrevisto: 26.4 }, bolla: { numeroRiferimento: null, controparteNome: "Cliente Alfa" } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });
});
