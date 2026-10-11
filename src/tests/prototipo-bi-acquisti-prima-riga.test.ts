import { describe, expect, it } from "vitest";
import { CRUSCOTTO_PREDEFINITO, RIQUADRI_RIMOSSI } from "@/lib/prototipo-bi/cruscotto-predefinito";
import { validaAspetto } from "@/lib/prototipo-bi/aspetto";
import { validaSpec } from "@/lib/prototipo-bi/semantico";

describe("pagina Acquisti del Cruscotto: prima riga", () => {
  const pagina = CRUSCOTTO_PREDEFINITO.find((p) => p.chiave === "acquisti")!;
  const kpi = pagina.analisi.slice(0, 4);

  it("sono quattro KPI da 3/12: riempiono la riga", () => {
    expect(kpi.every((a) => a.grafico === "kpi" && a.larghezza === 3)).toBe(true);
    expect(kpi.reduce((t, a) => t + (a.larghezza ?? 0), 0)).toBe(12);
  });

  it("turchese SICS, testo bianco e centrato, in una forma che il database accetta", () => {
    for (const a of kpi) {
      expect(validaAspetto(a.aspetto)).toEqual({ sfondo: "#00a1be", coloreTesto: "#ffffff", coloreContenuto: "#ffffff", testoCentrato: true });
    }
  });

  it("ogni KPI usa una metrica certificata", () => {
    for (const a of kpi) expect(() => validaSpec(a.spec)).not.toThrow();
  });

  it("i riquadri tolti non sono piu' fra quelli seminati", () => {
    const chiavi = new Set(pagina.analisi.map((a) => a.chiave));
    for (const r of RIQUADRI_RIMOSSI) expect(chiavi.has(r.chiave)).toBe(false);
  });
});
