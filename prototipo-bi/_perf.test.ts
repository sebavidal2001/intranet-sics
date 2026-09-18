import { describe, it } from "vitest";
import { esegui } from "@/lib/prototipo-bi/semantico";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import type { Snapshot, SpecQuery } from "@/lib/prototipo-bi/tipi";
import { caricaEnvLocale } from "./_env";

describe("Profilo prestazioni", () => {
  it("misura dove va il tempo", async () => {
    caricaEnvLocale();

    const t0 = performance.now();
    const snapshot: Snapshot = await costruisciSnapshot();
    const tSnapshot = performance.now() - t0;

    const righe = Object.values(snapshot.dataset).reduce((s, r) => s + r.length, 0);
    console.log(`   Snapshot: ${tSnapshot.toFixed(0)} ms per ${righe.toLocaleString("it-IT")} righe`);

    const specs: SpecQuery[] = [
      { metrica: "ordinato", periodo: { anno: 2026 } },
      { metrica: "ordinato", modificatore: "anno_precedente", periodo: { anno: 2026 } },
      { metrica: "ordinato", raggruppa: ["bu"], periodo: { anno: 2026 } },
      { metrica: "ordinato", raggruppa: ["cliente"], periodo: { anno: 2026 } },
      { metrica: "ordinato", granularita: "mese", raggruppa: ["bu"], periodo: { anno: 2026 } },
      { metrica: "fatturato", periodo: { anno: 2026 } },
      { metrica: "n_ordini", periodo: { anno: 2026 } },
      { metrica: "tasso_conversione", raggruppa: ["creatore"] },
      { metrica: "righe_preventivo", granularita: "giorno" },
      { metrica: "giorni_apertura", raggruppa: ["bu"] },
    ];

    const t1 = performance.now();
    for (const s of specs) esegui(s, snapshot);
    const tSpecs = performance.now() - t1;
    console.log(`   ${specs.length} spec: ${tSpecs.toFixed(0)} ms (${(tSpecs / specs.length).toFixed(1)} ms cadauna)`);

    const t2 = performance.now();
    for (let i = 0; i < 5; i++) for (const s of specs) esegui(s, snapshot);
    console.log(`   ripetute 5 volte: ${(performance.now() - t2).toFixed(0)} ms`);

    const json = JSON.stringify(snapshot);
    console.log(`   snapshot serializzato: ${(json.length / 1024 / 1024).toFixed(1)} MB`);
    const t3 = performance.now();
    JSON.parse(json);
    console.log(`   parse del file cache: ${(performance.now() - t3).toFixed(0)} ms`);
  }, 240_000);
});
