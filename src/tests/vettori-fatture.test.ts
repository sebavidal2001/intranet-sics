import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  FatturaNonLeggibile,
  leggiFattura,
  quadra,
  riconosciVettore,
} from "@/lib/portali/vettori/fatture";
import {
  dataIt,
  normalizzaRiferimento,
  numeroIt,
  percentualeIt,
} from "@/lib/portali/vettori/fatture/testo";

/**
 * I parser sono verificati sulle fatture VERE di luglio e agosto 2026.
 *
 * Le fixture in `fixtures/fatture/` sono il testo estratto dai PDF originali
 * (`node scripts/vettori/estrai-testo-fatture.mjs <cartella>`), non un testo
 * scritto a mano che assomiglia a una fattura. La differenza conta: un parser
 * provato su un esempio inventato passa sempre, e fallisce il primo giorno.
 */

function fattura(nome: string): string {
  return readFileSync(
    path.resolve(__dirname, "fixtures", "fatture", `${nome}.txt`),
    "utf8"
  );
}

describe("lettura dei numeri all'italiana", () => {
  it("il punto è separatore di migliaia, la virgola è decimale", () => {
    expect(numeroIt("1.013,22")).toBeCloseTo(1013.22, 2);
    expect(numeroIt("9,88")).toBeCloseTo(9.88, 2);
    expect(numeroIt("1.200,20")).toBeCloseTo(1200.2, 2);
  });

  it("quello che non è un numero è null, mai zero", () => {
    // Zero è un importo: restituirlo al posto di "non lo so" lo rende invisibile.
    expect(numeroIt("")).toBeNull();
    expect(numeroIt("abc")).toBeNull();
    expect(numeroIt(null)).toBeNull();
    expect(numeroIt("0,00")).toBe(0);
  });

  it("le date a due cifre stanno in questo secolo", () => {
    expect(dataIt("01/07/26")).toBe("2026-07-01");
    expect(dataIt("31/07/2026")).toBe("2026-07-31");
    expect(dataIt("32/07/26")).toBeNull();
    expect(dataIt("15/04/20026")).toBeNull(); // il refuso che c'è davvero nei fogli
  });

  it("percentuali", () => {
    expect(percentualeIt("13,00")).toBeCloseTo(0.13, 4);
    expect(percentualeIt("24,30 %")).toBeCloseTo(0.243, 4);
  });

  it("i segnaposto non sono riferimenti", () => {
    // In fattura «0» e «XXX» significano "riferimento assente": trattarli come
    // numeri farebbe agganciare fra loro spedizioni che non c'entrano niente.
    expect(normalizzaRiferimento("0")).toBeNull();
    expect(normalizzaRiferimento("000")).toBeNull();
    expect(normalizzaRiferimento("XXX")).toBeNull();
    expect(normalizzaRiferimento("764")).toBe("764");
    expect(normalizzaRiferimento("0764")).toBe("764");
    expect(normalizzaRiferimento("DDT26-0818")).toBe("DDT260818");
  });
});

describe("riconoscimento del vettore", () => {
  it.each([
    ["ft-gls-07-26", "gls"],
    ["ft-tnt-07-26", "tnt"],
    ["tp1260-002218-07-26", "trading_post"],
  ])("%s è di %s", (file, atteso) => {
    expect(riconosciVettore(fattura(file))).toBe(atteso);
  });

  it("non si fida del nome del file", () => {
    expect(riconosciVettore("una fattura qualsiasi senza intestazioni")).toBeNull();
  });

  /**
   * La fattura TNT di agosto non contiene da nessuna parte la parola «TNT».
   * Quella di luglio si riconosceva solo perché aveva i codici `MANH2` e
   * `NOSTK`, che però compaiono unicamente quando quei supplementi ci sono: un
   * mese di merce normale e il riconoscimento sarebbe saltato.
   */
  it("riconosce TNT anche quando il marchio non è stampato", () => {
    const agosto = fattura("ft-tnt-08-26");
    expect(/\bTNT\b/i.test(agosto)).toBe(false);
    expect(/MANH2|NOSTK/i.test(agosto)).toBe(false);
    expect(riconosciVettore(agosto)).toBe("tnt");
  });

  it("la firma strutturale di TNT non scatta sulle altre fatture", () => {
    expect(riconosciVettore(fattura("ft-gls-07-26"))).toBe("gls");
    expect(riconosciVettore(fattura("tp1260-002218-07-26"))).toBe("trading_post");
  });
});

