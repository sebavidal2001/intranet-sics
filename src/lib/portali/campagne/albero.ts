/**
 * L'albero degli articoli promossi, in TypeScript: la logica pura della selezione.
 *
 * Un SELETTORE e' un percorso dell'anagrafica: fornitore (`f`) > gruppo (`g`) >
 * categoria (`c`) > articolo (`a`), con solo i livelli scelti, SEMPRE a partire dall'alto
 * senza buchi (un gruppo senza il suo fornitore non e' un percorso: `{g}` da solo non
 * esiste). Prende tutti gli articoli che stanno sotto quel percorso. La selezione e'
 * l'unione dei selettori: `campagne.articoli_da_selettori` (migration 136) la applica
 * al database; qui si costruisce e si ripulisce.
 */
export type Livello = "fornitore" | "gruppo" | "categoria" | "articolo";

export interface SelettoreArticolo {
  f?: string;
  g?: string;
  c?: string;
  a?: string;
}

const CHIAVI = ["f", "g", "c", "a"] as const;
export const LIVELLI: Livello[] = ["fornitore", "gruppo", "categoria", "articolo"];
const CHIAVE_DI: Record<Livello, (typeof CHIAVI)[number]> = { fornitore: "f", gruppo: "g", categoria: "c", articolo: "a" };

/** Quanti livelli ha il percorso (0 = vuoto, 4 = un articolo). */
export function profondita(s: SelettoreArticolo): number {
  let n = 0;
  for (const k of CHIAVI) {
    if (s[k] === undefined) break;
    n++;
  }
  return n;
}

/** Un percorso valido: almeno un livello e nessun buco (niente `g` senza `f`, ecc.). */
export function percorsoValido(s: SelettoreArticolo): boolean {
  const n = profondita(s);
  if (n === 0) return false;
  return CHIAVI.every((k, i) => (i < n ? typeof s[k] === "string" && s[k] !== "" : s[k] === undefined));
}

/** Il percorso di un nodo: i valori dei livelli sopra, piu' il suo. */
export function percorsoNodo(genitore: SelettoreArticolo, livello: Livello, valore: string): SelettoreArticolo {
  return { ...genitore, [CHIAVE_DI[livello]]: valore };
}

/** `a` contiene `b` (o e' uguale): ogni livello di `a` coincide con quello di `b`. */
export function contiene(a: SelettoreArticolo, b: SelettoreArticolo): boolean {
  const n = profondita(a);
  return n > 0 && n <= profondita(b) && CHIAVI.slice(0, n).every((k) => a[k] === b[k]);
}

export const uguali = (a: SelettoreArticolo, b: SelettoreArticolo) => contiene(a, b) && profondita(a) === profondita(b);

export type StatoNodo = "incluso" | "parziale" | "no";

/**
 * Come appare un nodo rispetto alla selezione:
 *  - «incluso»: lui o un suo antenato e' scelto (tutto quello che sta sotto e' dentro);
 *  - «parziale»: sono scelti solo alcuni suoi discendenti;
 *  - «no».
 */
export function statoNodo(nodo: SelettoreArticolo, selezione: SelettoreArticolo[]): StatoNodo {
  if (selezione.some((s) => contiene(s, nodo))) return "incluso";
  if (selezione.some((s) => contiene(nodo, s))) return "parziale";
  return "no";
}

/** Chi dei selettori scelti copre il nodo (per dire «incluso da AIGNEP»). */
export function coperturaNodo(nodo: SelettoreArticolo, selezione: SelettoreArticolo[]): SelettoreArticolo | null {
  return selezione.find((s) => contiene(s, nodo) && !uguali(s, nodo)) ?? null;
}

/**
 * Sceglie un nodo. Se e' gia' coperto da un antenato non cambia niente; altrimenti entra
 * e porta via i selettori piu' profondi che ora sarebbero ridondanti.
 */
export function scegli(selezione: SelettoreArticolo[], nodo: SelettoreArticolo): SelettoreArticolo[] {
  if (!percorsoValido(nodo)) return selezione;
  if (selezione.some((s) => contiene(s, nodo))) return selezione;
  return [...selezione.filter((s) => !contiene(nodo, s)), nodo];
}

/** Toglie un nodo: solo se e' proprio uno dei selettori scelti (un nodo incluso da un antenato si toglie dall'antenato). */
export function togli(selezione: SelettoreArticolo[], nodo: SelettoreArticolo): SelettoreArticolo[] {
  return selezione.filter((s) => !uguali(s, nodo));
}

/** Ripulisce una selezione arrivata da fuori: percorsi validi, senza doppioni ne' selettori ridondanti. */
export function normalizza(selezione: SelettoreArticolo[]): SelettoreArticolo[] {
  const pulita = selezione
    .map((s) => {
      const o: SelettoreArticolo = {};
      for (const k of CHIAVI) {
        const v = s[k];
        if (typeof v === "string" && v.trim() !== "") o[k] = v.trim();
        else break; // un buco taglia tutto cio' che sta sotto
      }
      return o;
    })
    .filter(percorsoValido);
  return pulita.reduce<SelettoreArticolo[]>((acc, s) => scegli(acc, s), []);
}

const NOME_VUOTO = "(non indicato)";
export const nomeValore = (v: string) => (v === "-" ? NOME_VUOTO : v);

/** «AIGNEP raccordi-tubi (53,5%) › COMPONENTI › AUTOMAZIONE pneumatica»: il percorso in chiaro. */
export function etichettaSelettore(s: SelettoreArticolo): string {
  return CHIAVI.filter((k) => s[k] !== undefined)
    .map((k) => nomeValore(s[k] as string))
    .join(" › ");
}

/** A che livello arriva il selettore. */
export function livelloSelettore(s: SelettoreArticolo): Livello | null {
  const n = profondita(s);
  return n === 0 ? null : LIVELLI[n - 1];
}
