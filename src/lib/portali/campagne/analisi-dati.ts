import { db, leggiCampagna, ok } from "./dati";
import { FINESTRE, riassumi, type Finestra, type RigaAnalisi, type RiepilogoAnalisi } from "./analisi";
import type { CampagnaRiepilogo } from "./tipi";

/** Legge l'analisi di una campagna dal database (funzioni della migration 134). Solo lato server. */

export interface AnalisiCampagna {
  campagna: CampagnaRiepilogo;
  /** Primo e ultimo giorno coperti dal fatturato. */
  storico: { dal: string; al: string } | null;
  mesi: Finestra;
  righe: RigaAnalisi[];
  /** Lo stesso riepilogo per ogni finestra, per il confronto 3/6/12 mesi. */
  confronto: RiepilogoAnalisi[];
}

interface RigaDb {
  codice_cliente: string;
  ragione_sociale: string | null;
  agente_nome: string | null;
  data_invio: string;
  prima_tot: number | string;
  dopo_tot: number | string;
  prima_prom: number | string | null;
  dopo_prom: number | string | null;
  mai_prima_prom: boolean | null;
  prima_completa: boolean;
  dopo_completa: boolean;
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

const rigaDaDb = (r: RigaDb): RigaAnalisi => ({
  ...r,
  prima_tot: Number(r.prima_tot),
  dopo_tot: Number(r.dopo_tot),
  prima_prom: num(r.prima_prom),
  dopo_prom: num(r.dopo_prom),
});

async function righeFinestra(campagnaId: string, mesi: number): Promise<RigaAnalisi[]> {
  const r = await db().rpc("analisi_clienti", { p_campagna: campagnaId, p_mesi: mesi });
  return ((ok("analisi_clienti", r as never) as RigaDb[] | null) ?? []).map(rigaDaDb);
}

export async function analisiCampagna(campagnaId: string, mesi: Finestra): Promise<AnalisiCampagna> {
  const campagna = await leggiCampagna(campagnaId);
  const promossi = campagna.articoli_promossi.length > 0;

  const [estremi, ...perFinestra] = await Promise.all([
    db().rpc("fatturato_estremi"),
    ...FINESTRE.map((m) => righeFinestra(campagnaId, m)),
  ]);
  const e = (ok("fatturato_estremi", estremi as never) as { dal: string; al: string }[] | null)?.[0] ?? null;

  const righe = perFinestra[FINESTRE.indexOf(mesi)];
  return {
    campagna,
    storico: e && e.dal && e.al ? { dal: e.dal, al: e.al } : null,
    mesi,
    righe,
    confronto: FINESTRE.map((m, i) => riassumi(perFinestra[i], m, promossi)),
  };
}
