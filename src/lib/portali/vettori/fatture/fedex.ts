import type { FatturaLetta, RigaFattura, TotaliDichiarati } from "./tipi";
import {
  bandeColonne,
  celleDiRiga,
  raggruppaInRighe,
  rasterizza,
  riconosciPagina,
  correggiOrientamento,
  rileggiCelle,
  DPI,
  type Cella,
  type PaginaRasterizzata,
  type PaginaRiconosciuta,
} from "./ocr";
import { leggiNumero, plausibile, ricomponiImporto } from "./numeri";
import { leggiPerRighe, verso_righe } from "./fedex-righe";

/**
 * Lettura delle fatture FedEx per riconoscimento ottico.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PERCHÉ NON C'È UN TRACCIATO SCRITTO A MANO
 *
 * Gli altri tre parser sanno dove guardare perché il testo del PDF si legge e
 * il tracciato si è potuto studiare su fatture vere. Qui il PDF è un disegno, e
 * scrivere «la quarta colonna è il nolo» significherebbe fissare nel codice una
 * disposizione **ipotizzata**: il giorno in cui FedEx sposta una colonna il
 * programma leggerebbe importi sbagliati senza accorgersene, che è il modo
 * peggiore di sbagliare.
 *
 * Le colonne si riconoscono invece da **cosa contengono** e si assegnano da
 * **come tornano i conti**:
 *
 *   - una colonna di date è quella dove i valori sono date;
 *   - il riferimento è dove compare il nostro formato di bolla;
 *   - fra le colonne numeriche, il **totale è quella che è la somma delle
 *     altre**. Non è una convenzione grafica ma un fatto aritmetico, e vale
 *     qualunque sia l'ordine delle colonne.
 *
 * Se i conti non tornano, non si tira a indovinare: le righe tornano indietro
 * con le celle così come sono state lette, e le assegna una persona nella
 * schermata di acquisizione, dove ha accanto l'immagine della pagina.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface CellaLetta {
  banda: number;
  testo: string;
  valore: number | null;
  confidenza: number;
  /** Vero quando il valore viene dalla seconda passata sul ritaglio. */
  riletta: boolean;
  correzioni: string[];
}

export interface RigaOcr {
  numero: number;
  celle: CellaLetta[];
  /** La confidenza più bassa fra le celle: è quella che conta. */
  confidenzaMinima: number;
}

export interface LetturaOcr {
  fattura: FatturaLetta;
  /** Le righe come sono state lette, prima dell'assegnazione dei ruoli. */
  righeGrezze: RigaOcr[];
  /** Ruolo assegnato a ogni banda, o `null` dove non si è potuto decidere. */
  ruoli: Record<number, Ruolo | null>;
  /** PNG delle pagine, per mostrarle accanto ai valori. */
  pagine: Array<{ numero: number; immagine: string }>;
  /** Perché l'assegnazione è andata come è andata, in italiano. */
  spiegazioni: string[];
}

export type Ruolo =
  | "data"
  | "riferimento"
  | "numero_spedizione"
  | "destinazione"
  | "colli"
  | "peso"
  | "nolo"
  | "supplementi"
  | "carburante"
  | "totale";

const DATA = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/;
/** Il formato dei nostri numeri di bolla: anno, barra, progressivo. */
const RIFERIMENTO = /^\d{4}[/\-]\d{3,8}$/;
/**
 * Lettera di vettura: cifre in gruppi separati da spazi, almeno due gruppi.
 * FedEx la stampa come «7794 8821 0034».
 *
 * Ha una costante sua perché è il tranello più insidioso di tutta la lettura:
 * riletta con l'alfabeto dei numeri i gruppi si uniscono in «779488210034», che
 * è un intero valido, entra fra le colonne di importi e — essendo il più
 * grande — si prende il ruolo di peso o di nolo. Un identificativo travestito
 * da importo non lo intercetta nessuna quadratura.
 */
