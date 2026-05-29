import { describe, it, expect } from "vitest";
import { evalFormula, validateFormula, formulaDeps, risolviQuantita } from "@/lib/portali/preventivatore/template/formula";

describe("motore formule template", () => {
  it("aritmetica base e precedenze", () => {
    expect(evalFormula("(larghezza/1000)*n_gradini", { larghezza: 2000, n_gradini: 5 })).toBe(10);
    expect(evalFormula("(larghezza*lunghezza/165)/1000", { larghezza: 1000, lunghezza: 1650 })).toBeCloseTo(10);
    expect(evalFormula("1 + 2 * 3", {})).toBe(7);
    expect(evalFormula("-altezza", { altezza: 5 })).toBe(-5);
  });

  it("IF e condizioni", () => {
    expect(evalFormula("IF(profondita>0, altezza/1000, 0)", { profondita: 100, altezza: 2000 })).toBe(2);
    expect(evalFormula("IF(profondita>0, 1, 0)", { profondita: 0 })).toBe(0);
    expect(evalFormula("IF(AND(l>0,h>0),4,0)", { l: 10, h: 5 })).toBe(4);
    expect(evalFormula("IF(h<=600,2,3)", { h: 700 })).toBe(3);
  });

  it("coercizione SI/NO booleani", () => {
    expect(evalFormula("IF(calamite, 2, 0)", { calamite: "SI" })).toBe(2);
    expect(evalFormula("IF(calamite, 2, 0)", { calamite: "no" })).toBe(0);
  });

  it("divisione per zero → 0 (no crash)", () => {
    expect(evalFormula("10/0", {})).toBe(0);
  });

  it("validazione: riferimento sconosciuto", () => {
    const r = validateFormula("larghezza*pippo", new Set(["larghezza"]));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("pippo");
  });

  it("deps estratte senza funzioni riservate", () => {
    expect(formulaDeps("IF(a>0, b*2, MIN(c,d))").sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("risoluzione dipendenze tra righe (tubo = fiancate*2)", () => {
    const righe = [
      { slug: "fiancate", qta_formula: null, qta_manuale: 3 },
      { slug: "tubo", qta_formula: "fiancate*2", qta_manuale: 0 },
      { slug: "guarnizione", qta_formula: "fiancate", qta_manuale: 0 },
    ];
    const m = risolviQuantita(righe, {});
    expect(m.get("0")).toBe(3);
    expect(m.get("1")).toBe(6);
    expect(m.get("2")).toBe(3);
  });

  it("formula vuota → 0", () => {
    expect(evalFormula("", {})).toBe(0);
  });
});
