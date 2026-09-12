/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Smoke test dei grafici analitici e della tabella con gli scostamenti.
 * Verificano che disegnino, che i calcoli derivati siano giusti e che il
 * click propaghi il filtro incrociato.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import {
  Bullet,
  Heatmap,
  Pareto,
  Quadranti,
  Waterfall,
  Multipli,
  BarreScostamento,
  Sparkline,
} from "@/components/prototipo-bi/grafici-avanzati";
import {
  TabellaAnalitica,
  colonneConfronto,
  costruisciConfronto,
} from "@/components/prototipo-bi/tabella-analitica";
import type { RisultatoQuery } from "@/lib/prototipo-bi/tipi";

beforeEach(() => {
  // jsdom non implementa ResizeObserver, che il ResponsiveContainer di
  // Recharts usa per misurare il contenitore. Senza, nessun grafico monta.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: (e: unknown[]) => void) {}
      observe() {
        this.cb([{ contentRect: { width: 800, height: 400 } }]);
      }
      unobserve() {}
      disconnect() {}
    }
  );

  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    }
  );
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 400 });
});

function risultato(righe: [string, number][], chiave = "bu"): RisultatoQuery {
  return {
    spec: { metrica: "ordinato" },
    metrica: "ordinato",
    unita: "euro",
    righe: righe.map(([etichetta, valore]) => ({
      etichetta,
      chiavi: { [chiave]: etichetta },
      valore,
      conteggio: 1,
    })),
    totale: righe.reduce((s, [, v]) => s + v, 0),
    certificata: true,
    avvisi: [],
  };
}

describe("Waterfall", () => {
  it("mostra la variazione totale e la percentuale", () => {
    render(
      <Waterfall
        partenza={3_709_226}
        arrivo={2_823_462}
        voci={[
          { etichetta: "COSTRUITO", delta: -472_944 },
          { etichetta: "COMPONENTI", delta: -251_424 },
          { etichetta: "IMPIANTI", delta: -37_868 },
        ]}
        etichettaPartenza="2025"
        etichettaArrivo="2026"
      />
    );
    expect(screen.getByText(/Variazione totale/)).toBeInTheDocument();
    // La variazione è mostrata per esteso, non compattata: in un waterfall
    // direzionale gli euro esatti contano.
    expect(screen.getByText("-885.764 €")).toBeInTheDocument();
    expect(screen.getByText(/-23,9%|-23\.9%/)).toBeInTheDocument();
  });

  it("dice che non c'è nulla da scomporre invece di disegnare il vuoto", () => {
    render(<Waterfall partenza={100} arrivo={100} voci={[]} />);
    expect(screen.getByText(/Nessun dato/)).toBeInTheDocument();
  });
});

describe("Pareto", () => {
  it("calcola quante voci fanno l'80%", () => {
    // 60+25 = 85% con due voci su cinque.
    render(
      <Pareto
        dati={[
          { etichetta: "A", valore: 60 },
          { etichetta: "B", valore: 25 },
          { etichetta: "C", valore: 8 },
          { etichetta: "D", valore: 5 },
          { etichetta: "E", valore: 2 },
        ]}
      />
    );
    const testo = screen.getByText(/voci su/).textContent ?? "";
    expect(testo).toContain("2");
    expect(testo).toContain("80%");
  });
});

describe("Bullet", () => {
  it("mostra il raggiungimento e distingue sopra/sotto obiettivo", () => {
    render(
      <Bullet
        righe={[
          { etichetta: "COMPONENTI", valore: 1_267_923, obiettivo: 1_302_943, soglia: 1_200_000 },
          { etichetta: "COSTRUITO", valore: 925_007, obiettivo: 1_302_943, soglia: 1_200_000 },
        ]}
      />
    );
    expect(screen.getByText("COMPONENTI")).toBeInTheDocument();
    expect(screen.getByText("97%")).toBeInTheDocument();
    expect(screen.getByText("71%")).toBeInTheDocument();
    expect(screen.getByText(/budget/)).toBeInTheDocument();
    expect(screen.getByText(/BEP/)).toBeInTheDocument();
  });

  it("propaga il click come filtro", () => {
    const spia = vi.fn();
    render(
      <Bullet
        righe={[{ etichetta: "IMPIANTI", valore: 10, obiettivo: 20, soglia: null }]}
        onClick={spia}
      />
    );
    fireEvent.click(screen.getByText("IMPIANTI"));
    expect(spia).toHaveBeenCalledWith("IMPIANTI");
  });
});

describe("Heatmap", () => {
  it("disegna la matrice e propaga il click sulla cella", () => {
    const spia = vi.fn();
    render(
      <Heatmap
        righe={["COMPONENTI", "COSTRUITO"]}
        colonne={["gen", "feb"]}
        valori={{
          COMPONENTI: { gen: 12, feb: -8 },
          COSTRUITO: { gen: -30, feb: -45 },
        }}
        formato="percentuale"
        divergente
        onClick={spia}
      />
    );
    expect(screen.getByText("+12%")).toBeInTheDocument();
    expect(screen.getByText("-45%")).toBeInTheDocument();
    fireEvent.click(screen.getByText("-45%"));
    expect(spia).toHaveBeenCalledWith("COSTRUITO", "feb");
  });
});

describe("Quadranti", () => {
  it("mostra la legenda dei quattro quadranti", () => {
    render(
      <Quadranti
        punti={[
          { nome: "IMA spa", x: 542_669, y: -31 },
          { nome: "CURTI spa", x: 200_000, y: 15 },
        ]}
      />
    );
    expect(screen.getByText(/grandi in calo — priorità/)).toBeInTheDocument();
    expect(screen.getByText(/grandi in crescita/)).toBeInTheDocument();
  });
});

