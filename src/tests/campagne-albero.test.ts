import { describe, expect, it } from "vitest";
import {
  coperturaNodo,
  contiene,
  etichettaSelettore,
  livelloSelettore,
  normalizza,
  percorsoNodo,
  percorsoValido,
  profondita,
  scegli,
  statoNodo,
  togli,
  uguali,
  type SelettoreArticolo,
} from "@/lib/portali/campagne/albero";
import { ConteggioPromossiBody, CreaCampagnaBody, FiltroAlbero, SelettoreArticoloSchema } from "@/lib/portali/campagne/schemi";

const AIGNEP: SelettoreArticolo = { f: "AIGNEP raccordi-tubi (53,5%)" };
const COMP: SelettoreArticolo = { f: "AIGNEP raccordi-tubi (53,5%)", g: "COMPONENTI" };
const PNEU: SelettoreArticolo = { ...COMP, c: "AUTOMAZIONE pneumatica" };
const ART: SelettoreArticolo = { ...PNEU, a: "0056400001" };
const ALTRO: SelettoreArticolo = { f: "SMC 38% (ex 33%)" };

describe("percorsi dell'albero", () => {
  it("la profondità conta i livelli dall'alto, e un buco taglia tutto", () => {
    expect(profondita({})).toBe(0);
    expect(profondita(AIGNEP)).toBe(1);
    expect(profondita(ART)).toBe(4);
    expect(profondita({ g: "COMPONENTI" })).toBe(0);
  });

  it("un percorso è valido solo senza buchi: un gruppo senza il suo fornitore non esiste", () => {
    expect(percorsoValido(AIGNEP)).toBe(true);
    expect(percorsoValido(ART)).toBe(true);
    expect(percorsoValido({})).toBe(false);
    expect(percorsoValido({ g: "COMPONENTI" })).toBe(false);
    expect(percorsoValido({ f: "X", c: "Y" })).toBe(false);
    expect(percorsoValido({ f: "" })).toBe(false);
  });

  it("contiene: un nodo contiene se stesso e tutto ciò che sta sotto, non i fratelli né i genitori", () => {
    expect(contiene(AIGNEP, ART)).toBe(true);
    expect(contiene(AIGNEP, AIGNEP)).toBe(true);
    expect(contiene(ART, AIGNEP)).toBe(false);
    expect(contiene(AIGNEP, ALTRO)).toBe(false);
    expect(contiene({ f: "AIGNEP", g: "COMPONENTI" }, { f: "AIGNEP", g: "IMPIANTI" })).toBe(false);
    expect(uguali(COMP, COMP)).toBe(true);
    expect(uguali(AIGNEP, COMP)).toBe(false);
  });

  it("il percorso di un nodo figlio aggiunge il suo livello a quelli del genitore", () => {
    expect(percorsoNodo(AIGNEP, "gruppo", "COMPONENTI")).toEqual(COMP);
    expect(percorsoNodo({}, "fornitore", "SMC")).toEqual({ f: "SMC" });
  });

  it("l'etichetta è il percorso in chiaro, e «-» si legge «non indicato»", () => {
    expect(etichettaSelettore(PNEU)).toBe("AIGNEP raccordi-tubi (53,5%) › COMPONENTI › AUTOMAZIONE pneumatica");
    expect(etichettaSelettore({ f: "X", g: "-" })).toBe("X › (non indicato)");
    expect(livelloSelettore(PNEU)).toBe("categoria");
    expect(livelloSelettore({})).toBeNull();
  });
});

