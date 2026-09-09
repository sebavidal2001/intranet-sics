/**
 * Lettura dei numeri usciti da un riconoscimento ottico.
 *
 * Non è un `parseFloat` con qualche pulizia: sono le tre famiglie di errore che
 * il motore commette davvero su una fattura, misurate su un documento con
 * valori noti (`scripts/vettori/ocr/misura-precisione.test.ts`).
 *
 *   1) SEPARATORE DECIMALE SCAMBIATO. «107,48» letto «107.48», «310,0» letto
 *      «310.0». È l'errore più frequente e il meno grave: il valore non cambia,
 *      cambia il carattere. Qui punto e virgola sono trattati alla pari, e a
 *      decidere quale sia il decimale è la posizione, non il segno.
 *
 *   2) SEPARATORE PERSO E NUMERO SPEZZATO. «94,80» letto «94 80», in due
 *      parole. Questo il valore lo cambia, e di molto. Si ricompone solo
 *      sapendo che le due parti stanno nella stessa cella: la ricomposizione
 *      vive in `ocr.ts`, che le celle le conosce; qui c'è la regola che dice
 *      quando due pezzi formano un importo plausibile.
 *
 *   3) LETTERE AL POSTO DI CIFRE. «O» per «0», «l» per «1», «S» per «5». La
 *      correzione si applica **solo** dove ci si aspetta un numero e non c'è
 *      alternativa, e resta registrata: un valore corretto d'ufficio non è un
 *      valore letto, e chi rivede la fattura deve poterlo distinguere.
 */

export interface NumeroLetto {
  valore: number | null;
  /** Il testo di partenza, per mostrarlo accanto al valore. */
  grezzo: string;
  /** Sostituzioni applicate: vuoto se il testo era già numerico. */
  correzioni: string[];
}

/**
 * Confusioni ottiche fra lettere e cifre.
 *
 * L'elenco è corto di proposito: contiene solo le sostituzioni che il motore
 * fa davvero su caratteri stampati, non ogni somiglianza immaginabile. Una
 * tabella più larga «corregge» anche testo che numero non era, e trasforma
 * silenziosamente una sigla in un importo.
 */
const CONFUSIONI: Record<string, string> = {
  O: "0", o: "0", D: "0", Q: "0",
  l: "1", I: "1", i: "1", "|": "1", "!": "1",
  S: "5", s: "5",
  B: "8",
  Z: "2", z: "2",
  G: "6",
  T: "7",
  b: "6",
};

/**
 * Toglie valuta e segni che non fanno parte del numero, **senza chiudere gli
 * spazi interni**.
 *
 * È la riga più importante del file. Togliendo tutti gli spazi, «94 80» —
 * l'importo che il motore ha spezzato in due parole — diventerebbe 9480:
 * cento volte tanto, senza un errore visibile da nessuna parte. Lo spazio
 * interno resta, `leggiNumero` rifiuta il testo, e la ricomposizione passa da
 * `ricomponiImporto`, che sa quando due pezzi formano un importo e quando no.
 */
function ripulisci(testo: string): string {
  return testo
    .replace(/[€$£]/g, "")
    // Gli spazi unificatori vanno normalizzati, non tolti: restano spazi, e
    // come tali bloccano la lettura diretta invece di chiudersi in silenzio.
    .replace(/[   ]/g, " ")
    .replace(/^[\s·•*]+|[\s·•*]+$/g, "")
    .replace(/[ 	]{2,}/g, " ");
}

/**
 * Decide quale separatore è il decimale e restituisce il numero.
 *
 * La regola, in ordine:
 *   - se ci sono sia punti sia virgole, il decimale è **l'ultimo che compare**:
 *     `1.234,56` e `1,234.56` sono lo stesso importo scritto in due paesi;
 *   - se ce n'è uno solo e ha esattamente tre cifre dopo con almeno una prima,
 *     è un separatore di migliaia (`1.234`);
 *   - altrimenti è il decimale (`107.48`, `310.0`, `76,49`).
 *
 * L'unico caso che resta ambiguo è `1.234` inteso come «uno virgola
 * duecentotrentaquattro», che su una fattura non esiste: i pesi hanno una o
 * tre cifre decimali e gli importi due.
 */
export function interpretaSeparatori(pulito: string): number | null {
  // Uno spazio interno significa che il motore ha visto due gruppi: unirli
  // qui sarebbe un'ipotesi travestita da lettura. Se ne occupa
  // `ricomponiImporto`, che dichiara di averlo fatto.
  if (/\s/.test(pulito)) return null;
  if (!/^[+-]?[\d.,]+$/.test(pulito)) return null;

  const segno = pulito.startsWith("-") ? -1 : 1;
  const cifre = pulito.replace(/^[+-]/, "");
  if (!/\d/.test(cifre)) return null;

  const ultimoPunto = cifre.lastIndexOf(".");
  const ultimaVirgola = cifre.lastIndexOf(",");
  const posizione = Math.max(ultimoPunto, ultimaVirgola);

  if (posizione === -1) {
    const n = Number(cifre);
    return Number.isFinite(n) ? segno * n : null;
  }

  const dopo = cifre.length - posizione - 1;
  const prima = cifre.slice(0, posizione).replace(/[.,]/g, "");
  const soloUnSeparatore = ultimoPunto === -1 || ultimaVirgola === -1;
  const quantiSeparatori = (cifre.match(/[.,]/g) ?? []).length;

  const migliaia =
    soloUnSeparatore && quantiSeparatori >= 1 && dopo === 3 && prima.length >= 1;

  const testo = migliaia
    ? cifre.replace(/[.,]/g, "")
    : `${prima}.${cifre.slice(posizione + 1).replace(/[.,]/g, "")}`;

  const n = Number(testo);
  return Number.isFinite(n) ? segno * n : null;
}

