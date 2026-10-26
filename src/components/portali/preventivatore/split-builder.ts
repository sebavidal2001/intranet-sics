import {
  genKey,
  type ArticoloBlocco,
  type Blocco,
  type ComponenteDistinta,
  type ServizioBlocco,
  type SplitArticolo,
} from "@/components/portali/preventivatore/nuovo-view-types"

/**
 * Split di costo nel builder (migration 158).
 *
 * Quando un articolo ha uno standard in Impresa, `ult_costo` diventa la sola materia prima e le
 * altre componenti (manodopera, trattamenti esterni, ...) si spostano in righe di lavorazione
 * «da distinta», una per componente e per blocco. Il costo totale e il prezzo di vendita restano
 * quelli di prima: cambia solo dove sono scritti.
 *
 * Tutto qui e' puro (nessun fetch, nessun React) e idempotente: `normalizzaSplit` applicato a un
 * risultato proprio non cambia nulla, quindi puo' girare in un effect senza rischio di cicli.
 */

/** Quote dello standard di Impresa per un codice, come torna da /costi-split. */
export interface QuoteStandard {
  costo_totale: number
  materiale: number
  manodopera: number
  lavorazione: number
  lav_esterna: number
  altro: number
  data?: string | null
}

export const NOMI_DISTINTA: Record<ComponenteDistinta, string> = {
  manodopera: "Manodopera da distinta",
  lav_esterna: "Trattamenti esterni da distinta",
  altro: "Altri costi da distinta",
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const r4 = (n: number) => Math.round(n * 1e4) / 1e4

/** Costo pieno per unita' di un articolo: materia prima + componenti spostate. */
export function costoPienoArticolo(a: ArticoloBlocco): number {
  const s = a.split
  return a.ult_costo + (s ? s.manodopera + s.lavorazione + s.lav_esterna + s.altro : 0)
}

/** Un articolo si splitta solo se ha un codice reale, non e' una voce libera e non e' un componente Nastro. */
export function splittabile(a: ArticoloBlocco, b: Blocco): boolean {
  return Boolean(a.codice && a.codice.trim()) && !a.manuale && !b.usa_catena_guida
}

/**
 * Applica lo standard a un articolo: `ult_costo` (costo pieno in uso) diventa la sola materia prima,
 * le altre componenti vanno in `split`. Le percentuali sono quelle di Impresa; l'arrotondamento
 * finisce in «altro», cosi' la somma resta esattamente il costo di partenza.
 */
export function applicaStandard(a: ArticoloBlocco, q: QuoteStandard | null): ArticoloBlocco {
  if (!q || !(q.costo_totale > 0)) return { ...a, split: null }
  const tot = a.ult_costo
  if (!(tot > 0)) return a // senza costo non c'e' niente da dividere: resta da valutare
  const manodopera = r6((tot * q.manodopera) / q.costo_totale)
  const lavorazione = r6((tot * q.lavorazione) / q.costo_totale)
  const lav_esterna = r6((tot * q.lav_esterna) / q.costo_totale)
  const materiale = r6((tot * q.materiale) / q.costo_totale)
  const altro = r6(tot - materiale - manodopera - lavorazione - lav_esterna)
  return { ...a, ult_costo: materiale, split: { manodopera, lavorazione, lav_esterna, altro } }
}

/** Riporta un articolo splittato a costo pieno (per ricalcolare lo split o per duplicare). */
export function senzaSplit(a: ArticoloBlocco): ArticoloBlocco {
  if (!a.split) return a.split === null ? { ...a, split: undefined } : a
  return { ...a, ult_costo: r6(costoPienoArticolo(a)), split: undefined }
}

/**
 * Porta il costo PIENO di un articolo splittato a `nuovoTotale` mantenendo le proporzioni tra
 * materia prima e componenti spostate (usato da «Aggiorna prezzi»: il costo corrente
 * dell'anagrafica e' un totale, non la sola materia prima).
 */
export function riscalaArticolo(a: ArticoloBlocco, nuovoTotale: number): ArticoloBlocco {
  const s = a.split
  const vecchio = costoPienoArticolo(a)
  if (!s || !(vecchio > 0)) return { ...a, ult_costo: nuovoTotale }
  const f = nuovoTotale / vecchio
  const manodopera = r6(s.manodopera * f)
  const lavorazione = r6(s.lavorazione * f)
  const lav_esterna = r6(s.lav_esterna * f)
  const ult_costo = r6(a.ult_costo * f)
  return { ...a, ult_costo, split: { manodopera, lavorazione, lav_esterna, altro: r6(nuovoTotale - ult_costo - manodopera - lavorazione - lav_esterna) } }
}

interface Importi { manodopera: number; lav_esterna: number; altro: number }

/** Importi del LOTTO per componente + prezzo di vendita corrispondente (per ricavare il coefficiente). */
function importiBlocco(b: Blocco): { costo: Importi; vendita: Importi } {
  const q = Math.max(1, b.quantita_pezzi ?? 1)
  const costo: Importi = { manodopera: 0, lav_esterna: 0, altro: 0 }
  const vendita: Importi = { manodopera: 0, lav_esterna: 0, altro: 0 }
  for (const a of b.articoli) {
    const s = a.split
    if (!s) continue
    const k = a.qty * q
    const coeff = a.coeff_ricarico > 0 ? a.coeff_ricarico : 0
    const parti: [keyof Importi, number][] = [
      ["manodopera", s.manodopera * k],
      ["lav_esterna", s.lav_esterna * k],
      ["altro", (s.lavorazione + s.altro) * k],
    ]
    for (const [c, v] of parti) {
      costo[c] += v
      if (coeff > 0) vendita[c] += v / coeff
    }
  }
  return { costo, vendita }
}

/**
 * Righe «da distinta» che il blocco deve avere, in base allo split dei suoi articoli.
 * `esistenti` serve a conservare `_key` e coefficiente quando le righe sono gia' presenti.
 * Il coefficiente e' quello che lascia INVARIATO il prezzo di vendita dei singoli articoli
 * (anche se hanno ricarichi diversi); con ricarico uniforme coincide con quello degli articoli.
 */
export function righeDistintaDesiderate(b: Blocco, esistenti: ServizioBlocco[]): ServizioBlocco[] {
  const { costo, vendita } = importiBlocco(b)
  const out: ServizioBlocco[] = []
  for (const c of ["manodopera", "lav_esterna", "altro"] as ComponenteDistinta[]) {
    const importo = r4(costo[c])
    if (!(importo > 0)) continue
    const coeff = vendita[c] > 0 ? Math.round((costo[c] / vendita[c]) * 1000) / 1000 : 0.5
    const prima = esistenti.find((s) => s.auto_split === c)
    out.push({
      _key: prima?._key ?? genKey(),
      servizio_id: "",
      nome: NOMI_DISTINTA[c],
      categoria: "Da distinta",
      tariffa_ora: importo,
      ore: 1,
      coeff_ricarico: coeff > 0 && coeff <= 2 ? coeff : 0.5,
      scala_con_quantita: true,
      auto_split: c,
    })
  }
  return out
}

function stessiServizi(a: ServizioBlocco[], b: ServizioBlocco[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]
    return x._key === y._key && x.auto_split === y.auto_split && x.tariffa_ora === y.tariffa_ora && x.ore === y.ore && x.coeff_ricarico === y.coeff_ricarico
  })
}

