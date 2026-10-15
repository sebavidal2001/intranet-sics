import { describe, expect, it } from "vitest";
import { aumentaFasce, NuovoListino } from "@/lib/portali/vettori/listini-config";

describe("aumentaFasce", () => {
  const gls2025 = [
    { zona_id: "z", peso_da: 0, peso_a: 3, importo: 7.9, tipo: "fisso" as const, scatto_kg: null, scatto_importo: null },
    { zona_id: "z", peso_da: 3, peso_a: 5, importo: 8.53, tipo: "fisso" as const, scatto_kg: null, scatto_importo: null },
    { zona_id: "z", peso_da: 100, peso_a: null, importo: 36.26, tipo: "fisso" as const, scatto_kg: 50, scatto_importo: 17.78 },
  ];

  it("la lettera GLS «nolo +1,8%» dà le tariffe 2026 al centesimo", () => {
    const nuove = aumentaFasce(gls2025, 1.8);
    expect(nuove.map((f) => f.importo)).toEqual([8.04, 8.68, 36.91]);
    expect(nuove[2].scatto_importo).toBe(18.1);
  });

  it("non tocca soglie di peso né scatti assenti", () => {
    const nuove = aumentaFasce(gls2025, 1.8);
    expect(nuove.map((f) => [f.peso_da, f.peso_a])).toEqual([[0, 3], [3, 5], [100, null]]);
    expect(nuove[0].scatto_importo).toBeNull();
  });

  it("parte sempre dai valori passati: due applicazioni non si sommano", () => {
    expect(aumentaFasce(gls2025, 1.8)).toEqual(aumentaFasce(gls2025, 1.8));
  });
});

describe("NuovoListino · adeguamento", () => {
  const base = {
    listino_id: "7f2b8a0e-1c3d-4e5f-8a9b-0c1d2e3f4a5b",
    etichetta: "Tariffe nazionali 2027",
    valido_dal: "2027-01-01",
    fasce: [{ zona_id: "7f2b8a0e-1c3d-4e5f-8a9b-0c1d2e3f4a5c", peso_da: 0, peso_a: null, importo: 8, tipo: "fisso", scatto_kg: null, scatto_importo: null }],
    supplementi: [],
  };
  it("accetta la frazione, null e l'assenza", () => {
    expect(NuovoListino.safeParse({ ...base, adeguamento: 0.0721 }).success).toBe(true);
    expect(NuovoListino.safeParse({ ...base, adeguamento: null }).success).toBe(true);
    expect(NuovoListino.safeParse(base).success).toBe(true);
  });
  it("rifiuta 7,21 scritto come frazione sbagliata (721%)", () => {
    expect(NuovoListino.safeParse({ ...base, adeguamento: 7.21 }).success).toBe(false);
  });
});
