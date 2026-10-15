import type { AnomaliaElenco } from "./letture";

/** Genera bozze per Outlook COM o file EML. L’invio resta manuale. */

export interface DatiBozza {
  vettoreNome: string;
  mese: number;
  anno: number;
  anomalie: AnomaliaElenco[];
  destinatari: string[];
  cc: string[];
  oggettoModello: string;
  corpoModello: string;
  mittente?: string | null;
}

export interface Bozza {
  /** Spedizioni nella mail (una per riga di fattura). */
  spedizioni: number;
  /** Spedizioni fatturate meno dell'atteso: restano fuori dalla mail. */
  escluse: string[];
  oggetto: string;
  corpo: string;
  destinatari: string[];
  cc: string[];
  nomeFile: string;
  eml: string;
}

const MESI = [
  "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
  "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
];

const eur = (n: number | null | undefined) =>
  n == null
    ? "—"
    : n.toLocaleString("it-IT", { style: "currency", currency: "EUR" });

/** Una spedizione della fattura con tutte le sue anomalie aperte. */
export interface SpedizioneContestata {
  data: string | null;
  riferimento: string | null;
  controparte: string | null;
  fatturato: number | null;
  atteso: number | null;
  /** L'importo che si chiede di verificare; null se la spedizione va solo controllata (es. peso). */
  differenza: number | null;
  motivi: string[];
}

/**
 * Raggruppa le anomalie per spedizione e toglie quelle a nostro favore.
 *
 * Una riga di fattura può avere due anomalie (importo e peso): nella mail
 * deve comparire una volta sola, con i due motivi, e il suo importo contare
 * una volta. Una spedizione fatturata meno del previsto non si contesta al
 * vettore: resta fra le anomalie da decidere, ma fuori dalla mail e dal totale.
 */
export function raggruppaPerSpedizione(anomalie: AnomaliaElenco[]): {
  contestate: SpedizioneContestata[];
  escluse: SpedizioneContestata[];
} {
  const gruppi = new Map<string, AnomaliaElenco[]>();
  for (const a of anomalie) {
    const chiave = a.fattura_numero != null && a.riga_numero != null ? `${a.fattura_numero}|${a.riga_numero}` : a.id;
    gruppi.set(chiave, [...(gruppi.get(chiave) ?? []), a]);
  }
  const contestate: SpedizioneContestata[] = [];
  const escluse: SpedizioneContestata[] = [];
  for (const gruppo of gruppi.values()) {
    const primo = gruppo[0];
    const positivi = gruppo.map((a) => a.importo_contestato).filter((n): n is number => n != null && n > 0);
    const aNostroFavore =
      positivi.length === 0 &&
      (gruppo.some((a) => a.importo_contestato != null && a.importo_contestato < 0) ||
        (primo.fatturato != null && primo.atteso != null && primo.fatturato <= primo.atteso));
    const voce: SpedizioneContestata = {
      data: primo.data_spedizione,
      riferimento: primo.riferimento,
      controparte: primo.controparte,
      fatturato: primo.fatturato,
      atteso: primo.atteso,
      differenza: positivi.length ? Math.max(...positivi) : null,
      motivi: [...new Set(gruppo.map((a) => a.descrizione))],
    };
    (aNostroFavore ? escluse : contestate).push(voce);
  }
  const perData = (x: SpedizioneContestata, y: SpedizioneContestata) => (x.data ?? "").localeCompare(y.data ?? "");
  return { contestate: contestate.sort(perData), escluse: escluse.sort(perData) };
}

