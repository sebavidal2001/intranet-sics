import { describe, expect, it } from "vitest";
import {
  interpretaSeparatori,
  leggiNumero,
  plausibile,
  quadrano,
  ricomponiImporto,
} from "@/lib/portali/vettori/fatture/numeri";

/**
 * I numeri usciti dal riconoscimento ottico.
 *
 * I casi non sono inventati: vengono dalla misura su una fattura scansionata
 * con valori noti (`scripts/vettori/ocr/misura-precisione.test.ts`), dove il
 * motore ha letto «107.48» per 107,48 e ha spezzato «94,80» in «94 80».
 */

describe("interpretaSeparatori", () => {
  it("legge la virgola decimale italiana", () => {
    expect(interpretaSeparatori("107,48")).toBe(107.48);
    expect(interpretaSeparatori("76,49")).toBe(76.49);
  });

  it("legge il punto decimale, che è come il motore scrive la virgola", () => {
    // È l'errore più frequente sul documento di prova: il valore non cambia,
    // cambia il carattere. Trattarli alla pari è tutto quello che serve.
    expect(interpretaSeparatori("107.48")).toBe(107.48);
    expect(interpretaSeparatori("310.0")).toBe(310);
    expect(interpretaSeparatori("23.4")).toBe(23.4);
  });

  it("riconosce il separatore delle migliaia in entrambe le convenzioni", () => {
    expect(interpretaSeparatori("1.234,56")).toBe(1234.56);
    expect(interpretaSeparatori("1,234.56")).toBe(1234.56);
    expect(interpretaSeparatori("12.345,00")).toBe(12345);
  });

  it("tratta come migliaia il separatore seguito da tre cifre", () => {
    // Su una fattura «1.234» è milleduecentotrentaquattro: gli importi hanno
    // due decimali e i pesi uno o tre, mai tre in questa forma.
    expect(interpretaSeparatori("1.234")).toBe(1234);
    expect(interpretaSeparatori("12,500")).toBe(12500);
  });

  it("tiene il segno negativo delle note di credito", () => {
    expect(interpretaSeparatori("-45,30")).toBe(-45.3);
  });

  it("NON chiude gli spazi interni: «94 80» non è 9480", () => {
    // È il difetto che è costato di più trovare. Togliendo tutti gli spazi,
    // l'importo spezzato dal motore diventava cento volte tanto senza che
    // niente lo segnalasse: la somma poi non quadrava, e la colpa sembrava
    // del vettore.
    expect(interpretaSeparatori("94 80")).toBeNull();
    expect(leggiNumero("94 80").valore).toBeNull();
    expect(leggiNumero("94 80", { attesoNumerico: true }).valore).toBeNull();
  });

  it("non chiude nemmeno gli spazi delle migliaia", () => {
    // «1 234,50» va ricomposto sapendo che è una cella sola, non unito qui.
    expect(interpretaSeparatori("1 234,50")).toBeNull();
  });

  it("rifiuta quello che numero non è", () => {
    expect(interpretaSeparatori("2026/004512")).toBeNull();
    expect(interpretaSeparatori("MILANO")).toBeNull();
    expect(interpretaSeparatori("")).toBeNull();
  });
});

describe("leggiNumero", () => {
  it("toglie valuta e spazi", () => {
    expect(leggiNumero("€ 107,48").valore).toBe(107.48);
    expect(leggiNumero(" 76,49 ").valore).toBe(76.49);
  });

  it("non corregge le lettere se il campo non è dichiarato numerico", () => {
    // «SOO» in una cella di testo è una sigla, non 500: correggerla d'ufficio
    // significherebbe inventare un importo dove non ce n'era uno.
    expect(leggiNumero("SOO").valore).toBeNull();
  });

  it("corregge le confusioni ottiche quando il numero è atteso", () => {
    const n = leggiNumero("l07,48", { attesoNumerico: true });
    expect(n.valore).toBe(107.48);
    expect(n.correzioni).toContain("l→1");
  });

  it("dichiara sempre le correzioni applicate", () => {
    // Un valore corretto d'ufficio non è un valore letto: chi rivede la
    // fattura deve poterlo distinguere a colpo d'occhio.
    const n = leggiNumero("S6,O0", { attesoNumerico: true });
    expect(n.valore).toBe(56.0);
    expect(n.correzioni).toEqual(["S→5", "O→0"]);
  });

  it("non inventa un numero quando nemmeno la correzione basta", () => {
    expect(leggiNumero("MILANO", { attesoNumerico: true }).valore).toBeNull();
  });

  it("conserva il testo di partenza", () => {
    expect(leggiNumero("l07,48", { attesoNumerico: true }).grezzo).toBe("l07,48");
  });
});

