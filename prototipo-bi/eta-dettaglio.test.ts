/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Anzianità dei preventivi, dettaglio documenti, confronto YTD e cache.
 * I valori attesi vengono da query SQL sulla vista bi_preventivi_backoffice.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { esegui } from "@/lib/prototipo-bi/semantico";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import { dettaglioDocumenti } from "@/lib/prototipo-bi/dettaglio";
import { CacheRisultati, chiaveStabile } from "@/lib/prototipo-bi/cache";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

const M = (n: number) => Math.round(n).toLocaleString("it-IT");

describe("Cache dei risultati", () => {
  it("la chiave non dipende dall'ordine delle proprietà", () => {
    const a = chiaveStabile({ metrica: "ordinato", periodo: { anno: 2026 }, raggruppa: ["bu"] });
    const b = chiaveStabile({ raggruppa: ["bu"], periodo: { anno: 2026 }, metrica: "ordinato" });
    expect(a).toBe(b);
    // Ma spec diverse restano distinte.
    expect(a).not.toBe(chiaveStabile({ metrica: "ordinato", periodo: { anno: 2025 } }));
  });

  it("ignora le proprietà non valorizzate", () => {
    expect(chiaveStabile({ m: "x", limite: undefined })).toBe(chiaveStabile({ m: "x" }));
  });

  it("serve il valore memorizzato e conta l'efficacia", async () => {
    const cache = new CacheRisultati<number>(10, 60_000);
    let calcoli = 0;
    const calcola = () => {
      calcoli += 1;
      return 42;
    };
    expect(await cache.ottieni("k", calcola)).toBe(42);
    expect(await cache.ottieni("k", calcola)).toBe(42);
    expect(calcoli).toBe(1);
    expect(cache.statistiche.colpi).toBe(1);
  });

  it("dimentica le voci scadute", async () => {
    const cache = new CacheRisultati<number>(10, -1);
    let calcoli = 0;
    await cache.ottieni("k", () => ++calcoli);
    await cache.ottieni("k", () => ++calcoli);
    expect(calcoli).toBe(2);
  });

  it("sfratta quando supera la capienza", () => {
    const cache = new CacheRisultati<number>(10, 60_000);
    for (let i = 0; i < 30; i++) cache.scrivi(`k${i}`, i);
    expect(cache.statistiche.voci).toBeLessThanOrEqual(10);
  });
});