/**
 * Legge un numero da un testo riconosciuto otticamente.
 *
 * Con `attesoNumerico` si dichiara che quella cella **deve** contenere un
 * numero: solo allora si applicano le sostituzioni delle lettere confuse. Su
 * una cella di testo libero quella correzione trasformerebbe una sigla in un
 * importo, che è peggio di non leggere niente.
 */
export function leggiNumero(
  testo: string,
  opzioni: { attesoNumerico?: boolean } = {}
): NumeroLetto {
  const grezzo = testo ?? "";
  const pulito = ripulisci(grezzo);
  if (pulito === "") return { valore: null, grezzo, correzioni: [] };

  const diretto = interpretaSeparatori(pulito);
  if (diretto !== null) return { valore: diretto, grezzo, correzioni: [] };

  if (!opzioni.attesoNumerico) return { valore: null, grezzo, correzioni: [] };

  if (/\s/.test(pulito)) return { valore: null, grezzo, correzioni: [] };

  const correzioni: string[] = [];
  const corretto = [...pulito]
    .map((c) => {
      const sostituto = CONFUSIONI[c];
      if (sostituto) {
        correzioni.push(`${c}→${sostituto}`);
        return sostituto;
      }
      return c;
    })
    .join("");

  const valore = interpretaSeparatori(corretto);
  return valore === null
    ? { valore: null, grezzo, correzioni: [] }
    : { valore, grezzo, correzioni };
}

/**
 * Ricompone un importo spezzato in più parole.
 *
 * «94,80» letto «94 80» è l'errore che cambia davvero i conti: senza
 * ricomposizione quella riga porta 94 euro invece di 94,80, e la differenza
 * finisce nello scostamento come se fosse colpa del vettore.
 *
 * Si ricompone **solo** quando le parti sono coerenti con un importo: due
 * pezzi, il secondo di una, due o tre cifre. `["2026/00464", "1"]` non passa —
 * il primo pezzo non è un numero puro — e resta un riferimento spezzato, che
 * si ricompone altrove come testo.
 */
export function ricomponiImporto(pezzi: string[]): NumeroLetto {
  // I pezzi possono arrivare già spezzati dal motore oppure uniti da uno
  // spazio dentro la stessa cella: si normalizzano nello stesso modo.
  const puliti = pezzi
    .flatMap((p) => ripulisci(p).split(/\s+/))
    .filter((p) => p !== "");
  if (puliti.length === 0) return { valore: null, grezzo: pezzi.join(" "), correzioni: [] };
  if (puliti.length === 1) return leggiNumero(puliti[0], { attesoNumerico: true });

  const grezzo = pezzi.join(" ");
  if (puliti.length !== 2) return { valore: null, grezzo, correzioni: [] };

  const [intera, decimale] = puliti;
  if (!/^\d{1,6}$/.test(intera) || !/^\d{1,3}$/.test(decimale)) {
    return { valore: null, grezzo, correzioni: [] };
  }

  const valore = Number(`${intera}.${decimale}`);
  return Number.isFinite(valore)
    ? { valore, grezzo, correzioni: [`ricomposto «${intera}» + «${decimale}»`] }
    : { valore: null, grezzo, correzioni: [] };
}

/* ------------------------------------------------------------------ */
/*  Verifica aritmetica                                                */
/* ------------------------------------------------------------------ */

export interface EsitoQuadratura {
  ok: boolean;
  differenza: number;
  atteso: number;
  trovato: number;
}

/**
 * I conti tornano?
 *
 * La tolleranza è di un centesimo per addendo: sommando importi già arrotondati
 * l'ultimo decimale balla, e pretendere l'uguaglianza esatta farebbe fallire
 * fatture corrette. Oltre quella soglia non è arrotondamento, è una cifra letta
 * male.
 */
export function quadrano(
  addendi: Array<number | null>,
  totale: number | null,
  tolleranzaPerAddendo = 0.01
): EsitoQuadratura {
  const validi = addendi.filter((x): x is number => x != null);
  const somma = Math.round(validi.reduce((a, b) => a + b, 0) * 100) / 100;
  const atteso = totale ?? 0;
  const differenza = Math.round((somma - atteso) * 100) / 100;
  const tolleranza = Math.max(0.01, validi.length * tolleranzaPerAddendo);

  return {
    ok: totale != null && Math.abs(differenza) <= tolleranza,
    differenza,
    atteso,
    trovato: somma,
  };
}

/**
 * Il valore è plausibile per il tipo di campo?
 *
 * Serve a intercettare la cifra persa o aggiunta: un peso di 3.100 kg su una
 * spedizione FedEx, o un nolo di 7,65 € dove ci si aspetta 76,49. Non
 * garantisce che il numero sia giusto — dice che è nell'ordine di grandezza
 * possibile, e che quindi la quadratura ha senso di essere tentata.
 */
export function plausibile(
  valore: number | null,
  tipo: "importo" | "peso" | "colli" | "percentuale"
): boolean {
  if (valore == null || !Number.isFinite(valore)) return false;
  switch (tipo) {
    case "importo":
      return valore >= 0 && valore <= 100_000;
    case "peso":
      return valore > 0 && valore <= 30_000;
    case "colli":
      return Number.isInteger(valore) && valore >= 1 && valore <= 999;
    case "percentuale":
      return valore >= 0 && valore <= 100;
  }
}
