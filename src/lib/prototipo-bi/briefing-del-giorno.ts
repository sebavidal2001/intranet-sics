/**
 * Il briefing di una persona per oggi: uno solo, archiviato.
 *
 * La pagina lo apre, il report Word lo riporta: devono dire la stessa cosa.
 * Prima ognuno se lo calcolava, e non lo archiviava nessuno — quindi il
 * raffreddamento dei segnali gia' visti non aveva mai storia su cui lavorare.
 *
 * Riaprire la pagina restituisce il briefing gia' fatto (nessuna chiamata al
 * modello). `rigenera` lo rifa' da capo con lo stesso storico: cambia la
 * redazione, non le notizie.
 */

import type { AccessoBi } from "./accesso";
import { generaBriefing } from "./analista";
import {
  archiviaBriefing,
  leggiBriefingArchiviati,
  leggiConfigurazione,
  pesiDaRiscontri,
} from "./archivio";
import { calcolaPunteggi, costruisciContesto, rilevaTutto } from "./rilevatori";
import { selezionaVoci, storicoDaBriefing } from "./selezione-briefing";
import type { Briefing, Segnale, Snapshot } from "./tipi";

export interface EsitoBriefing {
  briefing: Briefing;
  /** Tutti i segnali valutati, gia' con punteggio: per il pannello di taratura. */
  segnali: Segnale[];
  configurazioneBudget: boolean;
}

export async function briefingDelGiorno(
  accesso: AccessoBi,
  snapshot: Snapshot,
  opzioni: { rigenera?: boolean } = {}
): Promise<EsitoBriefing> {
  const anno = Number((snapshot.dataMassima ?? "").slice(0, 4)) || new Date().getFullYear();
  const config = await leggiConfigurazione(anno);
  const oggi = new Date().toISOString().slice(0, 10);

  const archiviati = await leggiBriefingArchiviati(accesso.userId);
  const storico = storicoDaBriefing(archiviati, oggi);

  const ctx = costruisciContesto(snapshot, config, accesso.agenteScope);
  const segnali = calcolaPunteggi(rilevaTutto(ctx), {
    giorniDallUltima: storico.giorniPerSegnale,
    pesiFamiglia: await pesiDaRiscontri(),
  });

  // Lo stesso giorno E gli stessi dati: se nella notte e' arrivato un run
  // nuovo, il briefing di stamattina parla di numeri che non ci sono piu'.
  const giaFatto = archiviati.find(
    (b) => b.generatoIl.slice(0, 10) === oggi && b.dataRiferimento === (snapshot.dataMassima ?? "")
  );
  if (giaFatto && !opzioni.rigenera) {
    return { briefing: giaFatto, segnali, configurazioneBudget: Boolean(config) };
  }

  const briefing = await generaBriefing({
    segnali,
    selezione: selezionaVoci(segnali, storico, 3),
    snapshot,
    destinatario: accesso.nome,
    ruolo: accesso.ruolo,
  });

  try {
    await archiviaBriefing(briefing, accesso.userId);
  } catch (e) {
    // Senza archivio domani il raffreddamento non sapra' cosa si e' letto
    // oggi, ma il briefing di oggi resta giusto: meglio mostrarlo.
    console.warn("[bi.briefing] archiviazione fallita:", e instanceof Error ? e.message : e);
  }
  return { briefing, segnali, configurazioneBudget: Boolean(config) };
}
