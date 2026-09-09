import { describe, it, expect } from "vitest";
import {
  calcolaCostoAtteso,
  calcolaNolo,
  classifica,
  pesoTassabile,
  pesoVolumetrico,
  scostamento,
  trovaFascia,
} from "@/lib/portali/vettori/calcolo";
import type {
  DatiSpedizione,
  Fascia,
  ListinoRisolto,
  Supplemento,
  Vettore,
} from "@/lib/portali/vettori/tipi";

/**
 * I numeri di questo file NON sono inventati: vengono dalle fatture reali di
 * luglio e agosto 2026 dei quattro vettori. Se un giorno un test fallisce, la
 * prima domanda da farsi è se è cambiato il contratto, non se è sbagliato il
 * test — e in quel caso si cambia il listino, non l'asserzione.
 *
 * Fonti:
 *   FT GLS 07.26          — totali di piede, adeguamento ISTAT, carburante
 *   FT TNT 07.26          — righe spedizione con nolo e carburante
 *   TP1260_002218_07.26   — righe spedizione con nolo e addizionale
 *   Listini prezzi FedEx  — fasce zona 1 valide dal 27/02/2026
 */

// ---------------------------------------------------------------------------
// Fixture dei listini, allineate alla migration 088
// ---------------------------------------------------------------------------

function vettore(p: Partial<Vettore>): Vettore {
  return {
    id: "x", codice: "x", nome: "X", modelloTariffa: "scaglioni",
    divisoreVolumetrico: 300, pesoMinimoTassabile: 0,
    arrotondamentoKg: 0, arrotondamentoDaKg: 0, ...p,
  };
}

function fascia(pesoDa: number, pesoA: number | null, importo: number,
                extra: Partial<Fascia> = {}): Fascia {
  return { pesoDa, pesoA, importo, tipo: "fisso", scattoKg: null, scattoImporto: null, ...extra };
}

function suppl(p: Partial<Supplemento> & Pick<Supplemento, "codice" | "tipoCalcolo" | "valore">): Supplemento {
  return {
    nome: p.codice, baseNolo: true, condizione: "sempre",
    importoMinimo: null, importoMassimo: null, sogliaKgDa: null, sogliaKgA: null, ...p,
  };
}

const GLS: ListinoRisolto = {
  vettore: vettore({ codice: "gls", nome: "GLS", divisoreVolumetrico: 300 }),
  zonaCodice: "IT",
  fasce: [
    fascia(0, 3, 8.04), fascia(3, 5, 8.68), fascia(5, 10, 9.63),
    fascia(10, 20, 12.0), fascia(20, 30, 15.24), fascia(30, 50, 23.91),
    fascia(50, 100, 36.91),
    fascia(100, null, 36.91, { scattoKg: 50, scattoImporto: 18.1 }),
  ],
  supplementi: [
    suppl({ codice: "handling", tipoCalcolo: "per_kg", valore: 0.03 }),
    suppl({ codice: "autostrade", tipoCalcolo: "fisso_spedizione", valore: 0.2 }),
    suppl({ codice: "safety_energy", tipoCalcolo: "fisso_spedizione", valore: 0.2 }),
    suppl({ codice: "assicurazione", tipoCalcolo: "fisso_spedizione", valore: 0.5,
            baseNolo: false, sogliaKgDa: 10.001 }),
    suppl({ codice: "oversized", tipoCalcolo: "per_collo", valore: 9.0, condizione: "oversized" }),
  ],
  adeguamento: 0.0721,
  carburante: 0.13,
};

const TNT: ListinoRisolto = {
  vettore: vettore({ codice: "tnt", nome: "TNT", divisoreVolumetrico: 250 }),
  zonaCodice: "IT",
  fasce: [
    fascia(0, 1, 6.18), fascia(1, 3, 7.22), fascia(3, 5, 8.0),
    fascia(5, 10, 8.92), fascia(10, 20, 10.12), fascia(20, 30, 11.33),
    fascia(30, 40, 13.38), fascia(40, 50, 15.37), fascia(50, 70, 20.09),
    fascia(70, 100, 28.31),
    fascia(100, null, 28.31, { scattoKg: 50, scattoImporto: 16.06 }),
  ],
  supplementi: [
    suppl({ codice: "non_sovrapp", tipoCalcolo: "fisso_spedizione", valore: 30,
            baseNolo: false, condizione: "non_sovrapponibile" }),
  ],
  adeguamento: null,
  carburante: 0.243,
};

