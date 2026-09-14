/**
 * LA TENDENZA DELLA SPARKLINE, E IL CLIC CHE SCENDE AI DOCUMENTI.
 *
 * Due difetti trovati guardando il Cruscotto con dati veri.
 *
 * Il primo: il colore della sparkline veniva da `ultimo − primo`, cioè dai soli
 * due estremi. Nella tabella dei clienti un'azienda a −73,7% sull'anno era
 * verde e una a +1323% era rossa — due colonne accanto, colorate con criteri
 * diversi, senza che da nessuna parte fosse scritto. E l'ultimo punto è il mese
 * in corso, che lo snapshot tronca al giorno del caricamento: un terzo di mese
 * confrontato con mesi interi tinge di rosso anche chi cresce.
 *
 * Il secondo: il pannello dei documenti esisteva già ma era agganciato alle
 * sole schede Conversione e Back office. Nei riquadri costruiti dagli utenti il
 * clic non faceva niente.
 */

import { describe, expect, it } from "vitest";
import { pendenza } from "@/components/prototipo-bi/grafici-avanzati";
import { DATASET_DI_METRICA } from "@/lib/prototipo-bi/gruppi-campi";
import { CATALOGO } from "@/lib/prototipo-bi/semantico";
import { DATASET_DETTAGLIO } from "@/lib/prototipo-bi/dettaglio";

describe("La tendenza di una serie", () => {
  it("sale quando la serie sale", () => {
    expect(pendenza([10, 20, 30, 40])).toBeGreaterThan(0);
  });

  it("scende quando la serie scende", () => {
    expect(pendenza([40, 30, 20, 10])).toBeLessThan(0);
  });

  it("guarda tutti i punti, non solo il primo e l'ultimo", () => {
    // Gennaio eccezionale e poi crescita costante: con il confronto fra estremi
    // questo cliente risultava in calo, e invece sta salendo da undici mesi.
    const conPiccoIniziale = [100, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95];
    expect(pendenza(conPiccoIniziale)).toBeGreaterThan(0);
    expect(conPiccoIniziale[conPiccoIniziale.length - 1] - conPiccoIniziale[0]).toBeLessThan(0);
  });

  it("scarta l'ultimo punto quando il periodo non è concluso", () => {
    // Undici mesi piatti piu' un mese in corso troncato a un terzo: senza
    // scartarlo la tendenza risulta negativa per tutti, ogni mese.
    const conMeseInCorso = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 33];
    expect(pendenza(conMeseInCorso, false)).toBeLessThan(0);
    expect(pendenza(conMeseInCorso, true)).toBe(0);
  });

  it("con due punti soli non scarta niente, altrimenti non resterebbe nulla", () => {
    expect(pendenza([10, 20], true)).toBeGreaterThan(0);
  });

  it("una serie piatta non è né in crescita né in calo", () => {
    expect(pendenza([50, 50, 50, 50])).toBe(0);
  });
});

describe("La mappa metrica → dataset resta allineata alla fonte", () => {
  it("ogni voce dice il dataset che il catalogo dichiara", () => {
    // È una copia, tenuta lato client perché il componente gira nel browser.
    // Questo test è la ragione per cui la copia si può permettere di esistere.
    for (const [metrica, dataset] of Object.entries(DATASET_DI_METRICA)) {
      expect(CATALOGO[metrica as keyof typeof CATALOGO], `metrica sconosciuta: ${metrica}`).toBeDefined();
      expect(CATALOGO[metrica as keyof typeof CATALOGO].dataset, `dataset di ${metrica}`).toBe(dataset);
    }
  });

  it("copre tutte le metriche che hanno documenti dietro", () => {
    const attese = Object.values(CATALOGO)
      .filter((voce) => (DATASET_DETTAGLIO as string[]).includes(voce.dataset))
      .map((voce) => voce.chiave)
      // Budget e BEP vivono sul dataset dell'ordinato ma non nascono da
      // documenti: un drill-down li' aprirebbe una lista vuota.
      .filter((chiave) => chiave !== "budget" && chiave !== "bep");

    const mancanti = attese.filter((chiave) => !(chiave in DATASET_DI_METRICA));
    expect(mancanti, `metriche senza dataset dichiarato: ${mancanti.join(", ")}`).toEqual([]);
  });

  it("non promette documenti dove non ce ne sono", () => {
    for (const dataset of Object.values(DATASET_DI_METRICA)) {
      expect(DATASET_DETTAGLIO as string[]).toContain(dataset);
    }
  });
});
