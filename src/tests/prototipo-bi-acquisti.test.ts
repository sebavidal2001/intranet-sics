import { describe, expect, it } from "vitest";
import {
  calcolaCruscottoAcquisti,
  daVista,
  inizioSettimana,
  oggiAcquisti,
  puntuale,
  scaduta,
  valoreResiduo,
  type RigaAcquisto,
} from "@/lib/prototipo-bi/acquisti";
import { costruisciContesto, rilevaTutto } from "@/lib/prototipo-bi/rilevatori";
import { applicaPerimetro } from "@/lib/prototipo-bi/perimetro";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

const OGGI = "2026-09-24";

function riga(p: Partial<RigaAcquisto> & { dataOrdine: string }): RigaAcquisto {
  return {
    idRiga: Math.floor(Math.random() * 1e9),
    profilo: "OF",
    numeroOrdine: 1,
    codiceFornitore: "F1",
    fornitore: "FORNITORE UNO",
    buyerUtente: "claudiodalsass",
    buyer: "Claudio Dalsass",
    articolo: "ART",
    descrizione: "Articolo",
    gruppoArticoli: "SISTEMI",
    quantita: 10,
    qtaArrivata: 10,
    valore: 100,
    dataPrevista: null,
    dataConfermata: null,
    rigaEvasa: true,
    chiusaForzata: false,
    primoArrivo: null,
    ...p,
  };
}

function snapshot(acquisti: RigaAcquisto[], acquistiAl: string | null = OGGI): Snapshot {
  return {
    generatoIl: `${OGGI}T06:00:00Z`,
    runCorrente: null,
    runRicevutoIl: null,
    dataMassima: "2026-09-23",
    dataMinima: "2025-01-02",
    conteggi: {},
    dataset: {
      ordinato: [],
      fatturato: [],
      consegnato: [],
      portafoglio: [],
      preventivi_aperti: [],
      controllo_banco: [],
      consegnato_futuro_per_mese: [],
    },
    acquisti,
    acquistiAl,
  };
}

describe("definizioni", () => {
  it("la promessa e' la data confermata, o la prevista se manca", () => {
    expect(puntuale(riga({ dataOrdine: "2026-01-01", dataPrevista: "2026-01-10", dataConfermata: "2026-01-20", primoArrivo: "2026-01-15" }))).toBe(true);
    expect(puntuale(riga({ dataOrdine: "2026-01-01", dataPrevista: "2026-01-10", primoArrivo: "2026-01-15" }))).toBe(false);
    expect(puntuale(riga({ dataOrdine: "2026-01-01", dataPrevista: "2026-01-10" }))).toBeNull();
  });

  it("scaduta: aperta, non chiusa a forza, promessa passata", () => {
    const aperta = { rigaEvasa: false, qtaArrivata: 4, dataConfermata: "2026-09-01" };
    expect(scaduta(riga({ dataOrdine: "2026-08-01", ...aperta }), OGGI)).toBe(true);
    expect(scaduta(riga({ dataOrdine: "2026-08-01", ...aperta, chiusaForzata: true }), OGGI)).toBe(false);
    expect(scaduta(riga({ dataOrdine: "2026-08-01", ...aperta, dataConfermata: "2026-10-01" }), OGGI)).toBe(false);
    expect(valoreResiduo(riga({ dataOrdine: "2026-08-01", ...aperta }))).toBe(60);
  });

  it("legge la riga della vista con i tipi giusti", () => {
    const r = daVista({
      id_riga: 3435780, profilo: "OF", numero_ordine: 1931, data_ordine: "2026-09-24",
      fornitore: "FABBI IMOLA srl", buyer_utente: "produzione", buyer: "Daniele Mandrioli",
      codice_articolo: "QFAB/0081", quantita: "30.0000", qta_arrivata: "0", valore: "121.48",
      data_prevista: "2026-10-09", data_confermata: null, riga_evasa: false, chiusa_forzata: false,
      primo_arrivo: null,
    });
    expect(r.quantita).toBe(30);
    expect(r.valore).toBe(121.48);
    expect(r.dataConfermata).toBeNull();
    expect(r.rigaEvasa).toBe(false);
  });

  it("la settimana parte dal lunedi'", () => {
    expect(inizioSettimana("2026-09-24")).toBe("2026-09-21");
    expect(inizioSettimana("2026-09-21")).toBe("2026-09-21");
  });

  it("gli scaduti si giudicano alla data di estrazione degli acquisti, non all'ultima vendita", () => {
    expect(oggiAcquisti(snapshot([]))).toBe(OGGI);
    expect(oggiAcquisti(snapshot([], null))).toBe("2026-09-23");
  });
});

