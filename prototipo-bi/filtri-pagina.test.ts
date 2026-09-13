import { describe, expect, it } from "vitest";
import {
  fondiFiltriPagina,
  fondiFiltriPaginaConEsito,
} from "@/lib/prototipo-bi/filtri-pagina";
import type { SpecQuery } from "@/lib/prototipo-bi/tipi";

const BASE: SpecQuery = { metrica: "ordinato", raggruppa: ["cliente"] };

describe("fusione dei filtri di pagina", () => {
  it("aggiunge un filtro della pagina alla spec", () => {
    expect(fondiFiltriPagina(BASE, { bu: "COMPONENTI" }).filtri).toEqual([
      { campo: "bu", op: "eq", valore: "COMPONENTI" },
    ]);
  });

  it("lascia prevalere il filtro della spec sulla stessa dimensione", () => {
    const spec: SpecQuery = {
      ...BASE,
      filtri: [{ campo: "agente", op: "eq", valore: "ROSSI" }],
    };
    expect(fondiFiltriPagina(spec, { agente: "BIANCHI", bu: "IMPIANTI" }).filtri).toEqual([
      { campo: "agente", op: "eq", valore: "ROSSI" },
      { campo: "bu", op: "eq", valore: "IMPIANTI" },
    ]);
  });

  it("riempie dalla pagina il periodo mancante nella spec", () => {
    expect(
      fondiFiltriPagina(BASE, { periodo: { dal: "2026-01-01", al: "2026-06-30" } }).periodo
    ).toEqual({ dal: "2026-01-01", al: "2026-06-30" });
  });

  it("rispetta il periodo esplicito e segnala quello della pagina ignorato", () => {
    const spec: SpecQuery = { ...BASE, periodo: { anno: 2025 } };
    const esito = fondiFiltriPaginaConEsito(spec, { periodo: { anno: 2026 } });
    expect(esito.spec.periodo).toEqual({ anno: 2025 });
    expect(esito.periodoIgnorato).toBe(true);
  });

  it("lascia la spec intatta quando la pagina non ha filtri", () => {
    const spec: SpecQuery = { ...BASE, periodo: { anno: 2026 } };
    expect(fondiFiltriPagina(spec, {})).toBe(spec);
  });
});