const TRADING_POST: ListinoRisolto = {
  vettore: vettore({
    codice: "trading_post", nome: "Trading Post", divisoreVolumetrico: 300,
    pesoMinimoTassabile: 3, arrotondamentoKg: 100, arrotondamentoDaKg: 100,
  }),
  zonaCodice: "ER_LOM_PIE",
  fasce: [
    fascia(0, 3, 8.9), fascia(3, 5, 9.2), fascia(5, 10, 9.5),
    fascia(10, 20, 9.9), fascia(20, 30, 11.5), fascia(30, 40, 12.9),
    fascia(40, 50, 16.3), fascia(50, 100, 22.5),
    fascia(100, null, 22.5, { tipo: "quintale" }),
  ],
  supplementi: [
    suppl({ codice: "addizionale_gestione", tipoCalcolo: "percentuale_nolo",
            valore: 0.11, baseNolo: false }),
  ],
  adeguamento: null,
  carburante: null,
};

function sped(p: Partial<DatiSpedizione>): DatiSpedizione {
  return { colli: 1, pesoReale: 0, ...p };
}

// ---------------------------------------------------------------------------

describe("peso volumetrico — il divisore è del vettore, non una costante", () => {
  // Fattura TNT 07/2026: colonna volume 0,005 mc → peso volumetrico 1,25 kg.
  it.each([
    [0.005, 1.25], [0.049, 12.25], [0.166, 41.5], [0.259, 64.75], [0.082, 20.5],
  ])("TNT: %s mc valgono %s kg a 250 kg/mc", (mc, kg) => {
    expect(pesoVolumetrico(sped({ volumeMc: mc }), 250)).toBeCloseTo(kg, 2);
  });

  it("GLS usa 300 kg/mc, e sullo stesso volume il peso cambia del 20%", () => {
    expect(pesoVolumetrico(sped({ volumeMc: 0.1 }), 300)).toBeCloseTo(30, 2);
    expect(pesoVolumetrico(sped({ volumeMc: 0.1 }), 250)).toBeCloseTo(25, 2);
  });

  it("dalle tre misure in centimetri, come le rileva il magazzino", () => {
    // 120 x 80 x 100 cm = 0,96 mc
    expect(
      pesoVolumetrico(sped({ lunghezzaCm: 120, larghezzaCm: 80, altezzaCm: 100 }), 300)
    ).toBeCloseTo(288, 2);
  });

  it("senza volume né misure vale zero, e il chiamante lo saprà", () => {
    expect(pesoVolumetrico(sped({ pesoReale: 10 }), 300)).toBe(0);
  });
});

describe("peso tassabile", () => {
  it("vince il volumetrico quando è maggiore, e il motore dice quale", () => {
    const r = pesoTassabile(sped({ pesoReale: 5, volumeMc: 0.03 }), 300);
    expect(r.peso).toBeCloseTo(9, 3);
    expect(r.applicato).toBe("volumetrico");
  });

  it("vince il reale quando è maggiore", () => {
    const r = pesoTassabile(sped({ pesoReale: 20, volumeMc: 0.03 }), 300);
    expect(r.peso).toBe(20);
    expect(r.applicato).toBe("reale");
  });

  // Fattura Trading Post: una spedizione da 1,0 kg risulta tassata 3.
  it("Trading Post ha un minimo tassabile di 3 kg", () => {
    const r = pesoTassabile(sped({ pesoReale: 1 }), 300, 3, 100, 100);
    expect(r.peso).toBe(3);
    expect(r.applicato).toBe("minimo");
  });

  // Fattura Trading Post: 170,0 kg → quantità 200. E 0,576 mc (172,8 kg) → 200.
  it("Trading Post arrotonda ai 100 kg sopra il quintale", () => {
    expect(pesoTassabile(sped({ pesoReale: 170 }), 300, 3, 100, 100).peso).toBe(200);
    expect(pesoTassabile(sped({ pesoReale: 172.8 }), 300, 3, 100, 100).peso).toBe(200);
  });

  // Questo è l'errore che l'arrotondamento senza soglia farebbe fare.
  it("ma sotto il quintale NON arrotonda: 57 kg restano 57", () => {
    expect(pesoTassabile(sped({ pesoReale: 57 }), 300, 3, 100, 100).peso).toBe(57);
    expect(pesoTassabile(sped({ pesoReale: 5 }), 300, 3, 100, 100).peso).toBe(5);
  });
});

