import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { carburanteVigente } from "@/lib/portali/vettori/carburante";
import { NuovoListino } from "@/lib/portali/vettori/listini-config";
import { righeConOneri } from "@/lib/portali/vettori/confronto-fattura";
import { leggiFattura } from "@/lib/portali/vettori/fatture";
import { trovaFascia } from "@/lib/portali/vettori/calcolo";

describe("fuel con continuità", () => {
  const righe = [{ anno: 2026, mese: 7, percentuale: .13 }, { anno: 2026, mese: 9, percentuale: 0 }];
  it("usa luglio ad agosto e non anticipa settembre", () => expect(carburanteVigente(righe, 2026, 8)?.percentuale).toBe(.13));
  it("accetta zero e lo mantiene anche nell'anno successivo", () => expect(carburanteVigente(righe, 2027, 1)?.percentuale).toBe(0));
  it("non inventa valori prima della prima comunicazione", () => expect(carburanteVigente(righe, 2026, 6)).toBeUndefined());
});

describe("confronto di fatture reali", () => {
  it("ripartisce il piede GLS senza perdere centesimi né modificare il parser", () => {
    const f = leggiFattura(readFileSync("src/tests/fixtures/fatture/ft-gls-07-26.txt", "utf8"));
    const prima = JSON.stringify(f);
    const righe = righeConOneri(f);
    expect(righe.reduce((s, r) => s + r.carburante, 0)).toBeCloseTo(f.totali.carburante!, 2);
    expect(righe.reduce((s, r) => s + (r.totale ?? 0), 0)).toBeCloseTo(f.totali.totaleDocumento!, 2);
    expect(JSON.stringify(f)).toBe(prima);
  });
  it("Trading Post ricava la provincia anche senza bolla", () => {
    const f = leggiFattura(readFileSync("src/tests/fixtures/fatture/tp1260-002218-07-26.txt", "utf8"));
    expect(f.righe.length).toBeGreaterThan(0);
    expect(f.righe.every((r) => /^[A-Z]{2}$/.test(String(r.dettaglio.provincia)))).toBe(true);
  });
  it("un buco nelle fasce non applica arbitrariamente l'ultima tariffa", () => {
    expect(trovaFascia([{ pesoDa: 0, pesoA: 3, importo: 5, tipo: "fisso", scattoKg: null, scattoImporto: null }], 10)).toBeNull();
  });
});

describe("validazione tariffe", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const fascia = { zona_id: id, peso_da: 0, peso_a: 3, importo: 5, tipo: "fisso", scatto_kg: null, scatto_importo: null };
  const body = { listino_id: id, etichetta: "Nuove tariffe", valido_dal: "2026-09-06", fasce: [fascia], supplementi: [] };
  it("accetta un listino valido", () => expect(NuovoListino.safeParse(body).success).toBe(true));
  it("rifiuta buchi e sovrapposizioni", () => {
    for (const peso_da of [2, 4]) expect(NuovoListino.safeParse({ ...body, fasce: [fascia, { ...fascia, peso_da, peso_a: null }] }).success).toBe(false);
  });
  it("rifiuta scatti incompleti, importi negativi e date impossibili", () => {
    expect(NuovoListino.safeParse({ ...body, fasce: [{ ...fascia, scatto_kg: 50 }] }).success).toBe(false);
    expect(NuovoListino.safeParse({ ...body, fasce: [{ ...fascia, importo: -1 }] }).success).toBe(false);
    expect(NuovoListino.safeParse({ ...body, valido_dal: "2026-02-31" }).success).toBe(false);
  });
});