describe("selezione", () => {
  it("scegliere un nodo porta via le scelte più profonde che diventano ridondanti", () => {
    expect(scegli([ART, PNEU, ALTRO], COMP)).toEqual([ALTRO, COMP]);
  });

  it("scegliere un nodo già coperto da un antenato non cambia niente", () => {
    const sel = [AIGNEP];
    expect(scegli(sel, ART)).toBe(sel);
    expect(scegli(sel, AIGNEP)).toBe(sel);
  });

  it("un percorso non valido non si sceglie", () => {
    const sel = [AIGNEP];
    expect(scegli(sel, { g: "COMPONENTI" })).toBe(sel);
    expect(scegli(sel, {})).toBe(sel);
  });

  it("stato di un nodo: incluso (lui o un antenato), parziale (qualcosa sotto), no", () => {
    expect(statoNodo(AIGNEP, [AIGNEP])).toBe("incluso");
    expect(statoNodo(ART, [AIGNEP])).toBe("incluso");
    expect(statoNodo(AIGNEP, [PNEU])).toBe("parziale");
    expect(statoNodo(COMP, [PNEU])).toBe("parziale");
    expect(statoNodo(ALTRO, [PNEU])).toBe("no");
    expect(statoNodo(AIGNEP, [])).toBe("no");
  });

  it("chi copre un nodo: solo un antenato, non il nodo stesso", () => {
    expect(coperturaNodo(ART, [AIGNEP])).toEqual(AIGNEP);
    expect(coperturaNodo(AIGNEP, [AIGNEP])).toBeNull();
    expect(coperturaNodo(ALTRO, [AIGNEP])).toBeNull();
  });

  it("togliere toglie solo quel selettore; un nodo coperto da un antenato non si toglie da sé", () => {
    expect(togli([AIGNEP, ALTRO], ALTRO)).toEqual([AIGNEP]);
    expect(togli([AIGNEP], ART)).toEqual([AIGNEP]);
  });

  it("normalizza ripulisce una selezione arrivata da fuori", () => {
    // Doppioni tolti, spazi tolti, e alla fine vince il nodo più alto fra quelli che si contengono.
    expect(normalizza([ART, ART, PNEU, { f: " AIGNEP raccordi-tubi (53,5%) ", g: "COMPONENTI" }])).toEqual([COMP]);
  });

  it("normalizza scarta i selettori senza percorso e taglia ai buchi", () => {
    expect(normalizza([{}, { g: "X" }, { f: "A", c: "C" }, { f: "  ", g: "G" }])).toEqual([{ f: "A" }]);
  });

  it("normalizza non lascia selettori ridondanti: vince il più alto", () => {
    expect(normalizza([ART, AIGNEP, ALTRO])).toEqual([AIGNEP, ALTRO]);
  });
});

describe("schemi dell'albero", () => {
  it("un selettore accetta solo f, g, c, a e solo percorsi senza buchi", () => {
    expect(SelettoreArticoloSchema.safeParse(ART).success).toBe(true);
    expect(SelettoreArticoloSchema.safeParse({ f: "A", c: "C" }).success).toBe(false);
    expect(SelettoreArticoloSchema.safeParse({}).success).toBe(false);
    expect(SelettoreArticoloSchema.safeParse({ f: "A", x: "boh" }).success).toBe(false);
    expect(SelettoreArticoloSchema.safeParse({ f: "x".repeat(201) }).success).toBe(false);
  });

  it("la selezione ha un tetto", () => {
    const tanti = Array.from({ length: 301 }, (_, i) => ({ f: `F${i}` }));
    expect(ConteggioPromossiBody.safeParse({ selettori: tanti }).success).toBe(false);
    expect(ConteggioPromossiBody.safeParse({ selettori: tanti.slice(0, 300) }).success).toBe(true);
  });

  it("un livello dell'albero: i livelli sopra sono obbligatori", () => {
    expect(FiltroAlbero.safeParse({}).success).toBe(true);
    expect(FiltroAlbero.safeParse({ f: "A", g: "G" }).success).toBe(true);
    expect(FiltroAlbero.safeParse({ g: "G" }).success).toBe(false);
    expect(FiltroAlbero.safeParse({ f: "A", c: "C" }).success).toBe(false);
    expect(FiltroAlbero.parse({})).toMatchObject({ limit: 100, offset: 0 });
    expect(FiltroAlbero.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("creare una campagna: l'albero è facoltativo e vuoto di default", () => {
    const base = { codice: "C_05_26", nome: "Cinque", articolo_codice: "ART" };
    expect(CreaCampagnaBody.parse(base).promossi_albero).toEqual([]);
    expect(CreaCampagnaBody.safeParse({ ...base, promossi_albero: [{ g: "X" }] }).success).toBe(false);
  });
});
