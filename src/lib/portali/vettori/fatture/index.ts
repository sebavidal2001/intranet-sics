import type {
  CodiceVettore,
  EsitoQuadratura,
  FatturaLetta,
} from "./tipi";
import { tolleranza } from "./tipi";
import { leggiGls } from "./gls";
import { leggiTradingPost } from "./trading-post";
import { leggiTnt } from "./tnt";

export * from "./tipi";
export { leggiGls } from "./gls";
export { leggiTradingPost } from "./trading-post";
export { leggiTnt } from "./tnt";

/**
 * Riconosce da quale vettore viene una fattura, dal suo testo.
 *
 * Si guardano le intestazioni societarie, non il nome del file: il nome lo
 * sceglie chi salva il PDF, e prima o poi qualcuno lo chiamerà `fattura(2).pdf`.
 *
 * **Il nome del vettore però non è sempre stampato.** La fattura TNT di agosto
 * 2026 non contiene da nessuna parte la parola «TNT»: quella di luglio si
 * riconosceva solo perché aveva i codici dei supplementi `MANH2` e `NOSTK`, che
 * compaiono unicamente quando quei supplementi ci sono. Un riconoscimento che
 * dipende dalla presenza di un supplemento funziona un mese e fallisce quello
 * dopo, quando la merce viaggia normale.
 *
 * Per questo, dopo i marchi, si guarda la **struttura**: i codici di servizio
 * `EN PM` / `EN CT` che TNT stampa su ogni riga di spedizione compaiono su
 * tutte e due le fatture e su nessuna delle altre.
 */
export function riconosciVettore(testo: string): CodiceVettore | null {
  const t = testo.toUpperCase();

  // 1. Il marchio, quando c'è.
  if (/GLS\s+(ENTERPRISE|ITALY)|GLS-ITALY\.COM/.test(t)) return "gls";
  if (/TRADING\s*POST|TRADINGPOSTBO/.test(t)) return "trading_post";
  if (/TNT\s+GLOBAL|\bTNT\b/.test(t)) return "tnt";
  if (/FEDEX/.test(t)) return "fedex";

  // 2. La struttura, quando il marchio manca.
  if (/\sEN\s+(PM|CT)\s/.test(t)) return "tnt";

  return null;
}

export class FatturaNonLeggibile extends Error {
  constructor(
    message: string,
    readonly motivo:
      | "vettore_sconosciuto"
      | "senza_testo"
      | "nessuna_riga"
  ) {
    super(message);
    this.name = "FatturaNonLeggibile";
  }
}

/**
 * Legge una fattura a partire dal testo estratto dal PDF.
 *
 * FedEx viene riconosciuto ma non letto: il suo PDF contiene la fattura come
 * disegno, non come testo, e la lettura passa dal riconoscimento ottico con
 * conferma riga per riga. Qui si solleva un errore parlante invece di
 * restituire una fattura vuota che sembra riuscita.
 */
export function leggiFattura(testo: string): FatturaLetta {
  const vettore = riconosciVettore(testo);

  // L'assenza di testo si controlla PRIMA del vettore: un PDF senza testo non
  // si lascia riconoscere, e dire "vettore sconosciuto" manderebbe l'operatore
  // a cercare un problema di anagrafica quando il problema è il file. È il caso
  // delle fatture FedEx, che contengono la fattura come disegno.
  if (testo.trim().length < 200) {
    throw new FatturaNonLeggibile(
      vettore === "fedex" || vettore === null
        ? "Il PDF non contiene testo leggibile. È il caso delle fatture FedEx, che vanno acquisite per riconoscimento ottico con conferma riga per riga."
        : "Il PDF non contiene testo leggibile: probabilmente è la scansione di un documento cartaceo.",
      "senza_testo"
    );
  }

  if (!vettore) {
    throw new FatturaNonLeggibile(
      "Non riconosco il vettore da questa fattura. Se è un vettore nuovo, va aggiunto prima di poterla caricare.",
      "vettore_sconosciuto"
    );
  }

  const letta =
    vettore === "gls"
      ? leggiGls(testo)
      : vettore === "trading_post"
        ? leggiTradingPost(testo)
        : vettore === "tnt"
          ? leggiTnt(testo)
          : null;

  if (!letta) {
    throw new FatturaNonLeggibile(
      "Le fatture FedEx non contengono testo leggibile: vanno acquisite per riconoscimento ottico, con conferma riga per riga.",
      "senza_testo"
    );
  }
  if (letta.righe.length === 0) {
    throw new FatturaNonLeggibile(
      "Nessuna spedizione riconosciuta nella fattura: il tracciato del vettore è probabilmente cambiato.",
      "nessuna_riga"
    );
  }
  return letta;
}

/**
 * Quadratura: la somma delle righe lette coincide con i totali stampati?
 *
 * È il gate dell'acquisizione, e l'unico controllo che dice se la lettura è
 * *completa* invece che solo plausibile. Una riga saltata non si vede guardando
 * le righe lette — si vede solo qui.
 *
 * Le voci che la fattura non dichiara non vengono confrontate e non fanno
 * fallire la quadratura: restano come nota. Confrontare contro `null` darebbe
 * un errore ogni volta che un vettore espone una voce in meno.
 */
export function quadra(fattura: FatturaLetta): EsitoQuadratura {
  const t = fattura.totali;
  const n = fattura.righe.length;
  const soglia = tolleranza(n);
  const note: string[] = [];
  const confronti: EsitoQuadratura["confronti"] = [];

  const somma = (f: (r: FatturaLetta["righe"][number]) => number | null) =>
    fattura.righe.reduce((acc, r) => acc + (f(r) ?? 0), 0);

  function confronta(voce: string, dichiarato: number | null, calcolato: number, tol = soglia) {
    if (dichiarato == null) {
      note.push(`La fattura non dichiara ${voce}: non confrontabile.`);
      confronti.push({ voce, dichiarato: null, calcolato, differenza: null, ok: true });
      return;
    }
    const differenza = Math.round((calcolato - dichiarato) * 100) / 100;
    confronti.push({
      voce,
      dichiarato,
      calcolato: Math.round(calcolato * 100) / 100,
      differenza,
      ok: Math.abs(differenza) <= tol,
    });
  }

  confronta("il numero di spedizioni", t.spedizioni, n, 0);
  confronta("il numero di colli", t.colli, somma((r) => r.colli), 0);
  confronta(
    t.pesoRiferito === "tassato" ? "il peso tassato" : "il peso totale",
    t.peso,
    somma((r) => (t.pesoRiferito === "tassato" ? r.pesoTassato : r.peso)),
    Math.max(0.5, n * 0.05)
  );
  confronta("il nolo", t.nolo, somma((r) => r.nolo));

  if (fattura.righeNonLette.length > 0) {
    note.push(
      `${fattura.righeNonLette.length} righe sembravano spedizioni ma non si sono lasciate leggere.`
    );
  }

  const ok =
    confronti.every((c) => c.ok) && fattura.righeNonLette.length === 0;

  if (!ok) {
    note.push(
      "La fattura resta in bozza e non genera controlli: un'acquisizione parziale che sembra completa fa più danni di un errore dichiarato."
    );
  }

  return { ok, confronti, note };
}
