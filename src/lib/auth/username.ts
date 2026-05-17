/**
 * Auth con username — strategia:
 * Supabase Auth richiede email. Storicamente abbiamo usato `username@sics.interno`
 * come email tecnica. Stiamo migrando al dominio aziendale reale `s-ics.com`.
 *
 * Durante la migrazione, il login prova entrambi i domini in ordine
 * (legacy prima, poi nuovo) per non rompere gli utenti già esistenti.
 *
 * - `usernameToEmail()` ritorna l'email "legacy" per retro-compatibilità
 *   con codice esistente che si aspetta un singolo valore.
 * - `usernameToEmailCandidates()` ritorna entrambe le forme: usala per il login.
 * - I nuovi utenti vengono creati direttamente con `USERNAME_EMAIL_DOMAIN`
 *   (vedi `superadmin/utenti/actions.ts`).
 */

export const USERNAME_EMAIL_DOMAIN = "s-ics.com";
export const USERNAME_EMAIL_DOMAIN_LEGACY = "sics.interno";

export function usernameToEmail(username: string): string {
  // Retro-compatibilità: ritorna il dominio LEGACY perché tutti gli utenti
  // attuali in auth.users esistono ancora con quella email.
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN_LEGACY}`;
}

export function usernameToEmailNew(username: string): string {
  return `${username.trim().toLowerCase()}@${USERNAME_EMAIL_DOMAIN}`;
}

/** Ritorna i candidati email da provare per il login (legacy + nuovo). */
export function usernameToEmailCandidates(username: string): string[] {
  const u = username.trim().toLowerCase();
  return [
    `${u}@${USERNAME_EMAIL_DOMAIN_LEGACY}`,
    `${u}@${USERNAME_EMAIL_DOMAIN}`,
  ];
}
