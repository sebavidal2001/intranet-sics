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

/** Il minimo che serve per ricollocare una riga: dove sta, a quale documento appartiene, quanto vale. */
export interface RigaRicollocabile {
  bu: string;
  documento: string;
  data: string;
  codiceCliente: string;
  importo: number;
  /** Vero se la business unit non viene dal gestionale ma dal documento. */
  buDedotta?: boolean;
}

export interface EsitoRicollocazione {
  /** Righe senza business unit che ne hanno preso una dal proprio documento. */
  ricollocate: number;
  /** Righe rimaste senza: il documento non ha nessuna riga con business unit. */
  residue: number;
  /** Valore assoluto delle residue: e' il numero che dice se il problema pesa. */
  valoreResiduo: number;
}

/**
 * Una riga senza gruppo prende la business unit del SUO DOCUMENTO.
 *
 * Nel gestionale le righe senza gruppo (`-`) sono quasi tutte di testo: note,
 * avvisi, «documentazione inviata», spese di logistica (all'08/10/2026: 2.155
 * righe di ordinato a zero euro, 75 di portafoglio, 325 di preventivi). Una riga
 * di commento appartiene al documento in cui sta, e un documento si legge nella
 * business unit delle sue righe di merce: lasciarle «(non assegnata)» faceva
 * comparire una quinta categoria a zero euro in ogni grafico e ne falsava i
 * conteggi di righe.
 *
 * Quando il documento ha righe di business unit diverse vince quella che pesa
 * di piu' in valore assoluto (a parita', quella con piu' righe, poi l'ordine
 * alfabetico: il risultato non dipende dall'ordine in cui arrivano le righe).
 *
 * Una riga ricollocata e' marcata `buDedotta`: il dato non e' del gestionale, e
 * chi vuole sapere cosa ha deciso il codice lo puo' chiedere. Le righe di un
 * documento senza NESSUNA riga assegnata restano «(non assegnata)» e vengono
 * contate in `residue`: e' quello che deve riportare la sentinella, perche' li'
 * il gestionale deve ricevere un gruppo vero.
 *
 * Opera sul posto, per non copiare decine di migliaia di righe.
 */
export function ricollocaNonAssegnate(righe: RigaRicollocabile[]): EsitoRicollocazione {
  const chiave = (r: RigaRicollocabile) => `${r.documento}|${r.data}|${r.codiceCliente}`;

  // peso (valore assoluto) e righe per documento e business unit
  const perDocumento = new Map<string, Map<string, { peso: number; righe: number }>>();
  for (const r of righe) {
    if (!r.documento || r.bu === BU_NON_ASSEGNATA) continue;
    const k = chiave(r);
    const perBu = perDocumento.get(k) ?? new Map<string, { peso: number; righe: number }>();
    const voce = perBu.get(r.bu) ?? { peso: 0, righe: 0 };
    voce.peso += Math.abs(r.importo);
    voce.righe += 1;
    perBu.set(r.bu, voce);
    perDocumento.set(k, perBu);
  }

  const prevalente = new Map<string, string>();
  for (const [k, perBu] of perDocumento) {
    const ordinate = [...perBu.entries()].sort(
      ([nomeA, a], [nomeB, b]) => b.peso - a.peso || b.righe - a.righe || nomeA.localeCompare(nomeB)
    );
    prevalente.set(k, ordinate[0][0]);
  }

  const esito: EsitoRicollocazione = { ricollocate: 0, residue: 0, valoreResiduo: 0 };
  for (const r of righe) {
    if (r.bu !== BU_NON_ASSEGNATA) continue;
    const bu = r.documento ? prevalente.get(chiave(r)) : undefined;
    if (bu) {
      r.bu = bu;
      r.buDedotta = true;
      esito.ricollocate += 1;
    } else {
      esito.residue += 1;
      esito.valoreResiduo += Math.abs(r.importo);
    }
  }
  return esito;
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