/** La tabella delle spedizioni contestate, in testo semplice: una riga per spedizione. */
export function tabellaAnomalie(anomalie: AnomaliaElenco[]): string {
  const { contestate } = raggruppaPerSpedizione(anomalie);
  if (contestate.length === 0) return "(nessuna spedizione da segnalare)";

  const righe = contestate.map((s) => {
    const pezzi = [
      s.data ?? "—",
      s.riferimento ?? "senza riferimento",
      s.controparte ?? "—",
      `fatturato ${eur(s.fatturato)}`,
    ];
    if (s.atteso != null && s.atteso > 0) pezzi.push(`atteso ${eur(s.atteso)}`);
    if (s.differenza != null) pezzi.push(`differenza ${eur(s.differenza)}`);
    return `- ${pezzi.join(" · ")}\n${s.motivi.map((m) => `  ${m}`).join("\n")}`;
  });

  return righe.join("\n");
}

/**
 * Sostituisce i segnaposto per nome.
 *
 * Nessuna interpretazione: quello che non è un segnaposto noto resta com'è.
 * Un modello scritto da un utente con una graffa di troppo deve produrre un
 * testo con una graffa di troppo, non un errore.
 */
export function compila(modello: string, valori: Record<string, string>): string {
  return modello.replace(/\{(\w+)\}/g, (intero, chiave: string) =>
    chiave in valori ? valori[chiave] : intero
  );
}

/**
 * Codifica un'intestazione MIME che può contenere accenti.
 *
 * `Subject: Verifica addebiti — GLS` con la lineetta lunga, spedito come
 * ASCII, arriva con i caratteri rotti. RFC 2047 in base64 è la via più corta
 * che funziona ovunque.
 */
function intestazione(nome: string, valore: string): string {
  const soloAscii = /^[\x20-\x7E]*$/.test(valore);
  if (soloAscii) return `${nome}: ${valore}`;
  const b64 = Buffer.from(valore, "utf-8").toString("base64");
  return `${nome}: =?UTF-8?B?${b64}?=`;
}

export function costruisciBozza(d: DatiBozza): Bozza {
  const { contestate, escluse } = raggruppaPerSpedizione(d.anomalie);
  const totaleContestato = contestate.reduce((a, x) => a + (x.differenza ?? 0), 0);

  const valori: Record<string, string> = {
    vettore: d.vettoreNome,
    mese: MESI[d.mese - 1] ?? String(d.mese),
    anno: String(d.anno),
    direzione: [...new Set(d.anomalie.map((a) => a.direzione === "entrata" ? "arrivi da fornitori" : a.direzione === "uscita" ? "invii a clienti" : "da classificare"))].join(", "),
    n_anomalie: String(contestate.length),
    totale_contestato: eur(Math.round(totaleContestato * 100) / 100),
    tabella: tabellaAnomalie(d.anomalie),
  };

  const oggetto = compila(d.oggettoModello, valori);
  const corpo = compila(d.corpoModello, valori);

  // Il corpo va in base64: contiene accenti, a capo e importi, e il
  // quoted-printable scritto a mano è il posto in cui questi file si rompono.
  const corpoB64 = Buffer.from(corpo.replace(/\n/g, "\r\n"), "utf-8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");

  const testate = [
    "X-Unsent: 1", // dice a Outlook di aprirlo come bozza da inviare
    d.mittente ? `From: ${d.mittente}` : null,
    `To: ${d.destinatari.join(", ")}`,
    d.cc.length ? `Cc: ${d.cc.join(", ")}` : null,
    intestazione("Subject", oggetto),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter((x): x is string => x !== null);

  const eml = `${testate.join("\r\n")}\r\n\r\n${corpoB64}\r\n`;

  const nomeFile = `contestazione-${d.vettoreNome
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}-${String(d.mese).padStart(2, "0")}-${d.anno}.eml`;

  return {
    spedizioni: contestate.length,
    escluse: escluse.map((x) => `${x.data ?? "—"} · ${x.riferimento ?? "senza riferimento"} · ${x.controparte ?? "—"} · fatturato ${eur(x.fatturato)}, atteso ${eur(x.atteso)}`),
    oggetto, corpo, destinatari: d.destinatari, cc: d.cc, nomeFile, eml,
  };
}