describe("GLS — fattura di luglio 2026", () => {
  const f = leggiFattura(fattura("ft-gls-07-26"));

  it("legge tutte e 55 le spedizioni dichiarate in fattura", () => {
    expect(f.righe).toHaveLength(55);
    expect(f.totali.spedizioni).toBe(55);
    expect(f.righeNonLette).toEqual([]);
  });

  it("la prima riga è quella giusta, campo per campo", () => {
    const r = f.righe[0];
    expect(r.data).toBe("2026-07-01");
    expect(r.numeroSpedizione).toBe("260134364");
    expect(r.riferimento).toBe("2459");
    expect(r.controparte).toContain("HTP HIGH TECH PROD");
    expect(r.direzione).toBe("entrata");
    expect(r.colli).toBe(1);
    expect(r.peso).toBeCloseTo(3.1, 2);
    expect(r.pesoVolumetrico).toBeCloseTo(1.0, 2);
    expect(r.nolo).toBeCloseTo(10.52, 2);
  });

  it("l'assicurazione va sulla spedizione sopra, non conta come spedizione", () => {
    // 02/07 AIGNEP: nolo 50,54 e sotto la riga «0 0 - A.10/10 - 0,50».
    const aignep = f.righe.find((r) => r.controparte?.includes("AIGNEP"));
    expect(aignep?.nolo).toBeCloseTo(50.54, 2);
    expect(aignep?.supplementi).toBeCloseTo(0.5, 2);
    expect(aignep?.totale).toBeCloseTo(51.04, 2);
  });

  it("legge i totali di piede, adeguamento e carburante", () => {
    expect(f.totali.colli).toBe(67);
    expect(f.totali.peso).toBeCloseTo(872.1, 1);
    expect(f.totali.nolo).toBeCloseTo(1013.22, 2);
    expect(f.totali.adeguamento).toBeCloseTo(73.03, 2);
    expect(f.totali.carburante).toBeCloseTo(141.21, 2);
    expect(f.totali.percentualeCarburante).toBeCloseTo(0.13, 4);
  });

  it("il totale documento ricostruito è quello della fattura", () => {
    // 1.013,22 nolo + 11,00 assicurazione + 73,03 ISTAT + 141,21 carburante
    expect(f.totali.totaleDocumento).toBeCloseTo(1238.46, 2);
  });

  it("undici spedizioni non hanno il numero di bolla, e lo dice", () => {
    const senza = f.righe.filter((r) => !r.riferimento);
    expect(senza).toHaveLength(11);
    expect(f.avvertenze.join(" ")).toContain("abbinamento assistito");
  });

  it("quadra", () => {
    const q = quadra(f);
    expect(q.confronti.find((c) => c.voce.includes("spedizioni"))?.ok).toBe(true);
    expect(q.confronti.find((c) => c.voce.includes("colli"))?.ok).toBe(true);
    expect(q.confronti.find((c) => c.voce.includes("nolo"))?.ok).toBe(true);
    expect(q.ok).toBe(true);
  });
});

