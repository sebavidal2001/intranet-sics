/**
 * Il margine dentro il dettaglio documenti.
 *
 * Il pannello che si apre cliccando un cliente mostra le sue fatture con il
 * margine di ognuna, e le righe con costo unitario e margine. Sono numeri
 * calcolati in `dettaglioDocumenti()`, quindi valgono le stesse regole che
 * governano le metriche — e vanno presidiate qui, perché quel codice non passa
 * da `esegui()`.
 */
import { describe, expect, it } from "vitest";
import { dettaglioDocumenti } from "@/lib/prototipo-bi/dettaglio";
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

const richiesta = { dataset: "fatturato" as const, periodo: { anno: 2026 } };

describe("margine nel dettaglio documenti", () => {
  it("somma il margine del documento sulle sole righe con costo noto", () => {
    const esito = dettaglioDocumenti(richiesta, snapshotCon([
      riga({ importo: 1000, quantita: 10, costoUnitario: 60 }),
      riga({ importo: 500, quantita: 5, costoUnitario: 60 }),
    ]));

    const doc = esito.documenti[0];
    // Ricavo 1.500, costo 15×60 = 900, margine 600 = 40%.
    expect(doc.costo).toBe(900);
    expect(doc.margine).toBe(600);
    expect(doc.marginePct).toBeCloseTo(40, 1);
    expect(doc.coperturaPct).toBe(100);
  });

  it("una riga senza costo abbassa la copertura, non il margine", () => {
    const esito = dettaglioDocumenti(richiesta, snapshotCon([
      riga({ importo: 1000, quantita: 10, costoUnitario: 60 }),
      // Stesso ricavo, costo sconosciuto: se entrasse a costo zero il margine
      // del documento salirebbe dal 40% al 70%.
      riga({ importo: 1000, quantita: 10, costoUnitario: null }),
    ]));

    const doc = esito.documenti[0];
    expect(doc.margine).toBe(400);
    expect(doc.marginePct).toBeCloseTo(40, 1);
    expect(doc.marginePct).not.toBeCloseTo(70, 1);
    expect(doc.coperturaPct).toBe(50);
  });

  it("un documento senza alcun costo ha margine null, non zero", () => {
    // Zero direbbe "ha marginato niente"; null dice "non lo sappiamo", ed è la
    // differenza che tiene onesta tutta la pagina.
    const esito = dettaglioDocumenti(richiesta, snapshotCon([
      riga({ importo: 800, quantita: 4, costoUnitario: null }),
    ]));

    const doc = esito.documenti[0];
    expect(doc.margine).toBeNull();
    expect(doc.marginePct).toBeNull();
    expect(doc.costo).toBeNull();
    expect(doc.coperturaPct).toBe(0);
  });

  it("su una nota di credito il costo si sottrae", () => {
    const esito = dettaglioDocumenti(richiesta, snapshotCon([
      riga({ importo: 1000, quantita: 10, costoUnitario: 60, documento: "F-1" }),
      riga({ importo: -1000, quantita: 10, costoUnitario: 60, documento: "NC-1" }),
    ]));

    const nota = esito.documenti.find((d) => d.numero === "NC-1")!;
    // Ricavo −1.000, costo −600, margine −400: la resa restituisce anche il
    // costo. Col segno sbagliato il margine sarebbe −1.600.
    expect(nota.costo).toBe(-600);
    expect(nota.margine).toBe(-400);
    expect(nota.margine).not.toBe(-1600);
  });

  it("le righe portano costo unitario e margine, e il null resta null", () => {
    const esito = dettaglioDocumenti(
      { ...richiesta, documento: "F-1" },
      snapshotCon([
        riga({ importo: 1000, quantita: 10, costoUnitario: 60, articolo: "ART-1" }),
        riga({ importo: 500, quantita: 5, costoUnitario: null, articolo: "ART-2" }),
      ])
    );

    const righe = esito.righe!;
    const conCosto = righe.find((r) => r.articolo === "ART-1")!;
    const senza = righe.find((r) => r.articolo === "ART-2")!;

    expect(conCosto.costoUnitario).toBe(60);
    expect(conCosto.margine).toBe(400);
    expect(senza.costoUnitario).toBeNull();
    expect(senza.margine).toBeNull();
  });
});
