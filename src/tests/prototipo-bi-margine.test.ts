/**
 * Margine al costo valido alla data di vendita.
 *
 * La regola che questi test presidiano: una riga di cui NON si conosce il
 * costo deve uscire dal calcolo, non entrarci con costo zero. Un costo zero
 * darebbe margine 100% su quella riga — plausibile a vedersi, e falso.
 *
 * La risoluzione del costo alla data sta in
 * `prototipo-bi-costo-storico.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { esegui, validaSpec } from "@/lib/prototipo-bi/semantico";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

function riga(over: Partial<RigaFatto> & { importo: number; quantita: number }): RigaFatto {
  return {
    data: "2026-03-10",
    bu: "SISTEMI",
    categoria: "X",
    agente: "MARIO ROSSI",
    codiceAgente: "A01",
    cliente: "CLIENTE UNO",
    codiceCliente: "C01",
    documento: "F-1",
    articolo: "ART-1",
    descrizioneArticolo: "Articolo",
    costoUnitario: null,
    dataCosto: null,
    ...over,
  };
}

function snapshotCon(fatturato: RigaFatto[]): Snapshot {
  const vuoto: RigaFatto[] = [];
  return {
    generatoIl: new Date().toISOString(),
    runCorrente: "run-test",
    runRicevutoIl: new Date().toISOString(),
    dataMassima: "2026-03-31",
    dataMinima: "2026-01-01",
    dataset: {
      ordinato: vuoto,
      fatturato,
      consegnato: vuoto,
      portafoglio: vuoto,
      preventivi_aperti: vuoto,
      controllo_banco: vuoto,
      consegnato_futuro_per_mese: vuoto,
    },
    conteggi: { fatturato: fatturato.length },
  };
}

const periodo = { dal: "2026-01-01", al: "2026-03-31" };

describe("margine a ultimo costo", () => {
  it("calcola margine e percentuale sulle righe con costo noto", () => {
    const snapshot = snapshotCon([
      riga({ importo: 1000, quantita: 10, costoUnitario: 60, documento: "F-1" }),
      riga({ importo: 500, quantita: 5, costoUnitario: 60, documento: "F-2" }),
    ]);

    const margine = esegui(validaSpec({ metrica: "margine", periodo }), snapshot);
    const costo = esegui(validaSpec({ metrica: "costo_venduto", periodo }), snapshot);
    const pct = esegui(validaSpec({ metrica: "margine_pct", periodo }), snapshot);

    // Ricavo 1500, costo 10*60 + 5*60 = 900, margine 600 = 40%.
    expect(costo.totale).toBe(900);
    expect(margine.totale).toBe(600);
    expect(pct.totale).toBeCloseTo(40, 1);
  });

  it("ESCLUDE le righe senza costo invece di contarle a margine pieno", () => {
    const snapshot = snapshotCon([
      riga({ importo: 1000, quantita: 10, costoUnitario: 60, documento: "F-1" }),
      // Stesso ricavo, costo sconosciuto: se entrasse a costo zero il margine
      // complessivo salirebbe dal 40% al 70%.
      riga({ importo: 1000, quantita: 10, costoUnitario: null, documento: "F-2" }),
    ]);

    const margine = esegui(validaSpec({ metrica: "margine", periodo }), snapshot);
    const pct = esegui(validaSpec({ metrica: "margine_pct", periodo }), snapshot);

    expect(margine.totale).toBe(400);
    expect(pct.totale).toBeCloseTo(40, 1);
    expect(pct.totale).not.toBeCloseTo(70, 1);
  });

  it("dichiara la copertura e la natura del costo", () => {
    const snapshot = snapshotCon([
      riga({ importo: 1000, quantita: 10, costoUnitario: 60, documento: "F-1" }),
      riga({ importo: 1000, quantita: 10, costoUnitario: null, documento: "F-2" }),
    ]);

    const copertura = esegui(validaSpec({ metrica: "copertura_costi_pct", periodo }), snapshot);
    expect(copertura.totale).toBeCloseTo(50, 1);

    const avvisi = esegui(validaSpec({ metrica: "margine", periodo }), snapshot).avvisi ?? [];
    expect(avvisi.join(" ")).toMatch(/valido il giorno della vendita/i);
    expect(avvisi.join(" ")).toMatch(/50,0%|50\.0%/);
    expect(avvisi.join(" ")).toMatch(/non e' rappresentativo/i);
  });

  it("se ha ripiegato sull'ultimo costo noto, lo dice PRIMA di ogni altra cosa", () => {
    // Il ripiego cambia il significato del numero: da "al costo di allora" a
    // "al costo di oggi". Se cambiasse in silenzio, chi legge confronterebbe
    // due margini incomparabili senza sospettarlo.
    const snapshot = {
      ...snapshotCon([riga({ importo: 1000, quantita: 10, costoUnitario: 60, documento: "F-1" })]),
      costiApprossimati: true,
    };

    const avvisi = esegui(validaSpec({ metrica: "margine", periodo }), snapshot).avvisi ?? [];
    expect(avvisi.join(" ")).toMatch(/ULTIMO costo noto/i);
    expect(avvisi.join(" ")).toMatch(/costo corrente/i);
    // E non deve affermare il contrario nello stesso respiro.
    expect(avvisi.join(" ")).not.toMatch(/valido il giorno della vendita/i);
  });

  it("un costo pari al ricavo da' margine zero, non un margine assente", () => {
    const snapshot = snapshotCon([
      riga({ importo: 600, quantita: 10, costoUnitario: 60, documento: "F-1" }),
    ]);
    const margine = esegui(validaSpec({ metrica: "margine", periodo }), snapshot);
    expect(margine.totale).toBe(0);
    expect(margine.righe).toHaveLength(1);
  });

  it("il margine per mese si spacca sulle righe giuste", () => {
    const snapshot = snapshotCon([
      riga({ data: "2026-01-10", importo: 1000, quantita: 10, costoUnitario: 60, documento: "F-1" }),
      riga({ data: "2026-02-10", importo: 1000, quantita: 10, costoUnitario: 90, documento: "F-2" }),
    ]);
    const res = esegui(
      validaSpec({ metrica: "margine", granularita: "mese", periodo, ordina: "etichetta" }),
      snapshot
    );
    expect(res.righe.map((r) => [r.etichetta, r.valore])).toEqual([
      ["2026-01", 400],
      ["2026-02", 100],
    ]);
  });
});
