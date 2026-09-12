/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Calendario aziendale: giorni lavorativi, chiusure, settimane ISO.
 *
 * Serve a evitare l'errore che il PBIX attuale non gestisce: confrontare un
 * mese di 22 giorni lavorativi con uno di 12 (agosto 2026, chiusura estiva
 * verificata: 10–23 agosto senza un solo ordine) e concludere che il mercato
 * è crollato.
 */

import type { Chiusura } from "./tipi";

/** Festività nazionali italiane fisse (giorno-mese). */
const FESTIVITA_FISSE = [
  "01-01", // Capodanno
  "01-06", // Epifania
  "04-25", // Liberazione
  "05-01", // Festa del lavoro
  "06-02", // Repubblica
  "08-15", // Ferragosto
  "11-01", // Ognissanti
  "12-08", // Immacolata
  "12-25", // Natale
  "12-26", // Santo Stefano
];

/** Pasqua e Pasquetta (algoritmo di Meeus/Jones/Butcher). */
export function pasqua(anno: number): Date {
  const a = anno % 19;
  const b = Math.floor(anno / 100);
  const c = anno % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anno, mese - 1, giorno));
}

export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function dataDaIso(s: string): Date {
  const [a, m, g] = s.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, g));
}

/** Settimana ISO nel formato `2026-W35`. */
export function settimanaIso(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const giornoSettimana = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - giornoSettimana);
  const inizioAnno = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const n = Math.ceil(((t.getTime() - inizioAnno.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(n).padStart(2, "0")}`;
}

/** Lunedì della settimana ISO che contiene `d`. */
export function inizioSettimana(d: Date): Date {
  const t = new Date(d.getTime());
  const giornoSettimana = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() - (giornoSettimana - 1));
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

export function festivitaAnno(anno: number): Set<string> {
  const set = new Set<string>();
  for (const gm of FESTIVITA_FISSE) set.add(`${anno}-${gm}`);
  const p = pasqua(anno);
  const pasquetta = new Date(p.getTime() + 86400000);
  set.add(iso(p));
  set.add(iso(pasquetta));
  return set;
}

/** Tutti i giorni dell'anno. */
export function giorniAnno(anno: number): Date[] {
  const out: Date[] = [];
  const d = new Date(Date.UTC(anno, 0, 1));
  while (d.getUTCFullYear() === anno) {
    out.push(new Date(d.getTime()));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function inChiusura(data: string, chiusure: Chiusura[]): Chiusura | null {
  for (const c of chiusure) {
    if (data >= c.dal && data <= c.al) return c;
  }
  return null;
}

export interface GiornoCalendario {
  data: string;
  anno: number;
  mese: number;
  settimanaIso: string;
  weekend: boolean;
  festivo: boolean;
  chiusura: string | null;
  lavorativo: boolean;
}

/**
 * Costruisce il calendario dell'anno marcando ogni giorno.
 * Un giorno è lavorativo se non è weekend (se richiesto), non è festivo
 * nazionale e non ricade in una chiusura aziendale.
 */
export function costruisciCalendario(
  anno: number,
  chiusure: Chiusura[],
  escludiWeekend = true
): GiornoCalendario[] {
  const festivi = festivitaAnno(anno);

  return giorniAnno(anno).map((d) => {
    const s = iso(d);
    const gs = d.getUTCDay();
    const weekend = gs === 0 || gs === 6;
    const festivo = festivi.has(s);
    const c = inChiusura(s, chiusure);
    const lavorativo =
      !(escludiWeekend && weekend) && !festivo && !c;

    return {
      data: s,
      anno,
      mese: d.getUTCMonth() + 1,
      settimanaIso: settimanaIso(d),
      weekend,
      festivo,
      chiusura: c?.descrizione ?? null,
      lavorativo,
    };
  });
}

/** Numero di giorni lavorativi per mese — serve per i confronti normalizzati. */
export function giorniLavorativiPerMese(
  calendario: GiornoCalendario[]
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const g of calendario) {
    if (!g.lavorativo) continue;
    out[g.mese] = (out[g.mese] ?? 0) + 1;
  }
  return out;
}
