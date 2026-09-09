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

/** La tabella delle spedizioni contestate, in testo semplice. */
export function tabellaAnomalie(anomalie: AnomaliaElenco[]): string {
  if (anomalie.length === 0) return "(nessuna spedizione da segnalare)";

  const righe = anomalie.map((a) => {
    const pezzi = [
      a.data_spedizione ?? "—",
      a.riferimento ?? "senza riferimento",
      a.controparte ?? "—",
      `fatturato ${eur(a.fatturato)}`,
    ];
    if (a.atteso != null && a.atteso > 0) pezzi.push(`atteso ${eur(a.atteso)}`);
    if (a.importo_contestato != null) pezzi.push(`differenza ${eur(a.importo_contestato)}`);
    return `- ${pezzi.join(" · ")}\n  ${a.descrizione}`;
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
  const totaleContestato = d.anomalie.reduce(
    (a, x) => a + (x.importo_contestato ?? 0),
    0
  );

  const valori: Record<string, string> = {
    vettore: d.vettoreNome,
    mese: MESI[d.mese - 1] ?? String(d.mese),
    anno: String(d.anno),
    direzione: [...new Set(d.anomalie.map((a) => a.direzione === "entrata" ? "arrivi da fornitori" : a.direzione === "uscita" ? "invii a clienti" : "da classificare"))].join(", "),
    n_anomalie: String(d.anomalie.length),
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

  return { oggetto, corpo, destinatari: d.destinatari, cc: d.cc, nomeFile, eml };
}