describe("Trading Post — fattura di luglio 2026", () => {
  const f = leggiFattura(fattura("tp1260-002218-07-26"));

  it("legge il numero e la data della fattura", () => {
    expect(f.numero).toBe("2218/TP");
    expect(f.data).toBe("2026-07-31");
    expect(f.anno).toBe(2026);
    expect(f.mese).toBe(7);
  });

  it("legge tutte e 53 le spedizioni", () => {
    expect(f.righe).toHaveLength(53);
    expect(f.totali.spedizioni).toBe(53);
    expect(f.righeNonLette).toEqual([]);
  });

  it("la sigla M/D dà il verso della spedizione", () => {
    const entrate = f.righe.filter((r) => r.direzione === "entrata");
    const uscite = f.righe.filter((r) => r.direzione === "uscita");
    expect(entrate.length).toBe(15);
    expect(uscite.length).toBe(38);
  });

  it("ogni riga porta il numero di bolla: qui non manca mai", () => {
    expect(f.righe.every((r) => r.riferimento)).toBe(true);
  });

  it("l'addizionale è l'11,0% esatto su 52 righe di 53", () => {
    const rapporti = f.righe
      .filter((r) => r.nolo && r.supplementi)
      .map((r) => r.supplementi / r.nolo!);
    const alUndici = rapporti.filter((x) => x > 0.109 && x < 0.111);
    expect(alUndici).toHaveLength(52);

    // L'unica eccezione è la spedizione AIRON del 20/07, dove quella colonna
    // porta 2,75 su un nolo di 8,90 — cioè un addebito in più oltre
    // all'addizionale. I totali di piede della fattura la confermano: senza
    // quella riga mancherebbero esattamente 8,90 di nolo e 2,75 di addizionale.
    const airon = f.righe.find((r) => r.controparte?.includes("AIRON"));
    expect(airon?.nolo).toBeCloseTo(8.9, 2);
    expect(airon?.supplementi).toBeCloseTo(2.75, 2);
  });

  it("dichiara che l'11% non è un carburante", () => {
    expect(f.avvertenze.join(" ")).toContain("addizionale di gestione");
    expect(f.righe.every((r) => r.carburante === 0)).toBe(true);
  });

  it("legge i totali di piede, che l'estrazione spezza su più righe", () => {
    expect(f.totali.colli).toBe(60);
    expect(f.totali.peso).toBeCloseTo(1200.2, 1);
    expect(f.totali.nolo).toBeCloseTo(859.0, 2);
    expect(f.totali.supplementi).toBeCloseTo(96.34, 2);
    expect(f.totali.totaleDocumento).toBeCloseTo(955.34, 2);
  });

  it("quadra", () => {
    expect(quadra(f).ok).toBe(true);
  });
});

describe("TNT — fattura di luglio 2026", () => {
  const f = leggiFattura(fattura("ft-tnt-07-26"));

  it("legge le 23 spedizioni dichiarate", () => {
    expect(f.righe).toHaveLength(23);
    expect(f.totali.spedizioni).toBe(23);
    expect(f.righeNonLette).toEqual([]);
  });

  it("legge il numero e la data della fattura", () => {
    expect(f.numero).toBe("85027776");
    expect(f.data).toBe("2026-07-29");
  });

  /**
   * Il caso che rende necessario leggere da destra: due righe consecutive con
   * un numero diverso di campi. La prima ha un solo peso, la seconda due —
   * perché TNT ha corretto il peso dichiarato da 2,10 a 2,15.
   */
  it("legge il nolo giusto sia con uno che con due pesi", () => {
    const unPeso = f.righe[0]; // 1 1,00 0,005 1,25 1,25 1,82 7,22 9,04
    expect(unPeso.colli).toBe(1);
    expect(unPeso.peso).toBeCloseTo(1.0, 2);
    expect(unPeso.pesoTassato).toBeCloseTo(1.25, 2);
    expect(unPeso.nolo).toBeCloseTo(7.22, 2);
    expect(unPeso.carburante).toBeCloseTo(1.82, 2);
    expect(unPeso.totale).toBeCloseTo(9.04, 2);

    const duePesi = f.righe[1]; // 2 2,10 2,15 0,010 2,50 2,50 1,82 7,22 9,04
    expect(duePesi.colli).toBe(2);
    expect(duePesi.peso).toBeCloseTo(2.15, 2); // vince la correzione di TNT
    expect(duePesi.nolo).toBeCloseTo(7.22, 2);
    expect(duePesi.totale).toBeCloseTo(9.04, 2);
  });

  it("il peso volumetrico si ricava dal volume col divisore TNT", () => {
    // 0,166 mc x 250 kg/mc = 41,50 kg, che è il peso tassato in fattura.
    const grande = f.righe.find((r) => r.pesoTassato === 41.5);
    expect(grande?.pesoVolumetrico).toBeCloseTo(41.5, 1);
    expect(grande?.nolo).toBeCloseTo(15.37, 2);
  });

  it("i supplementi sono in coda, non sulle righe", () => {
    // MANH2 10,00 + NOSTK 30,00
    expect(f.totali.supplementi).toBeCloseTo(40.0, 2);
  });

  it("legge i totali e ricava la percentuale di carburante", () => {
    expect(f.totali.colli).toBe(35);
    expect(f.totali.peso).toBeCloseTo(406.35, 2);
    expect(f.totali.nolo).toBeCloseTo(255.18, 2);
    expect(f.totali.carburante).toBeCloseTo(62.09, 2);
    expect(f.totali.percentualeCarburante).toBeCloseTo(0.243, 2);
  });

  it("quadra", () => {
    expect(quadra(f).ok).toBe(true);
  });
});

