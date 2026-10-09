/**
 * Numero e valore medio dei documenti di fatturazione e di consegna.
 *
 * Il conteggio e' per documento distinto, non per riga: una fattura di tre
 * righe e' UNA fattura. Le note di credito sono documenti con importo
 * negativo: contano nel numero e abbassano la media.
 */
import { describe, expect, it } from "vitest";
import { chiaveDocumento, esegui, validaSpec } from "@/lib/prototipo-bi/semantico";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

function riga(documento: string, data: string, cliente: string, importo: number): RigaFatto {
  return {
    data,
    importo,
    bu: "COMPONENTI",
    categoria: "",
    agente: "Anna",
    codiceAgente: "AA",
    cliente,
    codiceCliente: cliente,
    documento,
    articolo: "A1",
    descrizioneArticolo: "Articolo",
    quantita: 1,
  };
}

const RIGHE: RigaFatto[] = [
  // Fattura 100: tre righe, 600 in tutto.
  riga("100", "2026-01-10", "Alfa", 100),
  riga("100", "2026-01-10", "Alfa", 200),
  riga("100", "2026-01-10", "Alfa", 300),
  // Fattura 101: una riga, 400.
  riga("101", "2026-02-05", "Beta", 400),
  // Nota di credito 102: -100.
  riga("102", "2026-02-20", "Beta", -100),
];

const SNAPSHOT: Snapshot = {
  generatoIl: "2026-04-01T08:00:00.000Z",
  runCorrente: "run-test",
  runRicevutoIl: "2026-04-01T07:00:00.000Z",
  dataMinima: "2025-01-01",
  dataMassima: "2026-03-31",
  dataset: {
    ordinato: [],
    fatturato: RIGHE,
    consegnato: RIGHE,
    portafoglio: [],
    preventivi_aperti: [],
    controllo_banco: [],
    consegnato_futuro_per_mese: [],
  },
  conteggi: { fatturato: RIGHE.length, consegnato: RIGHE.length },
};

describe("metriche sui documenti", () => {
  it("n_fatture conta i documenti, non le righe, note di credito comprese", () => {
    const r = esegui({ metrica: "n_fatture", periodo: { anno: 2026 } }, SNAPSHOT);
    expect(r.unita).toBe("numero");
    expect(r.totale).toBe(3);
  });

  it("fattura_media e' il valore netto diviso i documenti", () => {
    const r = esegui({ metrica: "fattura_media", periodo: { anno: 2026 } }, SNAPSHOT);
    expect(r.unita).toBe("euro");
    // (600 + 400 - 100) / 3
    expect(r.totale).toBe(300);
  });

  it("raggruppa per cliente senza mischiare i documenti", () => {
    const n = esegui({ metrica: "n_fatture", raggruppa: ["cliente"], periodo: { anno: 2026 } }, SNAPSHOT);
    const per = Object.fromEntries(n.righe.map((x) => [x.etichetta, x.valore]));
    expect(per).toEqual({ Alfa: 1, Beta: 2 });

    const m = esegui({ metrica: "fattura_media", raggruppa: ["cliente"], periodo: { anno: 2026 } }, SNAPSHOT);
    const medie = Object.fromEntries(m.righe.map((x) => [x.etichetta, x.valore]));
    expect(medie).toEqual({ Alfa: 600, Beta: 150 });
  });

  it("per mese: gennaio una fattura, febbraio due documenti", () => {
    const r = esegui({ metrica: "n_fatture", granularita: "mese", periodo: { anno: 2026 } }, SNAPSHOT);
    const per = Object.fromEntries(r.righe.map((x) => [x.etichetta, x.valore]));
    expect(per).toEqual({ "2026-01": 1, "2026-02": 2 });
  });

  it("n_consegne e consegna_media leggono il dataset delle consegne", () => {
    expect(esegui({ metrica: "n_consegne", periodo: { anno: 2026 } }, SNAPSHOT).totale).toBe(3);
    expect(esegui({ metrica: "consegna_media", periodo: { anno: 2026 } }, SNAPSHOT).totale).toBe(300);
  });

  it("una spec con le nuove metriche passa dal validatore", () => {
    for (const metrica of ["n_fatture", "fattura_media", "n_consegne", "consegna_media"]) {
      expect(validaSpec({ metrica, raggruppa: ["bu"] }).metrica).toBe(metrica);
    }
  });
});

