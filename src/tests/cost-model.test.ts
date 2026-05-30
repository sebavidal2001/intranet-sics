import { describe, it, expect } from "vitest";
import {
  calcNettoArticolo, calcTotaleServizio,
  calcBloccoVendita, calcBloccoCosto, calcBloccoPrezzoFinale,
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

  it("vendita complessiva: materiali ×Q, manodopera ×Q se scala, una-tantum ×1", () => {
    // 1000×3 + 200×3 + 500×1 = 4100
    expect(calcBloccoVendita(b, 3)).toBe(4100);
    // unità singola (Q=1): 1000 + 200 + 500
    expect(calcBloccoVendita(b, 1)).toBe(1700);
  });

  it("costo vergine complessivo", () => {
    // 500×1×3 + 25×4×3 + 25×10×1 = 1500 + 300 + 250 = 2050
    expect(calcBloccoCosto(b, 3)).toBe(2050);
  });

  it("prezzo finale: vendita + imb(1% su vendita) + tempi(2.8% su costo) + spese(24.2% su costo)", () => {
    // base 4100 ; imb 41 ; tempi 2050*0.028=57.4 ; spese 2050*0.242=496.1 ; margine 0
    expect(calcBloccoPrezzoFinale(b, 3, 0)).toBeCloseTo(4694.5, 2);
    // con margine globale 5%
    expect(calcBloccoPrezzoFinale(b, 3, 5)).toBeCloseTo(4694.5 * 1.05, 2);
    // override margine blocco prevale sul globale
    expect(calcBloccoPrezzoFinale(blocco({ ...b, margine_trattativa_pct: 10 }), 3, 5)).toBeCloseTo(4694.5 * 1.1, 2);
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