const LETTERA_VETTURA = /^\d{2,6}(?:\s+\d{2,6}){1,4}$/;

/* ------------------------------------------------------------------ */
/*  Lettura                                                            */
/* ------------------------------------------------------------------ */

export async function leggiFedexOcr(
  bytes: Uint8Array,
  opzioni: { dpi?: number } = {}
): Promise<LetturaOcr> {
  const spiegazioni: string[] = [];

  // Le fatture arrivano come le ha girate lo scanner: la prima FedEx vera era
  // coricata di 90 gradi, e il riconoscimento restituiva frammenti illeggibili
  // al 40% di confidenza. Si raddrizza prima di leggere.
  const grezze = await rasterizza(bytes, { dpi: opzioni.dpi ?? DPI });
  const pagine: PaginaRasterizzata[] = [];
  for (const g of grezze) {
    const { pagina, gradi } = await correggiOrientamento(g);
    if (gradi !== 0) {
      spiegazioni.push(`Pagina ${g.numero} raddrizzata di ${gradi} gradi.`);
    }
    pagine.push(pagina);
  }

  const riconosciute: PaginaRiconosciuta[] = [];
  for (const p of pagine) riconosciute.push(await riconosciPagina(p));

  const righeGrezze: RigaOcr[] = [];
  let progressivo = 0;

  for (let i = 0; i < pagine.length; i++) {
    const righe = raggruppaInRighe(riconosciute[i].parole);
    const dati = righe.filter(sembraRigaSpedizione);
    if (dati.length === 0) continue;

    const bande = bandeColonne(dati.flat(), riconosciute[i].larghezza);
    for (const riga of dati) {
      progressivo++;
      righeGrezze.push(
        await leggiRiga(progressivo, celleDiRiga(riga, bande), pagine[i])
      );
    }
  }

  if (righeGrezze.length === 0) {
    spiegazioni.push(
      "Nessuna riga di spedizione riconosciuta: la pagina non contiene una tabella con date e importi, oppure la scansione è troppo sbiadita."
    );
  }

  // ---- prima strategia: il tracciato a blocchi, quello che FedEx usa davvero ----
  //
  // Si prova per prima perché è l'unica misurata su fatture vere. La lettura a
  // colonne resta come ricaduta: servirebbe se un giorno FedEx passasse a una
  // tabella, e ha dietro il collaudo sul documento sintetico.
  const perRighe = leggiPerRighe(riconosciute);
  if (perRighe.blocchi.length > 0) {
    const { righe, totali: t, avvertenze } = verso_righe(perRighe);
    spiegazioni.push(
      `Tracciato a blocchi: ${perRighe.blocchi.length} spedizioni riconosciute dalla lettera di vettura.`
    );
    for (const a of avvertenze) spiegazioni.push(a);

    return {
      fattura: {
        vettore: "fedex",
        numero: perRighe.numero,
        data: perRighe.data,
        anno: perRighe.data ? Number(perRighe.data.slice(0, 4)) : null,
        mese: perRighe.data ? Number(perRighe.data.slice(5, 7)) : null,
        righe,
        righeNonLette: perRighe.nonLette,
        totali: t,
        avvertenze: [
          "Fattura letta per riconoscimento ottico: ogni riga va confermata prima dell'acquisizione.",
          ...avvertenze,
        ],
      },
      righeGrezze,
      ruoli: {},
    pagine: pagine.map((p, i) => ({
      numero: p.numero,
      immagine: `data:image/png;base64,${riconosciute[i].immagine.toString("base64")}`,
    })),
      spiegazioni,
    };
  }

  // ---- ricaduta: la lettura a colonne ----
  spiegazioni.push(
    "Nessuna lettera di vettura riconosciuta: si prova a leggere il documento come una tabella."
  );
  const totali = leggiTotali(riconosciute);
  const ruoli = assegnaRuoli(righeGrezze, spiegazioni, totali.percentualeCarburante);

  return {
    fattura: componiFattura(righeGrezze, ruoli, totali),
    righeGrezze,
    ruoli,
    pagine: pagine.map((p, i) => ({
      numero: p.numero,
      immagine: `data:image/png;base64,${riconosciute[i].immagine.toString("base64")}`,
    })),
    spiegazioni,
  };
}

