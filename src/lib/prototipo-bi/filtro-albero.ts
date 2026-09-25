/**
 * Filtri a matrioska: business unit → categoria.
 *
 * Si spunta una business unit intera, oppure la si apre e si scelgono solo
 * alcune categorie («COMPONENTI → AUTOMAZIONE pneumatica»). La selezione vive
 * come insieme di RAMI (`"COMPONENTI › AUTOMAZIONE pneumatica"`), e diventa un
 * filtro solo alla fine:
 *
 *  · solo business unit intere  → `bu in [...]`, leggibile e stabile: se
 *    domani compare una categoria nuova, e' gia' dentro;
 *  · anche una sola scelta parziale → `bu_categoria in [...]`. Non si puo'
 *    dire con `bu` + `categoria` separati: la categoria «-» esiste sotto piu'
 *    business unit, e `categoria in [-]` prenderebbe anche quelle non scelte.
 */

import { SEPARATORE_RAMO, type Filtro } from "./tipi";

export interface NodoBu {
  bu: string;
  categorie: string[];
}

export function ramo(bu: string, categoria: string): string {
  return `${bu}${SEPARATORE_RAMO}${categoria || "-"}`;
}

/** L'albero dalle righe di una query raggruppata per `bu` e `categoria`. */
export function alberoDaRighe(righe: { chiavi: Record<string, string> }[]): NodoBu[] {
  const m = new Map<string, Set<string>>();
  for (const r of righe) {
    const bu = r.chiavi.bu;
    if (!bu) continue;
    const c = m.get(bu) ?? new Set<string>();
    c.add(r.chiavi.categoria || "-");
    m.set(bu, c);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "it"))
    .map(([bu, cat]) => ({ bu, categorie: [...cat].sort((a, b) => a.localeCompare(b, "it")) }));
}

export function ramiDi(nodo: NodoBu): string[] {
  return nodo.categorie.map((c) => ramo(nodo.bu, c));
}

function valori(filtro: Filtro): string[] {
  return (Array.isArray(filtro.valore) ? filtro.valore : [filtro.valore]).map((v) => v.trim()).filter(Boolean);
}

/** Dalla selezione al filtro; `null` se non e' scelto niente o e' scelto tutto. */
export function filtroDaSelezione(albero: NodoBu[], selezione: Set<string>): Filtro | null {
  if (selezione.size === 0) return null;
  const tuttiIRami = albero.flatMap(ramiDi);
  if (tuttiIRami.length > 0 && tuttiIRami.every((r) => selezione.has(r))) return null;

  const intere = albero.filter((n) => ramiDi(n).every((r) => selezione.has(r))).map((n) => n.bu);
  const coperti = new Set(albero.filter((n) => intere.includes(n.bu)).flatMap(ramiDi));
  const soloIntere = [...selezione].every((r) => coperti.has(r));
  if (soloIntere) {
    return intere.length === 1
      ? { campo: "bu", op: "eq", valore: intere[0] }
      : { campo: "bu", op: "in", valore: intere };
  }
  return { campo: "bu_categoria", op: "in", valore: [...selezione].sort() };
}

/** Dal filtro alla selezione: per riaprire l'albero su cio' che c'e' gia'. */
export function selezioneDaFiltro(albero: NodoBu[], filtro: Filtro | null | undefined): Set<string> {
  const sel = new Set<string>();
  if (!filtro || (filtro.op !== "eq" && filtro.op !== "in")) return sel;
  const v = valori(filtro);
  if (filtro.campo === "bu_categoria") {
    for (const x of v) sel.add(x);
  } else if (filtro.campo === "bu") {
    for (const n of albero) if (v.includes(n.bu)) ramiDi(n).forEach((r) => sel.add(r));
  } else if (filtro.campo === "categoria") {
    for (const n of albero) for (const c of n.categorie) if (v.includes(c)) sel.add(ramo(n.bu, c));
  }
  return sel;
}

/** Riassunto per il bottone: «Tutte», «COMPONENTI», «COMPONENTI (2 di 7)», «3 business unit». */
export function riassuntoSelezione(albero: NodoBu[], selezione: Set<string>): string {
  if (selezione.size === 0) return "Tutte";
  const toccate = albero
    .map((n) => ({ n, scelti: ramiDi(n).filter((r) => selezione.has(r)).length }))
    .filter((x) => x.scelti > 0);
  if (toccate.length === albero.length && toccate.every((x) => x.scelti === x.n.categorie.length)) return "Tutte";
  if (toccate.length === 1) {
    const { n, scelti } = toccate[0];
    return scelti === n.categorie.length ? n.bu : `${n.bu} (${scelti} di ${n.categorie.length})`;
  }
  return `${toccate.length} business unit`;
}
