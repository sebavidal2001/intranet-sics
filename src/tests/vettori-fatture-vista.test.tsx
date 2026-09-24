import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { estremiDalNomeFile, FattureView } from "@/components/portali/vettori/fatture-view";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("separa le direzioni e lascia pesi e quadratura nei dettagli", async () => {
  const riga = (n: number, direzione: string) => ({ riga_numero: n, data: "2026-07-01", riferimento: `B${n}`, controparte: `Azienda ${n}`, direzione, totale: 20, peso: 3, abbinamento: "numero", motivo_abbinamento: "Bolla trovata", controllo: { esito: "in_linea", atteso_totale: 20, peso_reale: 3, peso_volumetrico: 5, peso_tassabile: 5, scostamento: 0, avvertenze: [] } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ fattura: { vettore: "gls", numero: "1", data: "2026-07-31", avvertenze: [], righeNonLette: [] }, quadratura: { ok: true, confronti: [], note: [] }, righe: [riga(1, "entrata"), riga(2, "uscita")] }) }));
  const { container } = render(<FattureView />);
  fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [new File(["pdf"], "fattura.pdf", { type: "application/pdf" })] } });
  await screen.findByText("Azienda 1");
  expect(screen.queryByText("Azienda 2")).toBeNull();
  expect(screen.getByText("Dettagli della quadratura").closest("details")!.open).toBe(false);
  const articolo = screen.getByRole("article", { name: "Spedizione B1" });
  const dettagli = within(articolo).getByText("Dettagli e misure").closest("details")!;
  expect(dettagli.open).toBe(false);
  expect(within(articolo).getByText("Peso volumetrico").closest("details")).toBe(dettagli);
  fireEvent.click(screen.getByRole("button", { name: /Invii a clienti/ }));
  await waitFor(() => expect(screen.getByText("Azienda 2")).toBeTruthy());
  expect(screen.queryByText("Azienda 1")).toBeNull();
  expect(screen.getByText("2 spedizioni lette", { exact: false })).toBeTruthy();
});

it("propone gli estremi dal nome GLS e non abilita il salvataggio se ne manca uno", async () => {
  const risposta = {
    nomeFile: "FAT-BM_3655379_E6_0667_2026_07.pdf",
    origineMetadati: { numero: "assente", data: "assente" },
    fattura: { vettore: "gls", numero: null, data: null, avvertenze: [], righeNonLette: [] },
    quadratura: { ok: true, confronti: [], note: [] },
    righe: [],
  };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => risposta }));
  const { container } = render(<FattureView />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["pdf"], risposta.nomeFile, { type: "application/pdf" })] },
  });

  expect(await screen.findByLabelText("Numero fattura")).toHaveValue("3655379");
  expect(screen.getByLabelText("Data fattura")).toHaveValue("2026-07-31");
  expect(screen.getByText(/NOME DEL FILE, non dal documento/)).toBeTruthy();
  const salva = screen.getByRole("button", { name: "Acquisisci la fattura" });
  expect(salva).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Numero fattura"), { target: { value: "" } });
  expect(salva).toBeDisabled();
});

it("calcola davvero l'ultimo giorno del mese indicato nel nome file", () => {
  expect(estremiDalNomeFile("FAT-BM_3655379_E6_0667_2026_02.pdf")).toEqual({
    numero: "3655379",
    data: "2026-02-28",
  });
});

it("una fattura che non quadra si acquisisce solo dichiarando il motivo", async () => {
  // Richiesta dell'amministrazione (24/09/2026): salvare anche se non corrisponde
  // al prospetto, lasciando l'avviso dove ci sono problemi.
  const risposta = {
    nomeFile: "tnt.pdf",
    origineMetadati: { numero: "documento", data: "documento" },
    fattura: { vettore: "tnt", numero: "T-1", data: "2026-07-31", avvertenze: [], righeNonLette: [] },
    quadratura: { ok: false, confronti: [], note: ["Il nolo non torna di 9,04 €."] },
    righe: [],
  };
  const fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes("anteprima=1") ? risposta : { salvata: true, esito: { righe: 0, spedizioni_nuove: 0, anomalie: 0 } }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  const { container } = render(<FattureView />);
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["pdf"], risposta.nomeFile, { type: "application/pdf" })] },
  });

  const salva = await screen.findByRole("button", { name: "Acquisisci senza quadratura" });
  expect(salva).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Motivo dell'acquisizione senza quadratura"), { target: { value: "riga illeggibile, la integro a mano" } });
  expect(salva).toBeEnabled();
  fireEvent.click(salva);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const corpo = fetchMock.mock.calls[1][1].body as FormData;
  expect(corpo.get("motivoSenzaQuadratura")).toBe("riga illeggibile, la integro a mano");
});
