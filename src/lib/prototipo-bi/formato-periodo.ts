/**
 * Le date come si leggono in Italia.
 *
 * Il motore chiama i periodi con chiavi ordinabili (`2026-10-05`, `2026-10`,
 * `2026`): vanno bene per ordinare e raggruppare, ma nella tabella chi legge si
 * aspetta `05/10/2026`. Qui si traduce solo cio' che e' inequivocabilmente una
 * data; ogni altro valore (un cliente, una settimana `2026-W40`) resta com'e'.
 */

/** `2026-10-05` → `05/10/2026`, `2026-10` → `10/2026`; il resto invariato. */
export function formattaPeriodo(valore: string): string {
  const giorno = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valore);
  if (giorno) return `${giorno[3]}/${giorno[2]}/${giorno[1]}`;
  const mese = /^(\d{4})-(\d{2})$/.exec(valore);
  if (mese) return `${mese[2]}/${mese[1]}`;
  return valore;
}