/**
 * Una riga è una spedizione quando comincia con una data e contiene almeno due
 * numeri.
 *
 * Il criterio è volutamente severo: intestazioni, note a piè di pagina e righe
 * di totale non cominciano con una data, e farle entrare fra le spedizioni
 * significherebbe fatturare due volte lo stesso importo.
 */
function sembraRigaSpedizione(riga: Array<{ testo: string }>): boolean {
  if (riga.length < 4) return false;
  if (!DATA.test(riga[0].testo)) return false;
  const numeri = riga.filter((p) => leggiNumero(p.testo).valore !== null).length;
  return numeri >= 2;
}

/**
 * Legge le celle di una riga, rileggendo **solo** quelle che ne hanno bisogno.
 *
 * La regola di quando rileggere è costata un giro di misura. La prima versione
 * rileggeva ogni cella sotto l'80% di confidenza, e peggiorava il risultato:
 * la data «24/07/2026», letta perfettamente dalla prima passata, tornava dalla
 * seconda come «2410712026» — le barre trasformate in uno e in sette. Una
 * seconda opinione non vale più della prima solo perché arriva dopo.
 *
 * Si rilegge quindi solo dove la prima passata ha **fallito in modo
 * riconoscibile**: la cella è spezzata in più parole, oppure il suo testo non
 * è né una data, né un riferimento, né un numero. E il risultato della
 * rilettura si accetta solo se la prima passata non aveva già prodotto un
 * valore utilizzabile.
 */
