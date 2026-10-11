import { describe, expect, it } from "vitest";
import { comeFatti, type RigaAcquisto } from "@/lib/prototipo-bi/acquisti";
import { esegui, validaSpec, SpecNonValida } from "@/lib/prototipo-bi/semantico";
import { fondiFiltriPaginaConEsito } from "@/lib/prototipo-bi/filtri-pagina";
import { applicaPerimetro } from "@/lib/prototipo-bi/perimetro";
import { dimensioniPerMetrica } from "@/lib/prototipo-bi/tassonomia";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

const OGGI = "2026-09-25";

function riga(p: Partial<RigaAcquisto> & { dataOrdine: string }): RigaAcquisto {
  return {
    idRiga: 1, profilo: "OF", numeroOrdine: 1, codiceFornitore: "F", fornitore: "COLUMBUS",
    buyerUtente: "claudiodalsass", buyer: "Claudio Dalsass", articolo: "A", descrizione: "",
    gruppoArticoli: "SISTEMI", categoria: "STRUTTURE", businessUnit: "STRUTTURE", quantita: 10, qtaArrivata: 10, valore: 100, dataPrevista: null,
    dataConfermata: "2026-08-10", rigaEvasa: true, chiusaForzata: false, primoArrivo: "2026-08-05", ...p,
  };
}

function snapshot(righe: RigaAcquisto[]): Snapshot {
  return {
    generatoIl: "", runCorrente: null, runRicevutoIl: null, dataMassima: "2026-09-24", dataMinima: "2026-01-01",
    conteggi: {},
    dataset: {
      ordinato: [], fatturato: [], consegnato: [], portafoglio: [], preventivi_aperti: [], controllo_banco: [],
      consegnato_futuro_per_mese: [], acquisti: comeFatti(righe, OGGI),
    },
  };
}

const S = snapshot([
  riga({ dataOrdine: "2026-07-01", numeroOrdine: 1 }), // puntuale
  riga({ dataOrdine: "2026-07-02", numeroOrdine: 1, primoArrivo: "2026-08-20" }), // in ritardo
  riga({ dataOrdine: "2026-07-03", numeroOrdine: 2, fornitore: "AIGNEP", buyer: "Linda Carlone",
    rigaEvasa: false, qtaArrivata: 0, primoArrivo: null, dataConfermata: "2026-09-01", valore: 60 }), // scaduta
]);

describe("acquisti nel motore semantico", () => {
  it("valore, righe e ordini", () => {
    expect(esegui({ metrica: "acquisti_valore" }, S).totale).toBe(260);
    expect(esegui({ metrica: "acquisti_righe" }, S).totale).toBe(3);
    expect(esegui({ metrica: "acquisti_ordini" }, S).totale).toBe(2);
  });

  it("la puntualita' conta solo le righe arrivate", () => {
    expect(esegui({ metrica: "puntualita_fornitori" }, S).totale).toBe(50);
  });

  it("da sollecitare per buyer", () => {
    const r = esegui({ metrica: "acquisti_valore_da_sollecitare", raggruppa: ["buyer"] }, S);
    expect(r.righe.find((x) => x.etichetta === "Linda Carlone")?.valore).toBe(60);
  });

  it("le dimensioni degli acquisti sono fornitore e buyer, non agente o cliente", () => {
    expect(dimensioniPerMetrica("acquisti_righe")).toEqual(["fornitore", "buyer", "bu", "categoria", "bu_categoria", "codice_articolo", "articolo", "profilo", "data_promessa", "condizione_pagamento", "documento"]);
    expect(() => validaSpec({ metrica: "acquisti_righe", raggruppa: ["agente"] })).toThrow(SpecNonValida);
    expect(() => validaSpec({ metrica: "ordinato", raggruppa: ["buyer"] })).toThrow(SpecNonValida);
  });

  it("il filtro BU di pagina vale sugli acquisti, quello per agente si salta e lo si dice", () => {
    const esito = fondiFiltriPaginaConEsito({ metrica: "acquisti_righe" }, { bu: "COMPONENTI", agente: "AIRFLUID" });
    expect(esito.spec.filtri ?? []).toEqual([{ campo: "bu", op: "eq", valore: "COMPONENTI" }]);
    expect(esito.filtriPaginaIgnorati).toEqual(["agente"]);
  });

  it("filtrando per business unit i numeri cambiano", () => {
    const misto = snapshot([
      riga({ dataOrdine: "2026-07-01", valore: 100, businessUnit: "STRUTTURE" }),
      riga({ dataOrdine: "2026-07-02", valore: 40, businessUnit: "COMPONENTI", categoria: "FLUIDI" }),
    ]);
    expect(esegui({ metrica: "acquisti_valore" }, misto).totale).toBe(140);
    expect(esegui({ metrica: "acquisti_valore", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] }, misto).totale).toBe(40);
    const perBu = esegui({ metrica: "acquisti_valore", raggruppa: ["bu"], ordina: "valore_desc" }, misto);
    expect(perBu.righe.map((r) => [r.etichetta, r.valore])).toEqual([["STRUTTURE", 100], ["COMPONENTI", 40]]);
  });

  it("un perimetro per agente esclude tutti gli acquisti", () => {
    const p = applicaPerimetro(S, { tipo: "agente", codici: ["AG000010"] });
    expect(p.dataset.acquisti).toEqual([]);
  });
});
