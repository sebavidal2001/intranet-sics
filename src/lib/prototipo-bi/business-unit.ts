/**
 *
 * BUSINESS UNIT — presentazione e controllo.
 *
 * ⚠️ Qui NON c'è la regola di riconciliazione. È deliberato.
 *
 * Il gestionale conosce tre gruppi merceologici (`01CO` COMPONENTI,
 * `05IM` IMPIANTI, `06SI` SISTEMI) mentre l'azienda ragiona per quattro
 * business unit, perché SISTEMI si spezza in COSTRUITO e STRUTTURE secondo la
 * *categoria* della riga. Quella regola vive in **un solo posto**: le viste
 * SQL `public.bi_*`, compresa `bi_preventivi_backoffice` creata apposta per
 * dare al prototipo i campi back office senza fargli perdere la riconciliazione.
 *
 * Per un periodo la regola è stata riscritta anche qui in TypeScript, perché i
 * preventivi venivano letti dalla tabella grezza. Era un doppione: due copie
 * della stessa definizione che potevano divergere in silenzio. La vista l'ha
 * eliminato.
 *
 * Restano in questo modulo due cose che NON sono la regola di business:
 *
 *  · `etichettaBusinessUnit` — una scelta di presentazione: il gestionale
 *    scrive "-" per le righe senza gruppo, e mostrarlo così lo farebbe
 *    sembrare una business unit vera nei grafici.
 *
 *  · `controllaTassonomia` — una sentinella. Ora che la riconciliazione è
 *    delegata al database, serve a verificare che stia davvero facendo il suo
 *    lavoro: se comparisse "SISTEMI" vorrebbe dire che è nata una categoria
 *    nuova sotto 06SI e che la vista non la copre più.
 */

/** Le business unit che l'azienda usa davvero. */
export const BUSINESS_UNIT = ["COMPONENTI", "COSTRUITO", "IMPIANTI", "STRUTTURE"] as const;

/** Etichetta usata quando il gestionale non ha assegnato un gruppo. */
export const BU_NON_ASSEGNATA = "(non assegnata)";

/**
 * Etichetta leggibile della business unit già riconciliata dalla vista.
 * Traduce soltanto il "-" del gestionale: nessuna logica di business.
 */
export function etichettaBusinessUnit(gruppoDescrizione: string | null | undefined): string {
  const gruppo = (gruppoDescrizione ?? "").trim();
  if (!gruppo || gruppo === "-") return BU_NON_ASSEGNATA;
  return gruppo;
}

export interface EsitoTassonomia {
  coerente: boolean;
  /** Valori trovati che non sono business unit riconosciute. */
  estranei: string[];
  /**
   * Vero se compare ancora "SISTEMI": significa che è apparsa una categoria
   * nuova sotto 06SI e che la partizione fatta dalle viste non la copre più.
   */
  sistemiResidua: boolean;
}

/**
 * Verifica che l'insieme delle business unit arrivate dal database sia quello
 * atteso. Se il gestionale introduce un gruppo o una categoria nuova, il
 * prototipo lo dice invece di disegnare in silenzio una fetta in più.
 */
export function controllaTassonomia(valori: Iterable<string>): EsitoTassonomia {
  const ammessi = new Set<string>([...BUSINESS_UNIT, BU_NON_ASSEGNATA]);
  const estranei = [...new Set([...valori])].filter((v) => !ammessi.has(v)).sort();
  return {
    coerente: estranei.length === 0,
    estranei,
    sistemiResidua: estranei.includes("SISTEMI"),
  };
}
