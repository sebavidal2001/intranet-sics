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
  prezzo_listino: number | null
  fornitore: string | null
  unita_misura: string
  giacenza: number | null
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
  prezzo_listino: number
  qty: number
  markup: number
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

export function calcNettoArticolo(a: ArticoloBlocco): number {
  return a.prezzo_listino * a.qty * (1 + a.markup / 100)
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
