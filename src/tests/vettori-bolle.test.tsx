import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { BolleView } from "@/components/portali/vettori/bolle-view";
import type { BollaDocumento, BolleResponse } from "@/lib/portali/vettori/tipi";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const spedizioneId = "00000000-0000-4000-8000-000000000101";
const vettoreId = "00000000-0000-4000-8000-000000000201";

const incompleta: BollaDocumento = {
  idSpedizione: spedizioneId,
  idDocumenti: [101],
  numeroDocumento: "DV-101",
  dataDocumento: "2026-09-12",
  dataCreazione: "2026-09-12T10:30:00Z",
  direzione: "uscita",
  soggetto: "Cliente Alfa",
  destinazione: "20100 MI",
  vettoreId,
  vettoreCodice: "GLS",
  vettore: "GLS Italy",
  vettoreCodiceGestionale: "VT000015",
  vettoreEsito: "assegnato",
  vettoreRegola: null,
  numColli: 1,
  pesoLordoKg: 4,
  pesoNettoKg: null,
  divisoreVolumetrico: 300,
  statoMisure: "da_misurare",
  origine: "gestionale",
  campiForzati: {},
  congelata: false,
  fattura: null,
  scostamenti: [],
  misure: [],
};

const vettori = [
  { id: vettoreId, codice: "GLS", nome: "GLS Italy", divisoreVolumetrico: 300 },
];

function risposta(documenti: BollaDocumento[], puoScongelare = false): BolleResponse {
  return {
    documenti,
    vettori,
    puoScongelare,
    pagina: 1,
    perPagina: 80,
    totale: documenti.length,
    altrePagine: false,
  };
}

