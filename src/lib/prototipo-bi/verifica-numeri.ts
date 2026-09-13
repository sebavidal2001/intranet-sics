/**
 * VERIFICA DEI NUMERI NELLA RISPOSTA DELL'ANALISTA.
 *
 * Le istruzioni dicono al modello «non inventare numeri, usa solo quelli dei
 * risultati». Niente lo imponeva: il testo andava a video così com'era, e un
 * numero sbagliato era indistinguibile da uno giusto.
 *
 * Qui si estraggono le cifre dal testo finale e si confrontano con i valori
 * che gli strumenti hanno davvero restituito in quella conversazione. Quelle
 * che non si ritrovano vengono marcate: l'analista prova a correggersi una
 * volta, e se restano, l'interfaccia lo dice a chi legge.
 *
 * Non è una dimostrazione di correttezza — un numero può essere giusto e non
 * riscontrabile, o riscontrabile per coincidenza. È il passaggio da un errore
 * invisibile a un errore visibile, che è la differenza che conta quando in
 * gioco c'è la fiducia in uno strumento.
 */

import type { UnitaMisura } from "./tipi";

export interface NumeroCitato {
  /** Come appare nel testo, es. "2.848.148 €". */
  testo: string;
  valore: number;
  /** Indice iniziale nel testo, per evidenziare in interfaccia. */
  posizione: number;
  verificato: boolean;
  /** Da dove risulta, quando risulta. */
  fonte?: string;
}

export interface EsitoVerifica {
  numeri: NumeroCitato[];
  nonVerificati: number;
}

export interface ValoreNoto {
  valore: number;
  fonte: string;
  /**
   * L'unità del valore. Serve a non confrontare una percentuale con un
   * importo: vedi `riscontro`, dove la sua assenza rendeva il controllo
   * inefficace proprio sulle percentuali.
   */
  unita?: UnitaMisura;
}

