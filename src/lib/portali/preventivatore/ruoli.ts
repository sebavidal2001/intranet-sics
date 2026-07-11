import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Ruoli funzionali del portale Preventivatore (slug stabili, vedi migration 039).
 * Sono assegnati per utente in `preventivatore.utente_ruoli_funzionali`.
 */
export const PREVENTIVATORE_RUOLI = {
  commerciale: "commerciale",
  preventivatore: "preventivatore",
  back_office: "back_office",
} as const;

export type PreventivatoreRuoloSlug =
  (typeof PREVENTIVATORE_RUOLI)[keyof typeof PREVENTIVATORE_RUOLI];

/**
 * Codice del portfolio "casa SICS": visibile a TUTTI i commerciali oltre ai
 * propri clienti. Eccezione esplicita richiesta dall'utente.
 */
export const AGENTE_AIRFLUID = "AIRFLUID";

/**
 * Ritorna i ruoli funzionali (slug) associati a un utente nel Preventivatore.
 * Array vuoto se l'utente non ha ruoli assegnati.
 */
export async function getRuoliFunzionali(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .schema("preventivatore")
    .from("utente_ruoli_funzionali")
    .select("ruolo:ruoli_funzionali(slug)")
    .eq("utente_id", userId);
  return (
    ((data ?? []) as unknown as Array<{ ruolo: { slug: string } | null }>)
      .map((r) => r.ruolo?.slug)
      .filter((s): s is string => Boolean(s))
  );
}

/**
 * Ritorna il codice agente del commerciale (dal campo `utenti.preventivatore_agente_codice`).
 * Null se non assegnato (= l'utente vede tutto, non è un commerciale "ristretto").
 */
export async function getAgenteCodice(userId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("utenti")
    .select("preventivatore_agente_codice")
    .eq("id", userId)
    .maybeSingle();
  return (data?.preventivatore_agente_codice as string | null) ?? null;
}

export type PreventivatoreLivello =
  "viewer" | "exporter" | "admin" | "superadmin" | null;

/**
 * Contesto permessi Preventivatore di un utente, caricato in UNA sola query
 * (RPC `get_preventivatore_context`, migration 064) invece dei 3 round-trip
 * seriali storici (get_portale_livello + ruoli funzionali + agente_codice).
 */
export interface PreventivatoreContext {
  livello: PreventivatoreLivello;
  ruoli: string[];
  agenteCodice: string | null;
}

export async function getPreventivatoreContext(
  userId: string
): Promise<PreventivatoreContext> {
  const admin = createAdminClient();
  const { data } = await admin.rpc("get_preventivatore_context", {
    p_user_id: userId,
  });
  const ctx = (data ?? {}) as {
    livello?: string | null;
    ruoli?: string[] | null;
    agente_codice?: string | null;
  };
  return {
    livello: (ctx.livello as PreventivatoreLivello) ?? null,
    ruoli: ctx.ruoli ?? [],
    agenteCodice: ctx.agente_codice ?? null,
  };
}

/**
 * Versione sincrona di {@link getFiltroCommerciale} che lavora su un contesto
 * già caricato (nessuna query). Preferirla nei route handler che hanno già
 * chiamato {@link getPreventivatoreContext}.
 */
export function filtroCommercialeFromContext(
  ctx: PreventivatoreContext
): string | null {
  if (ctx.livello === "admin" || ctx.livello === "superadmin") return null;
  const isCommerciale = ctx.ruoli.includes(PREVENTIVATORE_RUOLI.commerciale);
  const haAccessoTotale =
    ctx.ruoli.includes(PREVENTIVATORE_RUOLI.preventivatore) ||
    ctx.ruoli.includes(PREVENTIVATORE_RUOLI.back_office);
  if (!isCommerciale || haAccessoTotale) return null;
  return ctx.agenteCodice ?? null;
}

/**
 * Decide se applicare il filtro "vedi solo i miei clienti" all'utente:
 * - L'utente DEVE avere il ruolo funzionale 'commerciale'
 * - E NON deve avere ruoli che gli danno accesso totale (preventivatore, back_office)
 * - E deve avere un `preventivatore_agente_codice` assegnato
 *
 * Returns null se NON filtrare (l'utente vede tutto), altrimenti il codice agente
 * del commerciale (clienti suoi + AIRFLUID).
 *
 * @deprecated Preferire {@link getPreventivatoreContext} +
 * {@link filtroCommercialeFromContext} (1 sola query invece di 2-3). Mantenuta
 * per i route handler non ancora migrati.
 */
export async function getFiltroCommerciale(
  userId: string,
  livello: PreventivatoreLivello
): Promise<string | null> {
  // Admin e superadmin vedono tutto, sempre.
  if (livello === "admin" || livello === "superadmin") return null;

  const ruoli = await getRuoliFunzionali(userId);
  const isCommerciale = ruoli.includes(PREVENTIVATORE_RUOLI.commerciale);
  const haAccessoTotale =
    ruoli.includes(PREVENTIVATORE_RUOLI.preventivatore) ||
    ruoli.includes(PREVENTIVATORE_RUOLI.back_office);

  if (!isCommerciale || haAccessoTotale) return null;

  const codice = await getAgenteCodice(userId);
  if (!codice) return null; // commerciale senza codice associato: vede tutto (degraded mode)
  return codice;
}

/**
 * Costruisce il sotto-filtro PostgREST per restringere `documenti` ai soli
 * preventivi dei clienti del commerciale (+ sempre AIRFLUID).
 * Da applicare nelle query elenco/dettaglio quando `getFiltroCommerciale` ritorna non-null.
 *
 * Implementazione: filtro su `cliente_master_id IN (SELECT id FROM clienti_master
 * WHERE agente_codice IN (<codice>, 'AIRFLUID'))`.
 */
export async function getIdClientiVisibili(agenteCodice: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .schema("preventivatore")
    .from("clienti_master")
    .select("id")
    .in("agente_codice", [agenteCodice, AGENTE_AIRFLUID])
    .eq("attivo", true);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Scope commerciale unificato del Preventivatore. Da usare in TUTTE le viste che
 * leggono dati preventivi (lista, dettaglio, stats, dashboard, BI, tool AI) per
 * applicare in modo coerente il filtro "vedo solo i miei clienti".
 *
 * - `restricted = false` → l'utente vede tutto (admin/back_office/preventivatore o
 *   commerciale senza codice). `clienteIds` ignorato.
 * - `restricted = true`  → commerciale ristretto: `clienteIds` = cliente_master_id
 *   visibili (clienti del suo agente + AIRFLUID). Può essere vuoto (= vede 0 record).
 */
export interface PreventivatoreScope {
  restricted: boolean;
  agenteCodice: string | null;
  clienteIds: string[];
}

export async function getPreventivatoreScope(
  userId: string,
  livello: "viewer" | "exporter" | "admin" | "superadmin" | null
): Promise<PreventivatoreScope> {
  const agente = await getFiltroCommerciale(userId, livello);
  if (!agente) return { restricted: false, agenteCodice: null, clienteIds: [] };
  const clienteIds = await getIdClientiVisibili(agente);
  return { restricted: true, agenteCodice: agente, clienteIds };
}

// Re-export tipo SupabaseClient per consumatori che non vogliono importare il pacchetto
export type { SupabaseClient };
