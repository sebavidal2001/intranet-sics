/**
 * Il costo valido ALLA DATA DELLA VENDITA.
 *
 * Due difetti che questi test presidiano.
 *
 * 1. La risoluzione point-in-time. Il listino costi del gestionale e'
 *    versionato per data dal 1999: per ogni riga di vendita vale la variazione
 *    piu' recente fra quelle precedenti o uguali alla data del documento.
 *    Prendere l'ultima nota invece di quella di allora e' l'errore che questo
 *    lavoro esiste per togliere: sul 2022 valeva 5,55 punti di margine.
 *
 * 2. Il segno delle note di credito. Nelle viste `bi_*` l'importo porta il
 *    segno del documento ma la quantita' no, quindi una resa aggiungeva costo
 *    invece di toglierlo.
 */

import { describe, expect, it } from "vitest";
import { costoAllaData } from "@/lib/prototipo-bi/sorgente";
import { esegui, quantitaOrientata, validaSpec } from "@/lib/prototipo-bi/semantico";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

// Voci ordinate dalla piu' recente alla piu' vecchia, com'e' la mappa reale.
const STORICO = [
  { dal: "2026-01-19", costo: 11.69 },
  { dal: "2025-03-18", costo: 8.99 },
  { dal: "2024-09-11", costo: 8.995 },
];

describe("risoluzione del costo alla data", () => {
  it("prende la variazione in vigore, non l'ultima nota", () => {
    // Vendita del 30/06/2025: in vigore c'e' il costo dal 18/03/2025.
    expect(costoAllaData(STORICO, "2025-06-30")?.costo).toBe(8.99);
    // Non quello del 2026, che allora non esisteva ancora.
    expect(costoAllaData(STORICO, "2025-06-30")?.costo).not.toBe(11.69);
  });

  it("il giorno esatto della variazione usa gia' il costo nuovo", () => {
    expect(costoAllaData(STORICO, "2026-01-19")?.costo).toBe(11.69);
    // Il giorno prima, ancora il vecchio.
    expect(costoAllaData(STORICO, "2026-01-18")?.costo).toBe(8.99);
  });

  it("dopo l'ultima variazione vale l'ultima", () => {
    expect(costoAllaData(STORICO, "2026-09-17")?.costo).toBe(11.69);
  });

  it("prima della prima variazione il costo e' SCONOSCIUTO, non zero", () => {
    // Un costo zero darebbe margine 100% su quella riga: plausibile a
    // vedersi, e falso.
    expect(costoAllaData(STORICO, "2024-01-01")).toBeNull();
  });

  it("articolo assente o storico vuoto danno null", () => {
    expect(costoAllaData(undefined, "2026-01-01")).toBeNull();
    expect(costoAllaData([], "2026-01-01")).toBeNull();
  });

  it("riporta la data della versione applicata, non quella dell'ultima", () => {
    expect(costoAllaData(STORICO, "2025-06-30")?.dal).toBe("2025-03-18");
  });

  it("la bisezione da' lo stesso risultato della scansione lineare", () => {
    // Su una serie lunga un errore di indice si nasconde bene: qui si
    // confronta con l'implementazione ovvia, su ogni giorno dell'intervallo.
    const voci = Array.from({ length: 200 }, (_, i) => {
      const giorno = String((i % 28) + 1).padStart(2, "0");
      const mese = String((i % 12) + 1).padStart(2, "0");
      return { dal: `${2000 + Math.floor(i / 12)}-${mese}-${giorno}`, costo: i + 1 };
    }).sort((a, b) => (a.dal < b.dal ? 1 : -1));

    for (const anno of [1999, 2005, 2010, 2016]) {
      for (const mese of ["01", "05", "09", "12"]) {
        const data = `${anno}-${mese}-15`;
        const atteso = voci.find((v) => v.dal <= data) ?? null;
        expect(costoAllaData(voci, data)).toEqual(atteso);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

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

describe("segno delle note di credito", () => {
  it("una riga con importo negativo ha quantita' negativa nel costo", () => {
    expect(quantitaOrientata(riga({ importo: -500, quantita: 5 }))).toBe(-5);
    expect(quantitaOrientata(riga({ importo: 500, quantita: 5 }))).toBe(5);
    // Importo zero (omaggio): la merce esce comunque, il costo si somma.
    expect(quantitaOrientata(riga({ importo: 0, quantita: 5 }))).toBe(5);
  });

  it("il costo di una resa si SOTTRAE, non si somma", () => {
    // Una vendita da 1.000 con costo 600, e la resa integrale della stessa
    // merce. Netto: ricavo 0, costo 0, margine 0.
    const snapshot = snapshotCon([
      riga({ importo: 1000, quantita: 10, costoUnitario: 60, documento: "F-1" }),
      riga({ importo: -1000, quantita: 10, costoUnitario: 60, documento: "NC-1" }),
    ]);

    const costo = esegui(validaSpec({ metrica: "costo_venduto", periodo }), snapshot);
    const margine = esegui(validaSpec({ metrica: "margine", periodo }), snapshot);

    expect(costo.totale).toBe(0);
    expect(margine.totale).toBe(0);
    // Col difetto di prima il costo faceva 1.200 e il margine -1.200.
    expect(costo.totale).not.toBe(1200);
  });

  it("una resa parziale lascia il margine della parte venduta", () => {
    const snapshot = snapshotCon([
      riga({ importo: 1000, quantita: 10, costoUnitario: 60, documento: "F-1" }),
      riga({ importo: -200, quantita: 2, costoUnitario: 60, documento: "NC-1" }),
    ]);

    // Ricavo 800, costo (10-2)*60 = 480, margine 320 = 40%.
    expect(esegui(validaSpec({ metrica: "costo_venduto", periodo }), snapshot).totale).toBe(480);
    expect(esegui(validaSpec({ metrica: "margine", periodo }), snapshot).totale).toBe(320);
    expect(
      esegui(validaSpec({ metrica: "margine_pct", periodo }), snapshot).totale,
    ).toBeCloseTo(40, 1);
  });
});
