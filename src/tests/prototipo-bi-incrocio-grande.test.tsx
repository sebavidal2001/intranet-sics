import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Heatmap, estremiHeatmap } from "@/components/prototipo-bi/grafici-avanzati";
import { graficiPossibili, scegliGrafico } from "@/lib/prototipo-bi/scelta-grafico";
import type { RisultatoQuery } from "@/lib/prototipo-bi/tipi";

// Codici articolo × fornitori: migliaia di righe per decine di colonne.
function incrocio(articoli: number, fornitori: number): RisultatoQuery {
  const righe = [];
  for (let a = 0; a < articoli; a++) {
    righe.push({
      etichetta: `ART${a} · F${a % fornitori}`,
      chiavi: { codice_articolo: `ART${a}`, fornitore: `F${a % fornitori}` },
      valore: 10,
      conteggio: 1,
    });
  }
  return {
    spec: { metrica: "acquisti_quantita", raggruppa: ["codice_articolo", "fornitore"] },
    metrica: "acquisti_quantita",
    unita: "numero",
    righe,
    totale: articoli * 10,
    certificata: true,
    avvisi: [],
  } as unknown as RisultatoQuery;
}

describe("incrocio di due campi troppo grande", () => {
  it("propone la tabella e non offre mappa di calore, matrice o barre impilate", () => {
    const r = incrocio(5000, 80);
    expect(scegliGrafico(r).tipo).toBe("tabella");
    const possibili = graficiPossibili(r);
    for (const tipo of ["heatmap", "matrice", "barreImpilate"] as const) expect(possibili).not.toContain(tipo);
    expect(possibili).toContain("tabella");
  });

  it("un incrocio piccolo resta una mappa di calore", () => {
    expect(scegliGrafico(incrocio(40, 4)).tipo).toBe("heatmap");
  });

  it("la mappa di calore regge centinaia di migliaia di celle (niente spread su min e max)", () => {
    // 700 × 300 = 210.000 celle: oltre il limite degli argomenti di una funzione.
    // Si prova il calcolo degli estremi, non il disegno: rendere 210.000 celle
    // in jsdom costava 70 s da solo e sforava i 120 s con la suite in parallelo.
    const righe = Array.from({ length: 700 }, (_, i) => `r${i}`);
    const colonne = Array.from({ length: 300 }, (_, i) => `c${i}`);
    const valori = { r0: { c0: 5 }, r699: { c299: -3 } };
    expect(estremiHeatmap(righe, colonne, valori)).toEqual({ min: -3, max: 5, assoluto: 5 });
  });

  it("la mappa di calore si disegna con i suoi estremi", () => {
    const { container } = render(<Heatmap righe={["a", "b"]} colonne={["x", "y"]} valori={{ a: { x: 5 } }} formato="numero" />);
    expect(container.textContent).toContain("5");
  });
});
