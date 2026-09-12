import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BolleView } from "@/components/portali/vettori/bolle-view";
import type { BollaDocumento } from "@/lib/portali/vettori/tipi";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const incompleta: BollaDocumento = {
  idDocumento: 101,
  numeroDocumento: "DV-101",
  dataDocumento: "2026-09-12",
  dataCreazione: "2026-09-12T10:30:00",
  direzione: "uscita",
  soggetto: "Cliente Alfa",
  destinazione: "Milano",
  vettoreCodice: "GLS",
  vettore: "GLS Italy",
  numColli: 1,
  pesoLordoKg: null,
  pesoNettoKg: null,
  volumeGestionaleM3: null,
  divisoreVolumetrico: 300,
  statoMisure: "da_misurare",
  misure: [],
};

const conVolume: BollaDocumento = {
  ...incompleta,
  idDocumento: 102,
  numeroDocumento: "DV-102",
  soggetto: "Cliente Beta",
  volumeGestionaleM3: 0.4,
  divisoreVolumetrico: 250,
  statoMisure: "volume_gestionale",
};

it("evidenzia le bolle incomplete e ricalcola il peso mentre si digitano le misure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        documenti: [incompleta, conVolume],
        pagina: 1,
        perPagina: 80,
        totale: 2,
        altrePagine: false,
      }),
    })
  );

  render(<BolleView />);
  const bolla = await screen.findByRole("article", { name: "Bolla DV-101" });
  expect(within(bolla).getByText("Da misurare")).toBeTruthy();

  fireEvent.click(within(bolla).getByRole("button", { name: /Inserisci misure/ }));
  fireEvent.change(within(bolla).getByLabelText("Lunghezza (cm)"), { target: { value: "50" } });
  fireEvent.change(within(bolla).getByLabelText("Larghezza (cm)"), { target: { value: "30" } });
  fireEvent.change(within(bolla).getByLabelText("Altezza (cm)"), { target: { value: "30" } });

  expect(within(bolla).getByText("13,5 kg")).toBeTruthy();
});

it("usa il volume gestionale ma lascia misurare comunque", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        documenti: [conVolume],
        pagina: 1,
        perPagina: 80,
        totale: 1,
        altrePagine: false,
      }),
    })
  );

  render(<BolleView />);
  const bolla = await screen.findByRole("article", { name: "Bolla DV-102" });
  expect(within(bolla).getByText("100 kg")).toBeTruthy();
  // Il volume del gestionale è un dato dichiarato, non una verifica: la pagina lo
  // segnala ma non impedisce a chi ha il collo davanti di misurarlo.
  expect(within(bolla).getByText(/misuralo comunque/)).toBeTruthy();
  expect(
    within(bolla).getByRole("button", { name: /misura comunque/i })
  ).toBeTruthy();
});
