/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Verifica del motore sui DATI REALI (lettura dalle viste public.bi_*).
 * Si esegue con:  npx vitest run prototipo-bi/verifica.test.ts
 *
 * Non è una suite di regressione: è la prova che i pezzi funzionano e che i
 * numeri tornano con quelli visti nel PBIX.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { costruisciCalendario, settimanaIso, dataDaIso } from "@/lib/prototipo-bi/calendario";
import { distribuisci, budgetPerMese, budgetProgressivoAl } from "@/lib/prototipo-bi/budget";
import { esegui, validaSpec, SpecNonValida } from "@/lib/prototipo-bi/semantico";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import { costruisciContesto, rilevaTutto, calcolaPunteggi } from "@/lib/prototipo-bi/rilevatori";
import type { ConfigurazioneAnno, Snapshot } from "@/lib/prototipo-bi/tipi";
import { caricaEnvLocale } from "./_env";

const CONFIG_PROVA: ConfigurazioneAnno = {
  anno: 2026,
  budgetAnnuo: 7_500_000,
  bepAnnuo: 6_200_000,
  modalita: "giorni_lavorativi",
  escludiWeekend: true,
  chiusure: [
    { id: "estiva", dal: "2026-08-10", al: "2026-08-23", descrizione: "Chiusura estiva" },
    { id: "natale", dal: "2026-12-24", al: "2026-12-31", descrizione: "Chiusura natalizia" },
  ],
  incidenzeBU: [
    { bu: "COMPONENTI", pesoPct: 55 },
    { bu: "IMPIANTI", pesoPct: 30 },
    { bu: "SISTEMI", pesoPct: 15 },
  ],
  commerciali: [
    { codiceAgente: "AG000010", agente: "VALERIA BATTELANI", quotaPct: 40, importoAnnuo: null, bu: null },
    { codiceAgente: "AG010035", agente: "DANIELE BONI", quotaPct: 35, importoAnnuo: null, bu: null },
    { codiceAgente: "AG009999", agente: "AIRFLUID", quotaPct: 25, importoAnnuo: null, bu: null },
  ],
  aggiornatoIl: new Date().toISOString(),
};

describe("Calendario", () => {
  it("esclude weekend, festività e chiusure", () => {
    const cal = costruisciCalendario(2026, CONFIG_PROVA.chiusure, true);
    expect(cal).toHaveLength(365);

    const ferragosto = cal.find((g) => g.data === "2026-08-15");
    expect(ferragosto?.lavorativo).toBe(false);

    // La chiusura estiva verificata sui dati reali: 10-23 agosto senza ordini.
    const dentroChiusura = cal.filter(
      (g) => g.data >= "2026-08-10" && g.data <= "2026-08-23" && g.lavorativo
    );
    expect(dentroChiusura).toHaveLength(0);

    const primoMaggio = cal.find((g) => g.data === "2026-05-01");
    expect(primoMaggio?.festivo).toBe(true);
  });

  it("calcola correttamente la settimana ISO", () => {
    expect(settimanaIso(dataDaIso("2026-08-05"))).toBe("2026-W32");
    expect(settimanaIso(dataDaIso("2026-01-01"))).toBe("2026-W01");
  });
});

describe("Distribuzione Budget/BEP", () => {
  it("distribuisce l'importo esatto, senza derive di arrotondamento", () => {
    const d = distribuisci(CONFIG_PROVA);
    const sommaBudget = d.giorni.reduce((s, g) => s + g.budget, 0);
    const sommaBep = d.giorni.reduce((s, g) => s + g.bep, 0);

    expect(Math.abs(sommaBudget - CONFIG_PROVA.budgetAnnuo)).toBeLessThan(0.01);
    expect(Math.abs(sommaBep - CONFIG_PROVA.bepAnnuo)).toBeLessThan(0.01);
  });

  it("dà ad agosto meno budget perché è chiuso — il punto di tutto l'esercizio", () => {
    const d = distribuisci(CONFIG_PROVA);
    const perMese = budgetPerMese(d);
    const agosto = perMese.get(8)!;
    const settembre = perMese.get(9)!;

    expect(agosto.giorni).toBeLessThan(settembre.giorni);
    expect(agosto.budget).toBeLessThan(settembre.budget);
    // Agosto 2026 con la chiusura 10-23 e Ferragosto: 11 giorni lavorativi
    // (3-7, 24-28, 31) contro i 22 di settembre. Il budget di agosto vale
    // circa la metà di quello di settembre senza che nessuno lo imposti.
    expect(agosto.giorni).toBe(11);
    expect(settembre.giorni).toBe(22);
    expect(agosto.budget / settembre.budget).toBeCloseTo(11 / 22, 2);
  });

  it("ripartisce su business unit e commerciali senza perdere euro", () => {
    const d = distribuisci(CONFIG_PROVA);

    const sommaBU = d.perBU.reduce((s, r) => s + r.budget, 0);
    expect(Math.abs(sommaBU - CONFIG_PROVA.budgetAnnuo)).toBeLessThan(5);

    const sommaAgenti = d.perAgente.reduce((s, r) => s + r.budget, 0);
    expect(Math.abs(sommaAgenti - CONFIG_PROVA.budgetAnnuo)).toBeLessThan(5);

    expect(d.avvisi).toHaveLength(0);
  });

  it("il progressivo cresce in modo monotono", () => {
    const d = distribuisci(CONFIG_PROVA);
    const a = budgetProgressivoAl(d, "2026-06-30");
    const b = budgetProgressivoAl(d, "2026-12-31");
    expect(b.budget).toBeGreaterThan(a.budget);
    expect(Math.abs(b.budget - CONFIG_PROVA.budgetAnnuo)).toBeLessThan(0.01);
  });
});

