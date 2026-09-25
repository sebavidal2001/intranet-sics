import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GraficoDaRisultato } from "@/components/prototipo-bi/grafico-da-risultato";
import { graficiPossibili } from "@/lib/prototipo-bi/scelta-grafico";
import type { RisultatoQuery, SpecQuery } from "@/lib/prototipo-bi/tipi";

beforeEach(() => {
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
});

function risultato(spec: SpecQuery, righe: [Record<string, string>, number][]): RisultatoQuery {
  return {
    spec,
    metrica: "righe_preventivo",
    unita: "numero",
    righe: righe.map(([chiavi, valore]) => ({
      etichetta: Object.values(chiavi).join(" · "),
      chiavi,
      valore,
      conteggio: 1,
    })),
    totale: righe.reduce((t, [, v]) => t + v, 0),
    certificata: true,
    avvisi: [],
  };
}

const ADDETTI = ["LUCIA RODA", "JESSICA GORDINI", "BARBARA GIORIO", "VALERIA BATTELANI", "ERIKA LIVRERI", "GIACOMO DALL'ORSO", "DANIELE BONI"];

describe("grafici del Back office nella dashboard", () => {
  it("le aree impilate reggono sette addetti (le minori vanno in «Altri»)", () => {
    const r = risultato(
      { metrica: "righe_preventivo", granularita: "mese", raggruppa: ["creatore"] },
      ADDETTI.flatMap((a, i) => [
        [{ periodo: "2026-01", creatore: a }, 100 - i * 10],
        [{ periodo: "2026-02", creatore: a }, 90 - i * 10],
      ] as [Record<string, string>, number][])
    );
    expect(graficiPossibili(r)).toContain("areeImpilate");
    render(<GraficoDaRisultato risultato={r} tipo="areeImpilate" />);
    expect(screen.queryByText(/non è applicabile/)).not.toBeInTheDocument();
  });

  it("la heatmap di una serie giornaliera e' un calendario", () => {
    const r = risultato({ metrica: "righe_preventivo", granularita: "giorno" }, [
      [{ periodo: "2026-01-07" }, 1],
      [{ periodo: "2026-01-08" }, 28],
      [{ periodo: "2026-01-09" }, 19],
    ]);
    expect(graficiPossibili(r)).toContain("heatmap");
    render(<GraficoDaRisultato risultato={r} tipo="heatmap" />);
    expect(screen.queryByText(/non è applicabile/)).not.toBeInTheDocument();
    expect(screen.queryByText("2026-01-08")).not.toBeInTheDocument();
  });
});