describe("Anzianità e dettaglio, sui dati reali", () => {
  let snapshot: Snapshot;

  beforeAll(async () => {
    const t = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const r of t.split(/\r?\n/)) {
      if (!r.includes("=") || r.trim().startsWith("#")) continue;
      const i = r.indexOf("=");
      const k = r.slice(0, i).replace(/^﻿/, "").trim();
      if (!process.env[k]) process.env[k] = r.slice(i + 1).trim();
    }
    snapshot = await costruisciSnapshot();
  }, 240_000);

  it("calcola l'anzianità solo sulle righe ancora aperte", () => {
    const righe = snapshot.dataset.preventivi_aperti;
    const aperte = righe.filter((r) => r.importo > 0.01);
    const chiuse = righe.filter((r) => r.importo <= 0.01);

    // SQL: 2.743 righe con inevaso sul run corrente.
    expect(aperte.length).toBe(2743);
    expect(aperte.every((r) => typeof r.giorniAperto === "number")).toBe(true);
    expect(chiuse.every((r) => r.giorniAperto === null)).toBe(true);
    expect(aperte.every((r) => (r.giorniAperto ?? 0) >= 0)).toBe(true);
  });

  it("l'età media e l'inevaso coincidono con il database", () => {
    // SQL: media 338,45 giorni su 4.181.638 € di inevaso.
    const eta = esegui({ metrica: "giorni_apertura" }, snapshot);
    const inevaso = esegui({ metrica: "preventivi_aperti" }, snapshot);

    expect(eta.unita).toBe("giorni");
    expect(eta.totale).toBeCloseTo(338.45, 1);
    expect(Math.round(inevaso.totale)).toBe(4_180_296);
    console.log(`   Età media ${eta.totale.toFixed(1)} giorni su ${M(inevaso.totale)} € di inevaso`);
  });

  it("le fasce di anzianità riproducono la distribuzione SQL", () => {
    // SQL:  0-30 78 righe · 31-60 117 · 61-90 96 · 91-180 356
    //       6-12 mesi 757 · oltre 1 anno 1.339
    const attese: Record<string, number> = {
      "0-30 giorni": 78,
      "31-60 giorni": 117,
      "61-90 giorni": 96,
      "91-180 giorni": 356,
      "6-12 mesi": 757,
      "oltre 1 anno": 1339,
    };
    const res = esegui(
      { metrica: "preventivi_aperti", raggruppa: ["fascia_eta"] },
      snapshot
    );
    console.log("\n   Fascia            righe      inevaso");
    for (const [fascia, righe] of Object.entries(attese)) {
      const r = res.righe.find((x) => x.etichetta === fascia);
      expect(r, `manca ${fascia}`).toBeTruthy();
      expect(r!.conteggio).toBe(righe);
      console.log(`   ${fascia.padEnd(16)} ${String(righe).padStart(5)} ${M(r!.valore).padStart(12)} €`);
    }
  });

  it("misura l'inevaso vecchio, quello che non si chiude da solo", () => {
    const oltre = esegui({ metrica: "preventivi_aperti_oltre_90" }, snapshot);
    const totale = esegui({ metrica: "preventivi_aperti" }, snapshot);
    const massima = esegui({ metrica: "eta_massima_apertura" }, snapshot);

    // 91-180 + 6-12 mesi + oltre 1 anno = 623.933 + 1.644.252 + 1.351.323
    expect(Math.round(oltre.totale)).toBe(3_619_508);
    expect(massima.totale).toBeGreaterThan(365);

    const quota = (oltre.totale / totale.totale) * 100;
    console.log(
      `   Oltre 90 giorni: ${M(oltre.totale)} € (${quota.toFixed(0)}% dell'inevaso) · il più vecchio ${massima.totale} giorni`
    );
    expect(quota).toBeGreaterThan(80);
  });

  it("il confronto YTD ferma entrambi gli anni allo stesso giorno", () => {
    const al = snapshot.dataMassima!;
    const limite2026 = `2026-${al.slice(5, 10)}`;

    const annoIntero = esegui({ metrica: "ordinato", periodo: { anno: 2026 } }, snapshot);
    const apIntero = esegui(
      { metrica: "ordinato", modificatore: "anno_precedente", periodo: { anno: 2026 } },
      snapshot
    );
    const ytd = esegui({ metrica: "ordinato", periodo: { dal: "2026-01-01", al: limite2026 } }, snapshot);
    const apYtd = esegui(
      {
        metrica: "ordinato",
        modificatore: "anno_precedente",
        periodo: { dal: "2026-01-01", al: limite2026 },
      },
      snapshot
    );

    // Il 2026 è lo stesso in entrambi i casi: è il 2025 a cambiare.
    expect(Math.round(ytd.totale)).toBe(Math.round(annoIntero.totale));
    expect(apYtd.totale).toBeLessThan(apIntero.totale);

    const deltaSbagliato = ((annoIntero.totale - apIntero.totale) / apIntero.totale) * 100;
    const deltaGiusto = ((ytd.totale - apYtd.totale) / apYtd.totale) * 100;

    console.log(`   2026 al ${al}: ${M(ytd.totale)} €`);
    console.log(`   contro 2025 intero:      ${M(apIntero.totale)} € → ${deltaSbagliato.toFixed(1)}%`);
    console.log(`   contro 2025 a pari data: ${M(apYtd.totale)} € → ${deltaGiusto.toFixed(1)}%`);

    // Il confronto sbagliato esagera il calo di parecchi punti.
    expect(deltaGiusto).toBeGreaterThan(deltaSbagliato + 5);
  });

  it("elenca i documenti di un cliente e ne apre le righe", () => {
    const cliente = esegui(
      { metrica: "preventivi_valore", raggruppa: ["cliente"], ordina: "valore_desc", limite: 1 },
      snapshot
    ).righe[0].etichetta;

    const elenco = dettaglioDocumenti(
      { dataset: "preventivi_aperti", filtri: [{ campo: "cliente", op: "eq", valore: cliente }] },
      snapshot
    );
    expect(elenco.documenti.length).toBeGreaterThan(0);
    expect(elenco.righe).toBeNull();
    expect(elenco.documenti.every((d) => d.cliente === cliente)).toBe(true);

    const primo = elenco.documenti[0];
    const dettaglio = dettaglioDocumenti(
      {
        dataset: "preventivi_aperti",
        filtri: [{ campo: "cliente", op: "eq", valore: cliente }],
        documento: primo.numero,
      },
      snapshot
    );
    expect(dettaglio.righe).not.toBeNull();
    expect(dettaglio.righe!.length).toBe(primo.righe);
    // Le righe portano la descrizione: è il "cosa ha chiesto il cliente".
    expect(dettaglio.righe!.some((r) => r.descrizione.length > 0)).toBe(true);

    console.log(
      `\n   ${cliente}: ${elenco.totaleDocumenti} documenti · il primo (n. ${primo.numero}) ha ${primo.righe} righe per ${M(primo.valoreTotale ?? primo.importo)} €`
    );
    for (const r of dettaglio.righe!.slice(0, 3)) {
      console.log(`     ${r.descrizione.slice(0, 58).padEnd(58)} ${M(r.valoreTotale ?? r.importo).padStart(9)} €`);
    }
  });

  it("i totali del documento coincidono con la somma delle sue righe", () => {
    const elenco = dettaglioDocumenti(
      { dataset: "preventivi_aperti", limite: 5, ordina: "importo" },
      snapshot
    );
    for (const d of elenco.documenti) {
      const det = dettaglioDocumenti(
        { dataset: "preventivi_aperti", documento: d.numero },
        snapshot
      );
      const somma = (det.righe ?? []).reduce((s, r) => s + (r.valoreTotale ?? 0), 0);
      expect(Math.abs(somma - (d.valoreTotale ?? 0))).toBeLessThan(0.5);
    }
  });

  it("il dettaglio funziona anche sugli ordini, non solo sui preventivi", () => {
    const elenco = dettaglioDocumenti(
      { dataset: "ordinato", periodo: { anno: 2026 }, limite: 3 },
      snapshot
    );
    expect(elenco.documenti.length).toBe(3);
    // Gli ordini non hanno i campi back office: le colonne restano vuote
    // invece di mostrare zeri finti.
    expect(elenco.documenti.every((d) => d.giorniAperto === null)).toBe(true);
    expect(elenco.documenti[0].righe).toBeGreaterThan(0);
  });

  it("rifiuta i dataset senza dettaglio documentale", () => {
    const elenco = dettaglioDocumenti(
      { dataset: "preventivi_aperti", documento: "numero-che-non-esiste" },
      snapshot
    );
    expect(elenco.righe).toBeNull();
    expect(elenco.avvisi.join(" ")).toContain("non rientra");
  });
});