describe("cruscotto", () => {
  it("puntualita' sulle righe ARRIVATE nel periodo, volume sulle righe ORDINATE", () => {
    const righe = [
      // ordinata a luglio, arrivata a settembre in ritardo: conta nella puntualita' di settembre
      riga({ dataOrdine: "2026-07-10", dataConfermata: "2026-08-31", primoArrivo: "2026-09-05" }),
      riga({ dataOrdine: "2026-09-02", dataConfermata: "2026-09-20", primoArrivo: "2026-09-10" }),
      riga({ dataOrdine: "2026-09-03", buyer: "Daniele Mandrioli", buyerUtente: "produzione", rigaEvasa: false, qtaArrivata: 0, dataConfermata: "2026-09-15" }),
    ];
    const c = calcolaCruscottoAcquisti(righe, { dal: "2026-09-01", al: "2026-09-30", oggi: OGGI });
    expect(c.totale.righe).toBe(2);
    expect(c.totale.righeArrivate).toBe(2);
    expect(c.totale.puntualitaPct).toBe(50);
    expect(c.totale.ritardoMedioGiorni).toBe(5);
    expect(c.totale.righeScadute).toBe(1);
    const mandrioli = c.perBuyer.find((b) => b.nome === "Daniele Mandrioli");
    expect(mandrioli?.quotaRighePct).toBe(50);
    expect(c.scadute[0].giorniRitardo).toBe(9);
  });

  it("dice quando c'e' l'utente condiviso", () => {
    const c = calcolaCruscottoAcquisti([riga({ dataOrdine: "2026-09-01", buyerUtente: "acquisti", buyer: "acquisti" })], {
      dal: "2026-01-01", al: OGGI, oggi: OGGI,
    });
    expect(c.avvisi.some((a) => a.includes("condiviso"))).toBe(true);
  });
});

describe("rilevatori acquisti", () => {
  it("fornitori: segnala chi e' passato da puntuale a in ritardo", () => {
    const righe: RigaAcquisto[] = [];
    // 12 mesi prima: 40 arrivi puntuali
    for (let i = 0; i < 40; i++) {
      righe.push(riga({ dataOrdine: "2026-01-10", dataConfermata: "2026-02-10", primoArrivo: "2026-02-05", valore: 500 }));
    }
    // ultimi 90 giorni: 20 arrivi, 15 in ritardo di 10 giorni
    for (let i = 0; i < 20; i++) {
      righe.push(riga({ dataOrdine: "2026-07-20", dataConfermata: "2026-08-10", primoArrivo: i < 15 ? "2026-08-20" : "2026-08-05", valore: 500 }));
    }
    const s = rilevaTutto(costruisciContesto(snapshot(righe), null)).find((x) => x.famiglia === "fornitori");
    expect(s?.id).toBe("fornitori-puntualita");
    expect(s?.descrizione).toContain("FORNITORE UNO 100% → 25%");
    expect(s?.magnitudineEuro).toBe(7_500);
  });

  it("carico: l'arretrato di righe scadute diventa una voce, con il buyer piu' coinvolto", () => {
    const righe: RigaAcquisto[] = [];
    // ordini regolari su 26 settimane perche' il rilevatore abbia una base
    for (let w = 0; w < 26; w++) {
      const d = new Date(Date.UTC(2026, 2, 23 + w * 7)).toISOString().slice(0, 10);
      righe.push(riga({ dataOrdine: d, buyer: w % 2 ? "Linda Carlone" : "Claudio Dalsass" }));
    }
    for (let i = 0; i < 35; i++) {
      righe.push(riga({ dataOrdine: "2026-08-01", rigaEvasa: false, qtaArrivata: 0, dataConfermata: "2026-09-01", valore: 50 }));
    }
    const s = rilevaTutto(costruisciContesto(snapshot(righe), null)).find((x) => x.famiglia === "carico_acquisti");
    expect(s?.id).toBe("carico-acquisti");
    expect(s?.titolo).toContain("35 righe");
    expect(s?.descrizione).toContain("Claudio Dalsass");
  });

  it("senza acquisti i rilevatori tacciono", () => {
    const segnali = rilevaTutto(costruisciContesto(snapshot([]), null));
    expect(segnali.some((x) => x.famiglia === "fornitori" || x.famiglia === "carico_acquisti")).toBe(false);
  });
});

describe("perimetro", () => {
  it("chi ha un perimetro ristretto non vede gli acquisti", () => {
    const s = snapshot([riga({ dataOrdine: "2026-09-01" })]);
    expect(applicaPerimetro(s, { tipo: "agente", codici: ["AG000010"] }).acquisti).toEqual([]);
    expect(applicaPerimetro(s, { tipo: "tutto" }).acquisti).toHaveLength(1);
  });
});
