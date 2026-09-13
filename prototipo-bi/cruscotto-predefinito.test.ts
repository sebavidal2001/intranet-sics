/** Verifica che la semina dichiarativa resti stabile, valida e governata dalla pagina. */

import { describe, expect, it } from "vitest";
import {
  CHIAVI_CON_PERIODO_FISSO,
  CRUSCOTTO_PREDEFINITO,
} from "@/lib/prototipo-bi/cruscotto-predefinito";
import { validaSpec } from "@/lib/prototipo-bi/semantico";

describe("Cruscotto predefinito", () => {
  it("usa chiavi uniche per pagine e analisi", () => {
    const pagine = CRUSCOTTO_PREDEFINITO.map((pagina) => pagina.chiave);
    const analisi = CRUSCOTTO_PREDEFINITO.flatMap((pagina) =>
      pagina.analisi.map((voce) => voce.chiave)
    );
    expect(new Set(pagine).size).toBe(pagine.length);
    expect(new Set(analisi).size).toBe(analisi.length);
  });

  it("contiene soltanto spec valide", () => {
    for (const pagina of CRUSCOTTO_PREDEFINITO) {
      for (const analisi of pagina.analisi) {
        expect(() => validaSpec(analisi.spec), analisi.chiave).not.toThrow();
      }
    }
  });

  it("eredita il periodo salvo eccezioni dichiarate", () => {
    for (const pagina of CRUSCOTTO_PREDEFINITO) {
      for (const analisi of pagina.analisi) {
        if (analisi.spec.periodo) {
          expect(CHIAVI_CON_PERIODO_FISSO.has(analisi.chiave), analisi.chiave).toBe(true);
        }
      }
    }
  });
});