describe("Strato semantico — perimetro chiuso", () => {
  it("rifiuta metriche e dimensioni inventate", () => {
    expect(() => validaSpec({ metrica: "marginalita_occulta" })).toThrow(SpecNonValida);
    expect(() => validaSpec({ metrica: "ordinato", raggruppa: ["colore_preferito"] })).toThrow(
      SpecNonValida
    );
    expect(() => validaSpec({ metrica: "ordinato", raggruppa: ["bu"] })).not.toThrow();
  });
});

describe("Dati reali", () => {
  let snapshot: Snapshot;

  beforeAll(async () => {
    // Vitest non carica .env.local: lo si legge qui, prima che il client
    // Supabase venga istanziato (è lazy, quindi in tempo).
    caricaEnvLocale();

    snapshot = await costruisciSnapshot();
  }, 180_000);

  it("carica le sette viste dal run corrente", () => {
    expect(snapshot.conteggi.ordinato).toBeGreaterThan(10_000);
    expect(snapshot.conteggi.fatturato).toBeGreaterThan(10_000);
    expect(snapshot.dataMinima).toBeTruthy();
    expect(snapshot.dataMassima).toBeTruthy();
    console.log("   Snapshot:", snapshot.conteggi, snapshot.dataMinima, "→", snapshot.dataMassima);
  });

  it("il fatturato coincide con il valore certificato del run corrente (non 174 M)", () => {
    const res = esegui({ metrica: "fatturato" }, snapshot);
    // Verificato via SQL: 6.288.549 € sul run corrente, contro i 174.346.834 €
    // che restituirebbe una query ingenua su bi_documenti_raw (28 run sommati).
    expect(res.totale).toBeGreaterThan(6_000_000);
    expect(res.totale).toBeLessThan(7_000_000);
    console.log("   Fatturato certificato:", res.totale.toLocaleString("it-IT"), "€");
  });

  it("ritrova il buco di Ferragosto nella serie settimanale", () => {
    const res = esegui(
      {
        metrica: "ordinato",
        granularita: "settimana",
        periodo: { dal: "2026-08-01", al: "2026-08-27" },
        ordina: "etichetta",
      },
      snapshot
    );
    const settimane = Object.fromEntries(res.righe.map((r) => [r.etichetta, r.valore]));
    console.log("   Settimane agosto:", settimane);
    // La settimana 2026-W34 (17-23 ago) non esiste proprio nei dati.
    expect(res.righe.find((r) => r.etichetta === "2026-W34")).toBeUndefined();
  });

  it("ritrova la concentrazione della settimana 3-9 agosto", () => {
    const res = esegui(
      {
        metrica: "ordinato",
        raggruppa: ["cliente"],
        periodo: { dal: "2026-08-03", al: "2026-08-09" },
        ordina: "valore_desc",
        limite: 3,
      },
      snapshot
    );
    const primo = res.righe[0];
    const quota = (primo.valore / res.totale) * 100;
    console.log("   Primo cliente:", primo.etichetta, `${quota.toFixed(1)}%`);
    // Verificato via SQL: CURTI al 48,2%.
    expect(quota).toBeGreaterThan(40);
  });

  it("il confronto anno su anno usa lo stesso periodo dell'anno prima", () => {
    const corrente = esegui(
      { metrica: "ordinato", periodo: { dal: "2026-01-01", al: "2026-06-30" } },
      snapshot
    );
    const precedente = esegui(
      {
        metrica: "ordinato",
        modificatore: "anno_precedente",
        periodo: { dal: "2026-01-01", al: "2026-06-30" },
      },
      snapshot
    );
    expect(corrente.totale).toBeGreaterThan(0);
    expect(precedente.totale).toBeGreaterThan(0);
    console.log(
      "   Ordinato H1:",
      corrente.totale.toLocaleString("it-IT"),
      "vs",
      precedente.totale.toLocaleString("it-IT")
    );
  });

  it("avvisa onestamente quando il periodo non è coperto invece di rispondere zero", () => {
    const res = esegui(
      { metrica: "ordinato", periodo: { dal: "2023-01-01", al: "2023-12-31" } },
      snapshot
    );
    expect(res.totale).toBe(0);
    expect(res.avvisi.join(" ")).toContain("2025");
  });

  it("i rilevatori producono segnali ordinati per rilevanza", () => {
    const ctx = costruisciContesto(snapshot, CONFIG_PROVA);
    const segnali = calcolaPunteggi(rilevaTutto(ctx));

    expect(segnali.length).toBeGreaterThan(0);
    for (let i = 1; i < segnali.length; i++) {
      expect(segnali[i - 1].punteggio).toBeGreaterThanOrEqual(segnali[i].punteggio);
    }

    console.log("\n   ── Segnali rilevati ──");
    for (const s of segnali) {
      console.log(
        `   [${s.punteggio.toFixed(2)}] ${s.famiglia.padEnd(20)} ${s.titolo}`
      );
    }
    console.log(`   Selezionati per il briefing: i primi 3 di ${segnali.length}\n`);

    // Nessun rilevatore deve essere esploso.
    expect(segnali.filter((s) => s.id.startsWith("errore-"))).toHaveLength(0);
  });

  it("il rilevatore di serie non segnala le settimane di chiusura", () => {
    const ctx = costruisciContesto(snapshot, CONFIG_PROVA);
    const segnali = rilevaTutto(ctx).filter((s) => s.famiglia === "rottura_serie");
    for (const s of segnali) {
      const sett = (s.dettaglio as { settimana?: string })?.settimana ?? "";
      expect(["2026-W33", "2026-W34"]).not.toContain(sett);
    }
  });
});
