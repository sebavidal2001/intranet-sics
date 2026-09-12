import { describe, expect, it } from "vitest";
import {
  calcolaMargineRiaddebito,
  calcolaRiaddebito,
} from "@/lib/portali/vettori/riaddebito";
import { pesoVolumetrico } from "@/lib/portali/vettori/calcolo";
import type {
  AccordoRiaddebitoCliente,
  VersioneRiaddebito,
} from "@/lib/portali/vettori/tipi";

const VERSIONE: VersioneRiaddebito = {
  validoDal: "2026-01-01",
  validoAl: null,
  basePeso: "tassabile",
  scaglioni: [
    { pesoDa: 0, pesoA: 10, importo: 16.5, nota: null },
    { pesoDa: 10, pesoA: 30, importo: 22.5, nota: null },
    { pesoDa: 30, pesoA: 50, importo: 31, nota: null },
    { pesoDa: 50, pesoA: 100, importo: 49, nota: null },
    { pesoDa: 100, pesoA: null, importo: null, nota: "Chiedere offerta." },
  ],
};

function accordo(
  valori: Partial<AccordoRiaddebitoCliente>
): AccordoRiaddebitoCliente {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    codiceCliente: "C001",
    ragioneSociale: "Cliente Uno",
    validoDal: "2026-01-01",
    validoAl: null,
    modalita: "tabella",
    importo: null,
    nota: null,
    ...valori,
  };
}

function calcola(
  valori: Partial<Parameters<typeof calcolaRiaddebito>[0]> = {}
) {
  return calcolaRiaddebito({
    data: "2026-09-12",
    pesoReale: 8,
    pesoTassabile: 24,
    versione: VERSIONE,
    ...valori,
  });
}

describe("riaddebito a cliente", () => {
  it("legge lo scaglione sul peso configurato", () => {
    const risultato = calcola();
    expect(risultato.importo).toBe(22.5);
    expect(risultato.pesoUsato).toBe(24);
    expect(risultato.regola).toBe("scaglione 10-30 kg");
  });

  it("l'accordo a importo fisso prevale sulla tabella", () => {
    const risultato = calcola({
      accordo: accordo({ modalita: "importo_fisso", importo: 18 }),
    });
    expect(risultato.importo).toBe(18);
    expect(risultato.regola).toBe("accordo cliente: importo fisso");
  });

  it("nessun addebito e' l'unico caso che produce esplicitamente zero", () => {
    const risultato = calcola({
      accordo: accordo({ modalita: "nessun_addebito" }),
    });
    expect(risultato.importo).toBe(0);
  });

  it("oltre soglia conserva null e non inventa un ricavo zero", () => {
    const risultato = calcola({ pesoTassabile: 120 });
    expect(risultato.importo).toBeNull();
    expect(risultato.avvertenza).toBe("Chiedere offerta.");
    expect(calcolaMargineRiaddebito(risultato, 60)).toBeNull();
  });

  it("non nasconde un margine negativo", () => {
    expect(calcolaMargineRiaddebito(calcola(), 30)).toBe(-7.5);
  });

  it("puo usare il peso reale senza dipendere dal vettore", () => {
    const risultato = calcola({
      versione: { ...VERSIONE, basePeso: "reale" },
    });
    expect(risultato.pesoUsato).toBe(8);
    expect(risultato.importo).toBe(16.5);
  });
});

describe("gruppi di colli disomogenei", () => {
  it("somma i volumi dei gruppi prima di applicare il divisore", () => {
    const peso = pesoVolumetrico({
      colli: 3,
      pesoReale: 42.5,
      misureColli: [
        { quantita: 2, lunghezzaCm: 120, larghezzaCm: 80, altezzaCm: 100 },
        { quantita: 1, lunghezzaCm: 40, larghezzaCm: 30, altezzaCm: 25 },
      ],
    }, 300);
    // 2 x 0,96 mc + 0,03 mc = 1,95 mc; a 300 kg/mc sono 585 kg.
    expect(peso).toBe(585);
  });
});
