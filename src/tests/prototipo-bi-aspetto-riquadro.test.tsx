(globalThis as any).IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} takeRecords(){return []} };
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AspettoNonValido, classiTestoRiquadro, coloreContenutoKpi, coloreTestoSu, stileRiquadro, validaAspetto } from "@/lib/prototipo-bi/aspetto";
import { GraficoDaAnalisi } from "@/components/prototipo-bi/grafico-da-risultato";
import type { RisultatoQuery, SerieAnalisiEseguita } from "@/lib/prototipo-bi/tipi";

describe("aspetto del riquadro: sfondo, colore del testo, testo centrato", () => {
  afterEach(cleanup);

  it("valida e normalizza", () => {
    expect(validaAspetto({ sfondo: "#E6F6F9", coloreTesto: "#112233", testoCentrato: true })).toEqual({
      sfondo: "#e6f6f9", coloreTesto: "#112233", testoCentrato: true,
    });
    expect(validaAspetto({ testoCentrato: false })).toBeNull();
    expect(() => validaAspetto({ sfondo: "red" })).toThrow(AspettoNonValido);
    expect(() => validaAspetto({ coloreTesto: "url(x)" })).toThrow(AspettoNonValido);
  });

  it("il testo si adegua allo sfondo, salvo scelta esplicita", () => {
    expect(coloreTestoSu("#00a1be")).toBe("#ffffff");
    expect(coloreTestoSu("#f1f5f9")).toBe("#1a202c");
    expect(stileRiquadro({ sfondo: "#00a1be" })).toEqual({ backgroundColor: "#00a1be", color: "#ffffff" });
    expect(stileRiquadro({ sfondo: "#00a1be", coloreTesto: "#ffee00" })?.color).toBe("#ffee00");
    expect(stileRiquadro({ coloreTesto: "#ff0000" })).toEqual({ color: "#ff0000" });
    expect(stileRiquadro(null)).toBeUndefined();
    expect(classiTestoRiquadro({ testoCentrato: true })).toBe("text-center");
  });

  it("una KPI con sfondo e testo centrato", () => {
    const risultato = {
      spec: { metrica: "ordinato" }, metrica: "ordinato", unita: "euro", totale: 1000, certificata: true, avvisi: [],
      righe: [{ etichetta: "Totale", chiavi: {}, valore: 1000, conteggio: 1 }],
    } as unknown as RisultatoQuery;
    const serie = [{ ruolo: "principale", nome: "Ordinato", spec: risultato.spec, risultato }] as unknown as SerieAnalisiEseguita[];
    const { container } = render(<GraficoDaAnalisi serie={serie} aspetto={{ sfondo: "#00a1be", testoCentrato: true }} />);
    const radice = container.firstElementChild as HTMLElement;
    expect(radice.style.backgroundColor).toBe("rgb(0, 161, 190)");
    expect(radice.style.color).toBe("rgb(255, 255, 255)");
    expect(radice.className).toContain("text-center");
    expect(screen.getByText("Totale")).toBeInTheDocument();
  });
});

describe("colore del contenuto delle KPI", () => {
  it("si valida, e senza scelta segue testo e sfondo", () => {
    expect(validaAspetto({ coloreContenuto: "#FFFFFF" })).toEqual({ coloreContenuto: "#ffffff" });
    expect(() => validaAspetto({ coloreContenuto: "bianco" })).toThrow();
    expect(coloreContenutoKpi({ coloreContenuto: "#ffffff", coloreTesto: "#000000" })).toBe("#ffffff");
    expect(coloreContenutoKpi({ coloreTesto: "#ff0000" })).toBe("#ff0000");
    expect(coloreContenutoKpi({ sfondo: "#00a1be" })).toBe("#ffffff");
    expect(coloreContenutoKpi(null)).toBeUndefined();
  });

  it("l'etichetta della KPI prende il colore in linea", () => {
    const risultato = {
      spec: { metrica: "ordinato" }, metrica: "ordinato", unita: "numero", totale: 107, certificata: true, avvisi: [],
      righe: [{ etichetta: "Totale", chiavi: {}, valore: 107, conteggio: 1 }],
    } as unknown as RisultatoQuery;
    const serie = [{ ruolo: "principale", nome: "Righe", spec: risultato.spec, risultato }] as unknown as SerieAnalisiEseguita[];
    render(<GraficoDaAnalisi serie={serie} aspetto={{ sfondo: "#00a1be", coloreContenuto: "#ffffff" }} />);
    expect(screen.getByText("Totale")).toHaveStyle({ color: "rgb(255, 255, 255)" });
  });
});
