// ─── Shared types and helpers for the Nuovo Preventivo view ──────────────────

export interface Cliente {
  id: string
  ragione_sociale: string
  piva: string | null
  citta: string | null
  provincia: string | null
  // Campi opzionali popolati dal Cruscotto (clienti_master)
  codice_cliente?: string
  destinazione?: string | null
  id_destinazione?: string | null
  agente_nome?: string | null
  agente_codice?: string | null
  cat_commerciale?: string | null
  is_hq?: boolean
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
  /** Data dell'ultimo costo (ISO yyyy-mm-dd). Usata per la cella gialla >9 mesi. */
  data_ult_costo?: string | null
}

export interface ServizioDB {
  id: string
  nome: string
  categoria: string
  tariffa_ora: number
  unita: string
  /** Default catalogo: se true, la lavorazione scala con la quantità pezzi del blocco. */
  scala_con_quantita?: boolean
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
  /**
   * true = voce inserita manualmente, non presente nell'anagrafica cruscotto.
   * Per queste righe codice e descrizione sono editabili direttamente in tabella.
   */
  manuale?: boolean
  /** Data ultimo costo (ISO) dell'articolo da anagrafica; per la cella gialla >9 mesi. */
  data_ult_costo?: string | null
}

/**
 * Servizio/lavorazione aggiunto a un blocco.
 * Un servizio presente in `blocco.servizi` è per definizione attivo: i blocchi
 * nascono senza servizi e l'utente aggiunge solo quelli che gli servono.
 *
 * Prezzo riga = (ore × tariffa_ora) / coeff_ricarico
 * Stessa convenzione SICS dei materiali (vedi calcNettoArticolo).
 */
export interface ServizioBlocco {
  _key: string
  servizio_id: string
  nome: string
  categoria: string
  tariffa_ora: number
  ore: number
  coeff_ricarico: number
  /**
   * Se true la lavorazione scala con la quantità pezzi del blocco (es. Montaggio);
   * se false è "una tantum" (es. Progettazione) e si conta una volta sola.
   */
  scala_con_quantita: boolean
}

