/**
 * Lettura grezza delle viste `public.bi_*`, per i test di riconciliazione.
 *
 * Perché serve
 * ------------
 * Diversi test confrontavano lo snapshot con numeri scritti a mano nel
 * sorgente — `expect(righe.length).toBe(6476)`, `toBe(6_454_654)` — presi da
 * una SELECT fatta un giorno preciso su un database preciso. Quei test
 * passavano solo lì: sul database di produzione fallivano tutti insieme
 * (il 18/09/2026, nove su nove), non perché il codice fosse rotto ma perché i
 * dati erano altri. Verificato allora: la vista diceva 760 righe per COSTRUITO
 * e lo snapshot diceva 760 — coincidevano, era l'atteso a essere vecchio.
 *
 * Un rosso che torna ogni volta insegna a ignorare il rosso, ed è peggio di un
 * test mancante.
 *
 * Quello che quei test vogliono davvero verificare non è "il fatturato vale
 * 6.454.654" — quello cambia ogni notte ed è giusto che cambi — ma che lo
 * snapshot **non alteri** ciò che legge: stesse righe, stessi totali, stessi
 * raggruppamenti. Per dimostrarlo l'atteso va calcolato dalla stessa fonte,
 * nello stesso istante. Da qui in avanti i test riconciliano, e non invecchiano.
 */
import { createClient } from "@supabase/supabase-js";

/** PostgREST non restituisce più di 1.000 righe per richiesta. */
const PAGINA = 1000;

export type RigaVista = Record<string, unknown>;

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const chiave = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !chiave) {
    throw new Error(
      "Mancano NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: chiamare caricaEnvLocale() nel beforeAll",
    );
  }
  return createClient(url, chiave, { auth: { persistSession: false } });
}

/** Scarica una vista per intero, a pagine. */
export async function leggiVista(vista: string): Promise<RigaVista[]> {
  const sb = client();
  const { count, error } = await sb.from(vista).select("*", { count: "exact", head: true });
  if (error) throw new Error(`Conteggio ${vista}: ${error.message}`);
  const totale = count ?? 0;

  const righe: RigaVista[] = [];
  for (let da = 0; da < totale; da += PAGINA) {
    const { data, error: e } = await sb
      .from(vista)
      .select("*")
      .range(da, da + PAGINA - 1);
    if (e) throw new Error(`Lettura ${vista} da ${da}: ${e.message}`);
    righe.push(...((data ?? []) as RigaVista[]));
  }
  return righe;
}

export function numero(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function testo(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}

/** Somma un campo raggruppando per un altro, come farebbe un GROUP BY. */
export function raggruppa(
  righe: RigaVista[],
  campoChiave: string,
  campoValore: string,
): Map<string, { somma: number; conteggio: number }> {
  const mappa = new Map<string, { somma: number; conteggio: number }>();
  for (const r of righe) {
    const k = testo(r[campoChiave]);
    const corrente = mappa.get(k) ?? { somma: 0, conteggio: 0 };
    corrente.somma += numero(r[campoValore]);
    corrente.conteggio += 1;
    mappa.set(k, corrente);
  }
  return mappa;
}