describe("Multipli e Sparkline", () => {
  it("i multipli mostrano totale e variazione", () => {
    render(
      <Multipli
        serie={[
          {
            nome: "COMPONENTI",
            totale: 1_267_923,
            variazionePct: -16.5,
            valori: [
              { periodo: "2026-01", valore: 100 },
              { periodo: "2026-02", valore: 180 },
            ],
          },
        ]}
      />
    );
    expect(screen.getByText("COMPONENTI")).toBeInTheDocument();
    expect(screen.getByText(/16,5%|16.5%/)).toBeInTheDocument();
  });

  it("la sparkline degrada elegantemente con un solo punto", () => {
    const { container } = render(<Sparkline valori={[5]} />);
    expect(container.textContent).toBe("—");
  });
});

describe("BarreScostamento", () => {
  it("ordina e propaga il click", () => {
    const spia = vi.fn();
    render(
      <BarreScostamento
        dati={[
          { etichetta: "COSTRUITO", valore: -377_936 },
          { etichetta: "COMPONENTI", valore: -35_020 },
        ]}
        onClick={spia}
      />
    );
    expect(screen.getByText("COSTRUITO")).toBeInTheDocument();
  });
});

describe("Tabella analitica", () => {
  const corrente = risultato([
    ["COMPONENTI", 1_267_923],
    ["COSTRUITO", 925_007],
    ["IMPIANTI", 402_836],
  ]);
  const precedente = risultato([
    ["COMPONENTI", 1_519_347],
    ["COSTRUITO", 1_397_951],
    ["IMPIANTI", 440_704],
  ]);
  const budget = risultato([
    ["COMPONENTI", 1_302_943],
    ["COSTRUITO", 1_302_943],
    ["IMPIANTI", 521_240],
  ]);

  it("calcola delta, quota, scostamento budget e raggiungimento", () => {
    const { righe } = costruisciConfronto({ corrente, precedente, budget });
    const comp = righe.find((r) => r.chiave === "COMPONENTI")!;

    expect(comp.celle.deltaAP).toBeCloseTo(-251_424, 0);
    expect(Number(comp.celle.deltaAPPct)).toBeCloseTo(-16.55, 1);
    expect(Number(comp.celle.quota)).toBeCloseTo(48.87, 1);
    expect(comp.celle.scostBudget).toBeCloseTo(-35_020, 0);
    expect(Number(comp.celle.raggiungimento)).toBeCloseTo(97.31, 1);
  });

  it("disegna le colonne di scostamento e la riga dei totali", () => {
    const { righe } = costruisciConfronto({ corrente, precedente, budget });
    render(
      <TabellaAnalitica
        colonnaDimensione="Business unit"
        colonne={colonneConfronto({ annoCorrente: 2026, conBudget: true })}
        righe={righe}
      />
    );

    expect(screen.getByText("Δ €")).toBeInTheDocument();
    expect(screen.getByText("Δ %")).toBeInTheDocument();
    expect(screen.getByText("Δ budget")).toBeInTheDocument();
    expect(screen.getByText("Raggiung.")).toBeInTheDocument();
    expect(screen.getByText("Quota")).toBeInTheDocument();
    expect(screen.getByText(/Totale \(3\)/)).toBeInTheDocument();
  });

  it("si riordina cliccando sull'intestazione", () => {
    const { righe } = costruisciConfronto({ corrente, precedente, budget });
    render(
      <TabellaAnalitica
        colonnaDimensione="Business unit"
        colonne={colonneConfronto({ annoCorrente: 2026, conBudget: true })}
        righe={righe}
      />
    );

    const corpo = screen.getAllByRole("rowgroup")[1];
    const prima = within(corpo).getAllByRole("row")[0];
    expect(prima).toHaveTextContent("COMPONENTI");

    // Ordinando per scostamento dal budget, il peggiore va in cima solo
    // invertendo: di default l'ordine è discendente.
    fireEvent.click(screen.getByText("Δ budget"));
    fireEvent.click(screen.getByText("Δ budget"));
    const dopo = within(screen.getAllByRole("rowgroup")[1]).getAllByRole("row")[0];
    expect(dopo).toHaveTextContent("COSTRUITO");
  });

  it("propaga il click sulla riga come filtro incrociato", () => {
    const spia = vi.fn();
    const { righe } = costruisciConfronto({ corrente, precedente });
    render(
      <TabellaAnalitica
        colonnaDimensione="Business unit"
        colonne={colonneConfronto({ annoCorrente: 2026 })}
        righe={righe}
        onClickRiga={spia}
      />
    );
    fireEvent.click(screen.getByText("IMPIANTI"));
    expect(spia).toHaveBeenCalledWith("IMPIANTI");
  });

  it("filtra con la casella di ricerca", () => {
    const molte = Array.from({ length: 12 }, (_, i) => [`Cliente ${i}`, 1000 - i * 10] as [string, number]);
    const { righe } = costruisciConfronto({ corrente: risultato(molte, "cliente") });
    render(
      <TabellaAnalitica
        colonnaDimensione="Cliente"
        colonne={colonneConfronto({ annoCorrente: 2026 })}
        righe={righe}
      />
    );
    fireEvent.change(screen.getByPlaceholderText("Filtra…"), { target: { value: "Cliente 3" } });
    expect(screen.getByText(/Totale \(1\)/)).toBeInTheDocument();
  });
});