export interface Blocco {
  _key: string
  tipo: string
  nome: string
  note: string
  espanso: boolean
  articoli: ArticoloBlocco[]
  servizi: ServizioBlocco[]
  /** Numero di pezzi da produrre per questo blocco (default 1). */
  quantita_pezzi: number
  /** Override % margine trattativa per il blocco (null = usa il margine globale). */
  margine_trattativa_pct: number | null
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

/** Imballaggio: % di default sul prezzo di VENDITA del blocco. */
export const IMBALLAGGIO_PCT_DEFAULT = 1
/** Tempi accessori di produzione: % di default sul COSTO (vergine) del blocco. */
export const TEMPI_ACCESSORI_PCT_DEFAULT = 2.8
/** Spese generali aziendali: % di default sul COSTO (vergine) del blocco. */
export const SPESE_GENERALI_PCT_DEFAULT = 24.2
/** Soglia (mesi) oltre la quale la cella "Ult. Costo" diventa gialla. */
export const MESI_PREZZO_VECCHIO = 9

export function calcNettoArticolo(a: ArticoloBlocco): number {
  if (!a.coeff_ricarico || a.coeff_ricarico <= 0) return 0
  return (a.ult_costo * a.qty) / a.coeff_ricarico
}

export function calcTotaleServizio(s: ServizioBlocco): number {
  if (!s.coeff_ricarico || s.coeff_ricarico <= 0) return 0
  return (s.tariffa_ora * s.ore) / s.coeff_ricarico
}

export function calcTotaleBlocco(b: Blocco): number {
  const mat = b.articoli.reduce((sum, a) => sum + calcNettoArticolo(a), 0)
  const srv = b.servizi.reduce((sum, s) => sum + calcTotaleServizio(s), 0)
  return mat + srv
}

// ─── Costi "vergini" (senza ricarico) ────────────────────────────────────────
export function calcCostoArticolo(a: ArticoloBlocco): number {
  return a.ult_costo * a.qty
}
export function calcCostoServizio(s: ServizioBlocco): number {
  return s.tariffa_ora * s.ore
}

/** Moltiplicatore di un servizio dato Q: Q se scala, altrimenti 1 (una tantum). */
function multServizio(s: ServizioBlocco, q: number): number {
  return s.scala_con_quantita ? q : 1
}

/**
 * Prezzo di vendita del blocco (con ricarico) a quantità `q`.
 * Materiali × q (scalano sempre); manodopera × q solo se scala_con_quantita.
 * NON include imballaggio/spese/margine.
 */
export function calcBloccoVendita(b: Blocco, q = 1): number {
  const mat = b.articoli.reduce((s, a) => s + calcNettoArticolo(a) * q, 0)
  const srv = b.servizi.reduce((s, sv) => s + calcTotaleServizio(sv) * multServizio(sv, q), 0)
  return mat + srv
}

/** Costo vergine del blocco a quantità `q` (stessa logica di scala). */
export function calcBloccoCosto(b: Blocco, q = 1): number {
  const mat = b.articoli.reduce((s, a) => s + calcCostoArticolo(a) * q, 0)
  const srv = b.servizi.reduce((s, sv) => s + calcCostoServizio(sv) * multServizio(sv, q), 0)
  return mat + srv
}

/** Imballaggio: % sul prezzo di VENDITA. */
export function calcImballaggio(baseVendita: number, pct = IMBALLAGGIO_PCT_DEFAULT): number {
  return baseVendita * (pct / 100)
}
/** Tempi accessori: % sul COSTO vergine. */
export function calcTempiAccessori(baseCosto: number, pct = TEMPI_ACCESSORI_PCT_DEFAULT): number {
  return baseCosto * (pct / 100)
}
/** Spese generali: % sul COSTO vergine. */
export function calcSpeseGenerali(baseCosto: number, pct = SPESE_GENERALI_PCT_DEFAULT): number {
  return baseCosto * (pct / 100)
}

/** Margine trattativa effettivo del blocco: override blocco o globale. */
export function margineEffettivo(b: Blocco, margineGlobale: number): number {
  return b.margine_trattativa_pct ?? margineGlobale
}

/**
 * Prezzo finale del blocco a quantità `q` (modello canonico SICS):
 *   (vendita + imballaggio[su vendita] + tempi[su costo] + spese[su costo]) × (1 + margine%).
 */
export function calcBloccoPrezzoFinale(b: Blocco, q: number, margineGlobale: number): number {
  const vend = calcBloccoVendita(b, q)
  const costo = calcBloccoCosto(b, q)
  const conAddon = vend + calcImballaggio(vend) + calcTempiAccessori(costo) + calcSpeseGenerali(costo)
  return conAddon * (1 + margineEffettivo(b, margineGlobale) / 100)
}

/** True se la data ultimo costo è più vecchia di `MESI_PREZZO_VECCHIO` mesi rispetto a oggi. */
export function prezzoVecchio(dataUltCosto: string | null | undefined): boolean {
  if (!dataUltCosto) return false
  const d = new Date(dataUltCosto)
  if (isNaN(d.getTime())) return false
  const soglia = new Date()
  soglia.setMonth(soglia.getMonth() - MESI_PREZZO_VECCHIO)
  return d.getTime() < soglia.getTime()
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
  coeff_ricarico: number
  totale: number
  scala_con_quantita: boolean
}

export interface BuilderStateBlocco {
  numero: number
  tipo: string
  nome: string
  note: string
  quantita_pezzi: number
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
  const oreTot = blocchi.reduce((s, b) => s + b.servizi.reduce((x, sv) => x + sv.ore, 0), 0)
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
      quantita_pezzi: b.quantita_pezzi ?? 1,
      articoli: b.articoli.map((a) => ({
        codice: a.codice,
        descrizione: a.descrizione,
        qty: a.qty,
        ult_costo: a.ult_costo,
        coeff_ricarico: a.coeff_ricarico,
        netto: calcNettoArticolo(a),
      })),
      lavorazioni: b.servizi.map((s) => ({
        nome: s.nome,
        categoria: s.categoria,
        ore: s.ore,
        tariffa_ora: s.tariffa_ora,
        coeff_ricarico: s.coeff_ricarico,
        totale: calcTotaleServizio(s),
        scala_con_quantita: s.scala_con_quantita,
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

/**
 * Crea un blocco vuoto. I servizi NON vengono precaricati: il blocco nasce
 * senza lavorazioni e l'utente aggiunge solo quelle che gli servono dal picker.
 */
export function creaBlocco(): Blocco {
  return {
    _key: genKey(),
    tipo: TIPI_BLOCCO[0],
    nome: "",
    note: "",
    espanso: true,
    articoli: [],
    servizi: [],
    quantita_pezzi: 1,
    margine_trattativa_pct: null,
  }
}

/** Costruisce un ServizioBlocco da un servizio del catalogo DB (eredita il default scala). */
export function servizioBloccoDaDB(s: ServizioDB): ServizioBlocco {
  return {
    _key: genKey(),
    servizio_id: s.id,
    nome: s.nome,
    categoria: s.categoria,
    tariffa_ora: s.tariffa_ora,
    ore: 1,
    coeff_ricarico: COEFF_RICARICO_DEFAULT,
    scala_con_quantita: s.scala_con_quantita ?? true,
  }
}
