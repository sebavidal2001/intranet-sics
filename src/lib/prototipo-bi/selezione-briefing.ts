/**
 * Quali segnali diventano voci del briefing.
 *
 * Fino al 24/09/2026 si prendevano i primi tre per punteggio, e il briefing
 * diceva ogni mattina le stesse cose. Per tre ragioni, tutte verificate:
 *
 *  · il raffreddamento dei segnali gia' visti leggeva i briefing archiviati,
 *    ma la pagina non ne archiviava nessuno: lo storico era sempre vuoto;
 *  · anche con lo storico non avrebbe funzionato, perche' budget, dormienti e
 *    pipeline mettevano la DATA nell'identificativo: ogni giorno un segnale
 *    "nuovo" sullo stesso argomento;
 *  · nulla impediva tre voci della stessa famiglia, e le famiglie da centinaia
 *    di migliaia di euro (budget, dormienti) vincevano sempre sul punteggio.
 *
 * Qui si decide la varieta'; il punteggio resta in `calcolaPunteggi`.
 */

import type { Briefing, FamigliaRilevatore, Segnale } from "./tipi";

/** Quando un segnale o una famiglia e' uscito l'ultima volta. */
export interface StoricoUscite {
  giorniPerSegnale: Map<string, number>;
  giorniPerFamiglia: Map<FamigliaRilevatore, number>;
}

function giorno(isoDataOra: string): string {
  return isoDataOra.slice(0, 10);
}

function giorniFra(da: string, a: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86_400_000);
}

/**
 * Ricava le ultime uscite dai briefing archiviati di GIORNI PRECEDENTI a
 * `oggi`. Quelli di oggi non contano: riaprire la pagina non deve raffreddare
 * le notizie che si stanno leggendo.
 */
export function storicoDaBriefing(archiviati: Briefing[], oggi: string): StoricoUscite {
  const giorniPerSegnale = new Map<string, number>();
  const giorniPerFamiglia = new Map<FamigliaRilevatore, number>();
  for (const b of archiviati) {
    const quando = giorno(b.generatoIl);
    if (quando >= oggi) continue;
    const giorni = giorniFra(quando, oggi);
    for (const v of b.voci) {
      const s = giorniPerSegnale.get(v.segnaleId);
      if (s === undefined || giorni < s) giorniPerSegnale.set(v.segnaleId, giorni);
      const f = giorniPerFamiglia.get(v.famiglia);
      if (f === undefined || giorni < f) giorniPerFamiglia.set(v.famiglia, giorni);
    }
  }
  return { giorniPerSegnale, giorniPerFamiglia };
}

/**
 * Quanto pesa un segnale gia' uscito `giorni` fa: poco il giorno dopo, di
 * nuovo pieno dopo due settimane. Un argomento importante torna, ma non ogni
 * mattina.
 */
export function fattoreNovita(giorni: number | undefined): number {
  if (giorni === undefined) return 1;
  if (giorni <= 1) return 0.15;
  if (giorni <= 3) return 0.3;
  if (giorni <= 7) return 0.55;
  if (giorni <= 14) return 0.8;
  return 1;
}

/** Una famiglia assente da tanti giorni ha diritto al posto di rotazione. */
const GIORNI_PER_ROTAZIONE = 7;
/** Una notizia positiva si impone di nuovo solo dopo tanti giorni. */
const GIORNI_POSITIVA_RIPETUTA = 4;

/**
 * Sceglie le voci fra segnali GIA' ordinati per punteggio.
 *
 *  1. La qualita' del dato passa sempre e per prima: se il dato e' rotto, il
 *     resto non si legge.
 *  2. Una voce per famiglia.
 *  3. Un posto va a una famiglia che manca da almeno una settimana, se
 *     ce n'e' una con un segnale valido: e' cio' che fa emergere margine,
 *     consegne, costi — piccoli in euro, ma che nessun altro racconta.
 *  4. Se fra le voci non c'e' niente di positivo e un segnale positivo esiste,
 *     entra al posto dell'ultima voce scelta solo per punteggio: un briefing
 *     fatto solo di problemi smette di essere letto. Ma non la stessa ogni
 *     giorno: se e' uscita da meno di quattro giorni, si aspetta.
 */
export function selezionaVoci(
  ordinati: Segnale[],
  storico: StoricoUscite,
  massimo = 3
): Segnale[] {
  const validi = ordinati.filter((s) => s.punteggio > 0);
  const scelti: Segnale[] = [];
  const famiglieScelte = new Set<FamigliaRilevatore>();

  const aggiungi = (s: Segnale) => {
    scelti.push(s);
    famiglieScelte.add(s.famiglia);
  };

  for (const s of validi) {
    if (s.famiglia === "qualita_dato" && !famiglieScelte.has(s.famiglia)) aggiungi(s);
  }
  for (const s of validi) {
    if (scelti.length >= massimo) break;
    if (!famiglieScelte.has(s.famiglia)) aggiungi(s);
  }

  // Le voci messe da una regola (qualita', rotazione, positiva) non si
  // toccano: si sacrifica l'ultima voce entrata solo per punteggio.
  const protetti = new Set<Segnale>(scelti.filter((s) => s.famiglia === "qualita_dato"));
  const inserisci = (candidato: Segnale | undefined) => {
    if (!candidato) return;
    if (scelti.length < massimo) {
      aggiungi(candidato);
      protetti.add(candidato);
      return;
    }
    for (let i = scelti.length - 1; i >= 0; i--) {
      if (protetti.has(scelti[i])) continue;
      famiglieScelte.delete(scelti[i].famiglia);
      scelti[i] = candidato;
      famiglieScelte.add(candidato.famiglia);
      protetti.add(candidato);
      return;
    }
  };

  const assenteDaTempo = (f: FamigliaRilevatore) => {
    const g = storico.giorniPerFamiglia.get(f);
    return g === undefined || g >= GIORNI_PER_ROTAZIONE;
  };
  if (!scelti.some((s) => assenteDaTempo(s.famiglia))) {
    inserisci(validi.find((s) => !famiglieScelte.has(s.famiglia) && assenteDaTempo(s.famiglia)));
  }

  // La positiva forzata deve anche essere nuova: senza questo limite la stessa
  // notizia buona tornava a giorni alterni, scavalcando il raffreddamento.
  const giaDettaDaPoco = (s: Segnale) => {
    const g = storico.giorniPerSegnale.get(s.id);
    return g !== undefined && g < GIORNI_POSITIVA_RIPETUTA;
  };
  if (!scelti.some((s) => s.direzione === "positivo")) {
    inserisci(
      validi.find(
        (s) => s.direzione === "positivo" && !famiglieScelte.has(s.famiglia) && !giaDettaDaPoco(s)
      )
    );
  }

  return scelti;
}
