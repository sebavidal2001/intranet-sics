/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Verifica dal vivo del ciclo con strumenti: chiama davvero OpenRouter.
 *
 * NON fa parte della suite automatica — l'estensione è `.ts` e non
 * `.test.ts` — perché ogni esecuzione costa circa 7 centesimi di dollaro e
 * non ha senso pagarla a ogni `npm test`. Si lancia a mano quando si tocca
 * l'analista:
 *
 *   npx vitest run --config vitest.config.ts prototipo-bi/manuale-analista-dal-vivo.ts
 *
 * Ultima esecuzione (04/09/2026), tutto verde:
 *   domanda semplice  → Haiku 4.5,  1 interrogazione, 0,91 centesimi
 *   previsione        → Sonnet 4.5, strumento deterministico, 3,25 centesimi
 *   documento Excel   → 2 tabelle, 3,16 centesimi
 */
import { describe, expect, it, beforeAll } from "vitest";
import { chiediAnalista } from "@/lib/prototipo-bi/analista";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";
import { caricaEnvLocale } from "./_env";

describe("Analista dal vivo", () => {
  let snapshot: Snapshot;
  beforeAll(async () => {
    caricaEnvLocale();
    snapshot = await costruisciSnapshot();
  }, 240_000);

  it("risponde a una domanda semplice usando gli strumenti", async () => {
    const r = await chiediAnalista({
      domanda: "Quanto abbiamo fatturato nel 2026 finora?",
      snapshot,
    });
    expect(r.motore).toBe("openrouter");
    expect(r.interrogazioni.length).toBeGreaterThan(0);
    expect(r.testo.length).toBeGreaterThan(20);
    console.log(`\n   [${r.modello} · ${r.complessita}] ${r.interrogazioni.length} interrogazioni · ${((r.consumo?.costoUsd ?? 0) * 100).toFixed(2)} centesimi`);
    console.log("   " + r.testo.split("\n").slice(0, 6).join("\n   "));
  }, 180_000);

  it("usa lo strumento di previsione invece di stimare a occhio", async () => {
    const r = await chiediAnalista({
      domanda: "A che importo pensi che chiuderemo l'ordinato 2026?",
      snapshot,
    });
    expect(r.complessita).toBe("profonda");
    expect(r.previsioni.length).toBeGreaterThan(0);
    const p = r.previsioni[0];
    expect(p.stimaCentrale).toBeGreaterThan(0);
    console.log(`\n   [${r.modello}] previsione ${Math.round(p.stimaCentrale).toLocaleString("it-IT")} € · ${((r.consumo?.costoUsd ?? 0) * 100).toFixed(2)} centesimi`);
    console.log("   " + r.testo.split("\n").slice(0, 8).join("\n   "));
  }, 240_000);

  it("prepara un documento quando lo si chiede", async () => {
    const r = await chiediAnalista({
      domanda: "Preparami un report Excel con l'ordinato per business unit e per agente del 2026.",
      snapshot,
    });
    expect(r.documenti.length).toBeGreaterThan(0);
    expect(r.documenti[0].blocchi.length).toBeGreaterThan(0);
    console.log(`\n   Documento: ${r.documenti[0].formato} "${r.documenti[0].titolo}" con ${r.documenti[0].blocchi.length} tabelle · ${((r.consumo?.costoUsd ?? 0) * 100).toFixed(2)} centesimi`);
  }, 240_000);
});