describe("fasce di peso — le soglie sono inclusive in alto", () => {
  it("3,00 kg esatti stanno ancora nella prima fascia GLS", () => {
    expect(trovaFascia(GLS.fasce, 3)!.importo).toBe(8.04);
    expect(trovaFascia(GLS.fasce, 3.01)!.importo).toBe(8.68);
  });

  // Fattura TNT 07/2026: peso tassato 3,95 kg, nolo addebitato 8,00 €.
  // È il caso in cui le soglie TNT divergono da quelle FedEx: sul listino
  // FedEx 3,95 kg cadrebbe in 1,5-4 e costerebbe 7,22.
  it("TNT: 3,95 kg costano 8,00 come in fattura", () => {
    expect(trovaFascia(TNT.fasce, 3.95)!.importo).toBe(8.0);
  });

  it.each([
    [1.0, 6.18], [1.25, 7.22], [4.25, 8.0], [12.25, 10.12], [26.1, 11.33], [41.5, 15.37],
  ])("TNT: %s kg → nolo %s €", (peso, nolo) => {
    expect(trovaFascia(TNT.fasce, peso)!.importo).toBe(nolo);
  });
});

describe("nolo — scatti oltre il quintale e tariffa al quintale", () => {
  // Il foglio TNT elenca 100,1-150 → 44,37, che è 28,31 + 16,06.
  it.each([
    [150, 44.37], [200, 60.43], [250, 76.49],
  ])("TNT: %s kg → %s €", (peso, atteso) => {
    const f = trovaFascia(TNT.fasce, peso)!;
    expect(calcolaNolo(f, peso)).toBeCloseTo(atteso, 2);
  });

  it("GLS: 150 kg valgono 36,91 più uno scatto da 18,10", () => {
    const f = trovaFascia(GLS.fasce, 150)!;
    expect(calcolaNolo(f, 150)).toBeCloseTo(55.01, 2);
  });

  it("lo scatto è intero: 101 kg pagano già lo scatto pieno", () => {
    const f = trovaFascia(GLS.fasce, 101)!;
    expect(calcolaNolo(f, 101)).toBeCloseTo(55.01, 2);
  });

  // Fattura Trading Post: 200 kg tassabili, tariffa 22,50, nolo 45,00.
  it("Trading Post oltre il quintale va al quintale: 200 kg → 45,00", () => {
    const f = trovaFascia(TRADING_POST.fasce, 200)!;
    expect(calcolaNolo(f, 200)).toBeCloseTo(45.0, 2);
  });
});

