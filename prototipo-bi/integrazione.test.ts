/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Catena completa: import Excel reali → archivio → risoluzione budget →
 * confronto con i consuntivi veri.
 *
 * Come effetto collaterale VOLUTO popola `prototipo-bi/dati/`, così l'app
 * parte già con il budget caricato.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { importaBudget, unisciSerie } from "@/lib/prototipo-bi/importa-budget";
import { salvaSerieBudget, leggiSerieBudget } from "@/lib/prototipo-bi/archivio";
import { risolviBudget } from "@/lib/prototipo-bi/budget-fonte";
import { esegui } from "@/lib/prototipo-bi/semantico";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

const BASE =
  "C:/Users/sebav/AppData/Local/Temp/claude/C--Users-sebav-Desktop-intranet-sics/af3333a2-79b1-4650-88c6-e6783b861a6b/scratchpad/bi";
const F_GIORN = `${BASE}/BUDGET-BEP_GIORNALIERO.xlsx`;
const F_COMM = `${BASE}/BUDGET-BEP_GIORNALIERO_COMMERCIALI.xlsx`;

const M = (n: number) => Math.round(n).toLocaleString("it-IT");

describe("Catena completa budget + consuntivi", () => {
  let snapshot: Snapshot;

  beforeAll(async () => {
    const t = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const r of t.split(/\r?\n/)) {
      if (!r.includes("=") || r.trim().startsWith("#")) continue;
      const i = r.indexOf("=");
      const k = r.slice(0, i).replace(/^\ufeff/, "").trim();
      if (!process.env[k]) process.env[k] = r.slice(i + 1).trim();
    }
    snapshot = await costruisciSnapshot();

    if (existsSync(F_GIORN)) {
      const area = importaBudget(readFileSync(F_GIORN));
      const comm = existsSync(F_COMM) ? importaBudget(readFileSync(F_COMM)) : null;
      for (const anno of [2024, 2025, 2026]) {
        const pezzi = [area.serie, ...(comm ? [comm.serie] : [])]
          .map((s) => ({
            ...s,
            righe: s.righe.filter((r) => r.data.startsWith(String(anno))),
            anni: [anno],
          }))
          .filter((s) => s.righe.length > 0);
        if (pezzi.length === 0) continue;
        await salvaSerieBudget(anno, unisciSerie(pezzi));
      }
    }
  }, 180_000);

  it("archivia i tre anni con i totali giusti", async () => {
    const attesi = [
      [2024, 4_000_000, 3_800_000],
      [2025, 5_000_000, 4_600_000],
      [2026, 5_200_000, 4_800_000],
    ] as const;
    for (const [anno, budget, bep] of attesi) {
      const s = await leggiSerieBudget(anno);
      expect(s, `serie ${anno}`).toBeTruthy();
      expect(s!.totaliPerAnno[anno].budget).toBeCloseTo(budget, 0);
      expect(s!.totaliPerAnno[anno].bep).toBeCloseTo(bep, 0);
    }
  });

  it("interroga il budget per business unit, come i consuntivi", async () => {
    const serie = await leggiSerieBudget(2026);
    const b = risolviBudget(
      { metrica: "budget", raggruppa: ["bu"], periodo: { anno: 2026 }, ordina: "valore_desc" },
      serie
    );
    expect(b.origine).toBe("importato");
    expect(b.risultato.righe.length).toBe(4);
    expect(b.risultato.totale).toBeCloseTo(5_200_000, 0);
    console.log(
      "   Budget 2026 per BU: " +
        b.risultato.righe.map((r) => `${r.etichetta} ${M(r.valore)}`).join(" · ")
    );
  });

  it("interroga il budget per agente senza raddoppiare il totale", async () => {
    const serie = await leggiSerieBudget(2026);
    const b = risolviBudget(
      { metrica: "budget", raggruppa: ["agente"], periodo: { anno: 2026 }, ordina: "valore_desc" },
      serie
    );
    expect(b.risultato.totale).toBeCloseTo(5_200_000, 0);
    const perAgente = Object.fromEntries(
      b.risultato.righe.map((r) => [r.etichetta, Math.round(r.valore)])
    );
    expect(perAgente["VALERIA BATTELANI"]).toBe(3_000_000);
    expect(perAgente["DANIELE BONI"]).toBe(1_200_000);
    expect(perAgente["AIRFLUID"]).toBe(1_000_000);
    console.log("   Budget 2026 per agente: " + JSON.stringify(perAgente));
  });

  it("il budget a pari periodo è il confronto giusto, non quello annuo", async () => {
    const serie = await leggiSerieBudget(2026);
    const al = snapshot.dataMassima!;
    const adOggi = risolviBudget({ metrica: "budget", periodo: { dal: "2026-01-01", al } }, serie);
    const anno = risolviBudget({ metrica: "budget", periodo: { anno: 2026 } }, serie);

    expect(adOggi.risultato.totale).toBeLessThan(anno.risultato.totale);
    expect(adOggi.risultato.totale).toBeGreaterThan(0);

    const ordinato = esegui({ metrica: "ordinato", periodo: { dal: "2026-01-01", al } }, snapshot);
    const raggAnno = (ordinato.totale / anno.risultato.totale) * 100;
    const raggOggi = (ordinato.totale / adOggi.risultato.totale) * 100;

    console.log(`   Ordinato al ${al}: ${M(ordinato.totale)} €`);
    console.log(`   Budget anno intero:   ${M(anno.risultato.totale)} € → ${raggAnno.toFixed(0)}%`);
    console.log(`   Budget a pari periodo: ${M(adOggi.risultato.totale)} € → ${raggOggi.toFixed(0)}%`);
    expect(raggOggi).toBeGreaterThan(raggAnno);
  });

  it("calcola lo scostamento per business unit a pari periodo", async () => {
    const serie = await leggiSerieBudget(2026);
    const al = snapshot.dataMassima!;
    const ord = esegui(
      { metrica: "ordinato", raggruppa: ["bu"], periodo: { dal: "2026-01-01", al }, ordina: "valore_desc" },
      snapshot
    );
    const bdg = risolviBudget(
      { metrica: "budget", raggruppa: ["bu"], periodo: { dal: "2026-01-01", al } },
      serie
    );
    const mb = new Map(bdg.risultato.righe.map((r) => [r.etichetta, r.valore]));

    console.log("\n   BU            consuntivo      budget      scost.  ragg.");
    for (const r of ord.righe) {
      const b = mb.get(r.etichetta) ?? 0;
      if (b === 0) continue;
      console.log(
        `   ${r.etichetta.padEnd(12)} ${M(r.valore).padStart(11)} ${M(b).padStart(11)} ${M(r.valore - b).padStart(11)}  ${((r.valore / b) * 100).toFixed(0)}%`
      );
    }

    const buOrd = new Set(ord.righe.map((r) => r.etichetta));
    const comuni = bdg.risultato.righe.filter((b) => buOrd.has(b.etichetta));
    expect(comuni.length).toBe(4);
  });

  it("waterfall: la somma dei contributi ricostruisce la variazione totale", () => {
    const cur = esegui({ metrica: "ordinato", raggruppa: ["bu"], periodo: { anno: 2026 } }, snapshot);
    const ap = esegui(
      { metrica: "ordinato", modificatore: "anno_precedente", raggruppa: ["bu"], periodo: { anno: 2026 } },
      snapshot
    );
    const totCur = esegui({ metrica: "ordinato", periodo: { anno: 2026 } }, snapshot);
    const totAp = esegui(
      { metrica: "ordinato", modificatore: "anno_precedente", periodo: { anno: 2026 } },
      snapshot
    );

    const mappa = new Map(ap.righe.map((r) => [r.etichetta, r.valore]));
    const chiavi = new Set([
      ...cur.righe.map((r) => r.etichetta),
      ...ap.righe.map((r) => r.etichetta),
    ]);
    const contributi = [...chiavi].map((k) => ({
      bu: k,
      delta: (cur.righe.find((x) => x.etichetta === k)?.valore ?? 0) - (mappa.get(k) ?? 0),
    }));

    const somma = contributi.reduce((s, c) => s + c.delta, 0);
    const variazione = totCur.totale - totAp.totale;
    expect(Math.abs(somma - variazione)).toBeLessThan(1);

    console.log("\n   Waterfall 2025 → 2026");
    console.log(
      `   ${M(totAp.totale)} € → ${M(totCur.totale)} €  (${variazione >= 0 ? "+" : ""}${M(variazione)} €)`
    );
    for (const c of contributi.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))) {
      console.log(`     ${c.bu.padEnd(14)} ${c.delta >= 0 ? "+" : ""}${M(c.delta)}`);
    }
  });

  it("pareto: quante voci fanno l'ottanta per cento", () => {
    const cl = esegui(
      { metrica: "ordinato", raggruppa: ["cliente"], periodo: { anno: 2026 }, ordina: "valore_desc" },
      snapshot
    );
    const totale = cl.righe.reduce((s, r) => s + r.valore, 0);
    let acc = 0;
    let n = 0;
    for (const r of cl.righe) {
      acc += r.valore;
      n++;
      if (acc / totale >= 0.8) break;
    }
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(cl.righe.length);
    console.log(
      `   Pareto clienti 2026: ${n} su ${cl.righe.length} fanno l'80% di ${M(totale)} €`
    );
  });

  it("quadranti: separa i clienti in crescita da quelli in calo", () => {
    const cur = esegui(
      { metrica: "ordinato", raggruppa: ["cliente"], periodo: { anno: 2026 } },
      snapshot
    );
    const ap = esegui(
      { metrica: "ordinato", modificatore: "anno_precedente", raggruppa: ["cliente"], periodo: { anno: 2026 } },
      snapshot
    );
    const mappa = new Map(ap.righe.map((r) => [r.etichetta, r.valore]));

    const punti = cur.righe
      .map((r) => {
        const prec = mappa.get(r.etichetta) ?? 0;
        if (prec < 5000) return null;
        return { nome: r.etichetta, x: prec, y: ((r.valore - prec) / prec) * 100 };
      })
      .filter(Boolean) as { nome: string; x: number; y: number }[];

    expect(punti.length).toBeGreaterThan(5);
    const inCalo = punti.filter((p) => p.y < 0);
    const inCrescita = punti.filter((p) => p.y >= 0);
    console.log(
      `   Quadranti: ${punti.length} clienti sopra 5.000 € · ${inCrescita.length} in crescita · ${inCalo.length} in calo`
    );
    const peggiori = [...inCalo].sort((a, b) => a.x * a.y - b.x * b.y).slice(0, 3);
    for (const p of peggiori) {
      console.log(`     grande in calo: ${p.nome} — ${M(p.x)} € nel 2025, ${p.y.toFixed(0)}%`);
    }
  });
});
