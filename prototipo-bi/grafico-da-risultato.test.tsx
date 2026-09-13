import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraficoDaRisultato } from "@/components/prototipo-bi/grafico-da-risultato";
import type { TipoGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type { RisultatoQuery } from "@/lib/prototipo-bi/tipi";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private callback: (elementi: unknown[]) => void) {}
      observe() {
        this.callback([{ contentRect: { width: 800, height: 400 } }]);
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

function risultatoCategorie(): RisultatoQuery {
  const righe = [
    { etichetta: "Componenti", chiavi: { bu: "Componenti" }, valore: 60, conteggio: 6 },
    { etichetta: "Impianti", chiavi: { bu: "Impianti" }, valore: 30, conteggio: 3 },
    { etichetta: "Costruito", chiavi: { bu: "Costruito" }, valore: 10, conteggio: 1 },
  ];
  return {
    spec: { metrica: "ordinato", raggruppa: ["bu"] },
    metrica: "ordinato",
    unita: "euro",
    righe,
    totale: 100,
    certificata: true,
    avvisi: [],
  };
}

function risultatoTemporale(raggruppato = false): RisultatoQuery {
  const righe = ["2026-01", "2026-02", "2026-03"].flatMap((periodo, indice) =>
    (raggruppato ? ["Componenti", "Impianti"] : [""]).map((categoria, posizione) => ({
      etichetta: periodo,
      chiavi: { periodo, ...(raggruppato ? { bu: categoria } : {}) },
      valore: 10 + indice * 3 + posizione,
      conteggio: 1,
    }))
  );
  return {
    spec: {
      metrica: "ordinato",
      granularita: "mese",
      raggruppa: raggruppato ? ["bu"] : undefined,
    },
    metrica: "ordinato",
    unita: "euro",
    righe,
    totale: righe.reduce((somma, riga) => somma + riga.valore, 0),
    certificata: true,
    avvisi: [],
  };
}

function risultatoHeatmap(): RisultatoQuery {
  const base = risultatoCategorie();
  return {
    ...base,
    spec: { metrica: "ordinato", raggruppa: ["bu", "agente"] },
    righe: base.righe.map((riga, indice) => ({
      ...riga,
      chiavi: { ...riga.chiavi, agente: indice % 2 === 0 ? "Rossi" : "Bianchi" },
    })),
  };
}

const casi: { tipo: TipoGrafico; risultato: () => RisultatoQuery }[] = [
  { tipo: "linee", risultato: risultatoTemporale },
  { tipo: "barre", risultato: risultatoCategorie },
  { tipo: "combo", risultato: risultatoTemporale },
  { tipo: "torta", risultato: risultatoCategorie },
  { tipo: "anelli", risultato: risultatoCategorie },
  { tipo: "areeImpilate", risultato: () => risultatoTemporale(true) },
  { tipo: "pareto", risultato: risultatoCategorie },
  { tipo: "bullet", risultato: risultatoCategorie },
  { tipo: "heatmap", risultato: risultatoHeatmap },
  { tipo: "quadranti", risultato: risultatoCategorie },
  { tipo: "imbuto", risultato: risultatoCategorie },
  { tipo: "treemap", risultato: risultatoCategorie },
  { tipo: "sparkline", risultato: risultatoTemporale },
  {
    tipo: "kpi",
    risultato: () => ({
      ...risultatoCategorie(),
      spec: { metrica: "ordinato" },
      righe: [risultatoCategorie().righe[0]],
    }),
  },
  { tipo: "tabella", risultato: risultatoCategorie },
];

describe("GraficoDaRisultato", () => {
  for (const caso of casi) {
    it(`monta il tipo ${caso.tipo} senza errori`, () => {
      const { container } = render(
        <GraficoDaRisultato risultato={caso.risultato()} tipo={caso.tipo} altezza={240} />
      );
      expect(container).not.toBeEmptyDOMElement();
    });
  }

  it("ripiega sulla tabella con una nota quando il tipo non è applicabile", () => {
    render(<GraficoDaRisultato risultato={risultatoTemporale()} tipo="torta" />);
    expect(screen.getByRole("status")).toHaveTextContent(/non è applicabile.*tabella completa/i);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("gestisce zero righe senza errori", () => {
    const vuoto = { ...risultatoCategorie(), righe: [], totale: 0 };
    render(<GraficoDaRisultato risultato={vuoto} />);
    expect(screen.getByText(/Nessun dato/)).toBeInTheDocument();
  });
});