describe("Trading Post — l'addizionale è l'11%, non il 6%", () => {
  // Verificato su 67 righe di fattura di luglio e agosto 2026: il rapporto fra
  // la seconda colonna e il nolo è 11,0% esatto su tutte, mai una eccezione.
  // Il foglio degli arrivi usa il 6% e sottostima ogni spedizione del 4,7%.
  it.each([
    [1, 8.9, 0.98, 9.88],
    [4, 9.2, 1.01, 10.21],
    [7, 9.5, 1.05, 10.55],
    [13, 9.9, 1.09, 10.99],
    [26, 11.5, 1.27, 12.77],
    [57, 22.5, 2.48, 24.98],
  ])("%s kg: nolo %s + addizionale %s = %s", (peso, nolo, addiz, totale) => {
    const r = calcolaCostoAtteso(sped({ pesoReale: peso }), TRADING_POST);
    expect(r.nolo).toBeCloseTo(nolo, 2);
    expect(r.fuoriBase).toBeCloseTo(addiz, 2);
    expect(r.totale).toBeCloseTo(totale, 2);
  });

  it("il vecchio modello al 6% sottostima di quasi il 5% ogni spedizione", () => {
    const conUndici = calcolaCostoAtteso(sped({ pesoReale: 1 }), TRADING_POST);
    const conSei = calcolaCostoAtteso(sped({ pesoReale: 1 }), {
      ...TRADING_POST,
      supplementi: [
        suppl({ codice: "addizionale_gestione", tipoCalcolo: "percentuale_nolo",
                valore: 0.06, baseNolo: false }),
      ],
    });
    expect(conSei.totale).toBeCloseTo(9.43, 2);
    expect(conUndici.totale).toBeCloseTo(9.88, 2);
    // 4,8% su ogni singola spedizione Trading Post in arrivo.
    expect(scostamento(conUndici.totale, conSei.totale)!).toBeCloseTo(0.048, 3);
  });
});

describe("TNT — carburante al 24,3% sul nolo", () => {
  // Righe reali della fattura di luglio 2026.
  it.each([
    [6.18, 1.5], [8.0, 1.94], [10.12, 2.46], [11.33, 2.75], [15.37, 3.73], [20.09, 4.88],
  ])("nolo %s → carburante %s", (nolo, carb) => {
    expect(Math.round((nolo * 0.243 + Number.EPSILON) * 100) / 100).toBeCloseTo(carb, 2);
  });

  it("una spedizione da 4,25 kg tassabili: 8,00 di nolo e 9,94 di totale", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 2, volumeMc: 0.017 }), TNT);
    expect(r.pesoTassabile).toBeCloseTo(4.25, 2);
    expect(r.pesoApplicato).toBe("volumetrico");
    expect(r.nolo).toBeCloseTo(8.0, 2);
    expect(r.carburante).toBeCloseTo(1.94, 2);
    expect(r.totale).toBeCloseTo(9.94, 2);
  });

  it("la merce non sovrapponibile aggiunge 30 € e non entra nel carburante", () => {
    const senza = calcolaCostoAtteso(sped({ pesoReale: 4.25 }), TNT);
    const con = calcolaCostoAtteso(
      sped({ pesoReale: 4.25, condizioni: ["non_sovrapponibile"] }), TNT);
    expect(con.carburante).toBeCloseTo(senza.carburante, 2);
    expect(con.totale - senza.totale).toBeCloseTo(30, 2);
  });
});