const NUMERO_ITALIANO =
  /(?:€\s*)?[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?(?:\s*(?:€|%|M\b|milioni\b|mln\b))?/giu;
const DATA_ITALIANA = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/gu;
const MILIONI = /(?:\bM\b|\bmilioni\b|\bmln\b)/iu;

function intervalliDate(testo: string): Array<{ inizio: number; fine: number }> {
  return Array.from(testo.matchAll(DATA_ITALIANA), (match) => ({
    inizio: match.index,
    fine: match.index + match[0].length,
  }));
}

function normalizzaNumero(testo: string): number {
  const parteNumerica = testo.match(/[+-]?\d[\d.]*(?:,\d+)?/u)?.[0] ?? "";
  // In italiano il punto separa le migliaia: "1.234" vale 1234, non 1,234.
  const valore = Number(parteNumerica.replaceAll(".", "").replace(",", "."));
  return MILIONI.test(testo) ? valore * 1_000_000 : valore;
}

export function estraiNumeri(
  testo: string
): Omit<NumeroCitato, "verificato" | "fonte">[] {
  const date = intervalliDate(testo);
  const risultati: Omit<NumeroCitato, "verificato" | "fonte">[] = [];

  for (const match of testo.matchAll(NUMERO_ITALIANO)) {
    const posizione = match.index;
    const fine = posizione + match[0].length;
    const prima = testo[posizione - 1] ?? "";
    const dopo = testo[fine] ?? "";

    if (date.some((data) => posizione < data.fine && fine > data.inizio)) continue;
    // Attaccato a lettere o cifre: è una versione ("v2"), un codice, un pezzo
    // di data già scartata.
    if (/[\p{L}\p{N}_/]/u.test(prima) || /[\p{L}\p{N}_/]/u.test(dopo)) continue;

    const valore = normalizzaNumero(match[0]);
    const qualificato = /[€%]/u.test(match[0]) || MILIONI.test(match[0]);
    // Un intero nudo fra 1900 e 2100 è quasi sempre un anno, non una quantità.
    if (!qualificato && Number.isInteger(valore) && valore >= 1900 && valore <= 2100) {
      continue;
    }

    risultati.push({ testo: match[0], valore, posizione });
  }

  return risultati;
}

/** Quanto un numero può discostarsi dal valore noto e restare "lo stesso". */
function corrisponde(numero: NumeroCitato, noto: number, percentuale: boolean): boolean {
  const differenza = Math.abs(numero.valore - noto);
  if (differenza === 0) return true;
  if (percentuale) return differenza <= 0.5;
  if (MILIONI.test(numero.testo)) {
    // "2,8 M" ha una sola cifra decimale: copre mezzo scatto da 100.000.
    const decimali = numero.testo.match(/,(\d+)/u)?.[1].length ?? 0;
    if (differenza <= (10 ** -decimali * 1_000_000) / 2) return true;
  }
  return Math.abs(noto) > 0 && differenza / Math.abs(noto) <= 0.005;
}

/**
 * Cerca il riscontro di un numero, generando i valori derivati **al volo**.
 *
 * La versione che materializzava tutte le coppie costruiva, con 200 valori
 * noti, quasi centosessantamila oggetti con la stringa di provenienza già
 * concatenata — per poi usarne al più uno per numero, e rifare tutto al giro
 * di correzione. Qui si scorre e ci si ferma al primo riscontro, e la stringa
 * si compone solo per quello.
 */
function riscontro(numero: NumeroCitato, noti: ValoreNoto[]): string | null {
  const percentuale = numero.testo.includes("%");

  // Una percentuale si confronta solo con altre percentuali.
  //
  // Senza questo filtro il controllo era quasi inutile proprio dove serve di
  // più: con la tolleranza di mezzo punto, "35,4%" trovava riscontro in un
  // qualunque noto fra 34,9 e 35,9 — un conteggio di ordini, dei giorni di
  // risposta, un importo piccolo. Fra centinaia di righe un valore simile
  // c'è quasi sempre, e una percentuale inventata risultava verificata.
  const confrontabili = percentuale
    ? noti.filter((n) => n.unita === "percentuale" || n.unita === undefined)
    : noti;

  for (const noto of confrontabili) {
    if (corrisponde(numero, noto.valore, percentuale)) return noto.fonte;
  }

  // Derivati: differenze (gli scostamenti) e rapporti (le quote percentuali).
  // Oltre la soglia il costo diventa quadratico senza un beneficio
  // proporzionato, e restano i riscontri diretti.
  const LIMITE_DERIVATI = 200;
  if (noti.length > LIMITE_DERIVATI) return null;

  for (let i = 0; i < noti.length; i++) {
    for (let j = i + 1; j < noti.length; j++) {
      const a = noti[i];
      const b = noti[j];

      if (percentuale) {
        // Le quote si calcolano fra grandezze omogenee: la percentuale di un
        // importo sul totale degli importi, non di un importo su un conteggio.
        if (a.unita !== b.unita) continue;
        if (b.valore !== 0 && corrisponde(numero, (a.valore / b.valore) * 100, true)) {
          return `rapporto fra ${a.fonte} e ${b.fonte}`;
        }
        if (a.valore !== 0 && corrisponde(numero, (b.valore / a.valore) * 100, true)) {
          return `rapporto fra ${b.fonte} e ${a.fonte}`;
        }
        continue;
      }

      if (corrisponde(numero, a.valore - b.valore, false)) {
        return `differenza fra ${a.fonte} e ${b.fonte}`;
      }
      if (corrisponde(numero, b.valore - a.valore, false)) {
        return `differenza fra ${b.fonte} e ${a.fonte}`;
      }
    }
  }

  return null;
}

export function verificaNumeri(testo: string, noti: ValoreNoto[]): EsitoVerifica {
  const numeri: NumeroCitato[] = estraiNumeri(testo).map((estratto) => {
    const numero: NumeroCitato = { ...estratto, verificato: false };
    const fonte = riscontro(numero, noti);
    return fonte === null ? numero : { ...numero, verificato: true, fonte };
  });

  return {
    numeri,
    nonVerificati: numeri.filter((numero) => !numero.verificato).length,
  };
}