describe("bolle manuali e congelamento", () => {
  it("spiega perche il vettore manca e quale azione serve", async () => {
    const regola: BollaDocumento = {
      ...incompleta,
      idSpedizione: "00000000-0000-4000-8000-000000000111",
      numeroDocumento: "DV-REGOLA",
      vettoreId: null,
      vettoreCodice: null,
      vettore: "GLS fino a 30 Kg-FEDEX oltre",
      vettoreCodiceGestionale: "VT010015",
      vettoreEsito: "regola",
      vettoreRegola: "GLS fino a 30 kg, FedEx oltre",
      divisoreVolumetrico: null,
    };
    const esterna: BollaDocumento = {
      ...regola,
      idSpedizione: "00000000-0000-4000-8000-000000000112",
      numeroDocumento: "DV-ESTERNA",
      vettoreCodiceGestionale: "VT000099",
      vettoreEsito: "esterno",
      vettoreRegola: null,
    };
    const daClassificare: BollaDocumento = {
      ...regola,
      idSpedizione: "00000000-0000-4000-8000-000000000113",
      numeroDocumento: "DV-CLASSIFICARE",
      vettore: "BRT spa",
      vettoreCodiceGestionale: "VT000013",
      vettoreEsito: "da_classificare",
      vettoreRegola: null,
    };
    const assente: BollaDocumento = {
      ...regola,
      idSpedizione: "00000000-0000-4000-8000-000000000114",
      numeroDocumento: "DV-ASSENTE",
      vettore: null,
      vettoreCodiceGestionale: null,
      vettoreEsito: "assente",
      vettoreRegola: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => risposta([incompleta, regola, esterna, daClassificare, assente]),
    }));
    render(<BolleView />);

    const assegnata = await screen.findByRole("article", { name: "Bolla DV-101" });
    expect(within(assegnata).getByText("GLS Italy")).toBeTruthy();
    expect(within(assegnata).getByText("300 kg/m³")).toBeTruthy();
    const conRegola = screen.getByRole("article", { name: "Bolla DV-REGOLA" });
    expect(within(conRegola).getByText("Regola gestionale: «GLS fino a 30 kg, FedEx oltre»")).toBeTruthy();
    expect(within(conRegola).getByText("Scegli il vettore in base al peso o al tipo di collo")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Bolla DV-ESTERNA" })).getByText("Vettore esterno, non a nostro carico")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Bolla DV-CLASSIFICARE" })).getByText("Codice VT000013 (BRT spa) da classificare nelle impostazioni")).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Bolla DV-ASSENTE" })).getByText("Il gestionale non ha indicato il vettore")).toBeTruthy();
  });

  it("evidenzia le bolle incomplete e ricalcola il peso mentre si digitano le misure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => risposta([incompleta]) }));
    render(<BolleView />);

    const bolla = await screen.findByRole("article", { name: "Bolla DV-101" });
    expect(within(bolla).getByText("Da misurare")).toBeTruthy();
    fireEvent.click(within(bolla).getByRole("button", { name: /Dettagli e misure/ }));
    fireEvent.change(within(bolla).getByLabelText("Lunghezza (cm)"), { target: { value: "50" } });
    fireEvent.change(within(bolla).getByLabelText("Larghezza (cm)"), { target: { value: "30" } });
    fireEvent.change(within(bolla).getByLabelText("Altezza (cm)"), { target: { value: "30" } });

    expect(within(bolla).getByText("13,5 kg")).toBeTruthy();
  });

  it("crea una bolla manuale con testata e dimensioni", async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: init?.method === "POST" ? 201 : 200,
      json: async () => init?.method === "POST" ? { id: spedizioneId } : risposta([]),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<BolleView />);

    await screen.findByText("Nessuna bolla disponibile");
    fireEvent.click(screen.getByRole("button", { name: "Nuova bolla manuale" }));
    fireEvent.change(screen.getByLabelText("Numero bolla"), { target: { value: "BF-900" } });
    fireEvent.change(screen.getByLabelText("Controparte"), { target: { value: "Fornitore Beta" } });
    fireEvent.change(screen.getByLabelText("Peso totale (kg)"), { target: { value: "12.5" } });
    fireEvent.change(screen.getByLabelText("Lunghezza (cm)"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Larghezza (cm)"), { target: { value: "40" } });
    fireEvent.change(screen.getByLabelText("Altezza (cm)"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Crea bolla e salva misure" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const richiesta = fetchMock.mock.calls.find((chiamata) => chiamata[1]?.method === "POST");
    expect(JSON.parse(String(richiesta?.[1]?.body))).toMatchObject({
      operazione: "crea_bolla",
      numeroRiferimento: "BF-900",
      controparteNome: "Fornitore Beta",
      pesoKg: 12.5,
      misure: [{ quantita: 1, lunghezzaCm: 60, larghezzaCm: 40, altezzaCm: 30 }],
    });
  });

  it("spiega la fattura che congela tutto e mostra gli scostamenti", async () => {
    const congelata: BollaDocumento = {
      ...incompleta,
      congelata: true,
      fattura: { controlloId: "00000000-0000-4000-8000-000000000301", numero: "FT-77", data: "2026-09-10" },
      scostamenti: [{
        id: "00000000-0000-4000-8000-000000000401",
        idDocumento: 101,
        differenze: { peso_bolla: { spedizione: 4, gestionale: 5 } },
        rilevatoIl: "2026-09-12T11:00:00Z",
      }],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => risposta([congelata], true) }));
    render(<BolleView />);

    const bolla = await screen.findByRole("article", { name: "Bolla DV-101" });
    expect(within(bolla).getByText(/fattura FT-77/)).toBeTruthy();
    expect(within(bolla).getByRole("listitem").textContent).toContain(
      "Peso: congelato “4”, gestionale “5”"
    );
    fireEvent.click(within(bolla).getByRole("button", { name: /Dettagli e misure/ }));
    expect(within(bolla).queryByRole("button", { name: "Modifica dati" })).toBeNull();
    expect(within(bolla).getByLabelText("Lunghezza (cm)")).toBeDisabled();
    expect(within(bolla).getByRole("button", { name: "Scongela con motivo" })).toBeTruthy();
  });

  it("marca il campo forzato e tiene il valore gestionale a portata di sguardo", async () => {
    const forzata: BollaDocumento = {
      ...incompleta,
      soggetto: "Cliente corretto",
      campiForzati: {
        controparte_nome: {
          valorePrecedente: "Cliente originale",
          forzatoDa: "00000000-0000-4000-8000-000000000501",
          forzatoIl: "2026-09-12T12:00:00Z",
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => risposta([forzata]) }));
    render(<BolleView />);

    const bolla = await screen.findByRole("article", { name: "Bolla DV-101" });
    fireEvent.click(within(bolla).getByRole("button", { name: /Dettagli e misure/ }));
    expect(within(bolla).getByText("Forzato")).toBeTruthy();
    expect(within(bolla).getByText("Gestionale: Cliente originale")).toBeTruthy();
  });
});
