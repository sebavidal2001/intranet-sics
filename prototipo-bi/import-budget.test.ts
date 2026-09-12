/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 * Import dei file Budget/BEP aziendali reali.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { importaBudget, unisciSerie, leggiData } from "@/lib/prototipo-bi/importa-budget";

const BASE = "C:/Users/sebav/AppData/Local/Temp/claude/C--Users-sebav-Desktop-intranet-sics/af3333a2-79b1-4650-88c6-e6783b861a6b/scratchpad/bi";
const F_SETT = `${BASE}/BUDGET-BEP.xlsx`;
const F_GIORN = `${BASE}/BUDGET-BEP_GIORNALIERO.xlsx`;
const F_COMM = `${BASE}/BUDGET-BEP_GIORNALIERO_COMMERCIALI.xlsx`;

describe("Lettura date", () => {
  it("interpreta gg/mm/aaaa all'italiana, non all'americana", () => {
    // 07/01/2026 è il 7 GENNAIO. Letto all'americana sarebbe il 1° luglio:
    // sposterebbe silenziosamente il budget di sei mesi.
    expect(leggiData("07/01/2026")).toBe("2026-01-07");
    expect(leggiData("31/12/2026")).toBe("2026-12-31");
    expect(leggiData(new Date(2026, 7, 15))).toBe("2026-08-15");
    expect(leggiData("2026-03-04 00:00:00")).toBe("2026-03-04");
    expect(leggiData("")).toBeNull();
  });
});

describe("Import Budget/BEP reali", () => {
  it("importa il giornaliero per area con i totali esatti 2024-2026", () => {
    if (!existsSync(F_GIORN)) return;
    const e = importaBudget(readFileSync(F_GIORN));
    expect(e.serie.formato).toBe("area_giorno");
    expect(e.serie.anni).toEqual(expect.arrayContaining([2024, 2025, 2026]));

    // Totali verificati leggendo il file: sono i numeri veri dell'azienda.
    expect(e.serie.totaliPerAnno[2024].budget).toBeCloseTo(4_000_000, 0);
    expect(e.serie.totaliPerAnno[2024].bep).toBeCloseTo(3_800_000, 0);
    expect(e.serie.totaliPerAnno[2025].budget).toBeCloseTo(5_000_000, 0);
    expect(e.serie.totaliPerAnno[2025].bep).toBeCloseTo(4_600_000, 0);
    expect(e.serie.totaliPerAnno[2026].budget).toBeCloseTo(5_200_000, 0);
    expect(e.serie.totaliPerAnno[2026].bep).toBeCloseTo(4_800_000, 0);

    const aree = [...new Set(e.serie.righe.map((r) => r.area))].sort();
    expect(aree).toEqual(["COMPONENTI", "COSTRUITO", "IMPIANTI", "STRUTTURE"]);
    console.log("   Giornaliero:", e.serie.righe.length, "righe ·", aree.join(", "));
    console.log("   Totali:", JSON.stringify(e.serie.totaliPerAnno));
  });

  it("importa il settimanale per area", () => {
    if (!existsSync(F_SETT)) return;
    const e = importaBudget(readFileSync(F_SETT));
    expect(e.serie.formato).toBe("area_settimana");
    expect(e.serie.totaliPerAnno[2026].budget).toBeCloseTo(5_200_000, 0);
    console.log("   Settimanale:", e.serie.righe.length, "righe");
  });

  it("importa i commerciali leggendo SOLO il foglio GENERALE", () => {
    if (!existsSync(F_COMM)) return;
    const e = importaBudget(readFileSync(F_COMM));
    expect(e.fogliLetti).toEqual(["GENERALE"]);
    expect(e.avvisi.join(" ")).toContain("raddoppierebbe");

    const perAgente: Record<string, number> = {};
    for (const r of e.serie.righe) {
      if (!r.agente) continue;
      perAgente[r.agente] = (perAgente[r.agente] ?? 0) + r.budget;
    }
    const tot = Object.values(perAgente).reduce((s, v) => s + v, 0);
    // I quattro fogli separati sommano 3.0M + 1.2M + 1.0M = 5.2M: il foglio
    // GENERALE deve dare lo stesso totale, non il doppio.
    expect(tot).toBeCloseTo(5_200_000, 0);
    expect(Math.round(perAgente["VALERIA BATTELANI"])).toBe(3_000_000);
    expect(Math.round(perAgente["DANIELE BONI"])).toBe(1_200_000);
    expect(Math.round(perAgente["AIRFLUID"])).toBe(1_000_000);
    console.log("   Commerciali 2026:", JSON.stringify(perAgente));
  });

  it("unisce area e commerciali senza raddoppiare il totale", () => {
    if (!existsSync(F_GIORN) || !existsSync(F_COMM)) return;
    const area = importaBudget(readFileSync(F_GIORN), { soloAnno: 2026 });
    const comm = importaBudget(readFileSync(F_COMM), { soloAnno: 2026 });
    const unita = unisciSerie([area.serie, comm.serie]);

    // Il totale si conta una sola volta, sul livello area.
    expect(unita.totaliPerAnno[2026].budget).toBeCloseTo(5_200_000, 0);
    expect(unita.righe.filter((r) => r.agente).length).toBeGreaterThan(0);
    expect(unita.righe.filter((r) => !r.agente).length).toBeGreaterThan(0);
    console.log(
      "   Unione:",
      unita.righe.length,
      "righe · totale",
      unita.totaliPerAnno[2026].budget.toLocaleString("it-IT")
    );
  });
});
