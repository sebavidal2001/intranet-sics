import { describe, it, expect } from "vitest";
import {
  applicaQuote,
  confrontaConsuntivo,
  sommaSplit,
  scalaSplit,
  totaleSplit,
  verdettoDaPercentuale,
  SPLIT_VUOTO,
  type ConsuntivoNumeri,
} from "@/lib/portali/preventivatore/split-costi";

describe("applicaQuote", () => {
  it("applica le percentuali di Impresa al costo usato e quadra sempre", () => {
    // Standard di Impresa: 100 € = 60 materiale + 30 manodopera + 10 trattamenti esterni.
    const { split, fonte } = applicaQuote(50, {
      costo_totale: 100, materiale: 60, manodopera: 30, lavorazione: 0, lav_esterna: 10, altro: 0,
    });
    expect(fonte).toBe("impresa");
    expect(split.materiale).toBeCloseTo(30);
    expect(split.manodopera).toBeCloseTo(15);
    expect(split.lav_esterna).toBeCloseTo(5);
    expect(totaleSplit(split)).toBeCloseTo(50);
  });

  it("assorbe l'arrotondamento in «altro»: la somma è esattamente il costo", () => {
    const { split } = applicaQuote(10, {
      costo_totale: 3, materiale: 1, manodopera: 1, lavorazione: 0, lav_esterna: 1, altro: 0,
    });
    expect(totaleSplit(split)).toBeCloseTo(10, 9);
  });

  it("senza standard di Impresa tutto è materia prima (assunto)", () => {
    expect(applicaQuote(7, null)).toEqual({ split: { ...SPLIT_VUOTO, materiale: 7 }, fonte: "assunto" });
    expect(applicaQuote(7, { costo_totale: 0, materiale: 0, manodopera: 0, lavorazione: 0, lav_esterna: 0, altro: 0 }).fonte).toBe("assunto");
  });
});

describe("operazioni sugli split", () => {
  it("somma e scala componente per componente", () => {
    const a = { ...SPLIT_VUOTO, materiale: 2, manodopera: 1 };
    const b = { ...SPLIT_VUOTO, materiale: 3, lav_esterna: 4 };
    expect(sommaSplit(a, b)).toEqual({ materiale: 5, manodopera: 1, lavorazione: 0, lav_esterna: 4, altro: 0 });
    expect(scalaSplit(a, 3).materiale).toBe(6);
  });
});

describe("confrontaConsuntivo", () => {
  // Selezione di 3 pezzi: 216 € di materiale, 210 € di manodopera, 30 € di trattamenti esterni.
  const base: ConsuntivoNumeri = {
    quantita_articolo: 3,
    prev_materiale: 216, prev_manodopera: 210, prev_lavorazione: 0, prev_lav_esterna: 30, prev_altro: 0, prev_totale: 456,
    rif_materiale: 60, rif_manodopera: 30, rif_lavorazione: 0, rif_lav_esterna: 10, rif_altro: 0, rif_totale: 100,
  };

  it("porta tutto a costo per pezzo prima di confrontare", () => {
    const { righe, totale } = confrontaConsuntivo(base);
    expect(totale.preventivato).toBeCloseTo(152);
    expect(righe[0].preventivato).toBeCloseTo(72);
    expect(righe[1].preventivato).toBeCloseTo(70);
  });

  it("scostamento = riferimento − preventivato: negativo se il preventivo era prudente", () => {
    const { righe, totale, verdetto } = confrontaConsuntivo(base);
    expect(righe[0].scostamento).toBeCloseTo(-12);
    expect(totale.scostamento).toBeCloseTo(-52);
    expect(totale.scostamentoPct).toBeCloseTo((-52 / 152) * 100);
    expect(verdetto).toBe("sovrastimato");
  });

  it("riconosce un preventivo sottostimato e uno in linea", () => {
    expect(confrontaConsuntivo({ ...base, rif_totale: 200 }).verdetto).toBe("sottostimato");
    expect(confrontaConsuntivo({ ...base, rif_totale: 152.5 }).verdetto).toBe("in_linea");
  });

  it("senza riferimento di Impresa non inventa uno scostamento", () => {
    const out = confrontaConsuntivo({
      ...base, rif_materiale: null, rif_manodopera: null, rif_lavorazione: null, rif_lav_esterna: null, rif_altro: null, rif_totale: null,
    });
    expect(out.verdetto).toBe("senza_riferimento");
    expect(out.totale.scostamento).toBeNull();
    expect(out.righe.every((r) => r.scostamento === null)).toBe(true);
  });

  it("una quantità non valida non divide per zero", () => {
    expect(confrontaConsuntivo({ ...base, quantita_articolo: 0 }).totale.preventivato).toBeCloseTo(456);
  });
});

describe("verdettoDaPercentuale", () => {
  it("usa la soglia del 2%", () => {
    expect(verdettoDaPercentuale(1.99)).toBe("in_linea");
    expect(verdettoDaPercentuale(-1.99)).toBe("in_linea");
    expect(verdettoDaPercentuale(2)).toBe("sottostimato");
    expect(verdettoDaPercentuale(-2)).toBe("sovrastimato");
    expect(verdettoDaPercentuale(null)).toBe("senza_riferimento");
  });
});
