import { describe, expect, it } from "vitest";
import { comeFatti, type RigaAcquisto } from "@/lib/prototipo-bi/acquisti";
import { esegui } from "@/lib/prototipo-bi/semantico";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

function riga(p: Partial<RigaAcquisto> & { dataOrdine: string }): RigaAcquisto {
  return {
    idRiga: 1, profilo: "OF", numeroOrdine: 1, codiceFornitore: "F", fornitore: "COLUMBUS", buyerUtente: "x", buyer: "X",
    articolo: "A", descrizione: "", gruppoArticoli: "S", quantita: 10, qtaArrivata: 10, valore: 100, dataPrevista: null,
    dataConfermata: "2026-08-10", rigaEvasa: true, chiusaForzata: false, primoArrivo: "2026-08-05", ...p,
  };
}

describe("ritardo medio degli acquisti", () => {
  it("media i giorni oltre la promessa sulle sole righe in ritardo", () => {
    const S = {
      generatoIl: "", runCorrente: null, runRicevutoIl: null, dataMassima: "2026-09-24", dataMinima: "2026-01-01", conteggi: {},
      dataset: {
        ordinato: [], fatturato: [], consegnato: [], portafoglio: [], preventivi_aperti: [], controllo_banco: [], consegnato_futuro_per_mese: [],
        acquisti: comeFatti([
          riga({ dataOrdine: "2026-07-01" }), // puntuale
          riga({ dataOrdine: "2026-07-02", primoArrivo: "2026-08-20" }), // 10 giorni
          riga({ dataOrdine: "2026-07-03", primoArrivo: "2026-08-14" }), // 4 giorni
        ], "2026-09-25"),
      },
    } as unknown as Snapshot;
    expect(esegui({ metrica: "ritardo_medio_fornitori" }, S).totale).toBe(7);
  });

  it("giorni di ritardo delle righe aperte e scadute, fino a oggi", () => {
    const S = {
      generatoIl: "", runCorrente: null, runRicevutoIl: null, dataMassima: "2026-09-24", dataMinima: "2026-01-01", conteggi: {},
      dataset: {
        ordinato: [], fatturato: [], consegnato: [], portafoglio: [], preventivi_aperti: [], controllo_banco: [], consegnato_futuro_per_mese: [],
        acquisti: comeFatti([
          riga({ dataOrdine: "2026-07-01", numeroOrdine: 1, rigaEvasa: false, qtaArrivata: 0, primoArrivo: null, dataConfermata: "2026-09-15" }), // 10 gg
          riga({ dataOrdine: "2026-07-02", numeroOrdine: 2, rigaEvasa: false, qtaArrivata: 0, primoArrivo: null, dataConfermata: "2026-09-05" }), // 20 gg
          riga({ dataOrdine: "2026-07-03", numeroOrdine: 3 }), // arrivata: non conta
        ], "2026-09-25"),
      },
    } as unknown as Snapshot;
    expect(esegui({ metrica: "ritardo_da_sollecitare" }, S).totale).toBe(20);
    const per = esegui({ metrica: "ritardo_da_sollecitare", raggruppa: ["documento"] }, S);
    expect(per.righe.find((x) => x.etichetta.includes(" 1/"))?.valore).toBe(10);
  });
});

describe("dettaglio documenti degli acquisti", () => {
  it("elenca gli ordini del fornitore e le righe con promessa, arrivo e ritardo", async () => {
    const { dettaglioDocumenti } = await import("@/lib/prototipo-bi/dettaglio");
    const S = {
      generatoIl: "", runCorrente: null, runRicevutoIl: null, dataMassima: "2026-09-24", dataMinima: "2026-01-01", conteggi: {},
      dataset: {
        ordinato: [], fatturato: [], consegnato: [], portafoglio: [], preventivi_aperti: [], controllo_banco: [], consegnato_futuro_per_mese: [],
        acquisti: comeFatti([
          riga({ dataOrdine: "2026-07-01", numeroOrdine: 7, fornitore: "COLUMBUS", rigaEvasa: false, qtaArrivata: 0, primoArrivo: null, dataConfermata: "2026-09-05" }),
          riga({ dataOrdine: "2026-07-02", numeroOrdine: 8, fornitore: "AIGNEP" }),
        ], "2026-09-25"),
      },
    } as unknown as Snapshot;
    const e = dettaglioDocumenti({ dataset: "acquisti", filtri: [{ campo: "fornitore", op: "eq", valore: "COLUMBUS" }], documento: "OF 7/2026" }, S);
    expect(e.totaleDocumenti).toBe(1);
    expect(e.documenti[0].cliente).toBe("COLUMBUS");
    expect(e.righe?.[0]).toMatchObject({ promessa: "2026-09-05", arrivo: null, ritardo: 20 });
  });
});
