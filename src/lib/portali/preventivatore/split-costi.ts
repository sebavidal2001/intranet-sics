/**
 * Split dei costi (materiale / manodopera / lavorazioni) e confronto di consuntivazione.
 *
 * Nessuna dipendenza da React/Supabase: la stessa logica gira nelle route, nel builder
 * e nella pagina Consuntivazione. Le colonne seguono migration 157.
 */

export interface SplitCosti {
  materiale: number;
  manodopera: number;
  lavorazione: number;
  lav_esterna: number;
  altro: number;
}

export type ComponenteCosto = keyof SplitCosti;

/** Ordine e nomi mostrati. «Altro» raccoglie attrezzaggio, indiretti, imballo, trasporto, scarto. */
export const COMPONENTI: { chiave: ComponenteCosto; etichetta: string; breve: string }[] = [
  { chiave: "materiale", etichetta: "Materia prima", breve: "Mat." },
  { chiave: "manodopera", etichetta: "Manodopera", breve: "Mano." },
  { chiave: "lavorazione", etichetta: "Lavorazioni interne", breve: "Lav." },
  { chiave: "lav_esterna", etichetta: "Trattamenti esterni", breve: "Est." },
  { chiave: "altro", etichetta: "Altro", breve: "Altro" },
];

export const SPLIT_VUOTO: SplitCosti = { materiale: 0, manodopera: 0, lavorazione: 0, lav_esterna: 0, altro: 0 };

export function totaleSplit(s: SplitCosti): number {
  return s.materiale + s.manodopera + s.lavorazione + s.lav_esterna + s.altro;
}

export function sommaSplit(a: SplitCosti, b: SplitCosti): SplitCosti {
  return {
    materiale: a.materiale + b.materiale,
    manodopera: a.manodopera + b.manodopera,
    lavorazione: a.lavorazione + b.lavorazione,
    lav_esterna: a.lav_esterna + b.lav_esterna,
    altro: a.altro + b.altro,
  };
}

export function scalaSplit(s: SplitCosti, fattore: number): SplitCosti {
  return {
    materiale: s.materiale * fattore,
    manodopera: s.manodopera * fattore,
    lavorazione: s.lavorazione * fattore,
    lav_esterna: s.lav_esterna * fattore,
    altro: s.altro * fattore,
  };
}

/**
 * Applica a un costo le PERCENTUALI dello split di Impresa: le componenti sommano sempre
 * a `costo`, anche quando il costo del preventivo differisce dallo standard (listino
 * fornitore). Stessa regola del trigger della migration 157. L'arrotondamento finisce
 * in «altro». Senza split di Impresa tutto è materia prima («assunto»).
 */
export function applicaQuote(
  costo: number,
  riferimento: (SplitCosti & { costo_totale?: number }) | null | undefined
): { split: SplitCosti; fonte: "impresa" | "assunto" } {
  const tot = riferimento ? riferimento.costo_totale ?? totaleSplit(riferimento) : 0;
  if (!riferimento || !(tot > 0)) {
    return { split: { ...SPLIT_VUOTO, materiale: costo }, fonte: "assunto" };
  }
  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const materiale = r6((costo * riferimento.materiale) / tot);
  const manodopera = r6((costo * riferimento.manodopera) / tot);
  const lavorazione = r6((costo * riferimento.lavorazione) / tot);
  const lav_esterna = r6((costo * riferimento.lav_esterna) / tot);
  return {
    split: { materiale, manodopera, lavorazione, lav_esterna, altro: costo - materiale - manodopera - lavorazione - lav_esterna },
    fonte: "impresa",
  };
}

/** Riga di consuntivo come torna dall'API (totali della selezione + riferimento per unità). */
export interface ConsuntivoNumeri {
  quantita_articolo: number;
  prev_materiale: number;
  prev_manodopera: number;
  prev_lavorazione: number;
  prev_lav_esterna: number;
  prev_altro: number;
  prev_totale: number;
  rif_materiale: number | null;
  rif_manodopera: number | null;
  rif_lavorazione: number | null;
  rif_lav_esterna: number | null;
  rif_altro: number | null;
  rif_totale: number | null;
}

export interface RigaConfronto {
  chiave: ComponenteCosto | "totale";
  etichetta: string;
  /** Preventivato per unità di articolo. */
  preventivato: number;
  /** Riferimento di Impresa per unità; null se Impresa non ha costo per questo codice. */
  riferimento: number | null;
  /** riferimento − preventivato: positivo = il costo reale supera il preventivo (sottostima). */
  scostamento: number | null;
  /** Scostamento sul preventivato, in %; null se il preventivato è zero. */
  scostamentoPct: number | null;
}

export type Verdetto = "in_linea" | "sottostimato" | "sovrastimato" | "senza_riferimento";

/** Sotto questa soglia (in %, in valore assoluto) il preventivo è considerato in linea. */
export const SOGLIA_IN_LINEA_PCT = 2;

export function verdettoDaPercentuale(pct: number | null): Verdetto {
  if (pct == null) return "senza_riferimento";
  if (Math.abs(pct) < SOGLIA_IN_LINEA_PCT) return "in_linea";
  return pct > 0 ? "sottostimato" : "sovrastimato";
}

export const ETICHETTA_VERDETTO: Record<Verdetto, string> = {
  in_linea: "In linea",
  sottostimato: "Sottostimato",
  sovrastimato: "Sovrastimato",
  senza_riferimento: "Senza riferimento",
};

/** Confronto per componente + totale, tutto per unità di articolo. */
export function confrontaConsuntivo(c: ConsuntivoNumeri): { righe: RigaConfronto[]; totale: RigaConfronto; verdetto: Verdetto } {
  const q = c.quantita_articolo > 0 ? c.quantita_articolo : 1;
  const prev: SplitCosti = {
    materiale: c.prev_materiale / q,
    manodopera: c.prev_manodopera / q,
    lavorazione: c.prev_lavorazione / q,
    lav_esterna: c.prev_lav_esterna / q,
    altro: c.prev_altro / q,
  };
  const rif: Record<ComponenteCosto, number | null> = {
    materiale: c.rif_materiale,
    manodopera: c.rif_manodopera,
    lavorazione: c.rif_lavorazione,
    lav_esterna: c.rif_lav_esterna,
    altro: c.rif_altro,
  };
  const costruisci = (chiave: RigaConfronto["chiave"], etichetta: string, p: number, r: number | null): RigaConfronto => {
    const scostamento = r == null ? null : r - p;
    return {
      chiave,
      etichetta,
      preventivato: p,
      riferimento: r,
      scostamento,
      scostamentoPct: scostamento == null || Math.abs(p) < 1e-9 ? null : (scostamento / p) * 100,
    };
  };
  const righe = COMPONENTI.map((k) => costruisci(k.chiave, k.etichetta, prev[k.chiave], rif[k.chiave]));
  const totale = costruisci("totale", "Totale", c.prev_totale / q, c.rif_totale);
  return { righe, totale, verdetto: verdettoDaPercentuale(totale.scostamentoPct) };
}
