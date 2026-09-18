/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * I dati nuovi: esito dei preventivi (derivazione in ordini) e carico del
 * back office.
 *
 * Gli attesi si calcolano dalla VISTA, nello stesso istante in cui si legge lo
 * snapshot. Prima erano numeri scritti a mano ("SQL: 6.476 righe"), presi da
 * una query fatta un giorno preciso su un database preciso: passavano solo lì,
 * e sul database di produzione fallivano in blocco senza che niente fosse
 * rotto. Quello che il test vuole dimostrare non è che il valore sia
 * 6.454.654 — cambia ogni notte, ed è giusto — ma che lo snapshot **non
 * alteri** ciò che legge.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { esegui } from "@/lib/prototipo-bi/semantico";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";
import { caricaEnvLocale } from "./_env";
import { leggiVista, numero, testo, type RigaVista } from "./_vista";

const M = (n: number) => Math.round(n).toLocaleString("it-IT");

describe("Esito preventivi e back office", () => {
  let snapshot: Snapshot;
  let vista: RigaVista[];

  beforeAll(async () => {
    caricaEnvLocale();
    [snapshot, vista] = await Promise.all([
      costruisciSnapshot(),
      leggiVista("bi_preventivi_backoffice"),
    ]);
  }, 240_000);

  it("legge i preventivi del solo run corrente, con i campi nuovi", () => {
    const righe = snapshot.dataset.preventivi_aperti;
    expect(righe.length).toBe(vista.length);
    expect(righe.every((r) => r.creatore && r.creatore.length > 0)).toBe(true);
    expect(righe.filter((r) => r.valoreTotale !== undefined).length).toBe(vista.length);
    console.log(`   Preventivi: ${righe.length} righe, tutte con creatore e valore totale`);
  });

  it("il valore totale e l'inevaso coincidono con il database", () => {
    const valore = esegui({ metrica: "preventivi_valore" }, snapshot);
    const inevaso = esegui({ metrica: "preventivi_aperti" }, snapshot);
    const convertito = esegui({ metrica: "preventivi_convertito" }, snapshot);

    // I nomi delle colonne sono quelli VERI della vista, letti da PostgREST.
    // Avevo scritto "Importo Evaso" deducendolo dal commento in `tipi.ts`, che
    // parla del nome nel GESTIONALE: nella vista si chiama "Valore Totale
    // Riga", e il test dava zero contro zero senza lamentarsi del nome.
    const attesoValore = vista.reduce((s, r) => s + numero(r["Valore Totale Riga"]), 0);
    const attesoInevaso = vista.reduce((s, r) => s + numero(r["Importo Inevaso"]), 0);
    // Il convertito lo calcola già la vista, azzerando i contributi negativi:
    // alcune righe hanno l'inevaso maggiore del totale (incoerenza del
    // gestionale) e una "conversione negativa" non significa nulla.
    const attesoConvertito = vista.reduce(
      (s, r) => s + numero(r["Convertito In Ordine"]),
      0,
    );

    expect(Math.round(valore.totale)).toBe(Math.round(attesoValore));
    expect(Math.round(inevaso.totale)).toBe(Math.round(attesoInevaso));
    expect(Math.round(convertito.totale)).toBe(Math.round(attesoConvertito));

    console.log(
      `   Valore ${M(valore.totale)} € · inevaso ${M(inevaso.totale)} € · convertito ${M(convertito.totale)} €`
    );
  });

  it("il tasso di conversione è un rapporto, non una media di medie", () => {
    const tasso = esegui({ metrica: "tasso_conversione" }, snapshot);
    // SQL: 35,2%
    expect(tasso.unita).toBe("percentuale");
    expect(tasso.totale).toBeGreaterThan(34);
    expect(tasso.totale).toBeLessThan(37);

    // Il totale deve essere il rapporto complessivo, NON la media dei tassi
    // per business unit: con gruppi di dimensione molto diversa le due cose
    // divergono parecchio.
    const perBu = esegui({ metrica: "tasso_conversione", raggruppa: ["bu"] }, snapshot);
    const mediaDeiTassi =
      perBu.righe.reduce((s, r) => s + r.valore, 0) / (perBu.righe.length || 1);
    expect(Math.abs(tasso.totale - mediaDeiTassi)).toBeGreaterThan(1);

    console.log(
      `   Tasso complessivo ${tasso.totale.toFixed(1)}% · media dei tassi per BU ${mediaDeiTassi.toFixed(1)}% (giustamente diversi)`
    );
    for (const r of perBu.righe) console.log(`     ${r.etichetta.padEnd(16)} ${r.valore.toFixed(1)}%`);
  });

  it("classifica l'esito di ogni riga in convertito/parziale/aperto", () => {
    const esiti = esegui(
      { metrica: "preventivi_valore", raggruppa: ["esito"], ordina: "valore_desc" },
      snapshot
    );
    const chiavi = esiti.righe.map((r) => r.etichetta).sort();
    expect(chiavi).toEqual(expect.arrayContaining(["Aperto", "Convertito"]));

    const somma = esiti.righe.reduce((s, r) => s + r.valore, 0);
    expect(Math.abs(somma - esiti.totale)).toBeLessThan(1);

    console.log("   Esiti:");
    for (const r of esiti.righe) {
      console.log(`     ${r.etichetta.padEnd(12)} ${M(r.valore).padStart(11)} €  (${r.conteggio} righe)`);
    }
  });

  it("misura il carico dei sette addetti back office", () => {
    const creati = esegui(
      { metrica: "preventivi_creati", raggruppa: ["creatore"], ordina: "valore_desc" },
      snapshot
    );
    const righe = esegui(
      { metrica: "righe_preventivo", raggruppa: ["creatore"], ordina: "valore_desc" },
      snapshot
    );
    const conv = esegui(
      { metrica: "tasso_conversione", raggruppa: ["creatore"] },
      snapshot
    );

    // Quanti addetti compaiono lo dice la vista, non una costante: se domani
    // ne assumono un ottavo il test non deve diventare rosso per questo.
    const creatoriVista = new Set(vista.map((r) => testo(r["Creato da"])).filter(Boolean));
    expect(creati.righe.length).toBe(creatoriVista.size);

    // Preventivi DISTINTI per addetto: il conteggio va fatto sui documenti,
    // non sulle righe, ed è esattamente la differenza che questa metrica deve
    // rispettare.
    const documentiPerCreatore = new Map<string, Set<string>>();
    for (const r of vista) {
      const chi = testo(r["Creato da"]);
      if (!chi) continue;
      const suoi = documentiPerCreatore.get(chi) ?? new Set<string>();
      suoi.add(testo(r["Numero Doc."]));
      documentiPerCreatore.set(chi, suoi);
    }
    for (const riga of creati.righe) {
      const atteso = documentiPerCreatore.get(riga.etichetta)?.size;
      expect(riga.valore, `preventivi distinti di ${riga.etichetta}`).toBe(atteso);
    }

    const mappaRighe = new Map(righe.righe.map((r) => [r.etichetta, r.valore]));
    const mappaConv = new Map(conv.righe.map((r) => [r.etichetta, r.valore]));

    console.log("\n   Addetto                     prev.  righe  conv.");
    for (const r of creati.righe) {
      console.log(
        `   ${r.etichetta.padEnd(28)} ${String(r.valore).padStart(4)} ${String(mappaRighe.get(r.etichetta) ?? 0).padStart(6)}  ${(mappaConv.get(r.etichetta) ?? 0).toFixed(0)}%`
      );
    }
  });

  it("esclude le date incoerenti invece di produrre medie negative", () => {
    const righe = snapshot.dataset.preventivi_aperti;
    const negativi = righe.filter(
      (r) => r.giorniRisposta !== null && r.giorniRisposta !== undefined && r.giorniRisposta < 0
    );
    expect(negativi).toHaveLength(0);

    const gg = esegui(
      { metrica: "giorni_risposta", raggruppa: ["creatore"], ordina: "valore_desc" },
      snapshot
    );
    // Senza la pulizia, un addetto aveva media -496 giorni.
    for (const r of gg.righe) expect(r.valore).toBeGreaterThanOrEqual(0);

    const stessoGiorno = esegui({ metrica: "quota_stesso_giorno" }, snapshot);
    expect(stessoGiorno.totale).toBeGreaterThan(50);
    expect(stessoGiorno.totale).toBeLessThanOrEqual(100);

    console.log(`\n   Risposte in giornata: ${stessoGiorno.totale.toFixed(1)}%`);
    console.log("   Giorni medi di risposta per addetto:");
    for (const r of gg.righe) console.log(`     ${r.etichetta.padEnd(28)} ${r.valore.toFixed(2)}`);
  });

  it("non applica il progressivo a medie e percentuali", () => {
    const r = esegui(
      {
        metrica: "tasso_conversione",
        modificatore: "progressivo",
        granularita: "mese",
        periodo: { anno: 2026 },
      },
      snapshot
    );
    expect(r.avvisi.join(" ")).toContain("progressivo non è stato applicato");
    // I valori restano tassi mensili, non una somma crescente.
    for (const x of r.righe) expect(x.valore).toBeLessThanOrEqual(100);
  });

  it("il carico mensile del back office è una serie utilizzabile", () => {
    const serie = esegui(
      {
        metrica: "righe_preventivo",
        granularita: "mese",
        raggruppa: ["creatore"],
        periodo: { anno: 2026 },
        ordina: "etichetta",
      },
      snapshot
    );
    expect(serie.righe.length).toBeGreaterThan(10);
    const mesi = new Set(serie.righe.map((r) => r.chiavi.periodo));
    const persone = new Set(serie.righe.map((r) => r.chiavi.creatore));
    console.log(`   Serie carico: ${mesi.size} mesi × ${persone.size} addetti`);
    expect(mesi.size).toBeGreaterThan(5);
  });
});
