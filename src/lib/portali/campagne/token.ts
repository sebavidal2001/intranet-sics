import { createHash, timingSafeEqual } from "crypto";

/**
 * Controlla un `Authorization: Bearer <token>` contro il segreto atteso, in tempo
 * costante. Si confrontano gli hash e non le stringhe: `timingSafeEqual` pretende
 * la stessa lunghezza, e confrontare le lunghezze direttamente rivelerebbe quella
 * del segreto.
 *
 * Un segreto assente o troppo corto (meno di 24 caratteri) non autorizza mai
 * nessuno: meglio un controllo notturno che non parte, e si vede, che una porta
 * aperta con un token indovinabile.
 */
export const LUNGHEZZA_MINIMA_TOKEN = 24;

export function tokenValido(intestazione: string | null | undefined, atteso: string | null | undefined): boolean {
  if (!atteso || atteso.length < LUNGHEZZA_MINIMA_TOKEN) return false;
  const m = /^Bearer (.+)$/.exec(intestazione ?? "");
  if (!m) return false;
  const hash = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(hash(m[1]), hash(atteso));
}
