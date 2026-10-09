/**
 * Misure personalizzate: definizioni dichiarative composte da metriche
 * certificate. Si prova che i numeri tornino con quelli delle metriche di base
 * (la misura non ha un calcolo suo), che le avvertenze si propaghino, che il
 * perimetro si erediti e che il validatore rifiuti tutto cio' che non ha senso.
 */
import { describe, expect, it } from "vitest";
import { esegui, validaSpec, SpecNonValida } from "@/lib/prototipo-bi/semantico";
import {
  descriviMisura,
  normalizzaValoriFiltri,
  operandiDellaMisura,
  periodoDiProva,
  provaMisura,
  unitaDellaMisura,
  validaMisura,
} from "@/lib/prototipo-bi/misure";
import { applicaPerimetro } from "@/lib/prototipo-bi/perimetro";
import { chiaveStabile } from "@/lib/prototipo-bi/cache";
import type { MisuraDefinita, RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

function riga(p: Partial<RigaFatto> & { documento: string; importo: number }): RigaFatto {
  return {
    data: "2026-01-10",
    bu: "COMPONENTI",
    categoria: "",
    agente: "Anna",
    codiceAgente: "AA",
    cliente: "Alfa",
    codiceCliente: "alfa",
    articolo: "A1",
    descrizioneArticolo: "Articolo",
    quantita: 1,
    ...p,
  };
}

// Fatturato 2026: costo noto su tutte tranne una riga (copertura < 100%).
const FATTURATO: RigaFatto[] = [
  riga({ documento: "F1", importo: 1000, quantita: 1, costoUnitario: 600 }),
  riga({ documento: "F1", importo: 500, quantita: 1, costoUnitario: 300 }),
  riga({ documento: "F2", importo: 2000, bu: "IMPIANTI", cliente: "Beta", codiceCliente: "beta", agente: "Bruno", codiceAgente: "BB", quantita: 1, costoUnitario: 1500, data: "2026-02-10" }),
  riga({ documento: "F3", importo: 500, bu: "IMPIANTI", cliente: "Beta", codiceCliente: "beta", agente: "Bruno", codiceAgente: "BB", quantita: 1, costoUnitario: null, data: "2026-02-11" }),
];
// Fatturato 2025 per l'anno precedente.
const FATTURATO_2025: RigaFatto[] = [
  riga({ documento: "G1", importo: 800, data: "2025-01-10", quantita: 1, costoUnitario: 500 }),
  riga({ documento: "G2", importo: 1200, data: "2025-02-10", bu: "IMPIANTI", cliente: "Beta", codiceCliente: "beta", agente: "Bruno", codiceAgente: "BB", quantita: 1, costoUnitario: 900 }),
];
// Ordinato: Gamma ha ordinato ma non ha fatture.
const ORDINATO: RigaFatto[] = [
  riga({ documento: "O1", importo: 1800 }),
  riga({ documento: "O2", importo: 2200, bu: "IMPIANTI", cliente: "Beta", codiceCliente: "beta", agente: "Bruno", codiceAgente: "BB" }),
  riga({ documento: "O3", importo: 900, cliente: "Gamma", codiceCliente: "gamma" }),
];

const SNAPSHOT: Snapshot = {
  generatoIl: "2026-04-01T08:00:00.000Z",
  runCorrente: "run-test",
  runRicevutoIl: "2026-04-01T07:00:00.000Z",
  dataMinima: "2025-01-01",
  dataMassima: "2026-03-31",
  dataset: {
    ordinato: ORDINATO,
    fatturato: [...FATTURATO, ...FATTURATO_2025],
    consegnato: [],
    portafoglio: [],
    preventivi_aperti: [],
    controllo_banco: [],
    consegnato_futuro_per_mese: [],
  },
  conteggi: { ordinato: ORDINATO.length, fatturato: FATTURATO.length + FATTURATO_2025.length },
  costiApprossimati: false,
};

const ANNO = { anno: 2026 };

function misura(espressione: unknown, nome = "Misura di prova"): MisuraDefinita {
  return validaMisura({ nome, espressione });
}

function calcola(m: MisuraDefinita, extra: Record<string, unknown> = {}) {
  return esegui(validaSpec({ metrica: "fatturato", misura: m, periodo: ANNO, ...extra }), SNAPSHOT);
}

describe("misure: i numeri tornano con le metriche di base", () => {
  it("metrica con filtro incorporato = la metrica con quel filtro", () => {
    const m = misura({ tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] });
    const atteso = esegui({ metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }], periodo: ANNO }, SNAPSHOT);
    expect(calcola(m).totale).toBe(1500);
    expect(calcola(m).totale).toBe(atteso.totale);
  });

  it("differenza fatturato - costo = margine (dove il costo c'e' sempre)", () => {
    const m = misura({
      tipo: "differenza",
      da: { metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
      sottrai: { metrica: "costo_venduto", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
    });
    const margine = esegui({ metrica: "margine", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }], periodo: ANNO }, SNAPSHOT);
    expect(calcola(m).totale).toBe(margine.totale);
    expect(calcola(m).totale).toBe(600);
  });

  it("rapporto margine / fatturato = margine %, in percentuale", () => {
    const m = misura({
      tipo: "rapporto",
      numeratore: { metrica: "margine" },
      denominatore: { metrica: "fatturato" },
    });
    expect(unitaDellaMisura(m.espressione)).toBe("percentuale");
    const r = calcola(m);
    // margine = 400+200+500 = 1100 su fatturato 4000 (la riga senza costo conta al denominatore)
    expect(r.totale).toBe(27.5);
    expect(r.unita).toBe("percentuale");
  });

  it("rapporto euro / numero = euro per unita': fatturato / n_fatture = fattura_media", () => {
    const m = misura({
      tipo: "rapporto",
      numeratore: { metrica: "fatturato" },
      denominatore: { metrica: "n_fatture" },
    });
    expect(unitaDellaMisura(m.espressione)).toBe("euro");
    const atteso = esegui({ metrica: "fattura_media", periodo: ANNO }, SNAPSHOT);
    expect(calcola(m).totale).toBe(atteso.totale);
    expect(calcola(m).unita).toBe("euro");
  });

  it("somma di due metriche in euro", () => {
    const m = misura({ tipo: "somma", addendi: [{ metrica: "fatturato" }, { metrica: "ordinato" }] });
    expect(calcola(m).totale).toBe(4000 + 4900);
  });

  it("quota = parte sul totale, e per gruppo e' la quota dentro il gruppo", () => {
    const m = misura({ tipo: "quota", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] });
    expect(calcola(m).totale).toBe(37.5);
    const perCliente = calcola(m, { raggruppa: ["cliente"] });
    const per = Object.fromEntries(perCliente.righe.map((r) => [r.etichetta, r.valore]));
    // Alfa fattura solo COMPONENTI (100%), Beta solo IMPIANTI (0%).
    expect(per).toEqual({ Alfa: 100, Beta: 0 });
  });

  it("raggruppa per mese combina riga per riga", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "margine" }, denominatore: { metrica: "fatturato" } });
    const r = calcola(m, { granularita: "mese" });
    const per = Object.fromEntries(r.righe.map((x) => [x.etichetta, x.valore]));
    expect(per["2026-01"]).toBe(40);
    expect(per["2026-02"]).toBe(20);
  });

  it("anno_precedente sposta il periodo di tutti gli operandi", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "margine" }, denominatore: { metrica: "fatturato" } });
    const r = calcola(m, { modificatore: "anno_precedente" });
    // 2025: margine 300+300=600 su 2000.
    expect(r.totale).toBe(30);
  });

  it("limite e ordinamento valgono sulla misura, non sugli operandi", () => {
    const m = misura({ tipo: "metrica", metrica: "fatturato" });
    const r = calcola(m, { raggruppa: ["cliente"], limite: 1, ordina: "valore_desc" });
    expect(r.righe).toHaveLength(1);
    expect(r.righe[0].etichetta).toBe("Beta");
  });
});

