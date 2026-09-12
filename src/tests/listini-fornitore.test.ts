import { describe, it, expect } from "vitest";
import {
  normalizzaCodice,
  letteraToIndice,
  cellaToNumero,
  validaEParsa,
  TRACCIATI,
} from "@/lib/portali/preventivatore/listini";

/** Riga come la restituisce SheetJS con header:1 (indice 0 = colonna A). */
function riga(codice: unknown, descrizione: unknown, prezzoR: unknown) {
  const r: unknown[] = new Array(18).fill(null);
  r[1] = codice; // B
  r[2] = descrizione; // C
  r[17] = prezzoR; // R
  return r;
}

/** Le intestazioni che il tracciato Dorner pretende di trovare. */
const INTESTAZIONI_DORNER = riga("FlexMove Part #", "Item Description", "Vendita");

describe("normalizzaCodice", () => {
  it("allinea le grafie diverse dello stesso codice", () => {
    // Il fornitore scrive "FAHBS-40", il gestionale "FAHBS 40": stesso articolo.
    expect(normalizzaCodice("FAHBS-40")).toBe("FAHBS40");
    expect(normalizzaCodice(" fahbs 40 ")).toBe("FAHBS40");
    expect(normalizzaCodice("FAHBS.40")).toBe("FAHBS40");
  });
});

describe("letteraToIndice", () => {
  it("converte le lettere di colonna Excel", () => {
    expect(letteraToIndice("A")).toBe(0);
    expect(letteraToIndice("B")).toBe(1);
    expect(letteraToIndice("R")).toBe(17); // colonna prezzo del listino Dorner
    expect(letteraToIndice("AA")).toBe(26);
    expect(letteraToIndice("1")).toBe(-1);
  });
});

describe("cellaToNumero", () => {
  it("legge i numeri nei formati che capitano nei listini", () => {
    expect(cellaToNumero(8.76)).toBe(8.76);
    expect(cellaToNumero("8,76")).toBe(8.76);
    expect(cellaToNumero("1.234,56")).toBe(1234.56);
    expect(cellaToNumero("1,234.56")).toBe(1234.56);
    expect(cellaToNumero("€ 12,50")).toBe(12.5);
    expect(cellaToNumero("Conveyor beam")).toBeNull();
    expect(cellaToNumero(null)).toBeNull();
  });
});

describe("validaEParsa — controlli che bloccano il caricamento", () => {
  it("rifiuta se il fornitore non è stato selezionato", () => {
    const out = validaEParsa([INTESTAZIONI_DORNER, riga("FAHBS-40", "Bracket", 8.76)], "");
    expect(out.ok).toBe(false);
    expect(out.problemi[0].codice).toBe("fornitore_mancante");
    expect(out.voci).toHaveLength(0);
  });

  it("rifiuta un fornitore non gestito", () => {
    const out = validaEParsa([INTESTAZIONI_DORNER], "ACME");
    expect(out.ok).toBe(false);
    expect(out.problemi[0].codice).toBe("fornitore_sconosciuto");
  });

  it("rifiuta un fornitore dichiarato ma senza tracciato (Alusic)", () => {
    // Alusic è in elenco ma il suo formato non è ancora definito: meglio
    // bloccare che indovinare le colonne e produrre costi sbagliati.
    expect(TRACCIATI.ALUSIC).toBeNull();
    const out = validaEParsa([INTESTAZIONI_DORNER, riga("X-1", "a", 10)], "ALUSIC");
    expect(out.ok).toBe(false);
    expect(out.problemi[0].codice).toBe("tracciato_non_configurato");
  });

  it("rifiuta un foglio che non ha le intestazioni attese", () => {
    // Struttura giusta come colonne, ma è un altro file: niente intestazioni Dorner.
    const righe = [riga("Codice", "Descrizione", "Prezzo"), riga("AB-1", "roba", 12)];
    const out = validaEParsa(righe, "DORNER", "Foglio1");
    expect(out.ok).toBe(false);
    expect(out.problemi[0].codice).toBe("struttura_diversa");
    expect(out.problemi[0].messaggio).toContain("FlexMove Part #");
  });

  it("rifiuta un foglio vuoto", () => {
    const out = validaEParsa([], "DORNER");
    expect(out.ok).toBe(false);
    expect(out.problemi[0].codice).toBe("foglio_vuoto");
  });

  it("rifiuta un estratto parziale sotto la soglia minima", () => {
    const righe = [INTESTAZIONI_DORNER, riga("FAHBS-40", "Bracket", 8.76)];
    const out = validaEParsa(righe, "DORNER", "F-2017-Epicor");
    expect(out.ok).toBe(false);
    expect(out.problemi.some((p) => p.codice === "troppe_poche_voci")).toBe(true);
  });

  it("rifiuta un foglio con le intestazioni giuste ma senza dati", () => {
    const out = validaEParsa([INTESTAZIONI_DORNER, riga("Conveyor Accessories, FA", null, null)], "DORNER");
    expect(out.ok).toBe(false);
    expect(out.problemi.some((p) => p.codice === "nessuna_voce")).toBe(true);
  });
});

