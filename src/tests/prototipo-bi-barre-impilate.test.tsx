import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { datiBarreImpilate } from "@/components/prototipo-bi/barre-impilate";
import { GraficoDaRisultato } from "@/components/prototipo-bi/grafico-da-risultato";
import { SceltaGrafico } from "@/components/prototipo-bi/scelta-grafico";
import { NOMI_GRAFICI, TIPI_GRAFICO, graficiPossibili } from "@/lib/prototipo-bi/scelta-grafico";
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
});

function risultato(spec: SpecQuery, righe: [Record<string, string>, number][]): RisultatoQuery {
  return {
    spec,
    metrica: "portafoglio",
    unita: "euro",
    righe: righe.map(([chiavi, valore]) => ({ etichetta: Object.values(chiavi).join(" · "), chiavi, valore, conteggio: 1 })),
    totale: righe.reduce((t, [, v]) => t + v, 0),
    certificata: true,
    avvisi: [],
  };
}

// Il caso segnalato: portafoglio per mese diviso per business unit.
const PORTAFOGLIO = risultato({ metrica: "portafoglio", granularita: "mese", raggruppa: ["bu"] }, [
  [{ periodo: "2026-10", bu: "COMPONENTI" }, 100],
  [{ periodo: "2026-10", bu: "IMPIANTI" }, 50],
  [{ periodo: "2026-11", bu: "COMPONENTI" }, 80],
]);

describe("barre impilate", () => {
  it("sono proposte per un valore nel tempo diviso per una dimensione", () => {
    expect(graficiPossibili(PORTAFOGLIO)).toContain("barreImpilate");
  });

  it("una colonna per mese, una pila per business unit", () => {
    const d = datiBarreImpilate(PORTAFOGLIO)!;
    expect(d.pile).toEqual(["COMPONENTI", "IMPIANTI"]);
    expect(d.righe).toEqual([
      { asse: "2026-10", COMPONENTI: 100, IMPIANTI: 50 },
      { asse: "2026-11", COMPONENTI: 80 },
    ]);
  });

  it("si disegnano invece di ripiegare su una tabella", () => {
    render(<GraficoDaRisultato risultato={PORTAFOGLIO} tipo="barreImpilate" />);
    expect(screen.queryByText(/non è applicabile/)).not.toBeInTheDocument();
  });
});

describe("scelta del grafico con anteprima", () => {
  it("il catalogo ha un nome per ogni tipo, e nessun elenco ricopiato", () => {
    expect(TIPI_GRAFICO).toContain("barreImpilate");
    expect(TIPI_GRAFICO.every((t) => NOMI_GRAFICI[t])).toBe(true);
  });

  it("mostra un'anteprima per ogni voce e sceglie al clic", () => {
    const onChange = vi.fn();
    render(
      <SceltaGrafico etichetta="Visualizzazione" valore="barre" opzioni={["barre", "barreImpilate", "linee"]} onChange={onChange} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Visualizzazione" }));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    // un'anteprima nel bottone e una per voce; l'elenco sta nel body, fuori dal
    // riquadro, perche' dentro veniva tagliato
    expect(document.body.querySelectorAll("svg[viewBox='0 0 40 26']").length).toBe(4);
    expect(screen.getByRole("listbox").closest("body > div")?.getAttribute("style")).toContain("position: fixed");
    fireEvent.click(screen.getByRole("option", { name: /Barre impilate/ }));
    expect(onChange).toHaveBeenCalledWith("barreImpilate");
  });
});
