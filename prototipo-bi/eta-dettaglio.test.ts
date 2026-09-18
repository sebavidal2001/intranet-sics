/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Anzianità dei preventivi, dettaglio documenti, confronto YTD e cache.
 * I valori attesi vengono da query SQL sulla vista bi_preventivi_backoffice.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { esegui } from "@/lib/prototipo-bi/semantico";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import { dettaglioDocumenti } from "@/lib/prototipo-bi/dettaglio";
import { CacheRisultati, chiaveStabile } from "@/lib/prototipo-bi/cache";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";
import { caricaEnvLocale } from "./_env";
import { leggiVista, numero, type RigaVista } from "./_vista";

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
  let vista: RigaVista[];

  beforeAll(async () => {
    caricaEnvLocale();
    [snapshot, vista] = await Promise.all([
      costruisciSnapshot(),
      leggiVista("bi_preventivi_backoffice"),
    ]);
  }, 240_000);

  it("calcola l'anzianità solo sulle righe ancora aperte", () => {
    const righe = snapshot.dataset.preventivi_aperti;
    const aperte = righe.filter((r) => r.importo > 0.01);
    const chiuse = righe.filter((r) => r.importo <= 0.01);

    // Quante siano lo dicono i dati: contarle qui e riasserirle sarebbe una
    // tautologia, quindi si verifica la PROPRIETA' — ogni riga con inevaso ha
    // un'anzianita', ogni riga chiusa non ce l'ha — e che ce ne sia un numero
    // ragionevole. Il "2.743" che stava qui valeva per un database e un
    // giorno soli.
    expect(aperte.length).toBeGreaterThan(0);
    expect(aperte.length).toBeLessThan(righe.length);
    expect(aperte.every((r) => typeof r.giorniAperto === "number")).toBe(true);
    expect(chiuse.every((r) => r.giorniAperto === null)).toBe(true);
    expect(aperte.every((r) => (r.giorniAperto ?? 0) >= 0)).toBe(true);
  });

  it("l'età media e l'inevaso coincidono con il database", () => {
    const eta = esegui({ metrica: "giorni_apertura" }, snapshot);
    const inevaso = esegui({ metrica: "preventivi_aperti" }, snapshot);

    // L'inevaso deve riprodurre la vista euro per euro; l'eta' media deve
    // essere la media delle righe APERTE, non di tutte — che e' l'errore che
    // questo test presidia.
    const attesoInevaso = vista.reduce((s, r) => s + numero(r["Importo Inevaso"]), 0);
    const aperte = snapshot.dataset.preventivi_aperti.filter((r) => r.giorniAperto !== null);
    const attesaEta =
      aperte.reduce((s, r) => s + (r.giorniAperto ?? 0), 0) / (aperte.length || 1);

    expect(eta.unita).toBe("giorni");
    expect(eta.totale).toBeCloseTo(attesaEta, 1);
    expect(Math.round(inevaso.totale)).toBe(Math.round(attesoInevaso));
    console.log(`   Età media ${eta.totale.toFixed(1)} giorni su ${M(inevaso.totale)} € di inevaso`);
  });

  it("le fasce di anzianità sono una partizione, senza righe perse", () => {
    // Prima c'erano sei conteggi copiati da una SELECT ("0-30 78 righe · 31-60
    // 117 · ..."): valevano per il database di sviluppo di quel giorno, e su
    // produzione questo test falliva con `expected 119 to be 78`.
    //
    // E non si ricalcolano nemmeno qui i confini della regola (<=30, <=60...):
    // un test che ricopia la regola verifica la propria copia — se la copia è
    // giusta non dimostra nulla, se è sbagliata diventa rosso senza che il BI
    // abbia un difetto.
    //
    // Quello che conta è che la classificazione sia una PARTIZIONE: ogni riga
    // finisce in una fascia e in una sola, nessuna si perde, nessun euro si
    // perde, e le etichette sono quelle previste. Non duplica e non invecchia.
    const res = esegui(
      { metrica: "preventivi_aperti", raggruppa: ["fascia_eta"] },
      snapshot
    );

    const ETICHETTE = [
      "0-30 giorni",
      "31-60 giorni",
      "61-90 giorni",
      "91-180 giorni",
      "6-12 mesi",
      "oltre 1 anno",
      "(chiuso)",
    ];
    for (const r of res.righe) {
      expect(ETICHETTE, `fascia inattesa: ${r.etichetta}`).toContain(r.etichetta);
    }

    // Nessuna riga persa e nessuna contata due volte.
    const righeClassificate = res.righe.reduce((s, r) => s + r.conteggio, 0);
    expect(righeClassificate).toBe(snapshot.dataset.preventivi_aperti.length);

    // Gli euro non si perdono per strada.
    const sommaImporti = res.righe.reduce((s, r) => s + r.valore, 0);
    expect(Math.abs(sommaImporti - res.totale)).toBeLessThan(1);

    // Le righe chiuse stanno tutte e sole in "(chiuso)".
    const chiuse = snapshot.dataset.preventivi_aperti.filter(
      (r) => r.giorniAperto === null || r.giorniAperto === undefined
    ).length;
    const inChiuso = res.righe.find((r) => r.etichetta === "(chiuso)")?.conteggio ?? 0;
    expect(inChiuso).toBe(chiuse);

    console.log("\n   Fascia            righe      inevaso");
    for (const r of res.righe) {
      console.log(
        `   ${r.etichetta.padEnd(16)} ${String(r.conteggio).padStart(5)} ${M(r.valore).padStart(12)} €`
      );
    }
  });

  it("misura l'inevaso vecchio, quello che non si chiude da solo", () => {
    const oltre = esegui({ metrica: "preventivi_aperti_oltre_90" }, snapshot);
    const totale = esegui({ metrica: "preventivi_aperti" }, snapshot);
    const massima = esegui({ metrica: "eta_massima_apertura" }, snapshot);

    // Le righe aperte da piu' di 90 giorni, sommate dallo snapshot stesso:
    // il numero cambia ogni notte, la definizione no.
    const attesoOltre = snapshot.dataset.preventivi_aperti
      .filter((r) => (r.giorniAperto ?? 0) > 90)
      .reduce((s, r) => s + r.importo, 0);
    expect(Math.round(oltre.totale)).toBe(Math.round(attesoOltre));
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
