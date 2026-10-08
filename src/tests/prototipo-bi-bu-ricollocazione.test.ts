import { describe, expect, it } from "vitest";
import {
  BU_NON_ASSEGNATA,
  controllaTassonomia,
  ricollocaNonAssegnate,
  type RigaRicollocabile,
} from "@/lib/prototipo-bi/business-unit";

function riga(p: Partial<RigaRicollocabile>): RigaRicollocabile {
  return { bu: "COMPONENTI", documento: "100", data: "2026-09-01", codiceCliente: "C1", importo: 100, ...p };
}

describe("righe senza gruppo: seguono il documento", () => {
  it("una riga di testo prende la business unit delle righe di merce", () => {
    const righe = [riga({ bu: "IMPIANTI", importo: 500 }), riga({ bu: BU_NON_ASSEGNATA, importo: 0 })];
    const esito = ricollocaNonAssegnate(righe);
    expect(righe[1].bu).toBe("IMPIANTI");
    expect(righe[1].buDedotta).toBe(true);
    expect(righe[0].buDedotta).toBeUndefined(); // quella vera non si tocca
    expect(esito).toEqual({ ricollocate: 1, residue: 0, valoreResiduo: 0 });
  });

  it("con piu' business unit nel documento vince quella che pesa di piu' in valore", () => {
    const righe = [
      riga({ bu: "COMPONENTI", importo: 100 }),
      riga({ bu: "COSTRUITO", importo: 900 }),
      riga({ bu: "COMPONENTI", importo: 50 }),
      riga({ bu: BU_NON_ASSEGNATA, importo: 0 }),
    ];
    ricollocaNonAssegnate(righe);
    expect(righe[3].bu).toBe("COSTRUITO");
  });

  it("le note di credito pesano per il valore assoluto", () => {
    const righe = [
      riga({ bu: "COMPONENTI", importo: 100 }),
      riga({ bu: "IMPIANTI", importo: -400 }),
      riga({ bu: BU_NON_ASSEGNATA, importo: -6.42 }),
    ];
    ricollocaNonAssegnate(righe);
    expect(righe[2].bu).toBe("IMPIANTI");
  });

  it("a parita' di peso e di righe decide l'ordine alfabetico: non l'ordine di arrivo", () => {
    const a = [riga({ bu: "STRUTTURE", importo: 10 }), riga({ bu: "COSTRUITO", importo: 10 }), riga({ bu: BU_NON_ASSEGNATA, importo: 0 })];
    const b = [...a].reverse();
    ricollocaNonAssegnate(a);
    ricollocaNonAssegnate(b);
    expect(a.find((r) => r.buDedotta)?.bu).toBe("COSTRUITO");
    expect(b.find((r) => r.buDedotta)?.bu).toBe("COSTRUITO");
  });

  it("un documento senza nessuna riga assegnata resta tale, e lo si conta", () => {
    const righe = [
      riga({ documento: "200", bu: BU_NON_ASSEGNATA, importo: 0 }),
      riga({ documento: "200", bu: BU_NON_ASSEGNATA, importo: 25 }),
    ];
    const esito = ricollocaNonAssegnate(righe);
    expect(righe.every((r) => r.bu === BU_NON_ASSEGNATA)).toBe(true);
    expect(esito).toEqual({ ricollocate: 0, residue: 2, valoreResiduo: 25 });
  });

  it("documenti diversi non si contaminano (stesso numero, altro cliente o altra data)", () => {
    const righe = [
      riga({ documento: "300", codiceCliente: "C1", bu: "IMPIANTI" }),
      riga({ documento: "300", codiceCliente: "C2", bu: BU_NON_ASSEGNATA, importo: 0 }),
      riga({ documento: "300", codiceCliente: "C1", data: "2025-01-01", bu: BU_NON_ASSEGNATA, importo: 0 }),
    ];
    const esito = ricollocaNonAssegnate(righe);
    expect(esito.ricollocate).toBe(0);
    expect(esito.residue).toBe(2);
  });

  it("senza numero di documento non si indovina niente", () => {
    const righe = [riga({ documento: "", bu: "IMPIANTI" }), riga({ documento: "", bu: BU_NON_ASSEGNATA, importo: 0 })];
    expect(ricollocaNonAssegnate(righe).residue).toBe(1);
  });
});

describe("sentinella della tassonomia", () => {
  it("segnala SISTEMI se ricompare", () => {
    expect(controllaTassonomia(["COMPONENTI", "SISTEMI"]).sistemiResidua).toBe(true);
    expect(controllaTassonomia(["COMPONENTI", "COSTRUITO", BU_NON_ASSEGNATA]).coerente).toBe(true);
  });
});