describe("validaEParsa — estrazione con tracciato Dorner (B / C / R ÷2)", () => {
  /** Listino plausibile: intestazioni + N codici, sopra la soglia minima. */
  function listino(voci: [string, string, number][]) {
    return [INTESTAZIONI_DORNER, ...voci.map(([c, d, p]) => riga(c, d, p))];
  }
  /** Riempitivo per superare le 100 voci minime. */
  const riempi = (n: number): [string, string, number][] =>
    Array.from({ length: n }, (_, i) => [`FILL-${i}`, `Filler ${i}`, 10 + i]);

  it("dimezza il prezzo della colonna R e tiene la descrizione della colonna C", () => {
    const out = validaEParsa(listino([["FAHBS-60", "Support bracket", 10.008], ...riempi(120)]), "DORNER", "F-2017-Epicor");
    expect(out.ok).toBe(true);
    const v = out.voci.find((x) => x.codice === "FAHBS-60")!;
    expect(v.prezzo_origine).toBe(10.008);
    expect(v.costo).toBe(5.004);
    expect(v.descrizione).toBe("Support bracket");
  });

  it("ignora intestazioni e titoli di sezione senza doverli dichiarare", () => {
    const righe = [
      INTESTAZIONI_DORNER,
      riga("Conveyor Accessories, FA", null, null), // titolo di sezione
      ...riempi(120).map(([c, d, p]) => riga(c, d, p)),
    ];
    const out = validaEParsa(righe, "DORNER");
    expect(out.ok).toBe(true);
    expect(out.voci).toHaveLength(120);
    expect(out.righe_scartate).toBe(2);
  });

  it("sul codice ripetuto tiene l'ultima riga e lo segnala come avviso", () => {
    const out = validaEParsa(
      listino([["FY-RCD", "Roller", 150.14], ["FY-RCD", "Roller", 459.93], ...riempi(120)]),
      "DORNER"
    );
    expect(out.ok).toBe(true); // è un avviso, non blocca
    expect(out.voci.find((v) => v.codice === "FY-RCD")!.costo).toBe(229.965);
    expect(out.codici_in_conflitto).toEqual(["FY-RCD"]);
    expect(out.problemi.some((p) => p.gravita === "avviso" && p.codice === "codici_duplicati")).toBe(true);
  });

  it("scarta le righe con prezzo zero o negativo", () => {
    const out = validaEParsa(listino([["X-1", "a", 0], ["X-2", "b", -3], ...riempi(120)]), "DORNER");
    expect(out.voci.some((v) => v.codice === "X-1" || v.codice === "X-2")).toBe(false);
    expect(out.voci).toHaveLength(120);
  });

  it("produce un log leggibile dei controlli superati", () => {
    const out = validaEParsa(listino(riempi(120)), "DORNER", "F-2017-Epicor");
    expect(out.ok).toBe(true);
    expect(out.log.join("\n")).toContain("Dorner");
    expect(out.log.join("\n")).toContain("F-2017-Epicor");
    expect(out.log.some((r) => r.includes("Controlli superati"))).toBe(true);
  });
});
