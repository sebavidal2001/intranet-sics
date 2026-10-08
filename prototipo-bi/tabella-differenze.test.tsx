import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraficoDaAnalisi } from "@/components/prototipo-bi/grafico-da-risultato";
import { validaAspetto, AspettoNonValido } from "@/lib/prototipo-bi/aspetto";
import type { AspettoGrafico, RisultatoQuery, SerieAnalisiEseguita } from "@/lib/prototipo-bi/tipi";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  vi.stubGlobal("IntersectionObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  });
});

function risultato(metrica: "ordinato" | "fatturato", valori: number[]): RisultatoQuery {
  const clienti = ["ACME", "BETA", "GAMMA"];
  return {
    spec: { metrica, raggruppa: ["cliente"] },
    metrica,
    unita: "euro",
    righe: valori.map((valore, i) => ({ etichetta: clienti[i], chiavi: { cliente: clienti[i] }, valore, conteggio: 1 })),
    totale: valori.reduce((a, b) => a + b, 0),
    certificata: true,
    avvisi: [],
  };
}

function serie(): SerieAnalisiEseguita[] {
  const o = risultato("ordinato", [100, 200, 300]);
  const f = risultato("fatturato", [80, 220, 300]);
  return [
    { ruolo: "principale", nome: "Ordinato", spec: o.spec, risultato: o },
    { ruolo: "confronto", nome: "Fatturato", spec: f.spec, risultato: f },
  ];
}

function tabella(aspetto?: AspettoGrafico) {
  return render(<GraficoDaAnalisi tipo="tabella" serie={serie()} aspetto={aspetto ?? null} />);
}

describe("differenze in tabella", () => {
  it("senza scelte resta il comportamento storico: il confronto produce un Delta", () => {
    tabella();
    expect(screen.getByText("Delta")).toBeInTheDocument();
  });

  it("con l'elenco vuoto nessuna differenza compare da sola", () => {
    tabella({ tabella: { differenze: [] } });
    expect(screen.queryByText("Delta")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Δ/)).not.toBeInTheDocument();
  });

  it("una differenza scelta compare con le due misure nel titolo", () => {
    tabella({ tabella: { differenze: [{ da: 0, con: 1 }] } });
    expect(screen.getByText("Δ Ordinato − Fatturato")).toBeInTheDocument();
    expect(screen.getByText("+20 €")).toBeInTheDocument(); // ACME 100-80
  });

  it("la differenza in percentuale e' sul secondo termine", () => {
    tabella({ tabella: { differenze: [{ da: 0, con: 1, modo: "percentuale" }] } });
    expect(screen.getByText("Δ% Ordinato su Fatturato")).toBeInTheDocument();
    expect(screen.getByText("+25.0%")).toBeInTheDocument(); // (100-80)/80
  });

  it("si possono mostrare due differenze insieme", () => {
    tabella({ tabella: { differenze: [{ da: 0, con: 1 }, { da: 1, con: 0 }] } });
    expect(screen.getByText("Δ Ordinato − Fatturato")).toBeInTheDocument();
    expect(screen.getByText("Δ Fatturato − Ordinato")).toBeInTheDocument();
  });
});

describe("validaAspetto: differenze", () => {
  it("conserva un elenco vuoto: vuol dire «nessuna»", () => {
    expect(validaAspetto({ tabella: { differenze: [] } })?.tabella?.differenze).toEqual([]);
  });
  it("normalizza il modo", () => {
    expect(validaAspetto({ tabella: { differenze: [{ da: 0, con: 2, modo: "assoluta" }, { da: 1, con: 0, modo: "percentuale" }] } })?.tabella?.differenze)
      .toEqual([{ da: 0, con: 2 }, { da: 1, con: 0, modo: "percentuale" }]);
  });
  it("rifiuta una misura contro se stessa, indici assurdi e troppe colonne", () => {
    expect(() => validaAspetto({ tabella: { differenze: [{ da: 1, con: 1 }] } })).toThrow(AspettoNonValido);
    expect(() => validaAspetto({ tabella: { differenze: [{ da: -1, con: 0 }] } })).toThrow(AspettoNonValido);
    expect(() => validaAspetto({ tabella: { differenze: [{ da: 0, con: 1, modo: "x" }] } })).toThrow(AspettoNonValido);
    expect(() => validaAspetto({ tabella: { differenze: Array.from({ length: 7 }, () => ({ da: 0, con: 1 })) } })).toThrow(AspettoNonValido);
  });
});
