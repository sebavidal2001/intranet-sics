/**
 * Il margine storico, dalla catena vera.
 *
 * Costruisce lo snapshot leggendo il database — viste `bi_*` e storico costi —
 * e verifica che il margine 2025 dia lo STESSO numero misurato direttamente sul
 * gestionale via dbisql: **35,40 %** su 3.666.902 EUR coperti.
 *
 * Perché questo test esiste e gli altri non bastano
 * -------------------------------------------------
 * Gli unit test dimostrano che la risoluzione point-in-time è corretta *date
 * le voci giuste*. Qui si dimostra che le voci arrivano davvero: vista esposta,
 * codici articolo che agganciano, date che si confrontano, segno delle note di
 * credito. Ognuno di quei passaggi può rompersi in silenzio — una vista su
 * schema non esposto torna vuota SENZA errore, e il margine diventerebbe
 * semplicemente assente.
 *
 * Legge dal database, quindi sta fra i file di `LEGGONO_DAL_DATABASE` in
 * vitest.config.ts (sequenziali). Prima connessione dopo una pausa o una VPN
 * riagganciata: serve `--testTimeout=120000`.
 *
 *   npx vitest run prototipo-bi/costo-storico-dal-database.test.ts --testTimeout=180000
 */
import { describe, expect, it, beforeAll } from "vitest";
import { caricaEnvLocale } from "./_env";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import { esegui, validaSpec } from "@/lib/prototipo-bi/semantico";
import type { Snapshot } from "@/lib/prototipo-bi/tipi";

// Misurati sul gestionale il 17/09/2026 (docs/bi/REFERTO-costo-alla-vendita-20260917.md).
//
// La copertura attesa è 97,0 e non il 97,9 misurato con dbisql, e la
// differenza è voluta: la query sul gestionale rapportava valori NETTI, la
// metrica ora usa i valori ASSOLUTI. Col netto una copertura poteva superare
// il 100% (business unit STRUTTURE, 2026: 100,2%), perché le righe senza costo
// erano note di credito e abbassavano il denominatore più del numeratore.
// Il margine non cambia: la copertura non entra nel suo calcolo.
const ATTESO_2025 = { margineP: 35.4, coperturaP: 97.0, valore: 3_744_126.35 };

const P_2025 = { dal: "2025-01-01", al: "2025-12-31" };

let snapshot: Snapshot;
let msCostruzione = 0;

beforeAll(async () => {
  caricaEnvLocale();
  const t0 = Date.now();
  snapshot = await costruisciSnapshot();
  msCostruzione = Date.now() - t0;
}, 240_000);

describe("margine al costo storico, dal database", () => {
  it("ha caricato lo storico e NON ha ripiegato sull'ultimo costo noto", () => {
    // Se questo fallisce il margine esiste ancora, ma significa un'altra cosa:
    // è il caso che deve essere rumoroso invece che silenzioso.
    expect(snapshot.costiApprossimati).toBe(false);
  });

  it("aggancia un costo alla grande maggioranza del fatturato", () => {
    const copertura = esegui(
      validaSpec({ metrica: "copertura_costi_pct", periodo: P_2025 }),
      snapshot,
    );
    expect(copertura.totale).toBeGreaterThan(95);
    expect(copertura.totale).toBeCloseTo(ATTESO_2025.coperturaP, 0);
  });

  it("dà sul 2025 lo stesso margine misurato sul gestionale", () => {
    const fatturato = esegui(validaSpec({ metrica: "fatturato", periodo: P_2025 }), snapshot);
    const margine = esegui(validaSpec({ metrica: "margine_pct", periodo: P_2025 }), snapshot);

    // Il fatturato deve combaciare al centesimo: se non combacia, il confronto
    // sul margine non vuole dire niente.
    expect(fatturato.totale).toBeCloseTo(ATTESO_2025.valore, 1);

    // Una decimale: lo scarto misurato contro il gestionale è di 334 EUR su
    // 2,37 milioni di costo, cioè lo 0,014%.
    expect(margine.totale).toBeCloseTo(ATTESO_2025.margineP, 1);
  });

  it("usa costi DIVERSI per lo stesso articolo in anni diversi", () => {
    // È la prova che il costo segue la data e non è una costante travestita:
    // senza, tutti i test sopra passerebbero anche con l'ultimo costo noto.
    const perArticolo = new Map<string, Set<number>>();
    for (const r of snapshot.dataset.fatturato) {
      if (!r.articolo || r.costoUnitario == null) continue;
      const s = perArticolo.get(r.articolo) ?? new Set<number>();
      s.add(r.costoUnitario);
      perArticolo.set(r.articolo, s);
    }
    const conPiuCosti = [...perArticolo.values()].filter((s) => s.size > 1).length;
    expect(conPiuCosti).toBeGreaterThan(50);
  });

  it("la data del costo non è mai successiva alla vendita", () => {
    // Il difetto originale in una riga sola: col vecchio metodo il 32,5% del
    // valore aveva un costo datato DOPO la vendita.
    const posteriori = snapshot.dataset.fatturato.filter(
      (r) => r.dataCosto && r.dataCosto > r.data,
    );
    expect(posteriori).toHaveLength(0);
  });

  it("costruisce lo snapshot in un tempo accettabile", () => {
    // Prima dello storico costi: ~4,4 s. Si aggiungono ~83 pagine PostgREST.
    // La soglia è larga perché la prima connessione dopo una pausa è lenta:
    // serve a cogliere un ordine di grandezza sbagliato, non un rallentamento.
    console.log(
      `  snapshot: ${msCostruzione} ms · ` +
        `heap ${Math.round(process.memoryUsage().heapUsed / 1e6)} MB · ` +
        `righe fatturato ${snapshot.dataset.fatturato.length}`,
    );
    expect(msCostruzione).toBeLessThan(60_000);
  });
});