async function leggiRiga(
  numero: number,
  celle: Cella[],
  pagina: PaginaRasterizzata
): Promise<RigaOcr> {
  const giaBuona = (c: Cella) => {
    const t = c.testo.trim();
    if (DATA.test(t)) return true;
    // Lettera di vettura: gruppi di cifre separati da spazi. Rileggerla con
    // l'alfabeto dei numeri li unirebbe in un unico intero enorme, che poi
    // verrebbe scambiato per un importo.
    if (LETTERA_VETTURA.test(t)) return true;
    if (RIFERIMENTO.test(t.replace(/\s/g, ""))) return true;
    if (/^[A-Za-zÀ-ÿ .'-]{3,}$/.test(t)) return true;
    return c.parole.length === 1 && leggiNumero(t).valore !== null;
  };

  const dubbie = celle.filter((c) => !giaBuona(c));
  const numeriche = dubbie.filter(paresembraNumerica);
  const testuali = dubbie.filter((c) => !paresembraNumerica(c));

  const [riletteNumeriche, rilettuTestuali] = await Promise.all([
    rileggiCelle(pagina, numeriche, 'numero'),
    rileggiCelle(pagina, testuali, 'riferimento'),
  ]);

  const rilettura = new Map<number, { testo: string; confidenza: number }>();
  numeriche.forEach((c, i) => rilettura.set(c.banda, riletteNumeriche[i]));
  testuali.forEach((c, i) => rilettura.set(c.banda, rilettuTestuali[i]));

  const lette: CellaLetta[] = celle.map((c) => {
    // Prima passata: se ha prodotto un numero su una cella non spezzata, è
    // quello che vale.
    if (c.parole.length === 1) {
      const diretto = leggiNumero(c.testo, { attesoNumerico: true });
      if (diretto.valore !== null) {
        return {
          banda: c.banda,
          testo: c.testo,
          valore: diretto.valore,
          confidenza: c.confidenza,
          riletta: false,
          correzioni: diretto.correzioni,
        };
      }
    }

    const r = rilettura.get(c.banda);
    if (r) {
      const daRilettura = leggiNumero(r.testo, { attesoNumerico: true });
      if (daRilettura.valore !== null) {
        return {
          banda: c.banda,
          testo: r.testo,
          valore: daRilettura.valore,
          confidenza: r.confidenza,
          riletta: true,
          correzioni: daRilettura.correzioni,
        };
      }
      // Rilettura non numerica ma su cella spezzata: è comunque meglio del
      // testo con lo spazio in mezzo, che nessuno saprebbe interpretare.
      if (r.testo && c.parole.length > 1) {
        return {
          banda: c.banda,
          testo: r.testo,
          valore: null,
          confidenza: r.confidenza,
          riletta: true,
          correzioni: [],
        };
      }
    }

    const diretto = leggiNumero(c.testo, { attesoNumerico: true });
    if (diretto.valore !== null) {
      return {
        banda: c.banda,
        testo: c.testo,
        valore: diretto.valore,
        confidenza: c.confidenza,
        riletta: false,
        correzioni: diretto.correzioni,
      };
    }

    const ricomposto = ricomponiImporto(c.parole.map((p) => p.testo));
    return {
      banda: c.banda,
      testo: c.testo,
      valore: ricomposto.valore,
      confidenza: c.confidenza,
      riletta: false,
      correzioni: ricomposto.correzioni,
    };
  });

  return {
    numero,
    celle: lette,
    confidenzaMinima: Math.min(...lette.map((c) => c.confidenza), 100),
  };
}

/** Una cella è numerica se non contiene lettere. */
function paresembraNumerica(c: Cella): boolean {
  return !/[A-Za-z]{2,}/.test(c.testo) && /\d/.test(c.testo) && !c.testo.includes("/");
}

/* ------------------------------------------------------------------ */
/*  Assegnazione dei ruoli                                             */
/* ------------------------------------------------------------------ */

/**
 * Decide cosa contiene ogni colonna.
 *
 * Prima per contenuto — date, riferimenti, testo — poi, fra le colonne
 * numeriche rimaste, **per aritmetica**: il totale è la colonna che è la somma
 * delle altre. È l'unico criterio che non dipende da dove FedEx decide di
 * mettere le colonne.
 */
export function assegnaRuoli(
  righe: RigaOcr[],
  spiegazioni: string[],
  percentualeCarburante: number | null = null
): Record<number, Ruolo | null> {
  const ruoli: Record<number, Ruolo | null> = {};
  if (righe.length === 0) return ruoli;

  const bande = [...new Set(righe.flatMap((r) => r.celle.map((c) => c.banda)))].sort(
    (a, b) => a - b
  );
  const testiDi = (banda: number) =>
    righe.map((r) => r.celle.find((c) => c.banda === banda)?.testo ?? "");
  const valoriDi = (banda: number) =>
    righe.map((r) => r.celle.find((c) => c.banda === banda)?.valore ?? null);

  const quasiTutte = (v: boolean[]) =>
    v.filter(Boolean).length >= Math.ceil(v.length * 0.8);

  const numeriche: number[] = [];

  for (const banda of bande) {
    const testi = testiDi(banda);
    const valori = valoriDi(banda);

    if (quasiTutte(testi.map((t) => DATA.test(t)))) {
      ruoli[banda] = "data";
      continue;
    }
    if (quasiTutte(testi.map((t) => RIFERIMENTO.test(t.replace(/\s/g, ""))))) {
      ruoli[banda] = "riferimento";
      continue;
    }
    // Una colonna di sole lettere è la destinazione o il nome: non un importo.
    if (quasiTutte(testi.map((t) => /^[A-Za-zÀ-ÿ .'-]{3,}$/.test(t.trim())))) {
      ruoli[banda] = "destinazione";
      continue;
    }
    // Cifre in gruppi: la lettera di vettura. Va riconosciuta prima delle
    // colonne numeriche, altrimenti si candida come importo.
    if (quasiTutte(testi.map((t) => LETTERA_VETTURA.test(t.trim())))) {
      ruoli[banda] = "numero_spedizione";
      continue;
    }
    if (quasiTutte(valori.map((v) => v !== null))) {
      numeriche.push(banda);
      ruoli[banda] = null;
      continue;
    }
    ruoli[banda] = null;
  }

  if (numeriche.length === 0) {
    spiegazioni.push("Nessuna colonna di importi riconosciuta.");
    return ruoli;
  }

  // Colli: interi piccoli. Peso: decimali di grandezza da spedizione.
  const restanti = [...numeriche];
  const colli = restanti.find((b) =>
    valoriDi(b).every((v) => v !== null && plausibile(v, "colli"))
  );
  if (colli !== undefined) {
    ruoli[colli] = "colli";
    restanti.splice(restanti.indexOf(colli), 1);
    spiegazioni.push("Colonna dei colli riconosciuta: contiene solo interi piccoli.");
  }

  const totale = trovaColonnaTotale(restanti, valoriDi, percentualeCarburante);
  if (totale === null) {
    spiegazioni.push(
      "Non è stato possibile capire quale colonna sia il totale: nessuna è la somma delle altre. Le colonne vanno assegnate a mano."
    );
    return ruoli;
  }

  ruoli[totale.banda] = "totale";
  spiegazioni.push(
    totale.conCarburante
      ? `Colonna del totale riconosciuta: su ${totale.quante} righe su ${righe.length} è la somma delle altre più il carburante del periodo.`
      : `Colonna del totale riconosciuta: su ${totale.quante} righe su ${righe.length} è la somma esatta delle altre.`
  );

  const importi = restanti.filter((b) => b !== totale.banda);
  // Fra le colonne rimaste, il nolo è la più grande: gli extra sono
  // supplementi, e un supplemento più caro del trasporto non esiste.
  if (importi.length > 0) {
    const medie = importi.map((b) => ({
      banda: b,
      media: media(valoriDi(b).filter((v): v is number => v !== null)),
    }));
    medie.sort((a, b) => b.media - a.media);

    // Il peso si distingue dagli importi per due cose insieme: non entra nella
    // somma che dà il totale, **e** i suoi valori sono plausibili come
    // chilogrammi. Il primo criterio da solo non basta — non entra nella somma
    // nemmeno un identificativo letto per sbaglio come numero, e senza il
    // secondo controllo una lettera di vettura da dodici cifre diventerebbe un
    // peso di ottocento miliardi di chili senza che niente protesti.
    const peso = medie.find(
      (m) =>
        !totale.componenti.includes(m.banda) &&
        valoriDi(m.banda).every((v) => v === null || plausibile(v, "peso"))
    );
    if (peso && totale.componenti.length > 0) {
      ruoli[peso.banda] = "peso";
      spiegazioni.push(
        "Colonna del peso riconosciuta: non entra nella somma che dà il totale e i valori stanno nell'ordine di grandezza dei chilogrammi."
      );
    }

    const dentro = medie.filter((m) => totale.componenti.includes(m.banda));
    if (dentro.length > 0) {
      ruoli[dentro[0].banda] = "nolo";
      for (const m of dentro.slice(1)) ruoli[m.banda] = "supplementi";
    }
  }

  return ruoli;
}

/**
 * Cerca la colonna che è la somma di un sottoinsieme delle altre.
 *
 * Si provano tutte le combinazioni: le colonne numeriche di una fattura sono
 * poche, e provarle tutte costa niente rispetto al rischio di indovinare male.
 * Vince la combinazione che torna sul maggior numero di righe, e solo se torna
 * su almeno l'80% — sotto quella soglia è una coincidenza, non una struttura.
 *
 * **Il carburante spesso non ha una colonna sua.** Sul documento di collaudo il
 * totale non era la somma delle colonne stampate ma quella somma *maggiorata
 * della percentuale carburante*, che compare solo in testa alla fattura. Se si
 * cerca la sola somma non si trova niente e si conclude — sbagliando — che la
 * tabella non ha un totale. Per questo si prova anche la relazione con il
 * moltiplicatore, quando la percentuale è stata letta.
 */
function trovaColonnaTotale(
  bande: number[],
  valoriDi: (banda: number) => Array<number | null>,
  percentualeCarburante: number | null = null
): {
  banda: number;
  componenti: number[];
  quante: number;
  conCarburante: boolean;
} | null {
  let migliore: {
    banda: number;
    componenti: number[];
    quante: number;
    conCarburante: boolean;
  } | null = null;

  const moltiplicatori: Array<{ valore: number; conCarburante: boolean }> = [
    { valore: 1, conCarburante: false },
  ];
  if (percentualeCarburante !== null && percentualeCarburante > 0) {
    moltiplicatori.push({
      valore: 1 + percentualeCarburante,
      conCarburante: true,
    });
  }

  for (const candidata of bande) {
    const altre = bande.filter((b) => b !== candidata);
    const valoriTotale = valoriDi(candidata);

    for (let maschera = 1; maschera < 1 << altre.length; maschera++) {
      const componenti = altre.filter((_, i) => maschera & (1 << i));
      if (componenti.length < 2) continue;

      for (const m of moltiplicatori) {
      let quante = 0;
      let righeValide = 0;
      for (let r = 0; r < valoriTotale.length; r++) {
        const t = valoriTotale[r];
        if (t == null) continue;
        const parti = componenti.map((b) => valoriDi(b)[r]);
        if (parti.some((v) => v == null)) continue;
        righeValide++;
        const somma = parti.reduce((a, b) => a! + b!, 0)! * m.valore;
        // La tolleranza con il moltiplicatore è più larga: la percentuale
        // stampata è arrotondata, e su importi grandi qualche centesimo di
        // scarto è normale.
        const tolleranza = m.conCarburante ? Math.max(0.05, t * 0.002) : 0.02;
        if (Math.abs(somma - t) <= tolleranza) quante++;
      }

        if (righeValide === 0) continue;
        if (
          quante / righeValide >= 0.8 &&
          (!migliore || quante > migliore.quante)
        ) {
          migliore = {
            banda: candidata,
            componenti,
            quante,
            conCarburante: m.conCarburante,
          };
        }
      }
    }
  }

  return migliore;
}

function media(v: number[]): number {
  return v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length;
}

/* ------------------------------------------------------------------ */
/*  Totali del documento                                               */
/* ------------------------------------------------------------------ */

/**
 * I totali stampati in coda alla fattura.
 *
 * Si cercano per etichetta sulla stessa riga: «Totale documento» seguito da un
 * importo. Sono il metro con cui si giudica tutto il resto, quindi se non si
 * trovano restano `null` e la quadratura dichiara di non poter decidere —
 * meglio che inventarli sommando quello che si è letto.
 */
export function leggiTotali(pagine: PaginaRiconosciuta[]): TotaliDichiarati {
  const righe = pagine.flatMap((p) => raggruppaInRighe(p.parole));

  const cerca = (etichetta: RegExp): number | null => {
    for (const riga of righe) {
      const testo = riga.map((p) => p.testo).join(" ");
      if (!etichetta.test(testo)) continue;
      // L'importo è l'ultimo numero della riga: le etichette stanno a sinistra
      // e i numeri incolonnati a destra.
      for (let i = riga.length - 1; i >= 0; i--) {
        const n = leggiNumero(riga[i].testo, { attesoNumerico: true });
        if (n.valore !== null) return n.valore;
      }
    }
    return null;
  };

  return {
    spedizioni: null,
    colli: null,
    peso: null,
    pesoRiferito: "reale",
    nolo: cerca(/totale\s+nolo/i),
    supplementi: cerca(/totale\s+supplement/i),
    adeguamento: null,
    carburante: cerca(/totale\s+carburante|fuel/i),
    percentualeCarburante: (() => {
      const p = cerca(/supplemento\s+carburante.*%|carburante\s+del\s+periodo/i);
      return p !== null && plausibile(p, "percentuale") ? p / 100 : null;
    })(),
    totaleDocumento: cerca(/totale\s+(documento|fattura)|importo\s+totale/i),
  };
}

/* ------------------------------------------------------------------ */
/*  Composizione                                                       */
/* ------------------------------------------------------------------ */

function componiFattura(
  righe: RigaOcr[],
  ruoli: Record<number, Ruolo | null>,
  totali: TotaliDichiarati
): FatturaLetta {
  const banda = (ruolo: Ruolo): number | null => {
    const trovata = Object.entries(ruoli).find(([, r]) => r === ruolo);
    return trovata ? Number(trovata[0]) : null;
  };

  const bandaData = banda("data");
  const bandaRif = banda("riferimento");
  const bandaSped = banda("numero_spedizione");
  const bandaDest = banda("destinazione");
  const bandaColli = banda("colli");
  const bandaPeso = banda("peso");
  const bandaNolo = banda("nolo");
  const bandaSupp = banda("supplementi");
  const bandaTot = banda("totale");

  const righeNonLette: string[] = [];
  const lette: RigaFattura[] = [];

  for (const riga of righe) {
    const cella = (b: number | null) =>
      b === null ? undefined : riga.celle.find((c) => c.banda === b);

    const totale = cella(bandaTot)?.valore ?? null;
    if (totale === null) {
      righeNonLette.push(riga.celle.map((c) => c.testo).join(" | "));
      continue;
    }

    const nolo = cella(bandaNolo)?.valore ?? null;
    const supplementi = cella(bandaSupp)?.valore ?? 0;
    const imponibile = (nolo ?? 0) + supplementi;
    // Il carburante non ha una colonna sua: è quello che resta fra il totale e
    // l'imponibile. Ricavarlo per differenza invece di calcolarlo con la
    // percentuale evita di dare per buona una percentuale letta male.
    const carburante =
      nolo === null ? 0 : Math.round((totale - imponibile) * 100) / 100;

    lette.push({
      numero: riga.numero,
      data: normalizzaData(cella(bandaData)?.testo ?? null),
      numeroSpedizione: cella(bandaSped)?.testo?.replace(/\s+/g, "") ?? null,
      riferimento: cella(bandaRif)?.testo?.replace(/\s+/g, "") ?? null,
      controparte: cella(bandaDest)?.testo ?? null,
      // FedEx ci fattura solo partenze: gli arrivi da fornitore non passano da
      // qui. Resta `null` e lo decide l'aggancio alla bolla, che sa il verso.
      direzione: null,
      colli: cella(bandaColli)?.valore ?? null,
      peso: cella(bandaPeso)?.valore ?? null,
      pesoVolumetrico: null,
      pesoTassato: cella(bandaPeso)?.valore ?? null,
      nolo,
      supplementi,
      carburante: carburante > 0 ? carburante : 0,
      totale,
      dettaglio: Object.fromEntries(
        riga.celle.map((c) => [`colonna_${c.banda}`, c.testo])
      ),
    });
  }

  return {
    vettore: "fedex",
    numero: null,
    data: null,
    anno: null,
    mese: null,
    righe: lette,
    righeNonLette,
    totali,
    avvertenze: [
      "Fattura letta per riconoscimento ottico: ogni riga va confermata prima dell'acquisizione.",
    ],
  };
}

/** Da `02/07/2026` a `2026-07-02`. */
export function normalizzaData(testo: string | null): string | null {
  if (!testo) return null;
  const m = DATA.exec(testo.trim());
  if (!m) return null;
  const giorno = m[1].padStart(2, "0");
  const mese = m[2].padStart(2, "0");
  const anno = m[3].length === 2 ? `20${m[3]}` : m[3];
  if (Number(mese) < 1 || Number(mese) > 12) return null;
  if (Number(giorno) < 1 || Number(giorno) > 31) return null;
  return `${anno}-${mese}-${giorno}`;
}
