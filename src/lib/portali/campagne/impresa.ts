import { logError } from "@/lib/logger";
import { dashboard, db, ErroreCampagne, ok, schedaCliente, tuttePagine } from "./dati";
import type {
  Anomalia,
  ControlloEseguito,
  DaPreparare,
  DashboardCampagne,
  OrdineAperto,
  SchedaCliente,
  TipoAnomalia,
} from "./tipi";

/**
 * Letture della Fase 2: cio' che arriva da Impresa (ordini aperti, "da preparare")
 * e il risultato del controllo (anomalie, ultimo controllo).
 *
 * Tollerano l'assenza della migration 132 o delle viste `bi_*` (per esempio su un
 * database di sviluppo che non le ha): la scheda e la home devono continuare a
 * funzionare con quello che c'e', non rompersi. L'errore va nel log.
 */
async function tollera<T>(contesto: string, fallback: T, lettura: () => Promise<T>): Promise<T> {
  try {
    return await lettura();
  } catch (e) {
    logError(`campagne.impresa.${contesto}`, "lettura non riuscita, si prosegue senza", e);
    return fallback;
  }
}

// ─── Dati di Impresa ───────────────────────────────────────────────────────
export async function ordiniApertiCliente(codice: string): Promise<OrdineAperto[]> {
  return tollera("ordini-aperti", [], async () => {
    const r = await db().rpc("ordini_aperti_cliente", { p_cliente: codice });
    return (ok("ordini aperti del cliente", r) ?? []) as OrdineAperto[];
  });
}

/** Gli ordini recenti che aspettano la loro busta (il rosso). */
export async function elencoDaPreparare(giorni = 14): Promise<DaPreparare[]> {
  return tollera("da-preparare", [], () =>
    tuttePagine<DaPreparare>("da preparare", (da, a) => db().rpc("da_preparare", { p_giorni: giorni }).range(da, a))
  );
}

// ─── Anomalie ──────────────────────────────────────────────────────────────
export interface FiltroAnomalie {
  stato?: Anomalia["stato"];
  tipo?: TipoAnomalia;
  codice_cliente?: string;
}

export async function elencoAnomalie(f: FiltroAnomalie = {}): Promise<Anomalia[]> {
  return tollera("anomalie", [], async () => {
    let q = db().from("anomalie").select("*").eq("stato", f.stato ?? "aperta");
    if (f.tipo) q = q.eq("tipo", f.tipo);
    if (f.codice_cliente) q = q.eq("codice_cliente", f.codice_cliente);
    const r = await q.order("gravita").order("aperta_il", { ascending: false }).limit(500);
    return (ok("elenco anomalie", r) ?? []) as Anomalia[];
  });
}

export async function contaAnomalieAperte(): Promise<number> {
  return tollera("conta-anomalie", 0, async () => {
    const r = await db().from("anomalie").select("id", { count: "exact", head: true }).eq("stato", "aperta").eq("gravita", "errore");
    if (r.error) throw new Error(r.error.message);
    return r.count ?? 0;
  });
}

export async function ultimoControllo(): Promise<ControlloEseguito | null> {
  return tollera("ultimo-controllo", null, async () => {
    const r = await db().from("controlli").select("*").order("iniziato_il", { ascending: false }).limit(1).maybeSingle();
    return (ok("ultimo controllo", r) ?? null) as ControlloEseguito | null;
  });
}

/**
 * Lascia aperta una anomalia scegliendo di non correggerla. Resta `ignorata`
 * finche' la condizione dura (il controllo non la riapre ogni notte) e si chiude
 * da sola quando la condizione sparisce.
 */
export async function ignoraAnomalia(id: string, nota: string, userId: string): Promise<Anomalia> {
  const r = await db()
    .from("anomalie")
    .update({ stato: "ignorata", nota, risolta_con: "manuale", risolta_da: userId })
    .eq("id", id)
    .eq("stato", "aperta")
    .select("*");
  const righe = (ok("anomalia ignorata", r) ?? []) as Anomalia[];
  if (righe.length === 0) throw new ErroreCampagne(409, "L'anomalia non è più aperta: ricarica la pagina.");
  return righe[0];
}

// ─── Composizione per le schermate ─────────────────────────────────────────
/** La scheda cliente completa: Fase 1 (storico, assegnabili) piu' ordini aperti e anomalie. */
export async function schedaClienteCompleta(codice: string): Promise<SchedaCliente> {
  const base = await schedaCliente(codice);
  const [ordini_aperti, anomalie] = await Promise.all([
    ordiniApertiCliente(base.cliente.codice_cliente),
    elencoAnomalie({ codice_cliente: base.cliente.codice_cliente }),
  ]);
  return { ...base, ordini_aperti, anomalie };
}

/** I contatori della home. */
export async function dashboardCompleta(): Promise<DashboardCampagne> {
  const [base, daPreparare, anomalie, ultimo] = await Promise.all([
    dashboard(),
    elencoDaPreparare(),
    contaAnomalieAperte(),
    ultimoControllo(),
  ]);
  return { ...base, da_preparare: daPreparare.length, anomalie, ultimo_controllo: ultimo };
}

// ─── Freschezza dell'anagrafica clienti ────────────────────────────────────
export interface StatoAnagraficaClienti {
  stato: "ok" | "attenzione" | "critico";
  motivi: string[];
  ultimo_aggiornamento: string | null;
  ore_dall_aggiornamento: number | null;
  clienti: number;
  falliti_48h: number;
  ultimo_errore: string | null;
}

/**
 * Lo stato del caricamento notturno dei clienti da Impresa (migration 141). Se la
 * funzione non c'e' (database di sviluppo) o la lettura non riesce torna `null`: la
 * barra non compare, il portale lavora lo stesso.
 */
export async function statoAnagraficaClienti(): Promise<StatoAnagraficaClienti | null> {
  return tollera<StatoAnagraficaClienti | null>("anagrafica-clienti", null, async () => {
    const r = await db().rpc("anagrafica_clienti_stato");
    return (ok("stato anagrafica clienti", r) ?? null) as StatoAnagraficaClienti | null;
  });
}
