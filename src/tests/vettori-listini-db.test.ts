import { describe, it, expect } from "vitest";
import { calcolaCostoAtteso } from "@/lib/portali/vettori/calcolo";
import type { DatiSpedizione, ListinoRisolto } from "@/lib/portali/vettori/tipi";
import listiniDalDb from "./fixtures/vettori-listini-dal-db.json";

/**
 * Collaudo di chiusura del cerchio: seed → database → motore → fattura vera.
 *
 * `fixtures/vettori-listini-dal-db.json` NON è scritto a mano. È l'estrazione
 * letterale prodotta dal database dopo aver applicato le migration 087, 088 e
 * 089 su un PostgreSQL vuoto, con la stessa forma che il servizio
 * `risolviListino` costruisce a runtime.
 *
 * L'altro file di test (`vettori-calcolo.test.ts`) verifica il motore su
 * fixture scritte a mano: dice che la matematica è giusta. Questo verifica che
 * i numeri *seminati nel database* siano gli stessi, cioè che la migration 088
 * dica davvero quello che credo dica. Sono due domande diverse, ed è per questo
 * che sono due file.
 *
 * Se un domani si cambia una tariffa nella 088 senza rigenerare questa fixture,
 * il test resta verde ma bugiardo: rigenerare la fixture fa parte del cambio.
 */

interface RigaDb {
  codice: string;
  nome: string;
  zonaCodice: string;
  divisoreVolumetrico: number;
  pesoMinimoTassabile: number;
  arrotondamentoKg: number;
  arrotondamentoDaKg: number;
  adeguamento: number | null;
  carburante: number | null;
  fasce: Array<{
    pesoDa: number;
    pesoA: number | null;
    importo: number;
    tipo: string;
    scattoKg: number | null;
    scattoImporto: number | null;
  }>;
  supplementi: Array<Record<string, unknown>>;
}

const RIGHE = listiniDalDb as unknown as RigaDb[];

function listino(codice: string, zona?: string): ListinoRisolto {
  const r = RIGHE.find(
    (x) => x.codice === codice && (zona ? x.zonaCodice === zona : true)
  );
  if (!r) throw new Error(`Listino ${codice}/${zona ?? ""} assente dalla fixture`);
  return {
    vettore: {
      id: r.codice,
      codice: r.codice,
      nome: r.nome,
      modelloTariffa: "scaglioni",
      divisoreVolumetrico: r.divisoreVolumetrico,
      pesoMinimoTassabile: r.pesoMinimoTassabile,
      arrotondamentoKg: r.arrotondamentoKg,
      arrotondamentoDaKg: r.arrotondamentoDaKg,
    },
    zonaCodice: r.zonaCodice,
    fasce: r.fasce.map((f) => ({
      pesoDa: f.pesoDa,
      pesoA: f.pesoA,
      importo: f.importo,
      tipo: f.tipo as "fisso" | "quintale",
      scattoKg: f.scattoKg,
      scattoImporto: f.scattoImporto,
    })),
    supplementi: r.supplementi as unknown as ListinoRisolto["supplementi"],
    adeguamento: r.adeguamento,
    carburante: r.carburante,
  };
}

function sped(p: Partial<DatiSpedizione>): DatiSpedizione {
  return { colli: 1, pesoReale: 0, ...p };
}

describe("il database contiene i quattro vettori con i parametri giusti", () => {
  it("sei listini, uno per zona", () => {
    expect(RIGHE).toHaveLength(6);
    expect(RIGHE.map((r) => `${r.codice}/${r.zonaCodice}`).sort()).toEqual([
      "fedex/Z1",
      "gls/CAL_SIC",
      "gls/IT",
      "gls/SARD",
      "tnt/IT",
      "trading_post/ER_LOM_PIE",
    ]);
  });

  it("i divisori volumetrici sono quelli dei contratti", () => {
    expect(listino("gls", "IT").vettore.divisoreVolumetrico).toBe(300);
    expect(listino("trading_post").vettore.divisoreVolumetrico).toBe(300);
    expect(listino("tnt").vettore.divisoreVolumetrico).toBe(250);
    expect(listino("fedex").vettore.divisoreVolumetrico).toBe(250);
  });

  it("solo GLS ha l'adeguamento ISTAT", () => {
    expect(listino("gls", "IT").adeguamento).toBeCloseTo(0.0721, 5);
    expect(listino("tnt").adeguamento).toBeNull();
    expect(listino("fedex").adeguamento).toBeNull();
    expect(listino("trading_post").adeguamento).toBeNull();
  });

  it("Trading Post non ha carburante: il suo 11% è una voce di listino", () => {
    expect(listino("trading_post").carburante).toBeNull();
    const addiz = listino("trading_post").supplementi.find(
      (s) => s.codice === "addizionale_gestione"
    );
    expect(addiz?.valore).toBeCloseTo(0.11, 4);
    expect(addiz?.tipoCalcolo).toBe("percentuale_nolo");
  });
});