/**
 * L'identita' di un documento. Misurato sul database di produzione il
 * 09/10/2026: il «Numero Doc.» da solo dava 2.524 fatture contro 4.643 vere
 * (numero + data), 3.256 ordini contro 6.303, 1.324 preventivi contro 2.235,
 * perche' la numerazione riparte ogni anno; nelle consegne, serie diverse hanno
 * gli stessi numeri per clienti diversi.
 */
describe("identita' del documento", () => {
  const snapshotCon = (fatturato: RigaFatto[], extra: Partial<Snapshot["dataset"]> = {}): Snapshot => ({
    ...SNAPSHOT,
    dataset: { ...SNAPSHOT.dataset, fatturato, ...extra },
  });

  it("lo stesso numero in anni diversi sono documenti diversi", () => {
    const righe = [
      riga("7", "2025-03-10", "Alfa", 100),
      riga("7", "2026-03-10", "Alfa", 300),
    ];
    const s = snapshotCon(righe);
    expect(esegui({ metrica: "n_fatture", periodo: { anni: [2025, 2026] } }, s).totale).toBe(2);
    // La media per documento e' sui due documenti veri, non su uno solo da 400.
    expect(esegui({ metrica: "fattura_media", periodo: { anni: [2025, 2026] } }, s).totale).toBe(200);
  });

  it("per cliente: i documenti dello stesso cliente con lo stesso numero in anni diversi non si fondono", () => {
    const righe = [riga("7", "2025-03-10", "Alfa", 100), riga("7", "2026-03-10", "Alfa", 300)];
    const r = esegui({ metrica: "n_fatture", raggruppa: ["cliente"], periodo: { anni: [2025, 2026] } }, snapshotCon(righe));
    expect(r.righe.find((x) => x.etichetta === "Alfa")?.valore).toBe(2);
  });

  it("lo stesso numero e la stessa data per clienti diversi sono documenti diversi (le serie delle consegne)", () => {
    const righe = [riga("10", "2025-01-08", "Alfa", 100), riga("10", "2025-01-08", "Beta", 100)];
    expect(esegui({ metrica: "n_fatture", periodo: { anno: 2025 } }, snapshotCon(righe)).totale).toBe(2);
    expect(esegui({ metrica: "n_consegne", periodo: { anno: 2025 } }, snapshotCon([], { consegnato: righe })).totale).toBe(2);
  });

  it("le righe dello stesso documento restano UN documento", () => {
    const righe = [
      riga("7", "2026-03-10", "Alfa", 100),
      riga("7", "2026-03-10", "Alfa", 200),
      riga("7", "2026-03-10", "Alfa", 300),
    ];
    const s = snapshotCon(righe);
    expect(esegui({ metrica: "n_fatture", periodo: { anno: 2026 } }, s).totale).toBe(1);
    expect(esegui({ metrica: "fattura_media", periodo: { anno: 2026 } }, s).totale).toBe(600);
  });

  it("il numero degli ordini e il valore medio per ordine valgono anche su piu' anni", () => {
    const ordinato = [riga("5", "2025-02-01", "Alfa", 1000), riga("5", "2026-02-01", "Alfa", 3000)];
    const s = snapshotCon([], { ordinato });
    expect(esegui({ metrica: "n_ordini", periodo: { anni: [2025, 2026] } }, s).totale).toBe(2);
    expect(esegui({ metrica: "ordine_medio", periodo: { anni: [2025, 2026] } }, s).totale).toBe(2000);
  });

  it("un anno solo non cambia: e' il caso in cui il solo numero bastava", () => {
    const righe = [riga("1", "2026-01-10", "Alfa", 100), riga("2", "2026-01-11", "Beta", 200)];
    expect(esegui({ metrica: "n_fatture", periodo: { anno: 2026 } }, snapshotCon(righe)).totale).toBe(2);
  });

  it("la chiave: numero, data e cliente; per gli ordini a fornitore il numero com'e' (porta gia' profilo e anno)", () => {
    expect(chiaveDocumento(riga("7", "2026-03-10", "Alfa", 1))).toBe("7|2026-03-10|Alfa");
    expect(chiaveDocumento({ ...riga("OF 12/2026", "2026-03-10", "Alfa", 1), fornitore: "COLUMBUS" })).toBe("OF 12/2026");
  });
});
