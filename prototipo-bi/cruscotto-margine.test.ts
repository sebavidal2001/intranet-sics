/**
 * La pagina Margine del Cruscotto produce numeri, non riquadri vuoti.
 *
 * `cruscotto-predefinito.test.ts` dimostra che le spec sono SINTATTICAMENTE
 * valide. Non è la stessa cosa: una spec valida può restituire zero righe —
 * un raggruppamento che il dataset non porta, un limite che taglia tutto, una
 * metrica di rapporto il cui denominatore resta a zero. In quel caso il
 * pannello si disegna lo stesso, vuoto, e nessuno se ne accorge finché
 * qualcuno non lo guarda aspettandosi un numero.
 *
 * Qui ogni riquadro della pagina viene eseguito contro lo snapshot vero.
 *
 *   npx vitest run prototipo-bi/cruscotto-margine.test.ts --testTimeout=240000
 */
import { describe, expect, it, beforeAll } from "vitest";
import { caricaEnvLocale } from "./_env";
import { CRUSCOTTO_PREDEFINITO } from "@/lib/prototipo-bi/cruscotto-predefinito";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import { esegui, validaSpec } from "@/lib/prototipo-bi/semantico";
import type { Snapshot, SpecQuery } from "@/lib/prototipo-bi/tipi";

const PAGINA = CRUSCOTTO_PREDEFINITO.find((p) => p.chiave === "margine");

let snapshot: Snapshot;

// Periodo esplicito: nel Cruscotto lo eredita la pagina, e senza di esso il
// test misurerebbe l'intera storia invece dell'anno che l'utente vede.
const anno = new Date().getFullYear();
const periodo = { dal: `${anno}-01-01`, al: `${anno}-12-31` };

function conPeriodo(spec: SpecQuery): SpecQuery {
  return validaSpec({ ...spec, periodo });
}

beforeAll(async () => {
  caricaEnvLocale();
  snapshot = await costruisciSnapshot();
}, 240_000);

describe("Cruscotto — pagina Margine", () => {
  it("la pagina esiste ed è in coda alle sei storiche", () => {
    expect(PAGINA).toBeDefined();
    expect(PAGINA!.ordine).toBe(6);
    expect(PAGINA!.analisi.length).toBeGreaterThanOrEqual(6);
  });

  it("ogni riquadro restituisce almeno una riga", () => {
    const vuoti: string[] = [];
    for (const analisi of PAGINA!.analisi) {
      const esito = esegui(conPeriodo(analisi.spec), snapshot);
      if (esito.righe.length === 0) vuoti.push(analisi.chiave);
      for (const serie of analisi.serie ?? []) {
        const esitoSerie = esegui(conPeriodo(serie.spec), snapshot);
        if (esitoSerie.righe.length === 0) vuoti.push(`${analisi.chiave} · ${serie.nome}`);
      }
    }
    expect(vuoti, `riquadri senza dati: ${vuoti.join(", ")}`).toEqual([]);
  });

  it("le percentuali stanno in un intervallo che ha senso", () => {
    // Un margine percentuale sopra 100 significa costo negativo; sotto -100,
    // che il costo vale più del doppio del ricavo. Entrambi indicano un difetto
    // nel calcolo, non un fatto commerciale.
    for (const chiave of ["margine.pct-per-bu", "margine.pct-per-categoria"]) {
      const analisi = PAGINA!.analisi.find((a) => a.chiave === chiave)!;
      const esito = esegui(conPeriodo(analisi.spec), snapshot);
      for (const riga of esito.righe) {
        expect(riga.valore, `${chiave} · ${riga.etichetta}`).toBeLessThanOrEqual(100);
        expect(riga.valore, `${chiave} · ${riga.etichetta}`).toBeGreaterThan(-100);
      }
    }
  });

  it("il margine totale è coerente con fatturato meno costo del venduto", () => {
    const fatturato = esegui(validaSpec({ metrica: "fatturato", periodo }), snapshot);
    const costo = esegui(validaSpec({ metrica: "costo_venduto", periodo }), snapshot);
    const margine = esegui(validaSpec({ metrica: "margine", periodo }), snapshot);

    // Non `fatturato - costo`: il margine esclude le righe senza costo, il
    // fatturato no. La differenza è esattamente il valore scoperto, quindi il
    // margine deve stare SOTTO quella soglia e sopra zero.
    expect(margine.totale).toBeGreaterThan(0);
    expect(margine.totale).toBeLessThan(fatturato.totale - costo.totale + 1);
  });

  it("la copertura è alta abbastanza da rendere leggibile il margine", () => {
    const copertura = esegui(validaSpec({ metrica: "copertura_costi_pct", periodo }), snapshot);
    expect(copertura.totale).toBeGreaterThan(90);
  });

  it("nessuna copertura supera il 100%, su nessun raggruppamento", () => {
    // Col rapporto sui valori NETTI poteva succedere: se le righe senza costo
    // sono note di credito, il denominatore scende più del numeratore.
    // Misurato sul 2026, business unit STRUTTURE: 100,2%. Una copertura sopra
    // il 100% è assurda, e chi legge smette di fidarsi dell'intera pagina.
    for (const dimensione of ["bu", "categoria", "agente"] as const) {
      const esito = esegui(
        validaSpec({ metrica: "copertura_costi_pct", raggruppa: [dimensione], periodo }),
        snapshot,
      );
      for (const riga of esito.righe) {
        expect(riga.valore, `${dimensione} · ${riga.etichetta}`).toBeLessThanOrEqual(100);
        expect(riga.valore, `${dimensione} · ${riga.etichetta}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("ogni riquadro dichiara la natura del costo negli avvisi", () => {
    // È la regola che tiene onesto il numero: chi guarda deve sapere che è un
    // costo di ricostituzione e su quanta parte del fatturato è calcolato.
    for (const analisi of PAGINA!.analisi) {
      if (!analisi.spec.metrica.startsWith("margine") && analisi.spec.metrica !== "costo_venduto") {
        continue;
      }
      const avvisi = (esegui(conPeriodo(analisi.spec), snapshot).avvisi ?? []).join(" ");
      expect(avvisi, analisi.chiave).toMatch(/giorno della vendita|ULTIMO costo noto/i);
    }
  });
});
