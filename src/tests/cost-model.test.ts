import { describe, it, expect } from "vitest";
import {
  calcNettoArticolo, calcTotaleServizio,
  calcBloccoVendita, calcBloccoCosto, calcBloccoPrezzoFinale,
  calcBloccoVenditaUnitaria, calcBloccoCostoUnitario, calcBloccoPrezzoUnitario,
  capitalizzaDescrizione,
  ricalcolaArticoliFormule, ricalcolaCatenaGuida,
  type Blocco, type ArticoloBlocco, type ServizioBlocco,
} from "@/components/portali/preventivatore/nuovo-view-types";

function art(p: Partial<ArticoloBlocco>): ArticoloBlocco {
  return { _key: Math.random().toString(36), prodotto_id: "", codice: "", descrizione: "",
    ult_costo: 0, qty: 1, coeff_ricarico: 0.5, ...p };
}
function srv(p: Partial<ServizioBlocco>): ServizioBlocco {
  return { _key: Math.random().toString(36), servizio_id: "", nome: "", categoria: "",
    tariffa_ora: 0, ore: 0, coeff_ricarico: 0.5, scala_con_quantita: true, ...p };
}
function blocco(p: Partial<Blocco>): Blocco {
  return { _key: "b1", tipo: "Altro", nome: "", note: "", espanso: true,
    articoli: [], servizi: [], quantita_pezzi: 1, margine_trattativa_pct: null, ...p };
}

describe("cost model SICS (canonico)", () => {
  // Blocco di riferimento: materiale 500 (coeff 0.5), Montaggio per-pezzo, Progettazione una-tantum
  const b = blocco({
    quantita_pezzi: 3,
    articoli: [art({ ult_costo: 500, qty: 1, coeff_ricarico: 0.5 })],
    servizi: [
      srv({ nome: "Montaggio", ore: 4, tariffa_ora: 25, coeff_ricarico: 0.5, scala_con_quantita: true }),
      srv({ nome: "Progettazione", ore: 10, tariffa_ora: 25, coeff_ricarico: 0.5, scala_con_quantita: false }),
    ],
  });

  it("netto articolo = ult_costo×qty/coeff", () => {
    expect(calcNettoArticolo(art({ ult_costo: 500, qty: 1, coeff_ricarico: 0.5 }))).toBe(1000);
    expect(calcTotaleServizio(srv({ ore: 4, tariffa_ora: 25, coeff_ricarico: 0.5 }))).toBe(200);
  });

  it("vendita complessiva: materiali ×Q, manodopera ×1 (ore dell'intero lotto)", () => {
    // 1000×3 + 200 + 500 = 3700
    expect(calcBloccoVendita(b, 3)).toBe(3700);
    // Q=1: 1000 + 200 + 500
    expect(calcBloccoVendita(b, 1)).toBe(1700);
  });

  it("costo vergine complessivo", () => {
    // 500×1×3 + 25×4 + 25×10 = 1500 + 100 + 250 = 1850
    expect(calcBloccoCosto(b, 3)).toBe(1850);
  });

  it("viste unitarie: materiali ×1, ÷Q ripartita, una-tantum intera", () => {
    // vendita/pz = 1000 (mat) + 200÷3 (Montaggio ÷Q) + 500 (Progettazione 1×)
    expect(calcBloccoVenditaUnitaria(b, 3)).toBeCloseTo(1566.6667, 3);
    // costo/pz = 500 + 100÷3 + 250
    expect(calcBloccoCostoUnitario(b, 3)).toBeCloseTo(783.3333, 3);
  });

  it("con SOLE voci ÷Q vale unitario × Q = complessivo", () => {
    const soloRipartite = blocco({
      quantita_pezzi: 4,
      articoli: [art({ ult_costo: 500, qty: 1, coeff_ricarico: 0.5 })],
      servizi: [srv({ nome: "Lavorazione", ore: 8, tariffa_ora: 25, coeff_ricarico: 0.5, scala_con_quantita: true })],
    });
    expect(calcBloccoVenditaUnitaria(soloRipartite, 4) * 4).toBeCloseTo(calcBloccoVendita(soloRipartite, 4), 6);
    expect(calcBloccoPrezzoUnitario(soloRipartite, 4, 0) * 4).toBeCloseTo(calcBloccoPrezzoFinale(soloRipartite, 4, 0), 6);
  });

  it("caso reale: 1000 € di lavorazione su 10 pezzi", () => {
    // coeff 1 → vendita = costo, per leggere i numeri direttamente
    const mk = (scala: boolean) => blocco({
      quantita_pezzi: 10,
      servizi: [srv({ nome: "Lavorazione", ore: 1000, tariffa_ora: 1, coeff_ricarico: 1, scala_con_quantita: scala })],
    });
    // ÷Q: 100 sul pezzo, 1000 nel totale
    expect(calcBloccoVenditaUnitaria(mk(true), 10)).toBeCloseTo(100, 6);
    expect(calcBloccoVendita(mk(true), 10)).toBeCloseTo(1000, 6);
    // 1× (una tantum): 1000 sul pezzo e 1000 nel totale
    expect(calcBloccoVenditaUnitaria(mk(false), 10)).toBeCloseTo(1000, 6);
    expect(calcBloccoVendita(mk(false), 10)).toBeCloseTo(1000, 6);
  });

  it("prezzo finale: vendita + imb(1% su vendita) + tempi(2.8% su costo) + spese(24.2% su costo)", () => {
    // vend 3700 ; imb 37 ; tempi 1850*0.028=51.8 ; spese 1850*0.242=447.7 ; margine 0
    expect(calcBloccoPrezzoFinale(b, 3, 0)).toBeCloseTo(4236.5, 2);
    // con margine globale 5%
    expect(calcBloccoPrezzoFinale(b, 3, 5)).toBeCloseTo(4236.5 * 1.05, 2);
    // override margine blocco prevale sul globale
    expect(calcBloccoPrezzoFinale(blocco({ ...b, margine_trattativa_pct: 10 }), 3, 5)).toBeCloseTo(4236.5 * 1.1, 2);
    // prezzo per pezzo: add-on ricalcolati sulla base unitaria
    expect(calcBloccoPrezzoUnitario(b, 3, 0)).toBeCloseTo(1793.8333, 2);
  });
});