describe("le fatture di agosto si leggono con lo stesso parser", () => {
  it("GLS agosto", () => {
    const f = leggiFattura(fattura("ft-gls-08-26"));
    expect(f.righe.length).toBeGreaterThan(0);
    expect(f.righe.length).toBe(f.totali.spedizioni);
    expect(quadra(f).ok).toBe(true);
  });

  it("Trading Post agosto", () => {
    const f = leggiFattura(fattura("tp1260-002498-08-26"));
    expect(f.righe).toHaveLength(15);
    expect(quadra(f).ok).toBe(true);
  });

  it("TNT agosto", () => {
    const f = leggiFattura(fattura("ft-tnt-08-26"));
    expect(f.righe.length).toBeGreaterThan(0);
    expect(quadra(f).ok).toBe(true);
  });
});

describe("quello che non si può leggere lo dice, invece di fingere", () => {
  it("FedEx: riconosciuto ma senza testo", () => {
    expect(() => leggiFattura(fattura("ft-fedex-07-26"))).toThrowError(
      FatturaNonLeggibile
    );
    try {
      leggiFattura(fattura("ft-fedex-07-26"));
    } catch (e) {
      expect((e as FatturaNonLeggibile).motivo).toBe("senza_testo");
      expect((e as Error).message).toContain("riconoscimento ottico");
    }
  });

  it("un vettore mai visto non diventa una fattura vuota", () => {
    const testo = "FATTURA\n".repeat(60);
    try {
      leggiFattura(testo);
      throw new Error("doveva sollevare");
    } catch (e) {
      expect((e as FatturaNonLeggibile).motivo).toBe("vettore_sconosciuto");
    }
  });

  it("una fattura GLS senza righe non passa per riuscita", () => {
    const testo = "GLS Enterprise S.R.L. www.gls-italy.com\n".repeat(20);
    try {
      leggiFattura(testo);
      throw new Error("doveva sollevare");
    } catch (e) {
      expect((e as FatturaNonLeggibile).motivo).toBe("nessuna_riga");
    }
  });

  it("la quadratura fallisce se manca una riga", () => {
    const f = leggiFattura(fattura("ft-gls-07-26"));
    f.righe.pop(); // simula una riga persa dal parser
    const q = quadra(f);
    expect(q.ok).toBe(false);
    expect(q.confronti.find((c) => c.voce.includes("spedizioni"))?.ok).toBe(false);
    expect(q.note.join(" ")).toContain("resta in bozza");
  });

  it("la quadratura fallisce se restano righe non lette", () => {
    const f = leggiFattura(fattura("tp1260-002218-07-26"));
    f.righeNonLette.push("una riga che il parser non ha capito");
    expect(quadra(f).ok).toBe(false);
  });
});