describe("misure: onesta' del risultato", () => {
  it("le avvertenze del margine arrivano alla misura derivata", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "margine" }, denominatore: { metrica: "fatturato" } });
    const avvisi = calcola(m).avvisi.join(" | ");
    expect(avvisi).toContain("Margine al costo di acquisto");
    expect(avvisi).toContain("Costo noto per il");
  });

  it("combinare ordinato e fatturato dichiara le date diverse", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "ordinato" }, denominatore: { metrica: "fatturato" } });
    const avvisi = calcola(m).avvisi.join(" | ");
    expect(avvisi).toContain("date di riferimento diverse");
    expect(avvisi).toContain("data dell'ordine");
    expect(avvisi).toContain("data della fattura");
  });

  it("un solo dataset non porta l'avviso sulle date", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "margine" }, denominatore: { metrica: "fatturato" } });
    expect(calcola(m).avvisi.join(" ")).not.toContain("date di riferimento diverse");
  });

  it("un gruppo senza denominatore NON diventa 0%: e' escluso e dichiarato", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "ordinato" }, denominatore: { metrica: "fatturato" } });
    const r = calcola(m, { raggruppa: ["cliente"] });
    expect(r.righe.map((x) => x.etichetta).sort()).toEqual(["Alfa", "Beta"]);
    expect(r.avvisi.join(" ")).toContain("1 gruppo escluso");
  });

  it("un operando additivo assente vale zero (ordinato senza fatture nella differenza)", () => {
    const m = misura({ tipo: "differenza", da: { metrica: "ordinato" }, sottrai: { metrica: "fatturato" } });
    const r = calcola(m, { raggruppa: ["cliente"] });
    const per = Object.fromEntries(r.righe.map((x) => [x.etichetta, x.valore]));
    expect(per.Gamma).toBe(900);
  });

  it("il totale e' il rapporto delle somme, non la media dei rapporti", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "margine" }, denominatore: { metrica: "fatturato" } });
    const r = calcola(m, { raggruppa: ["cliente"] });
    const medie = r.righe.reduce((a, x) => a + x.valore, 0) / r.righe.length;
    expect(r.totale).toBe(27.5);
    expect(medie).not.toBe(r.totale);
  });
});

