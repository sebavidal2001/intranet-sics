/**
 * Helper di escaping per i filtri PostgREST.
 *
 * Dentro `.or(...)` la sintassi è `campo.op.valore,campo.op.valore` racchiusa
 * tra parentesi: un valore utente che contiene `,` o `)` chiude il gruppo in
 * anticipo e cambia la forma della query. `%` e `_` sono invece i metacaratteri
 * di LIKE: non scapparli trasforma una ricerca in un match troppo ampio.
 *
 * Esisteva già in `chat/tool-handlers.ts` ma le route `documenti` e `clienti`
 * scappavano solo `% _ ,`, lasciando fuori le parentesi. Ora è un modulo a sé
 * così che ci sia una sola definizione da usare ovunque.
 */
export function escapeIlike(s: string): string {
  return s.replace(/[%_,()\\]/g, (c) => `\\${c}`);
}
