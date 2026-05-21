// ─── Shared types and helpers for the Nuovo Preventivo view ──────────────────

export interface Cliente {
  id: string
  ragione_sociale: string
  piva: string | null
  citta: string | null
  provincia: string | null
}

export interface Prodotto {
  id: string
  codice: string
  descrizione: string
  /** Ultimo costo (cruscotto: `ult_costo`). Si chiamava `prezzo_listino`. */
  ult_costo: number | null
  fornitore: string | null
  unita_misura: string
  giacenza: number | null
  // campi opzionali dall'anagrafica cruscotto
  categoria?: string | null
  n_magazzini?: number
  prezzo_stale?: boolean
}

export interface ServizioDB {
  id: string
  nome: string
  categoria: string
  tariffa_ora: number
  unita: string
}

export interface ArticoloBlocco {
  _key: string
  prodotto_id: string
  codice: string
  descrizione: string
  /** Ultimo costo (override editabile lato builder). Cruscotto: `ult_costo`. */
  ult_costo: number
  qty: number
  /**
   * Coefficiente di ricarico SICS (es. 0.5, 0.65).
   * Prezzo riga = ult_costo * qty / coeff_ricarico. Convenzione storica `righe_distinta`.
   */
  coeff_ricarico: number
}

export interface ServizioBlocco {
  servizio_id: string
  nome: string
  categoria: string
  tariffa_ora: number
  ore: number
  markup: number
  attivo: boolean
}

export interface Blocco {
  _key: string
  tipo: string
  nome: string
  note: string
  espanso: boolean
  articoli: ArticoloBlocco[]
  servizi: ServizioBlocco[]
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const TIPI_BLOCCO = [
  "Nastro Principale",
  "Rulliera",
  "Protezioni",
  "Scala",
  "Ballatoio",
  "Pedana",
  "Camminamento",
  "Struttura",
  "Impianto elettrico",
  "Altro",
]

export const COLORI_BLOCCO = [
  "bg-teal-500",
  "bg-blue-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function genKey(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function fmtEur(n: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/** Costante: coefficiente di ricarico di default (modificabile per riga). */
export const COEFF_RICARICO_DEFAULT = 0.5

export function calcNettoArticolo(a: ArticoloBlocco): number {
  if (!a.coeff_ricarico || a.coeff_ricarico <= 0) return 0
  return (a.ult_costo * a.qty) / a.coeff_ricarico
}

export function calcTotaleServizio(s: ServizioBlocco): number {
  if (!s.attivo) return 0
  return s.tariffa_ora * s.ore * (1 + s.markup / 100)
}

export function calcTotaleBlocco(b: Blocco): number {
  const mat = b.articoli.reduce((sum, a) => sum + calcNettoArticolo(a), 0)
  const srv = b.servizi.reduce((sum, s) => sum + calcTotaleServizio(s), 0)
  return mat + srv
}

// ─── Builder state (per chat AI + scheda tecnica) ────────────────────────────

/**
 * Snapshot compatto dello stato corrente del builder, inviato all'AI per
 * domande contestuali ("qual è il margine?", "dammi suggerimenti") e per la
 * generazione della scheda tecnica.
 *
 * Formato pensato per essere serializzabile in JSON e iniettabile direttamente
 * nel system prompt.
 */
export interface BuilderStateArticolo {
  codice: string
  descrizione: string
  qty: number
  ult_costo: number
  coeff_ricarico: number
  netto: number
}

export interface BuilderStateLavorazione {
  nome: string
  categoria: string
  ore: number
  tariffa_ora: number
  markup_pct: number
  totale: number
}

export interface BuilderStateBlocco {
  numero: number
  tipo: string
  nome: string
  note: string
  articoli: BuilderStateArticolo[]
  lavorazioni: BuilderStateLavorazione[]
  totale_materiali: number
  totale_servizi: number
  totale_blocco: number
}

export interface BuilderState {
  titolo: string | null
  cliente: {
    ragione_sociale: string
    piva: string | null
    citta: string | null
    provincia: string | null
  } | null
  data_consegna: string | null
  blocchi: BuilderStateBlocco[]
  totali: {
    materiali: number
    servizi: number
    netto_totale: number
    n_blocchi: number
    n_articoli: number
    ore_totali: number
    coeff_ricarico_medio: number
  }
}

/** Costruisce il BuilderState a partire dallo stato React del builder. */
export function buildBuilderState(input: {
  titolo: string
  cliente: Cliente | null
  dataConsegna: string
  blocchi: Blocco[]
}): BuilderState {
  const { titolo, cliente, dataConsegna, blocchi } = input
  const totMat = blocchi.reduce((s, b) => s + b.articoli.reduce((x, a) => x + calcNettoArticolo(a), 0), 0)
  const totSrv = blocchi.reduce((s, b) => s + b.servizi.reduce((x, sv) => x + calcTotaleServizio(sv), 0), 0)
  const allArt = blocchi.flatMap((b) => b.articoli)
  const oreTot = blocchi.reduce((s, b) => s + b.servizi.filter((sv) => sv.attivo).reduce((x, sv) => x + sv.ore, 0), 0)
  const coeffMedio = allArt.length > 0 ? allArt.reduce((s, a) => s + a.coeff_ricarico, 0) / allArt.length : 0
  return {
    titolo: titolo.trim() || null,
    cliente: cliente
      ? {
          ragione_sociale: cliente.ragione_sociale,
          piva: cliente.piva,
          citta: cliente.citta,
          provincia: cliente.provincia,
        }
      : null,
    data_consegna: dataConsegna || null,
    blocchi: blocchi.map((b, i) => ({
      numero: i + 1,
      tipo: b.tipo,
      nome: b.nome,
      note: b.note,
      articoli: b.articoli.map((a) => ({
        codice: a.codice,
        descrizione: a.descrizione,
        qty: a.qty,
        ult_costo: a.ult_costo,
        coeff_ricarico: a.coeff_ricarico,
        netto: calcNettoArticolo(a),
      })),
      lavorazioni: b.servizi.filter((s) => s.attivo).map((s) => ({
        nome: s.nome,
        categoria: s.categoria,
        ore: s.ore,
        tariffa_ora: s.tariffa_ora,
        markup_pct: s.markup,
        totale: calcTotaleServizio(s),
      })),
      totale_materiali: b.articoli.reduce((s, a) => s + calcNettoArticolo(a), 0),
      totale_servizi: b.servizi.reduce((s, sv) => s + calcTotaleServizio(sv), 0),
      totale_blocco: calcTotaleBlocco(b),
    })),
    totali: {
      materiali: totMat,
      servizi: totSrv,
      netto_totale: totMat + totSrv,
      n_blocchi: blocchi.length,
      n_articoli: allArt.length,
      ore_totali: oreTot,
      coeff_ricarico_medio: coeffMedio,
    },
  }
}

export function creaBlocco(serviziDB: ServizioDB[]): Blocco {
  return {
    _key: genKey(),
    tipo: TIPI_BLOCCO[0],
    nome: "",
    note: "",
    espanso: true,
    articoli: [],
    servizi: serviziDB.map((s) => ({
      servizio_id: s.id,
      nome: s.nome,
      categoria: s.categoria,
      tariffa_ora: s.tariffa_ora,
      ore: 0,
      markup: 0,
      attivo: false,
    })),
  }
}
