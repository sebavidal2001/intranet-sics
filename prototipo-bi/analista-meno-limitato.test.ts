/**
 * Quello che l'analista può sapere di più, e i rifiuti che ora insegnano.
 *
 * Tre difetti misurati il 17/09/2026:
 *
 *  1. Il modello riceve il vocabolario (metriche e dimensioni) ma NON i valori:
 *     sa che esiste la dimensione `cliente`, non sa che quel cliente nel
 *     gestionale si chiama "TECNA spa". Un filtro con la grafia sbagliata torna
 *     vuoto senza errore, e un risultato vuoto somiglia a «non ha comprato».
 *  2. I rifiuti non dicevano cosa fare: «Dimensione "fornitore" non esiste».
 *  3. Il budget raggruppato per una dimensione che non possiede restituiva il
 *     totale su una riga sola, etichettata "totale", senza un avviso.
 */
import { describe, expect, it } from "vitest";
import { elencaValoriDimensione, SpecNonValida, validaSpec } from "@/lib/prototipo-bi/semantico";
import { risolviBudget } from "@/lib/prototipo-bi/budget-fonte";
import type { RigaFatto, SerieBudget, Snapshot, SpecQuery } from "@/lib/prototipo-bi/tipi";

function riga(p: Partial<RigaFatto>): RigaFatto {
  return {
    data: "2026-03-10",
    importo: 100,
    bu: "COSTRUITO",
    categoria: "COSTRUITO",
    agente: "VALERIA BATTELANI",
    codiceAgente: "AG000010",
    cliente: "TECNA spa",
    codiceCliente: "05001129",
    documento: "1",
    articolo: "AFD.00.1",
    descrizioneArticolo: "LIFTER CASE",
    quantita: 1,
    costoUnitario: null,
    dataCosto: null,
    ...p,
  };
}

function snapshotFinto(): Snapshot {
  const vuoto = {
    ordinato: [] as RigaFatto[],
    fatturato: [] as RigaFatto[],
    consegnato: [] as RigaFatto[],
    portafoglio: [] as RigaFatto[],
    preventivi_aperti: [] as RigaFatto[],
    controllo_banco: [] as RigaFatto[],
    consegnato_futuro_per_mese: [] as RigaFatto[],
  };
  return {
    generatoIl: "2026-09-17T00:00:00.000Z",
    runCorrente: "20260917_013001",
    runRicevutoIl: "2026-09-17T01:31:00.000Z",
    tassonomiaBu: { coerente: true, estranei: [], sistemiResidua: false },
    dataMinima: "2025-01-07",
    dataMassima: "2026-09-16",
    dataMassimaAssoluta: "2027-03-31",
    dataset: {
      ...vuoto,
      // Lo stesso cliente compare SOLO nel fatturato: se si guardasse un
      // dataset solo, non lo si troverebbe.
      fatturato: [riga({ cliente: "TECNA spa", importo: 5000 })],
      ordinato: [
        riga({ cliente: "OFFICINE ROSSI SRL", importo: 900 }),
        riga({ cliente: "OFFICINE ROSSI SRL", importo: 100 }),
        riga({ cliente: "BIANCHI & C.", importo: 3000 }),
      ],
    },
    conteggi: {},
    versioneForma: 2,
  };
}

