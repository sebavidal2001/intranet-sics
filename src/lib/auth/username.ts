/**
 * Auth con username — strategia:
 * Supabase Auth richiede email. Usiamo `username@sics.interno` come email tecnica
 * invisibile all'utente. L'utente inserisce solo username + password.
 */

export function usernameToEmail(username: string): string {
  return `${username.trim().toLowerCase()}@sics.interno`
}
