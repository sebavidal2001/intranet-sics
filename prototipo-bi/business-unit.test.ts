/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Riconciliazione delle business unit fra preventivi, ordinato e budget.
 *
 * La regola NON è più in TypeScript: vive nelle viste SQL, e i preventivi
 * passano da `public.bi_preventivi_backoffice`. Questi test verificano quindi
 * che sia il DATABASE a fare il lavoro, e che il prototipo lo riceva intatto.
 *
 * Gli attesi si calcolano dalla vista nello stesso istante in cui si legge lo
 * snapshot: erano numeri copiati da una SELECT, e valevano solo per il
 * database su cui quella SELECT era stata fatta.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  etichettaBusinessUnit,
  controllaTassonomia,
  BUSINESS_UNIT,
  BU_NON_ASSEGNATA,
} from "@/lib/prototipo-bi/business-unit";
import { esegui } from "@/lib/prototipo-bi/semantico";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import { leggiSerieBudget } from "@/lib/prototipo-bi/archivio";
import { risolviBudget } from "@/lib/prototipo-bi/budget-fonte";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";
import { caricaEnvLocale } from "./_env";
import { leggiVista, numero, testo, type RigaVista } from "./_vista";

const M = (n: number) => Math.round(n).toLocaleString("it-IT");

describe("Nessuna regola di business in TypeScript", () => {
  it("il modulo espone solo presentazione e controllo, non la riconciliazione", async () => {
    const modulo = await import("@/lib/prototipo-bi/business-unit");
    // Se un domani qualcuno reintroducesse la regola qui, tornerebbe il
    // doppione fra SQL e TypeScript: questo test lo impedisce.
    expect("riconciliaBusinessUnit" in modulo).toBe(false);

    const sorgente = readFileSync(
      resolve(process.cwd(), "src/lib/prototipo-bi/business-unit.ts"),
      "utf8"
    );
    expect(sorgente).not.toContain("COSTRUITO'");
    expect(sorgente).not.toMatch(/categoriaDescrizione/);
  });

  it("traduce solo il gruppo non assegnato", () => {
    expect(etichettaBusinessUnit("-")).toBe(BU_NON_ASSEGNATA);
    expect(etichettaBusinessUnit("")).toBe(BU_NON_ASSEGNATA);
    expect(etichettaBusinessUnit(null)).toBe(BU_NON_ASSEGNATA);
    expect(etichettaBusinessUnit("COSTRUITO")).toBe("COSTRUITO");
    expect(etichettaBusinessUnit("  IMPIANTI  ")).toBe("IMPIANTI");
  });

  it("la sentinella riconosce i valori estranei e il residuo SISTEMI", () => {
    expect(controllaTassonomia([...BUSINESS_UNIT, BU_NON_ASSEGNATA]).coerente).toBe(true);

    const conSistemi = controllaTassonomia(["COMPONENTI", "SISTEMI"]);
    expect(conSistemi.coerente).toBe(false);
    expect(conSistemi.sistemiResidua).toBe(true);

    const conIgnoto = controllaTassonomia(["COMPONENTI", "NUOVA BU"]);
    expect(conIgnoto.estranei).toEqual(["NUOVA BU"]);
  });
});