describe("misure: il perimetro si eredita", () => {
  it("su uno snapshot perimetrato la misura vede solo le righe del perimetro", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "margine" }, denominatore: { metrica: "fatturato" } });
    const ristretto = applicaPerimetro(SNAPSHOT, { tipo: "agente", codici: ["AA"] });
    const spec = validaSpec({ metrica: "fatturato", misura: m, periodo: ANNO });
    const r = esegui(spec, ristretto);
    // Solo Anna: margine 600 su fatturato 1500.
    expect(r.totale).toBe(40);
    const completo = esegui(spec, SNAPSHOT);
    expect(completo.totale).not.toBe(r.totale);
  });
});

describe("misure: il validatore rifiuta cio' che non ha senso", () => {
  const rifiuta = (espressione: unknown, nome = "Misura di prova") =>
    expect(() => validaMisura({ nome, espressione })).toThrow(SpecNonValida);

  it("unita' diverse in una differenza o in una somma", () => {
    rifiuta({ tipo: "differenza", da: { metrica: "fatturato" }, sottrai: { metrica: "n_fatture" } });
    rifiuta({ tipo: "somma", addendi: [{ metrica: "fatturato" }, { metrica: "n_ordini" }] });
  });

  it("somma di percentuali, rapporto numero/euro, rapporto di percentuali", () => {
    rifiuta({ tipo: "somma", addendi: [{ metrica: "margine_pct" }, { metrica: "margine_pct" }] });
    rifiuta({ tipo: "rapporto", numeratore: { metrica: "n_ordini" }, denominatore: { metrica: "ordinato" } });
    rifiuta({ tipo: "rapporto", numeratore: { metrica: "margine_pct" }, denominatore: { metrica: "tasso_conversione" } });
  });

  it("la differenza di due percentuali invece e' ammessa (punti di margine)", () => {
    expect(() =>
      validaMisura({
        nome: "Scarto di margine",
        espressione: {
          tipo: "differenza",
          da: { metrica: "margine_pct", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] },
          sottrai: { metrica: "margine_pct" },
        },
      })
    ).not.toThrow();
  });

  it("quota su una media, quota senza filtri, filtro senza valore", () => {
    rifiuta({ tipo: "quota", metrica: "ordine_medio", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] });
    rifiuta({ tipo: "quota", metrica: "fatturato", filtri: [] });
    rifiuta({ tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "" }] });
  });

  it("budget e BEP, metriche e dimensioni inesistenti, operatore libero", () => {
    rifiuta({ tipo: "rapporto", numeratore: { metrica: "fatturato" }, denominatore: { metrica: "budget" } });
    rifiuta({ tipo: "metrica", metrica: "inventata" });
    rifiuta({ tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "pianeta", op: "eq", valore: "x" }] });
    rifiuta({ tipo: "formula", testo: "fatturato * 2" });
    rifiuta({ tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "bu", op: "esegui", valore: "x" }] });
  });

  it("vendite e acquisti non si mescolano", () => {
    rifiuta({ tipo: "rapporto", numeratore: { metrica: "acquisti_valore" }, denominatore: { metrica: "fatturato" } });
  });

  it("nome troppo corto o assente", () => {
    expect(() => validaMisura({ nome: "ab", espressione: { tipo: "metrica", metrica: "fatturato" } })).toThrow(SpecNonValida);
    expect(() => validaMisura({ espressione: { tipo: "metrica", metrica: "fatturato" } })).toThrow(SpecNonValida);
  });

  it("troppi addendi o troppi filtri", () => {
    rifiuta({ tipo: "somma", addendi: Array(5).fill({ metrica: "fatturato" }) });
    rifiuta({ tipo: "somma", addendi: [{ metrica: "fatturato" }] });
    const filtri = Array.from({ length: 7 }, () => ({ campo: "bu", op: "eq", valore: "COMPONENTI" }));
    rifiuta({ tipo: "metrica", metrica: "fatturato", filtri });
  });
});