describe("GLS — l'ordine delle operazioni, verificato sui totali di fattura", () => {
  /**
   * Fattura GLS 07/2026, totali di piede:
   *   Nolo generale (comprensivo dei supplementi)  1.013,22
   *   Adeguamento ISTAT anno corrente + arretrati     73,03
   *   Totale nolo incluso adeguamento              1.086,25
   *   Carburante 13,00%                              141,21
   *   Diritti / assicurazione                         11,00
   */
  it("il carburante si calcola sul nolo GIÀ comprensivo di adeguamento", () => {
    const base = 1013.22;
    const adeguamento = 73.03;
    const carburante = Math.round((base + adeguamento) * 0.13 * 100) / 100;
    expect(carburante).toBeCloseTo(141.21, 2);
  });

  it("calcolarlo sul solo nolo darebbe 9,49 € in meno sul mese", () => {
    const sbagliato = Math.round(1013.22 * 0.13 * 100) / 100;
    expect(141.21 - sbagliato).toBeCloseTo(9.49, 2);
  });

  it("la percentuale ISTAT del listino ricostruisce l'adeguamento di fattura", () => {
    expect(1013.22 * 0.0721).toBeCloseTo(73.03, 1);
  });

  it("l'assicurazione resta fuori dalla base: sotto i 10 kg non c'è affatto", () => {
    const leggero = calcolaCostoAtteso(sped({ pesoReale: 6.6 }), GLS);
    expect(leggero.supplementi.find((s) => s.codice === "assicurazione")).toBeUndefined();

    const pesante = calcolaCostoAtteso(sped({ pesoReale: 25 }), GLS);
    const ass = pesante.supplementi.find((s) => s.codice === "assicurazione");
    expect(ass?.importo).toBeCloseTo(0.5, 2);
    // Non entra nell'imponibile su cui si calcolano adeguamento e carburante.
    expect(pesante.fuoriBase).toBeCloseTo(0.5, 2);
  });

  it("l'handling è a peso: pesa di più su un collo pesante", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 25 }), GLS);
    const h = r.supplementi.find((s) => s.codice === "handling");
    expect(h?.importo).toBeCloseTo(0.75, 2); // 25 kg x 0,03
  });

  it("l'oversized è a collo: tre colli fuori sagoma costano tre volte", () => {
    const r = calcolaCostoAtteso(
      sped({ colli: 3, pesoReale: 25, condizioni: ["oversized"] }), GLS);
    expect(r.supplementi.find((s) => s.codice === "oversized")?.importo).toBeCloseTo(27, 2);
  });

  it("una spedizione completa: le voci sommano al totale", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 25 }), GLS);
    // 15,24 nolo + 0,75 handling + 0,20 autostrade + 0,20 safety = 16,39
    expect(r.imponibileNolo).toBeCloseTo(16.39, 2);
    expect(r.adeguamento).toBeCloseTo(1.18, 2);
    expect(r.carburante).toBeCloseTo(2.28, 2);
    expect(r.fuoriBase).toBeCloseTo(0.5, 2);
    expect(r.totale).toBeCloseTo(20.35, 2);
  });
});

describe("il motore dice quello che non sa, invece di tacere", () => {
  it("senza misure avverte che il volume non è verificabile", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 10 }), GLS);
    expect(r.avvertenze.join(" ")).toContain("Peso volumetrico non calcolabile");
    expect(r.totale).toBeGreaterThan(0); // il resto si calcola lo stesso
  });

  it("senza carburante del mese lo dichiara e non lo inventa", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 10 }), { ...GLS, carburante: null });
    expect(r.carburante).toBe(0);
    expect(r.avvertenze.join(" ")).toContain("Nessuna percentuale carburante registrata");
  });

  it("con una fascia mancante non restituisce un prezzo inventato", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 10 }), { ...GLS, fasce: [] });
    expect(r.totale).toBe(0);
    expect(r.avvertenze.join(" ")).toContain("Nessuna fascia di peso");
  });
});

describe("classificazione — è qui che si decide se l'allarme ha senso", () => {
  it("uno scostamento del 3% è in linea", () => {
    expect(classifica(10.3, 10).esito).toBe("in_linea");
  });

  it("il 7% va verificato, il 15% è anomalia", () => {
    expect(classifica(10.7, 10).esito).toBe("da_verificare");
    expect(classifica(11.5, 10).esito).toBe("anomalia");
  });

  it("vale in entrambe le direzioni: pagare meno del dovuto è un'anomalia", () => {
    expect(classifica(8.5, 10).esito).toBe("anomalia");
  });

  it("atteso a zero non diventa uno scostamento del -100%", () => {
    // È il modo più rapido per riempire un cruscotto di anomalie inesistenti:
    // nei fogli attuali ci sono righe con costo previsto zero e differenza -1.
    expect(classifica(0, 0).esito).toBe("non_valutabile");
    expect(scostamento(12, 0)).toBeNull();
  });

  it("le soglie sono configurabili, perché quelle giuste dipendono dal vettore", () => {
    expect(classifica(10.7, 10, { verifica: 0.10, anomalia: 0.25 }).esito).toBe("in_linea");
  });
});
