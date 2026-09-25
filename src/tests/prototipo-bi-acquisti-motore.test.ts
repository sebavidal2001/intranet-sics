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
    gruppoArticoli: "SISTEMI", quantita: 10, qtaArrivata: 10, valore: 100, dataPrevista: null,
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
    expect(dimensioniPerMetrica("acquisti_righe")).toEqual(["fornitore", "buyer", "categoria", "articolo", "documento"]);
    expect(() => validaSpec({ metrica: "acquisti_righe", raggruppa: ["agente"] })).toThrow(SpecNonValida);
    expect(() => validaSpec({ metrica: "ordinato", raggruppa: ["buyer"] })).toThrow(SpecNonValida);
  });

  it("i filtri di pagina di vendita si saltano sui riquadri acquisti, e lo si dice", () => {
    const esito = fondiFiltriPaginaConEsito({ metrica: "acquisti_righe" }, { bu: "COMPONENTI", agente: "AIRFLUID" });
    expect(esito.spec.filtri ?? []).toEqual([]);
    expect(esito.filtriPaginaIgnorati).toEqual(["bu", "agente"]);
  });

  it("un perimetro per agente esclude tutti gli acquisti", () => {
    const p = applicaPerimetro(S, { tipo: "agente", codici: ["AG000010"] });
    expect(p.dataset.acquisti).toEqual([]);
  });
});