describe("Riconciliazione fatta dalla vista, sui dati reali", () => {
  let snapshot: Snapshot;
  let vistaPreventivi: RigaVista[];

  beforeAll(async () => {
    caricaEnvLocale();
    [snapshot, vistaPreventivi] = await Promise.all([
      costruisciSnapshot(),
      leggiVista("bi_preventivi_backoffice"),
    ]);
  }, 240_000);

  it("la vista consegna i preventivi già riconciliati: SISTEMI non arriva mai", () => {
    const tutte = new Set(
      Object.values(snapshot.dataset).flatMap((righe) => righe.map((r) => r.bu))
    );
    expect(tutte.has("SISTEMI")).toBe(false);
    expect(snapshot.tassonomiaBu?.coerente).toBe(true);
    expect(snapshot.tassonomiaBu?.sistemiResidua).toBe(false);
    console.log("   Business unit presenti: " + [...tutte].sort().join(", "));
  });

  it("preventivi, ordinato e budget usano lo stesso insieme di business unit", async () => {
    const prev = esegui({ metrica: "preventivi_valore", raggruppa: ["bu"] }, snapshot);
    const ord = esegui({ metrica: "ordinato", raggruppa: ["bu"] }, snapshot);
    const serie = await leggiSerieBudget(2026);
    const bdg = risolviBudget({ metrica: "budget", raggruppa: ["bu"], periodo: { anno: 2026 } }, serie);

    const reali = (v: { etichetta: string }[]) =>
      new Set(v.map((x) => x.etichetta).filter((x) => x !== BU_NON_ASSEGNATA));

    expect([...reali(prev.righe)].sort()).toEqual([...BUSINESS_UNIT]);
    expect([...reali(ord.righe)].sort()).toEqual([...BUSINESS_UNIT]);
    expect([...reali(bdg.risultato.righe)].sort()).toEqual([...BUSINESS_UNIT]);
  });

  it("i valori per business unit coincidono con la vista", () => {
    // Gli attesi si calcolano dalla VISTA, nello stesso istante in cui si è
    // letto lo snapshot. Prima erano quattro righe di numeri copiate da una
    // SELECT ("COSTRUITO 737 righe · 3.672.345 €"): valevano per il database
    // di sviluppo di quel giorno, e sul database di produzione questo test
    // falliva insieme ad altri otto — non perché il codice fosse rotto, ma
    // perché i dati erano altri. Verificato allora: la vista diceva 760 righe
    // per COSTRUITO e lo snapshot diceva 760.
    //
    // Quello che conta qui è la RICONCILIAZIONE: lo snapshot deve riprodurre
    // la vista riga per riga e euro per euro, quali che siano i numeri.
    const attesi: Record<string, [number, number, number, number]> = {};
    for (const bu of BUSINESS_UNIT) {
      const righeBu = vistaPreventivi.filter((r) => testo(r["Gruppo Descrizione"]) === bu);
      const valore = righeBu.reduce((s, r) => s + numero(r["Valore Totale Riga"]), 0);
      const convertito = righeBu.reduce(
        (s, r) => s + numero(r["Convertito In Ordine"]),
        0,
      );
      attesi[bu] = [
        righeBu.length,
        Math.round(valore),
        Math.round(convertito),
        valore > 0 ? (convertito / valore) * 100 : 0,
      ];
    }

    const valore = esegui({ metrica: "preventivi_valore", raggruppa: ["bu"] }, snapshot);
    const conv = esegui({ metrica: "preventivi_convertito", raggruppa: ["bu"] }, snapshot);
    const tasso = esegui({ metrica: "tasso_conversione", raggruppa: ["bu"] }, snapshot);
    const mappaConv = new Map(conv.righe.map((r) => [r.etichetta, r.valore]));
    const mappaTasso = new Map(tasso.righe.map((r) => [r.etichetta, r.valore]));

    console.log("\n   BU            righe      valore   convertito  conv.");
    for (const [bu, [righe, val, cnv, tas]] of Object.entries(attesi)) {
      const r = valore.righe.find((x) => x.etichetta === bu);
      expect(r, `manca ${bu}`).toBeTruthy();
      expect(r!.conteggio).toBe(righe);
      expect(Math.round(r!.valore)).toBe(val);
      expect(Math.round(mappaConv.get(bu) ?? 0)).toBe(cnv);
      expect(mappaTasso.get(bu)).toBeCloseTo(tas, 1);
      console.log(
        `   ${bu.padEnd(12)} ${String(righe).padStart(5)} ${M(val).padStart(11)} € ${M(cnv).padStart(11)}  ${tas.toFixed(1)}%`
      );
    }
  });

  it("i totali restano quelli del database", () => {
    const totale = esegui({ metrica: "preventivi_valore" }, snapshot);
    const convertito = esegui({ metrica: "preventivi_convertito" }, snapshot);
    const inevaso = esegui({ metrica: "preventivi_aperti" }, snapshot);
    const perBu = esegui({ metrica: "preventivi_valore", raggruppa: ["bu"] }, snapshot);

    const attesoTotale = vistaPreventivi.reduce((s, r) => s + numero(r["Valore Totale Riga"]), 0);
    const attesoInevaso = vistaPreventivi.reduce((s, r) => s + numero(r["Importo Inevaso"]), 0);
    const attesoConvertito = vistaPreventivi.reduce(
      (s, r) => s + numero(r["Convertito In Ordine"]),
      0,
    );

    expect(Math.round(totale.totale)).toBe(Math.round(attesoTotale));
    expect(Math.round(inevaso.totale)).toBe(Math.round(attesoInevaso));
    expect(Math.round(convertito.totale)).toBe(Math.round(attesoConvertito));

    // La ripartizione non crea né perde euro.
    const somma = perBu.righe.reduce((s, r) => s + r.valore, 0);
    expect(Math.abs(somma - totale.totale)).toBeLessThan(1);
    expect(perBu.righe.reduce((s, r) => s + r.conteggio, 0)).toBe(
      snapshot.dataset.preventivi_aperti.length
    );
  });

  it("il convertito arriva dalla vista, comprese le righe anomale azzerate", () => {
    const righe = snapshot.dataset.preventivi_aperti;
    expect(righe.every((r) => r.convertito !== undefined)).toBe(true);
    // Nessuna conversione negativa: la vista applica greatest(..., 0) sulle
    // 4 righe con inevaso maggiore del totale.
    expect(righe.filter((r) => (r.convertito ?? 0) < 0)).toHaveLength(0);
    const anomale = righe.filter((r) => (r.valoreTotale ?? 0) < r.importo);
    expect(anomale.length).toBe(4);
    expect(anomale.every((r) => r.convertito === 0)).toBe(true);
  });

  it("i giorni di risposta arrivano già puliti dalla vista", () => {
    const righe = snapshot.dataset.preventivi_aperti;
    // Nessun valore negativo, e la distinzione fra "zero giorni" e
    // "non calcolabile" è conservata.
    expect(
      righe.filter((r) => r.giorniRisposta !== null && (r.giorniRisposta ?? 0) < 0)
    ).toHaveLength(0);
    expect(righe.some((r) => r.giorniRisposta === null)).toBe(true);
    expect(righe.some((r) => r.giorniRisposta === 0)).toBe(true);

    const inGiornata = esegui({ metrica: "quota_stesso_giorno" }, snapshot);
    expect(inGiornata.totale).toBeGreaterThan(90);
    console.log(`   Risposte in giornata: ${inGiornata.totale.toFixed(1)}%`);
  });

  it("COSTRUITO resta la business unit più grande, e la peggiore per conversione", () => {
    const valore = esegui(
      { metrica: "preventivi_valore", raggruppa: ["bu"], ordina: "valore_desc" },
      snapshot
    );
    const tasso = esegui({ metrica: "tasso_conversione", raggruppa: ["bu"] }, snapshot);

    expect(valore.righe[0].etichetta).toBe("COSTRUITO");
    const costruito = tasso.righe.find((r) => r.etichetta === "COSTRUITO")!;
    const componenti = tasso.righe.find((r) => r.etichetta === "COMPONENTI")!;
    expect(costruito.valore).toBeLessThan(componenti.valore);

    console.log(
      `   COSTRUITO ${M(valore.righe[0].valore)} € con conversione ${costruito.valore.toFixed(1)}%, ` +
        `contro il ${componenti.valore.toFixed(1)}% di COMPONENTI`
    );
  });

  it("il confronto preventivi contro budget funziona per tutte e quattro le BU", async () => {
    const serie = await leggiSerieBudget(2026);
    const bdg = risolviBudget(
      { metrica: "budget", raggruppa: ["bu"], periodo: { anno: 2026 } },
      serie
    );
    const prev = esegui(
      { metrica: "preventivi_valore", raggruppa: ["bu"], periodo: { anno: 2026 } },
      snapshot
    );
    const mappaB = new Map(bdg.risultato.righe.map((r) => [r.etichetta, r.valore]));

    const accoppiate = prev.righe.filter((r) => mappaB.has(r.etichetta));
    expect(accoppiate.length).toBe(4);
  });
});
