import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoricoView } from "@/components/portali/vettori/storico-view";
import type {
  EsitoStorico,
  RigaStorico,
  ValoriFiltroStorico,
} from "@/lib/portali/vettori/tipi";

const nonFatturata: RigaStorico = {
  id: "s1",
  fattura_id: null,
  direzione: "uscita",
  vettore_codice: "gls",
  vettore_nome: "GLS",
  fattura_numero: null,
  data_fattura: null,
  anno: null,
  mese: null,
  stato_fattura: null,
  stato_fatturazione: "non_fatturata",
  origine: "excel_storico",
  riga_numero: null,
  data_spedizione: "2026-07-12",
  numero_spedizione: null,
  riferimento: "2026/004512",
  controparte: "ROSSI SPA",
  controparte_codice: "CP1",
  provincia: "MI",
  cap: "20100",
  porto_descrizione: "Franco",
  a_nostro_carico: true,
  colli: 2,
  peso: 148,
  peso_volumetrico: null,
  peso_tassato: null,
  nolo: null,
  supplementi: null,
  adeguamento: null,
  carburante: null,
  fatturato: null,
  atteso: null,
  scostamento: null,
  esito: null,
  abbinamento: null,
  listino: null,
  zona: null,
  peso_applicato: null,
  avvertenze: null,
  anomalie: 0,
  anomalie_aperte: 0,
};

const iniziali: EsitoStorico = {
  righe: [nonFatturata],
  totali: {
    righe: 1,
    righe_valide: 0,
    righe_bozza: 0,
    spedizioni_non_fatturate: 1,
    colli: 2,
    kg: 148,
    fatturato: 0,
    atteso: 0,
    anomalie: 0,
    con_anomalie_aperte: 0,
  },
  per_direzione: { uscita: 1 },
  pagina: 1,
  per_pagina: 100,
};

const valori: ValoriFiltroStorico = {
  vettori: [{ codice: "gls", nome: "GLS" }],
  province: ["MI"],
  periodi: [{ anno: 2026, mese: 7 }],
  anni: [2026],
};

describe("StoricoView con spedizione senza fattura", () => {
  it("dichiara lo stato e non mostra zero euro nei totali economici", () => {
    render(<StoricoView iniziali={iniziali} valori={valori} />);

    expect(screen.getAllByText(/non ancora fatturat/i).length).toBeGreaterThan(0);
    for (const titolo of ["Fatturato", "Atteso", "Differenza"]) {
      const etichetta = screen
        .getAllByText(titolo)
        .find((elemento) => elemento.tagName === "P");
      const tessera = etichetta?.parentElement;
      if (!tessera) throw new Error(`Tessera ${titolo} non trovata`);
      expect(within(tessera).getByText("—")).toBeInTheDocument();
      expect(tessera).not.toHaveTextContent("€0");
    }
  });

  it("nel dettaglio spiega che importi e controllo arriveranno con la fattura", () => {
    render(<StoricoView iniziali={iniziali} valori={valori} />);
    fireEvent.click(screen.getByText("2026/004512"));

    expect(screen.getByText("Fattura non ancora presente. Gli importi non sono valorizzati.")).toBeInTheDocument();
    expect(screen.getByText(/esito e scostamento non sono ancora calcolabili/i)).toBeInTheDocument();
    expect(screen.getByText("Excel storico")).toBeInTheDocument();
    expect(screen.getByText("Non ancora eseguito")).toBeInTheDocument();
  });
});