describe("misure: dentro validaSpec", () => {
  it("la metrica dell'input viene ignorata: conta l'operando rappresentativo", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "margine" }, denominatore: { metrica: "fatturato" } });
    const spec = validaSpec({ metrica: "visite_numero", misura: m });
    expect(spec.metrica).toBe("margine");
    expect(spec.misura?.nome).toBe("Misura di prova");
  });

  it("una misura non si raggruppa per dimensioni di un altro dominio", () => {
    const m = misura({ tipo: "metrica", metrica: "fatturato" });
    expect(() => validaSpec({ metrica: "fatturato", misura: m, raggruppa: ["fornitore"] })).toThrow(SpecNonValida);
    expect(() => validaSpec({ metrica: "fatturato", misura: m, raggruppa: ["creatore"] })).toThrow(SpecNonValida);
  });

  it("dimensione valida solo per un operando = rifiutata per la misura", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "preventivi_convertito" }, denominatore: { metrica: "ordinato" } });
    expect(() => validaSpec({ metrica: "fatturato", misura: m, raggruppa: ["esito"] })).toThrow(SpecNonValida);
  });

  it("combinando dataset diversi non si raggruppa per documento", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "ordinato" }, denominatore: { metrica: "fatturato" } });
    expect(() => validaSpec({ metrica: "fatturato", misura: m, raggruppa: ["documento"] })).toThrow(SpecNonValida);
    const stessa = misura({ tipo: "rapporto", numeratore: { metrica: "margine" }, denominatore: { metrica: "fatturato" } });
    expect(() => validaSpec({ metrica: "fatturato", misura: stessa, raggruppa: ["documento"] })).not.toThrow();
  });

  it("il progressivo non e' disponibile per le misure", () => {
    const m = misura({ tipo: "metrica", metrica: "fatturato" });
    expect(() => validaSpec({ metrica: "fatturato", misura: m, modificatore: "progressivo" })).toThrow(SpecNonValida);
    expect(() => esegui({ metrica: "fatturato", misura: m, modificatore: "progressivo" }, SNAPSHOT)).toThrow(SpecNonValida);
  });

  it("la spec con misura ha una chiave di cache distinta da quella senza", () => {
    const m = misura({ tipo: "metrica", metrica: "fatturato" });
    const con = validaSpec({ metrica: "fatturato", misura: m });
    const senza = validaSpec({ metrica: "fatturato" });
    expect(chiaveStabile(con)).not.toBe(chiaveStabile(senza));
  });
});

