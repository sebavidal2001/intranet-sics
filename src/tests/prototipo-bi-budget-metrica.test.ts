/**
 * Budget e BEP non sono l'ordinato.
 *
 * Il difetto che questi test presidiano: nel catalogo `budget` e `bep` sono
 * dichiarati sul dataset "ordinato" e senza funzione di estrazione, e
 * `esegui()` in quel caso ripiegava su `r.importo`. Risultato: un report Word
 * con tre tabelle intitolate Ordinato, BEP e Budget e tre volte gli stessi
 * numeri, senza un avviso.
 */

import { describe, expect, it } from "vitest";
import { esegui, validaSpec } from "@/lib/prototipo-bi/semantico";
import { serieDaConfigurazione } from "@/lib/prototipo-bi/budget-fonte";
import { configurazioneVuota } from "@/lib/prototipo-bi/budget";
import type { RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

const ANNO = 2026;

function riga(data: string, importo: number): RigaFatto {
  return {
    data,
    importo,
    bu: "SISTEMI",
    categoria: "X",
    agente: "MARIO ROSSI",
    codiceAgente: "A01",
    cliente: "CLIENTE UNO",
    codiceCliente: "C01",
    documento: `D-${data}-${importo}`,
    articolo: "ART",
    descrizioneArticolo: "Articolo",
    quantita: 1,
  };
}

function snapshotBase(serieBudget?: Snapshot["serieBudget"]): Snapshot {
  const righe = [
    riga(`${ANNO}-01-15`, 100_000),
    riga(`${ANNO}-02-16`, 250_000),
    riga(`${ANNO}-03-17`, 90_000),
  ];
  const vuoto: RigaFatto[] = [];
  return {
    generatoIl: new Date().toISOString(),
    runCorrente: "run-test",
    runRicevutoIl: new Date().toISOString(),
    dataMassima: `${ANNO}-03-31`,
    dataMinima: `${ANNO}-01-01`,
    dataset: {
      ordinato: righe,
      fatturato: vuoto,
      consegnato: vuoto,
      portafoglio: vuoto,
      preventivi_aperti: vuoto,
      controllo_banco: vuoto,
      consegnato_futuro_per_mese: vuoto,
    },
    conteggi: { ordinato: righe.length },
    serieBudget,
  };
}

function specMensile(metrica: string) {
  return validaSpec({
    metrica,
    granularita: "mese",
    periodo: { dal: `${ANNO}-01-01`, al: `${ANNO}-03-31` },
  });
}

describe("metriche budget e bep", () => {
  it("senza serie agganciata non restituisce l'ordinato ma un risultato vuoto con avviso", () => {
    const snapshot = snapshotBase(undefined);

    const ordinato = esegui(specMensile("ordinato"), snapshot);
    expect(ordinato.totale).toBe(440_000);

    for (const metrica of ["bep", "budget"]) {
      const res = esegui(specMensile(metrica), snapshot);
      expect(res.totale).toBe(0);
      expect(res.righe).toHaveLength(0);
      expect(res.avvisi?.join(" ")).toMatch(/non sono stati caricati/i);
    }
  });

  it("con la serie agganciata BEP e budget hanno valori propri, diversi dall'ordinato", () => {
    const config = {
      ...configurazioneVuota(ANNO),
      budgetAnnuo: 6_000_000,
      bepAnnuo: 4_800_000,
    };
    const snapshot = snapshotBase({ [ANNO]: serieDaConfigurazione(config) });

    const ordinato = esegui(specMensile("ordinato"), snapshot);
    const bep = esegui(specMensile("bep"), snapshot);
    const budget = esegui(specMensile("budget"), snapshot);

    expect(bep.totale).toBeGreaterThan(0);
    expect(budget.totale).toBeGreaterThan(0);

    // Il punto: tre metriche, tre serie distinte.
    expect(bep.totale).not.toBe(ordinato.totale);
    expect(budget.totale).not.toBe(ordinato.totale);
    expect(budget.totale).not.toBe(bep.totale);

    // Il rapporto budget/BEP e' quello configurato, non un caso.
    expect(budget.totale / bep.totale).toBeCloseTo(6_000_000 / 4_800_000, 2);
  });

  it("il BEP mensile segue i giorni lavorativi, non gli ordini", () => {
    const config = {
      ...configurazioneVuota(ANNO),
      budgetAnnuo: 6_000_000,
      bepAnnuo: 4_800_000,
    };
    const snapshot = snapshotBase({ [ANNO]: serieDaConfigurazione(config) });

    const bep = esegui(specMensile("bep"), snapshot);
    const perMese = new Map(bep.righe.map((r) => [r.etichetta, r.valore]));

    expect([...perMese.keys()].sort()).toEqual([
      `${ANNO}-01`,
      `${ANNO}-02`,
      `${ANNO}-03`,
    ]);

    // Marzo 2026 ha 22 giorni lavorativi, febbraio 20: il BEP lo riflette,
    // mentre l'ordinato di febbraio (250.000) e' il piu' alto dei tre. Le due
    // serie non possono coincidere.
    const feb = perMese.get(`${ANNO}-02`)!;
    const mar = perMese.get(`${ANNO}-03`)!;
    expect(feb).toBeLessThan(mar);

    // E soprattutto non somiglia all'ordinato di febbraio (250.000), che e'
    // il valore che compariva prima nella colonna BEP.
    expect(feb).not.toBe(250_000);
  });
});
