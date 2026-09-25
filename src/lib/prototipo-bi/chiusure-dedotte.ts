/**
 * CHIUSURE AZIENDALI DEDOTTE DAI DATI.
 *
 * Il calendario aziendale prevede di inserire a mano ferie e chiusure, e senza
 * quelle righe il sistema legge le due settimane di agosto — in cui non esiste
 * un solo documento — come un crollo del 100%. Il briefing lo annuncerebbe alla
 * direzione come la notizia del giorno.
 *
 * Finché quelle date non vengono inserite, qui si deducono: un periodo di
 * giorni feriali consecutivi in cui **nessun dataset** contiene un documento
 * non è un crollo, è un'azienda chiusa. Un crollo vero lascia comunque
 * qualcosa — un ordine, una bolla, un preventivo.
 *
 * È un'inferenza, e come tale va **dichiarata**: le chiusure dedotte portano
 * `dedotta: true` e una descrizione che dice su cosa si basano, così chi legge
 * sa distinguere ciò che qualcuno ha inserito da ciò che il sistema ha
 * supposto. Restano un ripiego: le date vere, quando arrivano, hanno la
 * precedenza.
 */

import type { Chiusura, Snapshot } from "./tipi";
import { dataDaIso, iso, festivitaAnno } from "./calendario";

/** Una chiusura dedotta si distingue da una inserita a mano. */
export interface ChiusuraDedotta extends Chiusura {
  dedotta: true;
  /** Giorni feriali consecutivi senza alcun documento. */
  giorniFeriali: number;
}

/**
 * Quanti giorni feriali di fila servono per parlare di chiusura.
 *
 * Cinque: una settimana lavorativa intera. Con una soglia più bassa
 * finirebbero dentro i ponti e le code di fine mese, che non sono chiusure e
 * il cui calo è invece un'informazione vera.
 */
const GIORNI_MINIMI = 5;

function giorniConDocumenti(snapshot: Snapshot): Set<string> {
  const presenti = new Set<string>();
  for (const [chiave, righe] of Object.entries(snapshot.dataset)) {
    // Le chiusure sono delle vendite: un ordine a fornitore fatto in una
    // settimana di chiusura non la rende lavorativa.
    if (chiave === "acquisti") continue;
    for (const r of righe ?? []) presenti.add(r.data);
  }
  return presenti;
}

/**
 * I periodi di chiusura probabile dell'anno indicato.
 *
 * Si guardano solo i giorni **entro la copertura dei dati**: il vuoto dopo
 * l'ultimo giorno caricato non è una chiusura, è il futuro — confonderli
 * farebbe comparire una chiusura lunga mesi ogni volta che si guarda l'anno in
 * corso.
 */
export function deduciChiusure(snapshot: Snapshot, anno: number): ChiusuraDedotta[] {
  if (!snapshot.dataMinima || !snapshot.dataMassima) return [];

  const conDocumenti = giorniConDocumenti(snapshot);
  const festivi = festivitaAnno(anno);

  const inizioCopertura = dataDaIso(
    snapshot.dataMinima > `${anno}-01-01` ? snapshot.dataMinima : `${anno}-01-01`
  );
  const fineCopertura = dataDaIso(
    snapshot.dataMassima < `${anno}-12-31` ? snapshot.dataMassima : `${anno}-12-31`
  );
  if (inizioCopertura > fineCopertura) return [];

  const chiusure: ChiusuraDedotta[] = [];
  let inizioVuoto: Date | null = null;
  let ferialiVuoti = 0;

  const chiudiSequenza = (ultimoGiorno: Date) => {
    if (inizioVuoto && ferialiVuoti >= GIORNI_MINIMI) {
      chiusure.push({
        id: `dedotta-${iso(inizioVuoto)}`,
        dal: iso(inizioVuoto),
        al: iso(ultimoGiorno),
        descrizione: `Probabile chiusura: ${ferialiVuoti} giorni feriali senza alcun documento.`,
        dedotta: true,
        giorniFeriali: ferialiVuoti,
      });
    }
    inizioVuoto = null;
    ferialiVuoti = 0;
  };

  let precedente: Date | null = null;
  for (
    let g = new Date(inizioCopertura);
    g <= fineCopertura;
    g.setUTCDate(g.getUTCDate() + 1)
  ) {
    const giorno = iso(g);
    const feriale = g.getUTCDay() !== 0 && g.getUTCDay() !== 6 && !festivi.has(giorno);

    if (conDocumenti.has(giorno)) {
      // Un documento chiude la sequenza: l'azienda quel giorno ha lavorato.
      if (precedente) chiudiSequenza(precedente);
      precedente = new Date(g);
      continue;
    }

    if (feriale) {
      if (!inizioVuoto) inizioVuoto = new Date(g);
      ferialiVuoti += 1;
    }
    // Sabati, domeniche e festivi dentro una sequenza non la interrompono e
    // non si contano: sono già non lavorativi.
    precedente = new Date(g);
  }
  if (precedente) chiudiSequenza(precedente);

  return chiusure;
}

/**
 * Le chiusure da usare: quelle inserite a mano, e solo in loro assenza quelle
 * dedotte.
 *
 * Non si mescolano. Se qualcuno ha configurato il calendario dell'anno, quella
 * è la verità e una deduzione che la contraddicesse creerebbe solo confusione
 * su quale delle due stia guidando i conti.
 */
export function chiusureEffettive(
  configurate: Chiusura[] | undefined,
  snapshot: Snapshot,
  anno: number
): { chiusure: Chiusura[]; dedotte: boolean } {
  if (configurate && configurate.length > 0) {
    return { chiusure: configurate, dedotte: false };
  }
  return { chiusure: deduciChiusure(snapshot, anno), dedotte: true };
}