/** Codici che hanno bisogno dello standard: articoli splittabili non ancora valutati. */
export function codiciDaValutare(blocchi: Blocco[]): string[] {
  const out = new Set<string>()
  for (const b of blocchi) for (const a of b.articoli) if (a.split === undefined && splittabile(a, b) && a.ult_costo > 0) out.add(a.codice)
  return Array.from(out)
}

/**
 * Porta i blocchi allo stato coerente con lo split:
 *   1. gli articoli non valutati per cui lo standard e' noto (`standard.has(codice)`) vengono splittati;
 *   2. le righe «da distinta» di ogni blocco vengono rigenerate dagli articoli.
 * Restituisce `null` se non c'e' niente da cambiare (cosi' l'effect che la chiama non rilancia).
 *
 * `standard` mappa il codice (come scritto) → quote, oppure null se Impresa non ha uno standard.
 */
export function normalizzaSplit(blocchi: Blocco[], standard: Map<string, QuoteStandard | null>): Blocco[] | null {
  let cambiato = false
  const nuovi = blocchi.map((b) => {
    let articoli = b.articoli
    if (articoli.some((a) => a.split === undefined && splittabile(a, b) && standard.has(a.codice))) {
      articoli = articoli.map((a) =>
        a.split === undefined && splittabile(a, b) && standard.has(a.codice) ? applicaStandard(a, standard.get(a.codice) ?? null) : a
      )
    }
    const bTmp: Blocco = articoli === b.articoli ? b : { ...b, articoli }
    const manuali = bTmp.servizi.filter((s) => !s.auto_split)
    const autoOra = bTmp.servizi.filter((s) => s.auto_split)
    const desiderate = righeDistintaDesiderate(bTmp, autoOra)
    const servizi = stessiServizi(autoOra, desiderate) ? bTmp.servizi : [...desiderate, ...manuali]
    if (articoli === b.articoli && servizi === bTmp.servizi) return b
    cambiato = true
    return { ...bTmp, servizi }
  })
  return cambiato ? nuovi : null
}

/** Per l'overlay di un articolo: composizione del costo pieno di UNA unita'. */
export function composizioneArticolo(a: ArticoloBlocco): { chiave: "materiale" | "manodopera" | "lavorazione" | "lav_esterna" | "altro"; valore: number }[] | null {
  const s: SplitArticolo | null | undefined = a.split
  if (!s) return null
  return [
    { chiave: "materiale" as const, valore: a.ult_costo },
    { chiave: "manodopera" as const, valore: s.manodopera },
    { chiave: "lavorazione" as const, valore: s.lavorazione },
    { chiave: "lav_esterna" as const, valore: s.lav_esterna },
    { chiave: "altro" as const, valore: s.altro },
  ].filter((c) => c.valore > 0.0000005)
}
