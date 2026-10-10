import { describe, expect, it } from "vitest";
import { TRACCIATI, convertiRiga } from "../../scripts/lib/fornitori-tracciati.mjs";

/** Righe vere dei CSV prodotti da dbisql il 10/10/2026 (senza intestazione). */
const FATTURA = ["2942339", "FF", "22", "110/01", "2024-01-12", "2024-01-31", "15002218", "I.L.C. srl", "2.1n.05-025", "DISTRIBUTORE", "IMPIANTI", "6,0000", "370,2100", "2890171", "OF", "1183", "2023-08-23", "04", "RB 120 ggfm                        ", "492658"];
const DOCUMENTO = ["491756", "OC", "2", "1445/MO", "2023-12-27", "2024-01-02", "05003576", "SALUMIFICI GRANTERRE spa", "23", "BB 90 ggfm  ", "81,4000", "0", "", "", "", "0,0000", "0,0000", "0,00"];
const SCADENZA = ["43443", "A", "2008-05-31", "2008-02-20", "3101,9500", "3101,9500", "FC", "204", "142075", "05002556", "I.M.E.C. GROUP srl", "23", "P"];

describe("tracciati fornitori/pagamenti", () => {
  it("la fattura fornitore si converte: numeri italiani, data, articolo maiuscolo, condizione ripulita", () => {
    const r = convertiRiga(TRACCIATI.fatture_fornitore, FATTURA, 1);
    expect(r.valore).toBe(370.21);
    expect(r.quantita).toBe(6);
    expect(r.codice_articolo).toBe("2.1N.05-025");
    expect(r.condizione_descrizione).toBe("RB 120 ggfm");
    expect(r.id_riga_ordine).toBe(2890171);
    expect(r.profilo_ordine).toBe("OF");
  });

  it("senza legame all'ordine il gestionale scrive 0 e vuoto: diventano assenti", () => {
    const senza = [...FATTURA];
    senza[13] = "0"; senza[14] = ""; senza[15] = "0"; senza[16] = "";
    const r = convertiRiga(TRACCIATI.fatture_fornitore, senza, 1);
    expect(r.id_riga_ordine).toBeNull();
    expect(r.profilo_ordine).toBeNull();
    expect(r.numero_ordine).toBeNull();
    expect(r.data_ordine).toBeNull();
  });

  it("un ordine senza scadenze ha giorni medi assenti, non zero", () => {
    const r = convertiRiga(TRACCIATI.documenti_pagamento, DOCUMENTO, 1);
    expect(r.giorni_medi).toBeNull();
    expect(r.prima_scadenza).toBeNull();
    expect(r.n_scadenze).toBe(0);
  });

  it("la scadenza si converte", () => {
    const r = convertiRiga(TRACCIATI.scadenzario, SCADENZA, 1);
    expect(r).toMatchObject({ id_scadenza: 43443, tipo: "A", importo: 3101.95, saldo: 3101.95, profilo: "FC" });
  });

  it("un tracciato spostato di una colonna si rifiuta invece di caricare dati nei campi sbagliati", () => {
    expect(() => convertiRiga(TRACCIATI.fatture_fornitore, FATTURA.slice(1), 7)).toThrow(/riga 7: 19 colonne invece di 20/);
    const spostata = ["FF", ...FATTURA.slice(0, 19)];
    expect(() => convertiRiga(TRACCIATI.fatture_fornitore, spostata, 3)).toThrow(/riga 3/);
  });

  it("un profilo non estratto si rifiuta", () => {
    const r = [...FATTURA]; r[1] = "ZZ";
    expect(() => convertiRiga(TRACCIATI.fatture_fornitore, r, 1)).toThrow(/profilo inatteso/);
  });

  it("senza la data obbligatoria la riga si rifiuta", () => {
    const r = [...SCADENZA]; r[2] = "";
    expect(() => convertiRiga(TRACCIATI.scadenzario, r, 1)).toThrow(/data_scadenza mancante/);
  });
});
