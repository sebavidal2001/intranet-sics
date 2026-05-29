// ─── Tipi e compute dei template prodotti ───────────────────────────────────
import { evalFormula, risolviQuantita, type Scope } from "./formula";

export type ParametroTipo = "number" | "select" | "bool";
export type UnitaTempo = "min" | "h";
export type ModalitaManodopera = "per_pezzo" | "una_tantum";

export interface TemplateParametro {
  id?: string;
  slug: string;
  label: string;
  tipo: ParametroTipo;
  unita?: string | null;
  valore_default?: string | null;
  opzioni?: string[] | null;
  ordine?: number;
}

export interface TemplateRigaMateriale {
  id?: string;
  slug?: string | null;
  descrizione: string;
  codice_articolo?: string | null;
  costo_manuale?: number | null;
  usa_listino?: boolean;
  ricarico_default: number;
  qta_formula?: string | null;
  qta_manuale?: number;
  gruppo?: string | null;
  ordine?: number;
  // risolto lato server (non in tabella):
  costo_corrente?: number | null;
  data_ult_costo?: string | null;
}

export interface TemplateRigaManodopera {
  id?: string;
  label: string;
  tariffa_default: number;
  unita_tempo: UnitaTempo;
  tempo_formula?: string | null;
  tempo_default?: number;
  modalita: ModalitaManodopera;
  ricarico_default: number;
  ordine?: number;
}

export interface TemplateProdotto {
  id?: string;
  nome: string;
  slug: string;
  descrizione?: string | null;
  attivo: boolean;
  ordine: number;
  consegna_settimane_min?: number | null;
  consegna_settimane_max?: number | null;
  imballaggio_pct: number;
  tempi_accessori_pct: number;
  spese_generali_pct: number;
  margine_default_pct: number;
  ricarico_materiale_default: number;
  ricarico_manodopera_default: number;
  parametri: TemplateParametro[];
  righe_materiale: TemplateRigaMateriale[];
  righe_manodopera: TemplateRigaManodopera[];
}

/** Costruisce lo scope (slug → valore) dai parametri e dai loro valori correnti. */
export function scopeParametri(
  parametri: TemplateParametro[],
  valori: Record<string, string | number | boolean>
): Scope {
  const scope: Scope = {};
  for (const p of parametri) {
    const v = valori[p.slug] ?? p.valore_default ?? 0;
    scope[p.slug] = v;
  }
  return scope;
}

/** Articolo risolto dal template, formato compatibile col builder. */
export interface ArticoloCalcolato {
  codice: string;
  descrizione: string;
  qty: number;
  ult_costo: number;
  coeff_ricarico: number;
  data_ult_costo: string | null;
  manuale: boolean;
  slug: string | null;
  qta_formula: string | null;
}

export interface ServizioCalcolato {
  nome: string;
  categoria: string;
  ore: number;
  tariffa_ora: number;
  coeff_ricarico: number;
  scala_con_quantita: boolean;
}

/** Calcola le righe materiale (quantità via formule + costi risolti). */
export function calcolaArticoli(
  template: TemplateProdotto,
  valoriParametri: Record<string, string | number | boolean>
): ArticoloCalcolato[] {
  const scope = scopeParametri(template.parametri, valoriParametri);
  const qtaMap = risolviQuantita(
    template.righe_materiale.map((r) => ({
      slug: r.slug ?? null,
      qta_formula: r.qta_formula ?? null,
      qta_manuale: r.qta_manuale ?? 0,
    })),
    scope
  );
  return template.righe_materiale.map((r, idx) => {
    const qty = qtaMap.get(String(idx)) ?? r.qta_manuale ?? 0;
    // Costo: listino (placeholder) > corrente anagrafica > manuale
    const costo = r.usa_listino
      ? (r.costo_corrente ?? 0) // prezzo_listino non ancora disponibile → 0
      : (r.costo_corrente ?? r.costo_manuale ?? 0);
    return {
      codice: r.codice_articolo ?? "",
      descrizione: r.descrizione,
      qty,
      ult_costo: costo,
      coeff_ricarico: r.ricarico_default,
      data_ult_costo: r.data_ult_costo ?? null,
      manuale: !r.codice_articolo,
      slug: r.slug ?? null,
      qta_formula: r.qta_formula ?? null,
    };
  });
}

/** Calcola le righe manodopera (tempo via formula o default; min→ore). */
export function calcolaServizi(
  template: TemplateProdotto,
  valoriParametri: Record<string, string | number | boolean>
): ServizioCalcolato[] {
  const scope = scopeParametri(template.parametri, valoriParametri);
  return template.righe_manodopera.map((r) => {
    let tempo = r.tempo_formula ? safeEval(r.tempo_formula, scope) : (r.tempo_default ?? 0);
    if (r.unita_tempo === "min") tempo = tempo / 60; // builder lavora in ore
    return {
      nome: r.label,
      categoria: "",
      ore: tempo,
      tariffa_ora: r.tariffa_default,
      coeff_ricarico: r.ricarico_default,
      scala_con_quantita: r.modalita === "per_pezzo",
    };
  });
}

function safeEval(expr: string, scope: Scope): number {
  try { return evalFormula(expr, scope); } catch { return 0; }
}