describe("elenca_valori: la grafia esatta da mettere nei filtri", () => {
  const snapshot = snapshotFinto();

  it("trova i valori di tutti i dataset, non di uno solo", () => {
    const esito = elencaValoriDimensione(snapshot, "cliente");
    const nomi = esito.valori.map((v) => v.valore);
    expect(nomi).toContain("TECNA spa");
    expect(nomi).toContain("OFFICINE ROSSI SRL");
    expect(esito.distinti).toBe(3);
  });

  it("ordina per peso, non alfabeticamente", () => {
    const esito = elencaValoriDimensione(snapshot, "cliente");
    expect(esito.valori[0].valore).toBe("TECNA spa");
    expect(esito.valori[0].importo).toBe(5000);
  });

  it("somma le righe dello stesso valore invece di ripeterlo", () => {
    const esito = elencaValoriDimensione(snapshot, "cliente");
    const rossi = esito.valori.find((v) => v.valore === "OFFICINE ROSSI SRL");
    expect(rossi).toEqual({ valore: "OFFICINE ROSSI SRL", righe: 2, importo: 1000 });
  });

  it("cerca senza distinguere maiuscole, che è il caso d'uso vero", () => {
    // Chi chiede dice "tecna", il gestionale scrive "TECNA spa".
    const esito = elencaValoriDimensione(snapshot, "cliente", { contiene: "tecna" });
    expect(esito.distinti).toBe(1);
    expect(esito.valori[0].valore).toBe("TECNA spa");
  });

  it("taglia a `massimo` ma dichiara quanti erano", () => {
    const esito = elencaValoriDimensione(snapshot, "cliente", { massimo: 1 });
    expect(esito.valori).toHaveLength(1);
    expect(esito.distinti).toBe(3);
  });
});

describe("I rifiuti dicono cosa usare al posto di cosa", () => {
  function rifiuto(spec: unknown): SpecNonValida | null {
    try {
      validaSpec(spec);
      return null;
    } catch (e) {
      if (e instanceof SpecNonValida) return e;
      throw e;
    }
  }

  it("una metrica inesistente porta con sé l'elenco di quelle vere", () => {
    const e = rifiuto({ metrica: "marginalita" });
    expect(e).not.toBeNull();
    expect(e?.suggerimento).toContain("fatturato");
  });

  it("una dimensione inesistente nomina quelle sensate per quella metrica", () => {
    const e = rifiuto({ metrica: "fatturato", raggruppa: ["fornitore"] });
    expect(e?.suggerimento).toContain("agente");
  });

  it("un filtro su dimensione inesistente indirizza a elenca_valori", () => {
    const e = rifiuto({
      metrica: "fatturato",
      filtri: [{ campo: "reparto", op: "eq", valore: "X" }],
    });
    expect(e?.suggerimento).toContain("elenca_valori");
  });

  it("un operatore sbagliato elenca quelli ammessi", () => {
    const e = rifiuto({
      metrica: "fatturato",
      filtri: [{ campo: "cliente", op: "maggiore", valore: "X" }],
    });
    expect(e?.suggerimento).toContain("contiene");
  });
});

describe("Il budget non finge un dettaglio che non ha", () => {
  const serie: SerieBudget = {
    origine: "importato",
    formato: "excel",
    importatoIl: "2026-09-12T00:00:00.000Z",
    anni: [2026],
    totaliPerAnno: { 2026: { budget: 1500, bep: 1200 } },
    righe: [
      {
        data: "2026-03-01",
        area: "COSTRUITO",
        agente: null,
        codiceAgente: null,
        budget: 1000,
        bep: 800,
        granularita: "giorno",
      },
      {
        data: "2026-03-01",
        area: "STRUTTURE",
        agente: null,
        codiceAgente: null,
        budget: 500,
        bep: 400,
        granularita: "giorno",
      },
    ],
  };

  it("avvisa quando lo si raggruppa per una dimensione che non possiede", () => {
    const esito = risolviBudget(
      { metrica: "budget", raggruppa: ["cliente"], periodo: { anno: 2026 } } as SpecQuery,
      serie
    );
    // Il numero resta quello aggregato — ed è corretto che lo sia — ma ora chi
    // legge sa che il raggruppamento chiesto non è stato applicato.
    expect(esito.risultato.avvisi.join(" ")).toMatch(/cliente/);
    expect(esito.risultato.avvisi.join(" ")).toMatch(/ignorat/i);
  });

  it("non avvisa quando il raggruppamento è legittimo", () => {
    const esito = risolviBudget(
      { metrica: "budget", raggruppa: ["bu"], periodo: { anno: 2026 } } as SpecQuery,
      serie
    );
    expect(esito.risultato.avvisi).toHaveLength(0);
    expect(esito.risultato.righe).toHaveLength(2);
  });
});