describe("misure: descrizione, prova e grafia dei filtri", () => {
  it("descrive la misura a parole", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "margine", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] }, denominatore: { metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] } });
    const testo = descriviMisura(m);
    expect(testo).toContain("Margine (Business unit = COMPONENTI)");
    expect(testo).toContain("diviso Fatturato (Business unit = COMPONENTI)");
    expect(testo).toContain("in percentuale");
    expect(descriviMisura(misura({ tipo: "quota", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] }))).toContain("Quota di Fatturato");
  });

  it("gli operandi stanno nell'ordine di valutazione", () => {
    const m = misura({ tipo: "quota", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "COMPONENTI" }] });
    const [parte, tutto] = operandiDellaMisura(m.espressione);
    expect(parte.filtri).toHaveLength(1);
    expect(tutto.filtri).toBeUndefined();
  });

  it("il periodo di prova e' l'ultimo anno completo, o l'anno in corso se non c'e'", () => {
    expect(periodoDiProva(SNAPSHOT)).toEqual({ anno: 2025 });
    expect(periodoDiProva({ ...SNAPSHOT, dataMassima: "2026-12-30" })).toEqual({ anno: 2026 });
    expect(periodoDiProva({ ...SNAPSHOT, dataMinima: "2026-01-01" })).toEqual({ anno: 2026 });
  });

  it("la prova restituisce anche il valore di ogni operando", () => {
    const m = misura({ tipo: "rapporto", numeratore: { metrica: "margine" }, denominatore: { metrica: "fatturato" } });
    const prova = provaMisura(m, SNAPSHOT, ANNO);
    expect(prova.foglie).toHaveLength(2);
    expect(prova.foglie[0].descrizione).toBe("Margine");
    expect(prova.foglie[0].valore).toBe(1100);
    expect(prova.foglie[1].valore).toBe(4000);
    expect(prova.risultato.totale).toBe(27.5);
  });

  it("riporta i valori dei filtri alla grafia del dato, e rifiuta quelli che non esistono", () => {
    const m = misura({ tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "componenti" }] });
    const corretta = normalizzaValoriFiltri(m, SNAPSHOT);
    const filtro = operandiDellaMisura(corretta.espressione)[0].filtri![0];
    expect(filtro.valore).toBe("COMPONENTI");

    const sbagliata = misura({ tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "bu", op: "eq", valore: "ASTRONAVI" }] });
    expect(() => normalizzaValoriFiltri(sbagliata, SNAPSHOT)).toThrow(SpecNonValida);

    const parziale = misura({ tipo: "metrica", metrica: "fatturato", filtri: [{ campo: "cliente", op: "contiene", valore: "alf" }] });
    expect(() => normalizzaValoriFiltri(parziale, SNAPSHOT)).not.toThrow();
  });
});
