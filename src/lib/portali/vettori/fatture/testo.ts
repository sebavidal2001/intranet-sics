/**
 * Utilità di lettura del testo delle fatture.
 *
 * Tutto quello che qui dentro non riesce a leggere un numero restituisce `null`,
 * mai zero. Zero è un importo, e un importo sbagliato di zero euro passa
 * inosservato in un controllo che confronta importi.
 */

/**
 * Converte un numero scritto all'italiana in numero.
 *
 * Le fatture usano il punto come separatore delle migliaia e la virgola come
 * decimale: `1.013,22`. Passarlo a `Number()` così com'è dà `NaN` su GLS e —
 * peggio — dà `1.013` su un importo scritto senza decimali.
 */
export function numeroIt(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s/g, "");
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Come {@link numeroIt} ma restituisce 0 quando manca: solo per gli accumulatori. */
export function numeroItO(v: string | null | undefined): number {
  return numeroIt(v) ?? 0;
}

/** Interi semplici (colli, conteggi). */
export function interoIt(v: string | null | undefined): number | null {
  const n = numeroIt(v);
  return n == null ? null : Math.round(n);
}

/**
 * Data da `gg/mm/aa` o `gg/mm/aaaa` a `aaaa-mm-gg`.
 *
 * L'anno a due cifre si interpreta nel secolo corrente: le fatture in gioco
 * sono del 2026, e una fattura del 1926 non esiste.
 */
export function dataIt(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const [, g, me, a] = m;
  const anno = a.length === 2 ? 2000 + Number(a) : Number(a);
  const mese = Number(me);
  const giorno = Number(g);
  if (mese < 1 || mese > 12 || giorno < 1 || giorno > 31) return null;
  return `${anno}-${String(mese).padStart(2, "0")}-${String(giorno).padStart(2, "0")}`;
}

/** Percentuale scritta come `13,00` o `24,30 %` → frazione. */
export function percentualeIt(v: string | null | undefined): number | null {
  const n = numeroIt(String(v ?? "").replace("%", ""));
  return n == null ? null : n / 100;
}

/**
 * Normalizza un numero di riferimento per l'aggancio: maiuscolo, senza
 * punteggiatura e senza zeri iniziali.
 *
 * Serve perché lo stesso documento compare come `764`, `0764` e `DDT26-0818`
 * a seconda di chi lo scrive. Restituisce `null` sui segnaposto — `0`, `XXX`,
 * `-` — che nelle fatture significano «riferimento assente», non un numero.
 */
export function normalizzaRiferimento(v: string | null | undefined): string | null {
  if (!v) return null;
  const pulito = String(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!pulito) return null;
  const senzaZeri = pulito.replace(/^0+/, "");
  if (!senzaZeri) return null; // era tutto zeri: segnaposto, non riferimento
  if (/^X+$/.test(senzaZeri)) return null;
  return senzaZeri;
}

/** Spezza il testo in righe pulite, senza vuote. */
export function righe(testo: string): string[] {
  return testo
    .split(/\r?\n/)
    .map((r) => r.replace(/ /g, " ").trimEnd())
    .filter((r) => r.trim().length > 0);
}

/** Tutti i token numerici di una riga, in ordine. */
export function numeriDi(riga: string): number[] {
  const trovati = riga.match(/-?\d[\d.]*(?:,\d+)?/g) ?? [];
  return trovati.map((t) => numeroIt(t)).filter((n): n is number => n != null);
}
