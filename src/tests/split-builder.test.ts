import { describe, it, expect } from "vitest";
import {
  applicaStandard,
  codiciDaValutare,
  composizioneArticolo,
  costoPienoArticolo,
  normalizzaSplit,
  riscalaArticolo,
  senzaSplit,
  type QuoteStandard,
} from "@/components/portali/preventivatore/split-builder";
import {
  calcBloccoCosto,
  calcBloccoVendita,
  type ArticoloBlocco,
  type Blocco,
} from "@/components/portali/preventivatore/nuovo-view-types";

// Rullo folle: 39,98 € di standard = 18,07 materiale + 21,11 manodopera + 0,80 trattamenti esterni.
const RULLO: QuoteStandard = { costo_totale: 40, materiale: 18, manodopera: 21.2, lavorazione: 0, lav_esterna: 0.8, altro: 0 };

const art = (o: Partial<ArticoloBlocco> = {}): ArticoloBlocco => ({
  _key: "a1", prodotto_id: "", codice: "AFD.00.2.00019.0", descrizione: "rullo", ult_costo: 37.5, qty: 2, coeff_ricarico: 0.5, ...o,
});
const blocco = (articoli: ArticoloBlocco[], q = 3, extra: Partial<Blocco> = {}): Blocco => ({
  _key: "b1", tipo: "Altro", nome: "B1", note: "", espanso: true, articoli, servizi: [], quantita_pezzi: q, margine_trattativa_pct: null, ...extra,
});
const std = (m: Record<string, QuoteStandard | null>) => new Map(Object.entries(m));

describe("applicaStandard", () => {
  it("ult_costo diventa la sola materia prima e il resto va in split, senza perdere un centesimo", () => {
    const a = applicaStandard(art(), RULLO);
    expect(a.ult_costo).toBeCloseTo(16.875);
    expect(a.split!.manodopera).toBeCloseTo(19.875);
    expect(a.split!.lav_esterna).toBeCloseTo(0.75);
    expect(costoPienoArticolo(a)).toBeCloseTo(37.5, 9);
  });
  it("senza standard l'articolo resta a costo pieno e non viene rivalutato", () => {
    expect(applicaStandard(art(), null)).toMatchObject({ ult_costo: 37.5, split: null });
  });
  it("senza costo non c'e' niente da dividere: resta da valutare", () => {
    expect(applicaStandard(art({ ult_costo: 0 }), RULLO).split).toBeUndefined();
  });
  it("senzaSplit riporta il costo pieno", () => {
    expect(senzaSplit(applicaStandard(art(), RULLO)).ult_costo).toBeCloseTo(37.5, 9);
  });
});

describe("normalizzaSplit", () => {
  it("genera le righe da distinta e lascia invariati costo e prezzo di vendita del blocco", () => {
    const prima = blocco([art()]);
    const dopo = normalizzaSplit([prima], std({ "AFD.00.2.00019.0": RULLO }))![0];
    expect(dopo.servizi.map((s) => s.auto_split)).toEqual(["manodopera", "lav_esterna"]);
    // lotto: 19,875 × 2 pz × 3 blocchi = 119,25 € di manodopera; 0,75 × 6 = 4,5 € di trattamenti
    expect(dopo.servizi[0].tariffa_ora).toBeCloseTo(119.25);
    expect(dopo.servizi[1].tariffa_ora).toBeCloseTo(4.5);
    expect(calcBloccoCosto(dopo, 3)).toBeCloseTo(calcBloccoCosto(prima, 3), 6);
    expect(calcBloccoVendita(dopo, 3)).toBeCloseTo(calcBloccoVendita(prima, 3), 6);
  });

  it("e' idempotente: applicato al proprio risultato non cambia nulla", () => {
    const una = normalizzaSplit([blocco([art()])], std({ "AFD.00.2.00019.0": RULLO }))!;
    expect(normalizzaSplit(una, std({ "AFD.00.2.00019.0": RULLO }))).toBeNull();
  });

  it("con ricarichi diversi il prezzo di vendita resta quello di prima (a meno dei 3 decimali del coefficiente)", () => {
    const prima = blocco([art(), art({ _key: "a2", coeff_ricarico: 0.65, qty: 1 })], 2);
    const dopo = normalizzaSplit([prima], std({ "AFD.00.2.00019.0": RULLO }))![0];
    const a = calcBloccoVendita(prima, 2);
    expect(Math.abs(calcBloccoVendita(dopo, 2) - a) / a).toBeLessThan(0.001);
  });

  it("cambiando quantita' o pezzi le righe si ricalcolano, tenendo la stessa _key", () => {
    const uno = normalizzaSplit([blocco([art()])], std({ "AFD.00.2.00019.0": RULLO }))![0];
    const chiave = uno.servizi[0]._key;
    const piu = normalizzaSplit([{ ...uno, quantita_pezzi: 6 }], std({}))![0];
    expect(piu.servizi[0].tariffa_ora).toBeCloseTo(238.5);
    expect(piu.servizi[0]._key).toBe(chiave);
  });

  it("togliendo l'articolo spariscono le righe da distinta, non le lavorazioni manuali", () => {
    const manuale = { _key: "m", servizio_id: "1", nome: "Saldatura", categoria: "x", tariffa_ora: 40, ore: 2, coeff_ricarico: 0.5, scala_con_quantita: true };
    const con = normalizzaSplit([blocco([art()], 3, { servizi: [manuale] })], std({ "AFD.00.2.00019.0": RULLO }))![0];
    expect(con.servizi.map((s) => s.nome)).toEqual(["Manodopera da distinta", "Trattamenti esterni da distinta", "Saldatura"]);
    const senza = normalizzaSplit([{ ...con, articoli: [] }], std({}))![0];
    expect(senza.servizi).toEqual([manuale]);
  });

  it("non tocca voci manuali, componenti Nastro e articoli senza standard", () => {
    const b = blocco([art({ manuale: true, codice: "" }), art({ _key: "a3", codice: "XYZ" })]);
    const n = normalizzaSplit([b], std({ XYZ: null }))![0];
    expect(n.articoli[0].split).toBeUndefined();
    expect(n.articoli[1]).toMatchObject({ ult_costo: 37.5, split: null });
    expect(n.servizi).toHaveLength(0);
    const nastro = blocco([art()], 1, { usa_catena_guida: true });
    expect(normalizzaSplit([nastro], std({ "AFD.00.2.00019.0": RULLO }))).toBeNull();
  });

  it("aspetta lo standard finche' non e' arrivato", () => {
    expect(normalizzaSplit([blocco([art()])], std({}))).toBeNull();
    expect(codiciDaValutare([blocco([art()])])).toEqual(["AFD.00.2.00019.0"]);
  });
});

describe("riscalaArticolo e composizione", () => {
  it("riscala materia prima e componenti in proporzione", () => {
    const a = applicaStandard(art(), RULLO);
    const r = riscalaArticolo(a, 75);
    expect(costoPienoArticolo(r)).toBeCloseTo(75, 6);
    expect(r.ult_costo / costoPienoArticolo(r)).toBeCloseTo(a.ult_costo / 37.5, 6);
  });
  it("l'overlay elenca solo le componenti presenti", () => {
    const c = composizioneArticolo(applicaStandard(art(), RULLO))!;
    expect(c.map((x) => x.chiave)).toEqual(["materiale", "manodopera", "lav_esterna"]);
    expect(composizioneArticolo(art())).toBeNull();
  });
});
