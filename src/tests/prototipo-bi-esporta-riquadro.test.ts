import { describe, expect, it } from "vitest";
import { preparaEsportazione, tabellaDaSerie } from "@/lib/prototipo-bi/esporta-riquadro";
import type { SerieAnalisiEseguita, SpecQuery } from "@/lib/prototipo-bi/tipi";

function serie(nome: string, metrica: "ordinato" | "margine_pct", spec: SpecQuery, righe: { etichetta: string; chiavi: Record<string, string>; valore: number }[], unita: "euro" | "percentuale" = "euro"): SerieAnalisiEseguita {
  return {
    ruolo: "principale",
    nome,
    spec,
    risultato: {
      spec, metrica, unita, certificata: true, avvisi: [],
      totale: righe.reduce((s, r) => s + r.valore, 0),
      righe: righe.map((r) => ({ ...r, conteggio: 1 })),
    },
  };
}

describe("esportazione di un riquadro in Excel", () => {
  const spec: SpecQuery = { metrica: "ordinato", raggruppa: ["documento_anno", "cliente"] };
  const specMargine: SpecQuery = { metrica: "margine_pct", raggruppa: ["documento_anno", "cliente"] };
  const S = [
    serie("Ordinato", "ordinato", spec, [
      { etichetta: "100/2026 · ICA", chiavi: { documento_anno: "100/2026", cliente: "ICA" }, valore: 5000 },
      { etichetta: "101/2026 · IMA", chiavi: { documento_anno: "101/2026", cliente: "IMA" }, valore: 300 },
    ]),
    serie("Margine %", "margine_pct", specMargine, [
      { etichetta: "100/2026 · ICA", chiavi: { documento_anno: "100/2026", cliente: "ICA" }, valore: 34.1 },
      { etichetta: "102/2026 · COSTA", chiavi: { documento_anno: "102/2026", cliente: "COSTA" }, valore: 12 },
    ], "percentuale"),
  ];

  it("una colonna per dimensione e una per misura, con l'unita'", () => {
    const t = tabellaDaSerie(S);
    expect(t.colonne).toEqual(["Documento e anno", "Cliente", "Ordinato (€)", "Margine % (%)"]);
  });

  it("le misure si uniscono sulla stessa voce e nessuna voce si perde", () => {
    const t = tabellaDaSerie(S);
    expect(t.righe).toEqual([
      ["100/2026", "ICA", 5000, 34.1],
      ["101/2026", "IMA", 300, null],
      ["102/2026", "COSTA", null, 12],
    ]);
  });

  it("con il tempo c'e' la colonna Periodo, per prima", () => {
    const sp: SpecQuery = { metrica: "ordinato", granularita: "mese" };
    const t = tabellaDaSerie([serie("Ordinato", "ordinato", sp, [{ etichetta: "2026-03", chiavi: { periodo: "2026-03" }, valore: 10 }])]);
    expect(t.colonne).toEqual(["Periodo", "Ordinato (€)"]);
    expect(t.righe).toEqual([["2026-03", 10]]);
  });

  it("senza suddivisioni la voce e' una sola, col suo nome", () => {
    const t = tabellaDaSerie([serie("Ordinato", "ordinato", { metrica: "ordinato" }, [{ etichetta: "totale", chiavi: {}, valore: 7 }])]);
    expect(t.colonne).toEqual(["Voce", "Ordinato (€)"]);
    expect(t.righe).toEqual([["totale", 7]]);
  });

  it("due misure con lo stesso nome non si sovrappongono", () => {
    const t = tabellaDaSerie([S[0], { ...S[0], ruolo: "confronto" }]);
    expect(t.colonne.slice(-2)).toEqual(["Ordinato (€)", "Ordinato (€) (2)"]);
  });

  it("il foglio Informazioni dice da dove vengono i numeri, filtri e periodo compresi", () => {
    const con: SpecQuery = { ...spec, filtri: [{ campo: "cliente", op: "eq", valore: "ICA" }], periodo: { anno: 2026 } };
    const e = preparaEsportazione("Ordinato e marginalità per documento", [serie("Ordinato", "ordinato", con, [])], "2026-10-10");
    expect(e.nomeFile).toBe("BI_Ordinato_e_marginalita_per_documento_2026-10-10.xlsx");
    const riga = e.informazioni.find((r) => r[0] === "Ordinato (€)");
    expect(riga?.[3]).toBe("anno 2026");
    expect(riga?.[4]).toBe("Cliente = ICA");
  });
});