describe("con i listini del database, i conti tornano con le fatture vere", () => {
  // Fattura Trading Post 07.26 — righe reali, nolo e addizionale.
  it.each([
    [1, 8.9, 9.88],
    [4, 9.2, 10.21],
    [7, 9.5, 10.55],
    [13, 9.9, 10.99],
    [26, 11.5, 12.77],
    [57, 22.5, 24.98],
  ])("Trading Post %s kg: nolo %s, totale %s", (peso, nolo, totale) => {
    const r = calcolaCostoAtteso(sped({ pesoReale: peso }), listino("trading_post"));
    expect(r.nolo).toBeCloseTo(nolo, 2);
    expect(r.totale).toBeCloseTo(totale, 2);
  });

  // Fattura Trading Post: 170 kg tassati 200, tariffa 22,50/quintale, nolo 45,00.
  it("Trading Post 170 kg: arrotondati a 200, nolo 45,00", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 170 }), listino("trading_post"));
    expect(r.pesoTassabile).toBe(200);
    expect(r.nolo).toBeCloseTo(45.0, 2);
  });

  // Fattura TNT 07.26 — peso volumetrico da 0,017 mc e carburante 24,3%.
  it("TNT 2 kg reali ma 4,25 volumetrici: nolo 8,00, totale 9,94", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 2, volumeMc: 0.017 }), listino("tnt"));
    expect(r.pesoTassabile).toBeCloseTo(4.25, 2);
    expect(r.pesoApplicato).toBe("volumetrico");
    expect(r.nolo).toBeCloseTo(8.0, 2);
    expect(r.carburante).toBeCloseTo(1.94, 2);
    expect(r.totale).toBeCloseTo(9.94, 2);
  });

  it.each([
    [1.0, 6.18, 1.5],
    [12.25, 10.12, 2.46],
    [26.1, 11.33, 2.75],
    [41.5, 15.37, 3.73],
  ])("TNT %s kg: nolo %s, carburante %s", (peso, nolo, carb) => {
    const r = calcolaCostoAtteso(sped({ pesoReale: peso }), listino("tnt"));
    expect(r.nolo).toBeCloseTo(nolo, 2);
    expect(r.carburante).toBeCloseTo(carb, 2);
  });

  // Il foglio TNT elenca 100,1-150 → 44,37, cioè 28,31 + 16,06.
  it("TNT 150 kg: lo scatto oltre il quintale vale 44,37", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 150 }), listino("tnt"));
    expect(r.nolo).toBeCloseTo(44.37, 2);
  });

  it("GLS 25 kg su zona Italia: le voci sommano al totale", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 25 }), listino("gls", "IT"));
    // 15,24 nolo + 0,75 handling + 0,20 autostrade + 0,20 safety
    expect(r.nolo).toBeCloseTo(15.24, 2);
    expect(r.imponibileNolo).toBeCloseTo(16.39, 2);
    expect(r.adeguamento).toBeCloseTo(1.18, 2);
    expect(r.carburante).toBeCloseTo(2.28, 2);
    expect(r.fuoriBase).toBeCloseTo(0.5, 2); // assicurazione, fuori dalla base
    expect(r.totale).toBeCloseTo(20.35, 2);
  });

  it("GLS: la Sardegna costa più dell'Italia a parità di peso", () => {
    const it = calcolaCostoAtteso(sped({ pesoReale: 25 }), listino("gls", "IT"));
    const sa = calcolaCostoAtteso(sped({ pesoReale: 25 }), listino("gls", "SARD"));
    const cs = calcolaCostoAtteso(sped({ pesoReale: 25 }), listino("gls", "CAL_SIC"));
    expect(sa.nolo).toBeCloseTo(25.51, 2);
    expect(cs.nolo).toBeCloseTo(19.26, 2);
    expect(sa.totale).toBeGreaterThan(cs.totale);
    expect(cs.totale).toBeGreaterThan(it.totale);
  });

  // Listino ufficiale FedEx del 27/02/2026, zona 1: soglie diverse da TNT.
  it("FedEx e TNT divergono fra 3 e 4 kg, come nei rispettivi contratti", () => {
    const f = calcolaCostoAtteso(sped({ pesoReale: 3.95 }), listino("fedex"));
    const t = calcolaCostoAtteso(sped({ pesoReale: 3.95 }), listino("tnt"));
    expect(f.nolo).toBeCloseTo(7.22, 2);
    expect(t.nolo).toBeCloseTo(8.0, 2); // ed è quello che la fattura TNT addebita
  });
});

