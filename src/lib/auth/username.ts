/**
 * Auth con username — strategia attuale (dal 2026-05-26):
 *
 * Supabase Auth richiede un'email. Il dominio aziendale tecnico ufficiale è
 * `@s-ics.com`. Il vecchio dominio `@sics.interno` è stato dismesso il
 * 2026-05-26 (vedi `scripts/migrate-domain-legacy.cjs` + Vault Auth).
 *
 * - Utenti **con username** → la funzione costruisce automaticamente
 *   `username@s-ics.com` per il login.
 * - Utenti **con email personale** (senza username) → digitano la propria
 *   email completa nel campo "Username o email": il sistema vede il `@`
 *   nell'input e la usa tal quale, senza costruire alcun dominio.
 */

export const USERNAME_EMAIL_DOMAIN = "s-ics.com";

/**
 * @deprecated dominio legacy dismesso il 2026-05-26.
 * Mantenuto per retro-compatibilità su import esistenti, ma non più usato nel flusso login.
 */
export const USERNAME_EMAIL_DOMAIN_LEGACY = "sics.interno";

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}

/**
 * @deprecated alias di `usernameToEmail` — usa direttamente quella.
 */
export function usernameToEmailNew(username: string): string {
  return usernameToEmail(username);
}

/**
 * Ritorna i candidati email da provare per il login.
 *
 * - Se l'input è già un'email completa (contiene `@`): viene usato tal quale.
 *   Caso degli utenti senza mail aziendale, registrati con email personale.
 * - Altrimenti è uno username: si costruisce `<username>@s-ics.com`.
 *   (Il dominio legacy `@sics.interno` non è più tentato dal 2026-05-26.)
 */
export function usernameToEmailCandidates(username: string): string[] {
  const u = username.trim().toLowerCase();
  if (u.includes("@")) {
    return [u];
  }
  return [`${u}@${USERNAME_EMAIL_DOMAIN}`];
}
