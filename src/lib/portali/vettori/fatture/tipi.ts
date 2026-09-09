/**
 * Tipi della lettura delle fatture dei vettori.
 *
 * Un parser non restituisce "le righe": restituisce le righe **più** i totali
 * dichiarati dalla fattura e l'elenco di quello che non è riuscito a leggere.
 * Serve per la quadratura, che è il vero gate dell'acquisizione: se la somma
 * delle righe non coincide con il totale stampato, non si salva niente. Una
 * fattura letta a metà che sembra completa fa più danni di un errore.
 */

export type CodiceVettore = "gls" | "tnt" | "fedex" | "trading_post";

/** Una spedizione come la espone la fattura del vettore. */
export interface RigaFattura {
  /** Progressivo nel documento, per ritrovare la riga sulla carta. */
  numero: number;
  data: string | null;
  /** Numero di spedizione del vettore (GLS «N. Sp.», TNT lettera di vettura). */
  numeroSpedizione: string | null;
  /**
   * Il numero di bolla citato in fattura: il nostro sulle partenze, quello del
   * fornitore sugli arrivi. È la chiave di aggancio al documento di trasporto.
   */
  riferimento: string | null;
  /** Controparte come scritta in fattura, spesso troncata a metà parola. */
  controparte: string | null;
  direzione: "entrata" | "uscita" | null;
  colli: number | null;
  peso: number | null;
  pesoVolumetrico: number | null;
  pesoTassato: number | null;
  nolo: number | null;
  supplementi: number;
  carburante: number;
  totale: number | null;
  /** Le voci come lette, per mostrare in confronto quello che il vettore ha scritto. */
  dettaglio: Record<string, number | string>;
}

/** I totali che la fattura dichiara in coda. Servono a quadrare, non a sommare. */
export interface TotaliDichiarati {
  spedizioni: number | null;
  colli: number | null;
  peso: number | null;
  /**
   * A quale peso si riferisce il totale dichiarato: non è lo stesso per tutti.
   * GLS e Trading Post totalizzano il peso **reale**, TNT quello **tassato** —
   * sulla fattura di luglio 406,35 kg contro 225,97 di merce vera. Confrontare
   * la somma sbagliata farebbe fallire la quadratura ogni mese su una fattura
   * perfettamente corretta, e in poche settimane nessuno guarderebbe più il
   * risultato del controllo.
   */
  pesoRiferito: "reale" | "tassato";
  nolo: number | null;
  supplementi: number | null;
  adeguamento: number | null;
  carburante: number | null;
  percentualeCarburante: number | null;
  totaleDocumento: number | null;
  /**
   * Il totale che la **somma delle righe** deve fare, quando la fattura lo
   * dichiara in una forma confrontabile.
   *
   * È distinto da `totaleDocumento` perché non tutti i vettori compongono il
   * documento allo stesso modo. Su TNT e Trading Post le righe sommano al
   * totale stampato. Su GLS no, e non è un errore: carburante e adeguamento
   * ISTAT sono applicati a piè di fattura sull'imponibile complessivo, non
   * riga per riga — sulla fattura di luglio 1.024,22 di righe contro 1.238,46
   * di documento. Confrontare i due numeri farebbe fallire la quadratura di
   * ogni fattura GLS corretta, e in poche settimane nessuno guarderebbe più il
   * risultato del controllo.
   *
   * Lo valorizza il parser che sa di poterlo fare. Lasciato `null`, il
   * confronto non viene tentato.
   */
  totaleRighe?: number | null;
}

export interface EsitoQuadratura {
  ok: boolean;
  /** Confronti eseguiti, con la differenza trovata. Sempre popolato, anche se ok. */
  confronti: Array<{
    voce: string;
    dichiarato: number | null;
    calcolato: number;
    differenza: number | null;
    ok: boolean;
  }>;
  note: string[];
}

export interface FatturaLetta {
  vettore: CodiceVettore;
  numero: string | null;
  data: string | null;
  anno: number | null;
  mese: number | null;
  righe: RigaFattura[];
  totali: TotaliDichiarati;
  /**
   * Righe che sembravano spedizioni e non si sono lasciate leggere. Vanno
   * mostrate all'operatore: sono l'unico modo di accorgersi che il formato
   * della fattura è cambiato.
   */
  righeNonLette: string[];
  avvertenze: string[];
}

/** Tolleranza di quadratura: un centesimo per riga, con un minimo di due. */
export function tolleranza(nRighe: number): number {
  return Math.max(0.02, nRighe * 0.01);
}