describe("ricomponiImporto", () => {
  it("rimette insieme l'importo spezzato dal motore", () => {
    // Il caso vero: «94,80» letto come due parole «94» e «80».
    const n = ricomponiImporto(["94", "80"]);
    expect(n.valore).toBe(94.8);
    expect(n.correzioni[0]).toContain("ricomposto");
  });

  it("regge tre decimali, che i pesi hanno", () => {
    expect(ricomponiImporto(["148", "500"]).valore).toBe(148.5);
  });

  it("lascia stare un pezzo unico già completo", () => {
    const n = ricomponiImporto(["107,48"]);
    expect(n.valore).toBe(107.48);
    expect(n.correzioni).toEqual([]);
  });

  it("non ricompone quello che non è un importo", () => {
    // «2026/00464» + «1» è un riferimento spezzato, non 2026,1: ricomporlo
    // come numero produrrebbe un importo assurdo al posto di una bolla.
    expect(ricomponiImporto(["2026/00464", "1"]).valore).toBeNull();
  });

  it("non ricompone più di due pezzi", () => {
    expect(ricomponiImporto(["1", "2", "3"]).valore).toBeNull();
  });

  it("rifiuta una parte decimale troppo lunga", () => {
    expect(ricomponiImporto(["94", "8000"]).valore).toBeNull();
  });
});

describe("quadrano", () => {
  it("accetta la somma esatta", () => {
    // Le quattro righe del documento di prova contro il totale stampato.
    const e = quadrano([107.48, 51.21, 155.14, 35.55], 349.38);
    expect(e.ok).toBe(true);
    expect(e.differenza).toBe(0);
  });

  it("tollera il centesimo di arrotondamento per addendo", () => {
    expect(quadrano([10.005, 10.005], 20.02).ok).toBe(true);
  });

  it("rifiuta lo scarto di una cifra letta male", () => {
    // 94,80 letto 94: la somma perde 80 centesimi e la quadratura lo dice.
    const e = quadrano([107.48, 51.21, 155.14 - 0.8, 35.55], 349.38);
    expect(e.ok).toBe(false);
    expect(e.differenza).toBeCloseTo(-0.8, 2);
  });

  it("non quadra mai senza un totale con cui confrontarsi", () => {
    expect(quadrano([10, 20], null).ok).toBe(false);
  });

  it("ignora gli addendi non letti invece di trattarli come zero certo", () => {
    const e = quadrano([10, null, 20], 30);
    expect(e.trovato).toBe(30);
  });
});

describe("plausibile", () => {
  it("accetta i valori nell'ordine di grandezza giusto", () => {
    expect(plausibile(107.48, "importo")).toBe(true);
    expect(plausibile(310, "peso")).toBe(true);
    expect(plausibile(4, "colli")).toBe(true);
    expect(plausibile(24.3, "percentuale")).toBe(true);
  });

  it("intercetta la cifra di troppo", () => {
    expect(plausibile(310_000, "peso")).toBe(false);
    expect(plausibile(150, "percentuale")).toBe(false);
  });

  it("i colli sono interi", () => {
    expect(plausibile(2.5, "colli")).toBe(false);
    expect(plausibile(0, "colli")).toBe(false);
  });

  it("un valore non letto non è plausibile", () => {
    expect(plausibile(null, "importo")).toBe(false);
    expect(plausibile(Number.NaN, "importo")).toBe(false);
  });
});
