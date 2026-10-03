/**
 * Chiamate alle route del Portale Campagne dal browser. Restituisce sempre un
 * oggetto, mai un'eccezione: le schermate mostrano il messaggio dell'errore
 * (che per gli errori di dominio e' scritto per l'operatore) invece di rompersi.
 */
export type RispostaApi<T> = { ok: true; dati: T } | { ok: false; errore: string };

export async function chiamaApi<T>(url: string, opzioni?: { metodo?: string; corpo?: unknown }): Promise<RispostaApi<T>> {
  try {
    const res = await fetch(url, {
      method: opzioni?.metodo ?? (opzioni?.corpo === undefined ? "GET" : "POST"),
      headers: opzioni?.corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: opzioni?.corpo === undefined ? undefined : JSON.stringify(opzioni.corpo),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok) {
      return { ok: false, errore: json?.error ?? `Errore ${res.status}` };
    }
    return { ok: true, dati: json as T };
  } catch {
    return { ok: false, errore: "Connessione non riuscita. Riprova." };
  }
}

/** "2026-07-14" → "14/07/2026", senza passare da Date: nessun fuso puo' spostare il giorno. */
export function formattaData(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [a, m, g] = iso.slice(0, 10).split("-");
  return g && m && a ? `${g}/${m}/${a}` : iso;
}

const dataOra = new Intl.DateTimeFormat("it-IT", {
  timeZone: "Europe/Rome",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formattaDataOra(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dataOra.format(d);
}

/** "ZECA, ZETEK" → ["ZECA", "ZETEK"]: un elenco si scrive come un testo. */
export const daElenco = (v: string): string[] =>
  v
    .split(/[,;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