describe("il confronto fra vettori, come lo mostra la simulazione", () => {
  it("su 25 kg per una destinazione coperta da tutti, l'ordine è stabile", () => {
    const dati = sped({ pesoReale: 25 });
    const esiti = (["trading_post", "gls", "tnt", "fedex"] as const)
      .map((c) => ({
        codice: c,
        totale: calcolaCostoAtteso(dati, listino(c === "gls" ? "gls" : c, c === "gls" ? "IT" : undefined)).totale,
      }))
      .sort((a, b) => a.totale - b.totale);

    // Trading Post è il più conveniente su questa fascia; TNT e FedEx pagano
    // il carburante al 24,3% e finiscono in fondo.
    expect(esiti[0].codice).toBe("trading_post");
    expect(esiti[0].totale).toBeCloseTo(12.77, 2);
    expect(esiti.at(-1)!.totale).toBeGreaterThan(esiti[0].totale);
  });

  /**
   * Sui pesi alti la classifica si ribalta, ed è esattamente il genere di cosa
   * che la pagina di simulazione serve a far vedere.
   *
   * Su 250 kg per una destinazione coperta da entrambi, Trading Post costa
   * 74,93 € e GLS 120,57: **45,64 € di differenza sulla stessa spedizione.**
   * La causa è lo scatto GLS di 18,10 € ogni 50 kg oltre il quintale, contro i
   * 22,50 €/quintale di Trading Post. Sulle fasce leggere vince invece GLS.
   */
  it("sui pesi alti Trading Post costa molto meno di GLS", () => {
    const dati = sped({ pesoReale: 250 });
    const tp = calcolaCostoAtteso(dati, listino("trading_post"));
    const gls = calcolaCostoAtteso(dati, listino("gls", "IT"));

    // 250 kg arrotondati a 300, poi 22,50 €/quintale x 3. L'arrotondamento
    // viene prima della tariffa, non dopo: è il motivo per cui non fa 56,25.
    expect(tp.pesoTassabile).toBe(300);
    expect(tp.nolo).toBeCloseTo(67.5, 2);
    expect(tp.totale).toBeCloseTo(74.93, 2);

    // GLS: 36,91 + tre scatti da 18,10 = 91,21 di nolo.
    expect(gls.nolo).toBeCloseTo(91.21, 2);
    expect(gls.totale).toBeCloseTo(120.57, 2);

    expect(gls.totale - tp.totale).toBeGreaterThan(40);
  });

  /**
   * DOMANDA APERTA, da porre al collaudo con l'amministrazione.
   *
   * La convenzione Trading Post recita «Fino a Ql. 5,0 ai 100,0 - oltre ai
   * 100,0 Kg.», che si può leggere in due modi: arrotondamento ai 100 kg
   * sempre sopra il quintale, oppure solo fino a 5 quintali e poi al kg.
   *
   * Tutte le righe di fattura osservate confermano il primo modo (170 → 200,
   * 172,8 → 200, 57 → 57), ma la più pesante è di 210 kg: sopra i 500 kg non
   * c'è evidenza. Il modello segue quello che i dati mostrano invece di
   * inventare una seconda regola, e questo test fissa il comportamento attuale
   * perché la differenza si veda se un giorno si decide diversamente.
   */
  it("sopra i 500 kg il comportamento è quello attuale, non verificato sui documenti", () => {
    const r = calcolaCostoAtteso(sped({ pesoReale: 650 }), listino("trading_post"));
    expect(r.pesoTassabile).toBe(700); // se il contratto dicesse "al kg", sarebbe 650
    expect(r.nolo).toBeCloseTo(157.5, 2);
  });
});