describe("capitalizzaDescrizione (anagrafica MAIUSCOLA → leggibile)", () => {
  it("prima lettera maiuscola, resto minuscolo", () => {
    expect(capitalizzaDescrizione("TESTATA FOLLE")).toBe("Testata folle");
  });
  it("preserva codici e misure (token con cifre)", () => {
    expect(capitalizzaDescrizione("TESTATA FOLLE FMIE-A85")).toBe("Testata folle FMIE-A85");
    expect(capitalizzaDescrizione("TRAVE W=85MM")).toBe("Trave W=85MM");
  });
  it("preserva le sigle tecniche note", () => {
    expect(capitalizzaDescrizione("GUIDA HDPE COLORE BIANCO")).toBe("Guida HDPE colore bianco");
    expect(capitalizzaDescrizione("LAMIERA INOX AISI")).toBe("Lamiera INOX AISI");
  });
  it("lascia invariate le descrizioni già scritte normalmente", () => {
    expect(capitalizzaDescrizione("Testata folle già scritta")).toBe("Testata folle già scritta");
  });
  it("gestisce stringa vuota", () => {
    expect(capitalizzaDescrizione("")).toBe("");
  });
});

describe("formule live tra righe (ricalcolaArticoliFormule)", () => {
  it("tubo = fiancate*2, guarnizione = fiancate", () => {
    const b = blocco({
      articoli: [
        art({ slug: "fiancate", qty: 3 }),
        art({ slug: "tubo", qta_formula: "fiancate*2", qty: 0 }),
        art({ slug: "guarnizione", qta_formula: "fiancate", qty: 0 }),
      ],
    });
    const out = ricalcolaArticoliFormule(b.parametri, b.articoli);
    expect(out[1].qty).toBe(6);
    expect(out[2].qty).toBe(3);
  });

  it("override manuale: una riga-formula con qta_override non viene ricalcolata", () => {
    const b = blocco({
      articoli: [
        art({ slug: "fiancate", qty: 5 }),
        art({ slug: "tubo", qta_formula: "fiancate*2", qty: 99, qta_override: true }),
      ],
    });
    const out = ricalcolaArticoliFormule(b.parametri, b.articoli);
    expect(out[1].qty).toBe(99); // resta il valore manuale
  });
});

describe("catena/guida Nastro (ricalcolaCatenaGuida)", () => {
  it("ult_costo effettivo = base + metri_catena×€cat + metri_guida×€guida", () => {
    const b = blocco({
      usa_catena_guida: true,
      catena_articolo: { codice: "FSPC", descrizione: "Catena", costo: 10 },
      guida_articolo: { codice: "FASR", descrizione: "Guida", costo: 5 },
      articoli: [art({ ult_costo: 100, metri_catena: 2, metri_guida: 4 })],
    });
    const out = ricalcolaCatenaGuida(b);
    expect(out[0].ult_costo_componente).toBe(100);
    expect(out[0].ult_costo).toBe(100 + 2 * 10 + 4 * 5); // 140
  });

  it("senza usa_catena_guida non tocca nulla", () => {
    const b = blocco({ articoli: [art({ ult_costo: 100, metri_catena: 2 })] });
    expect(ricalcolaCatenaGuida(b)[0].ult_costo).toBe(100);
  });
});
