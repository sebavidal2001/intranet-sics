import type { Canvas } from "@napi-rs/canvas";

/**
 * Riconoscimento ottico delle fatture che non contengono testo.
 *
 * Serve per FedEx: i suoi PDF sono immagini, e `extractText` restituisce una
 * stringa vuota. Sono due o tre spedizioni al mese, ma senza questo passaggio
 * quelle righe non entrano nel controllo — e sono proprio quelle costose.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COME SI OTTIENE LA PRECISIONE
 *
 * Il riconoscimento ottico di una tabella di importi non è affidabile quanto la
 * lettura di un testo, e nessuna impostazione lo rende tale. La precisione qui
 * non viene dal motore ma da quattro accorgimenti, in ordine di resa:
 *
 *   1) RISOLUZIONE ALTA E BINARIZZAZIONE. Si rasterizza a 300 punti per pollice
 *      e si porta l'immagine in bianco e nero con soglia di Otsu. Su una
 *      scansione debole è la differenza fra leggere «8» e leggere «3».
 *
 *   2) SECONDA PASSATA SULLE CELLE, CON LA MODALITÀ GIUSTA PER OGNI CAMPO. La
 *      prima passata legge la pagina e dice dove stanno le parole; le celle si
 *      ricostruiscono dalla posizione e vengono **rilette ritagliate**.
 *      Misurato sul documento di collaudo, è l'accorgimento che ripara gli
 *      errori veri: «94,80» che la prima passata aveva spezzato in «94 80»
 *      torna intero. Ma vale solo se l'alfabeto è scelto in base al campo —
 *      sui riferimenti l'alfabeto ristretto alle cifre **peggiora**, perché
 *      sostituisce la barra di «2026/004641» con un sette. Il confronto delle
 *      cinque combinazioni è in `scripts/vettori/ocr/prova-rilettura.test.ts`.
 *
 *   3) LA CONFIDENZA VIAGGIA CON IL DATO. Ogni valore porta con sé quanto il
 *      motore era sicuro. Un totale letto al 62% non è un totale: è una
 *      domanda, e come tale deve arrivare a chi controlla.
 *
 *   4) L'ARITMETICA È IL GIUDICE. Alla fine i conti devono tornare con i totali
 *      stampati sulla fattura. Un OCR che sbaglia una cifra quasi sempre rompe
 *      una somma, e la somma è verificabile senza fidarsi di niente.
 *
 * Quello che questo modulo NON fa, di proposito: accettare da solo il risultato.
 * Le righe lette per riconoscimento ottico nascono con `confermata = false`
 * (migration 089) e restano fuori dai controlli finché una persona non le ha
 * guardate accanto all'immagine della pagina.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Punti per pollice della rasterizzazione.
 *
 * 400, non i 300 che si consigliano di solito. Misurato sulle due fatture FedEx
 * vere: a 300 una riga non si lasciava leggere e la fattura di luglio si
 * fermava a quattro spedizioni su sei; a 400 quella riga torna intera. A 500
 * non migliora più niente e compare un errore nuovo — «11047» letto «111047» —
 * perché ingrandire oltre il tratto reale della stampa aggiunge solo bordi
 * sfrangiati.
 */
export const DPI = 400;
const DPI_PDF = 72;

export interface Parola {
  testo: string;
  /** 0-100, come la restituisce il motore. */
  confidenza: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PaginaRiconosciuta {
  numero: number;
  larghezza: number;
  altezza: number;
  parole: Parola[];
  /** Il PNG della pagina, per mostrarlo accanto ai valori estratti. */
  immagine: Buffer;
}

/* ------------------------------------------------------------------ */
/*  Rasterizzazione                                                    */
/* ------------------------------------------------------------------ */

export interface PaginaRasterizzata {
  numero: number;
  larghezza: number;
  altezza: number;
  tela: Canvas;
}

/**
 * Da PDF a immagini, una per pagina.
 *
 * Passa da `renderPageAsImage` di unpdf indicandogli esplicitamente dove
 * trovare la libreria di disegno: il pdf.js impacchettato dentro unpdf non
 * riesce a risolverla da solo quando il codice gira fuori dal bundle di Next,
 * e fallisce con «@napi-rs/canvas is not available in this environment».
 *
 * Il PNG che torna viene ricaricato su una tela nostra, perché i passi
 * successivi — binarizzazione e ritagli per la rilettura dei numeri — lavorano
 * sui pixel, non su un file codificato.
 */
export async function rasterizza(
  bytes: Uint8Array,
  opzioni: { dpi?: number; massimoPagine?: number } = {}
): Promise<PaginaRasterizzata[]> {
  const dpi = opzioni.dpi ?? DPI;
  const scala = dpi / DPI_PDF;

  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const canvasImport = () => import("@napi-rs/canvas");

  // Copia dei byte, non i byte originali. pdf.js **svuota** l'array che gli si
  // passa: dopo la lettura il chiamante si ritrova un buffer staccato, e la
  // seconda apertura fallisce con «Cannot transfer object of unsupported type».
  // La route di acquisizione fa esattamente questo — prima prova a estrarre il
  // testo, poi passa gli stessi byte al riconoscimento ottico — quindi senza
  // questa copia il riconoscimento non partirebbe mai in produzione.
  const pdf = await getDocumentProxy(bytes.slice());
  const quante = Math.min(pdf.numPages, opzioni.massimoPagine ?? 20);
  const pagine: PaginaRasterizzata[] = [];

  for (let n = 1; n <= quante; n++) {
    const png = await renderPageAsImage(pdf, n, { scale: scala, canvasImport });
    const immagine = await loadImage(Buffer.from(png));

    const tela = createCanvas(immagine.width, immagine.height);
    const contesto = tela.getContext("2d");
    // Fondo bianco esplicito: una tela nuova è trasparente, e la trasparenza
    // salvata in PNG diventa nera. Il motore leggerebbe una pagina nera.
    contesto.fillStyle = "#ffffff";
    contesto.fillRect(0, 0, tela.width, tela.height);
    contesto.drawImage(immagine, 0, 0);

    pagine.push({ numero: n, larghezza: tela.width, altezza: tela.height, tela });
  }

  return pagine;
}

/* ------------------------------------------------------------------ */
/*  Binarizzazione                                                     */
/* ------------------------------------------------------------------ */

/**
 * Soglia di Otsu: il valore di grigio che separa meglio inchiostro e carta.
 *
 * Si calcola dall'istogramma massimizzando la varianza fra le due classi. È
 * preferibile a una soglia fissa perché le scansioni non hanno tutte lo stesso
 * fondo: una soglia a 128 su una pagina ingiallita cancella il testo chiaro.
 */
export function sogliaOtsu(istogramma: number[]): number {
  const totale = istogramma.reduce((a, b) => a + b, 0);
  if (totale === 0) return 128;

  let sommaTotale = 0;
  for (let i = 0; i < 256; i++) sommaTotale += i * istogramma[i];

  let sommaSfondo = 0;
  let pesoSfondo = 0;
  let varianzaMassima = -1;
  let soglia = 128;

  for (let i = 0; i < 256; i++) {
    pesoSfondo += istogramma[i];
    if (pesoSfondo === 0) continue;
    const pesoPrimoPiano = totale - pesoSfondo;
    if (pesoPrimoPiano === 0) break;

    sommaSfondo += i * istogramma[i];
    const mediaSfondo = sommaSfondo / pesoSfondo;
    const mediaPrimoPiano = (sommaTotale - sommaSfondo) / pesoPrimoPiano;
    const varianza =
      pesoSfondo * pesoPrimoPiano * (mediaSfondo - mediaPrimoPiano) ** 2;

    if (varianza > varianzaMassima) {
      varianzaMassima = varianza;
      soglia = i;
    }
  }

  return soglia;
}

/** Porta la tela in bianco e nero, in posto. */
export function binarizza(tela: Canvas): void {
  const contesto = tela.getContext("2d");
  const dati = contesto.getImageData(0, 0, tela.width, tela.height);
  const pixel = dati.data;

  const istogramma = new Array<number>(256).fill(0);
  const grigi = new Uint8Array(pixel.length / 4);

  for (let i = 0, g = 0; i < pixel.length; i += 4, g++) {
    // Luminanza percettiva: il verde pesa più del blu perché l'occhio — e le
    // scansioni — ci mettono più informazione.
    const grigio =
      (pixel[i] * 299 + pixel[i + 1] * 587 + pixel[i + 2] * 114) / 1000;
    const v = grigio | 0;
    grigi[g] = v;
    istogramma[v]++;
  }

  const soglia = sogliaOtsu(istogramma);

  for (let i = 0, g = 0; i < pixel.length; i += 4, g++) {
    const v = grigi[g] > soglia ? 255 : 0;
    pixel[i] = v;
    pixel[i + 1] = v;
    pixel[i + 2] = v;
    pixel[i + 3] = 255;
  }

  contesto.putImageData(dati, 0, 0);
}

/* ------------------------------------------------------------------ */
/*  Riconoscimento                                                     */
/* ------------------------------------------------------------------ */

/**
 * Alfabeti per la rilettura mirata.
 *
 * Restringere l'alfabeto è quello che rende la seconda passata utile: senza
 * lettere fra cui scegliere il motore non può leggere «O» dove c'è uno zero.
 * Ma l'alfabeto va scelto in base a cosa contiene la cella: applicare quello
 * dei numeri a un riferimento come «2026/004641» trasforma la barra in un
 * sette, che è un peggioramento, non una correzione. Misurato: la rilettura
 * numerica di quel riferimento ha restituito «2026700464» al 47%.
 */
export const ALFABETI = {
  numeri: "0123456789.,-+€",
  /** Riferimenti e lettere di vettura: cifre più i separatori che ci stanno. */
  riferimenti: "0123456789/-. ",
} as const;

export type Alfabeto = keyof typeof ALFABETI;

type Motore = Awaited<ReturnType<typeof creaMotore>>;

async function creaMotore(alfabeto?: string) {
  const { createWorker } = await import("tesseract.js");
  const motore = await createWorker("eng", 1, {
    // I dati della lingua si scaricano una volta e restano in cache sul disco:
    // sulla VM il primo caricamento ha bisogno di rete, i successivi no.
    cachePath: process.env.VETTORI_OCR_CACHE || undefined,
    logger: () => {},
  });
  if (alfabeto) {
    await motore.setParameters({
      tessedit_char_whitelist: alfabeto,
      // Riga singola: su un ritaglio che contiene un importo e basta, dire al
      // motore che non deve cercare una struttura di pagina evita che inventi
      // colonne dove non ce ne sono.
      tessedit_pageseg_mode: "7" as never,
    });
  }
  return motore;
}

/**
 * Legge una pagina e restituisce le parole con posizione e confidenza.
 *
 * La posizione serve più del testo: una fattura è una tabella, e le colonne si
 * ricostruiscono da dove stanno le parole, non dall'ordine in cui il motore le
 * restituisce.
 */
export async function riconosciPagina(
  pagina: PaginaRasterizzata,
  opzioni: { binarizza?: boolean } = {}
): Promise<PaginaRiconosciuta> {
  if (opzioni.binarizza !== false) binarizza(pagina.tela);

  const png = pagina.tela.toBuffer("image/png");
  const motore = await creaMotore();

  try {
    const esito = await motore.recognize(png, {}, { blocks: true });
    return {
      numero: pagina.numero,
      larghezza: pagina.larghezza,
      altezza: pagina.altezza,
      parole: estraiParole(esito.data),
      immagine: png,
    };
  } finally {
    await motore.terminate();
  }
}

/**
 * Le parole con riquadro, prese dalle foglie della struttura del motore.
 *
 * L'esito arriva annidato — blocchi, paragrafi, righe, parole — e ogni livello
 * ha `text` e `bbox`. Prendere tutto significherebbe contare lo stesso importo
 * quattro volte, a riquadri sempre più larghi: si scende fino alle parole e si
 * fermano lì.
 */
interface NodoOcr {
  text?: string;
  confidence?: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
  blocks?: NodoOcr[];
  paragraphs?: NodoOcr[];
  lines?: NodoOcr[];
  words?: NodoOcr[];
}

export function estraiParole(dati: unknown): Parola[] {
  const fuori: Parola[] = [];

  const scendi = (nodo: NodoOcr | undefined) => {
    if (!nodo) return;
    for (const figli of [nodo.blocks, nodo.paragraphs, nodo.lines]) {
      if (Array.isArray(figli)) {
        figli.forEach(scendi);
        return;
      }
    }
    if (Array.isArray(nodo.words)) {
      for (const p of nodo.words) {
        const testo = (p.text ?? "").trim();
        if (testo && p.bbox) {
          fuori.push({
            testo,
            confidenza: Number(p.confidence ?? 0),
            x0: p.bbox.x0,
            y0: p.bbox.y0,
            x1: p.bbox.x1,
            y1: p.bbox.y1,
          });
        }
      }
    }
  };

  const radice = dati as NodoOcr;
  if (Array.isArray(radice?.blocks)) radice.blocks.forEach(scendi);
  else scendi(radice);

  return fuori;
}

/**
 * Rilegge una cella ritagliandola dalla pagina.
 *
 * È la seconda passata. Le impostazioni non sono scelte a intuito: vengono dal
 * confronto in `scripts/vettori/ocr/prova-rilettura.test.ts`, che ha provato
 * cinque combinazioni di segmentazione e alfabeto sulle celle che la prima
 * passata aveva sbagliato. Il risultato, sul documento di collaudo:
 *
 *   cella          prima passata      parola singola+cifre   riga singola+libero
 *   ─────────────  ─────────────────  ────────────────────   ───────────────────
 *   94,80          «94 80»  spezzato  «94,80»   86%   ✓      «94.80»   75%
 *   310,0          «310.0»            «310,0»   88%   ✓      «310,0»   84%
 *   155,14         «155.14»           «155,14»  95%   ✓      «155,14»  94%
 *   2026/004641    «2026/00464 1»     «20261004641»  ✗       «2026/004641» 73% ✓
 *
 * Da qui le due regole:
 *
 *   NUMERI → parola singola con alfabeto ristretto alle cifre. È l'unica
 *   combinazione che ricompone «94 80» in «94,80»: dicendo al motore che deve
 *   leggere UNA parola, lo spazio che aveva inserito non è più un'opzione.
 *
 *   RIFERIMENTI → riga singola con alfabeto libero. Sui riferimenti l'alfabeto
 *   ristretto **peggiora**: senza la barra fra i caratteri ammessi il motore la
 *   sostituisce con un 7 o un 1, e «2026/004641» diventa «20267004641». Un
 *   alfabeto ristretto non è più preciso in assoluto — lo è solo quando esclude
 *   caratteri che in quella cella non possono comparire.
 */
export type ModoRilettura = "numero" | "riferimento";

export interface Rilettura {
  testo: string;
  confidenza: number;
}

export async function rileggiCelle(
  pagina: PaginaRasterizzata,
  riquadri: Array<{ x0: number; y0: number; x1: number; y1: number }>,
  modo: ModoRilettura = "numero"
): Promise<Rilettura[]> {
  if (riquadri.length === 0) return [];

  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const { createWorker, PSM } = await import("tesseract.js");

  const motore = await createWorker("eng", 1, {
    cachePath: process.env.VETTORI_OCR_CACHE || undefined,
    logger: () => {},
  });

  const parametri: Record<string, unknown> =
    modo === "numero"
      ? {
          tessedit_pageseg_mode: PSM.SINGLE_WORD,
          tessedit_char_whitelist: ALFABETI.numeri,
        }
      : { tessedit_pageseg_mode: PSM.SINGLE_LINE };
  await motore.setParameters(parametri as never);

  const fuori: Rilettura[] = [];

  try {
    // Il ritaglio si fa da un'immagine caricata una volta sola: rigenerare il
    // PNG della pagina per ogni cella costerebbe più della lettura.
    const immagine = await loadImage(pagina.tela.toBuffer("image/png"));

    for (const r of riquadri) {
      // Margine 20 e ingrandimento 2: sono i valori del confronto. Un margine
      // stretto fa perdere l'ultima cifra, un ingrandimento maggiore sfoca i
      // bordi e non aggiunge informazione.
      const margine = 20;
      const ingrandimento = 2;
      const larghezza = Math.max(1, r.x1 - r.x0);
      const altezza = Math.max(1, r.y1 - r.y0);

      const tela = createCanvas(
        (larghezza + margine * 2) * ingrandimento,
        (altezza + margine * 2) * ingrandimento
      );
      const contesto = tela.getContext("2d");
      contesto.fillStyle = "#ffffff";
      contesto.fillRect(0, 0, tela.width, tela.height);
      contesto.drawImage(
        immagine,
        r.x0 - margine,
        r.y0 - margine,
        larghezza + margine * 2,
        altezza + margine * 2,
        0,
        0,
        tela.width,
        tela.height
      );

      const esito = await motore.recognize(tela.toBuffer("image/png"));
      fuori.push({
        testo: esito.data.text.replace(/\s+/g, " ").trim(),
        confidenza: esito.data.confidence,
      });
    }
  } finally {
    await motore.terminate();
  }

  return fuori;
}

/** @deprecated Usare `rileggiCelle`, che sceglie la modalità in base al campo. */
export const rileggiNumeri = (
  pagina: PaginaRasterizzata,
  riquadri: Array<{ x0: number; y0: number; x1: number; y1: number }>
) => rileggiCelle(pagina, riquadri, "numero");

/* ------------------------------------------------------------------ */
/*  Righe dalla posizione                                              */
/* ------------------------------------------------------------------ */

/**
 * Raggruppa le parole in righe di tabella usando la coordinata verticale.
 *
 * L'ordine in cui il motore restituisce le parole non è affidabile su una
 * tabella: due celle affiancate possono arrivare separate da mezza pagina. La
 * riga la definisce la posizione — parole i cui centri stanno entro una
 * frazione dell'altezza del carattere appartengono alla stessa riga.
 */
export function raggruppaInRighe(
  parole: Parola[],
  tolleranza = 0.6
): Parola[][] {
  if (parole.length === 0) return [];

  const altezzaMediana = mediana(parole.map((p) => p.y1 - p.y0)) || 10;
  const soglia = altezzaMediana * tolleranza;

  const ordinate = [...parole].sort(
    (a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2
  );

  const righe: Parola[][] = [];
  let corrente: Parola[] = [ordinate[0]];
  let centroCorrente = (ordinate[0].y0 + ordinate[0].y1) / 2;

  for (const p of ordinate.slice(1)) {
    const centro = (p.y0 + p.y1) / 2;
    if (Math.abs(centro - centroCorrente) <= soglia) {
      corrente.push(p);
      // Il centro della riga si aggiorna alla media: una riga con una parola
      // più alta delle altre non deve trascinarsi dietro la soglia.
      centroCorrente =
        corrente.reduce((a, q) => a + (q.y0 + q.y1) / 2, 0) / corrente.length;
    } else {
      righe.push(corrente.sort((a, b) => a.x0 - b.x0));
      corrente = [p];
      centroCorrente = centro;
    }
  }
  righe.push(corrente.sort((a, b) => a.x0 - b.x0));

  return righe;
}

export function mediana(valori: number[]): number {
  if (valori.length === 0) return 0;
  const ordinati = [...valori].sort((a, b) => a - b);
  const meta = Math.floor(ordinati.length / 2);
  return ordinati.length % 2
    ? ordinati[meta]
    : (ordinati[meta - 1] + ordinati[meta]) / 2;
}

/* ------------------------------------------------------------------ */
/*  Colonne e celle                                                    */
/* ------------------------------------------------------------------ */

export interface Banda {
  x0: number;
  x1: number;
}

export interface Cella {
  banda: number;
  parole: Parola[];
  testo: string;
  confidenza: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Trova le colonne proiettando le parole sull'asse orizzontale.
 *
 * Una tabella ha corridoi bianchi verticali fra una colonna e l'altra:
 * proiettando tutti i riquadri su una riga e cercando i vuoti larghi si
 * ottengono i confini senza sapere niente del documento.
 *
 * Perché non dedurli dall'intestazione: le intestazioni sono allineate a
 * sinistra e i numeri a destra, quindi il titolo «Totale» sta altrove rispetto
 * agli importi che sovrasta. I corridoi invece sono dove sono.
 */
export function bandeColonne(
  parole: Parola[],
  larghezzaPagina: number,
  opzioni: { vuotoMinimo?: number } = {}
): Banda[] {
  if (parole.length === 0) return [];

  const occupato = new Uint8Array(larghezzaPagina + 1);
  for (const p of parole) {
    const da = Math.max(0, Math.floor(p.x0));
    const a = Math.min(larghezzaPagina, Math.ceil(p.x1));
    for (let x = da; x <= a; x++) occupato[x] = 1;
  }

  // Il vuoto che separa due colonne è largo almeno quanto un paio di
  // caratteri: sotto quella soglia è lo spazio fra due parole della stessa
  // cella, e tagliare lì spezzerebbe «CLIENTE ALFA SPA» in tre colonne.
  const altezzaCarattere = mediana(parole.map((p) => p.y1 - p.y0)) || 10;
  const vuotoMinimo = opzioni.vuotoMinimo ?? Math.max(8, altezzaCarattere * 1.2);

  const bande: Banda[] = [];
  let inizio = -1;
  let vuotoDa = -1;

  for (let x = 0; x <= larghezzaPagina; x++) {
    if (occupato[x]) {
      // Il margine bianco prima della prima parola non è un corridoio fra
      // colonne: si chiude una banda solo se una era già aperta.
      if (inizio !== -1 && vuotoDa !== -1 && x - vuotoDa >= vuotoMinimo) {
        bande.push({ x0: inizio, x1: vuotoDa - 1 });
        inizio = x;
      } else if (inizio === -1) {
        inizio = x;
      }
      vuotoDa = -1;
    } else if (vuotoDa === -1) {
      vuotoDa = x;
    }
  }
  if (inizio !== -1) bande.push({ x0: inizio, x1: vuotoDa === -1 ? larghezzaPagina : vuotoDa - 1 });

  return bande;
}

/**
 * Distribuisce le parole di una riga nelle bande, unendo quelle che cadono
 * nella stessa cella.
 *
 * È il punto in cui si ripara «94 80»: le due parole stanno nella stessa banda,
 * quindi diventano una cella sola, e la cella si può rileggere per intero.
 */
export function celleDiRiga(riga: Parola[], bande: Banda[]): Cella[] {
  const celle = new Map<number, Parola[]>();

  for (const p of riga) {
    const centro = (p.x0 + p.x1) / 2;
    let indice = bande.findIndex((b) => centro >= b.x0 && centro <= b.x1);
    if (indice === -1) {
      // Fuori da ogni banda: si assegna alla più vicina invece di perderla.
      let minima = Number.POSITIVE_INFINITY;
      bande.forEach((b, i) => {
        const d = centro < b.x0 ? b.x0 - centro : centro - b.x1;
        if (d < minima) {
          minima = d;
          indice = i;
        }
      });
    }
    if (indice === -1) continue;
    const elenco = celle.get(indice) ?? [];
    elenco.push(p);
    celle.set(indice, elenco);
  }

  return [...celle.entries()]
    .map(([banda, parole]) => {
      const ordinate = [...parole].sort((a, b) => a.x0 - b.x0);
      return {
        banda,
        parole: ordinate,
        testo: ordinate.map((p) => p.testo).join(" "),
        confidenza:
          ordinate.reduce((a, p) => a + p.confidenza, 0) / ordinate.length,
        x0: Math.min(...ordinate.map((p) => p.x0)),
        y0: Math.min(...ordinate.map((p) => p.y0)),
        x1: Math.max(...ordinate.map((p) => p.x1)),
        y1: Math.max(...ordinate.map((p) => p.y1)),
      };
    })
    .sort((a, b) => a.banda - b.banda);
}

/* ------------------------------------------------------------------ */
/*  Orientamento                                                       */
/* ------------------------------------------------------------------ */

/**
 * Ruota una tela di un multiplo di 90 gradi.
 *
 * Serve perché le fatture arrivano come le ha girate lo scanner. La prima
 * fattura FedEx vera che ho aperto era **coricata**: pagina A4 in orizzontale
 * con il testo verticale. Il riconoscimento restituiva 1.428 «parole» come
 * `[OX=8]` e `NMWWOSFr`, con confidenza intorno al 40%. Non è un difetto del
 * motore: stava leggendo righe di caratteri girati di lato.
 */
export async function ruota(
  tela: Canvas,
  gradi: 0 | 90 | 180 | 270
): Promise<Canvas> {
  if (gradi === 0) return tela;

  const { createCanvas } = await import("@napi-rs/canvas");
  const scambia = gradi === 90 || gradi === 270;
  const nuova = createCanvas(
    scambia ? tela.height : tela.width,
    scambia ? tela.width : tela.height
  );
  const c = nuova.getContext("2d");
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, nuova.width, nuova.height);
  c.translate(nuova.width / 2, nuova.height / 2);
  c.rotate((gradi * Math.PI) / 180);
  c.drawImage(tela as never, -tela.width / 2, -tela.height / 2);
  return nuova;
}

/**
 * Quanto «sembra testo» quello che il motore ha letto.
 *
 * Serve a scegliere fra i quattro orientamenti senza avere il modello di
 * riconoscimento dell'orientamento (`osd`), che andrebbe scaricato a parte.
 *
 * Il criterio: si contano solo le parole di almeno tre caratteri fatte di sole
 * lettere, cifre e punteggiatura da documento, e si somma la loro confidenza.
 * Una pagina girata produce tanti frammenti corti e strani — `[OX=8]`, `NEES`,
 * `p]` — che questo conteggio scarta, e le poche parole che restano le legge
 * male. Una pagina dritta produce parole vere lette con sicurezza.
 */
export function punteggioTesto(parole: Parola[]): number {
  const buone = parole.filter(
    (p) => p.testo.length >= 3 && /^[A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9.,/:'-]*$/.test(p.testo)
  );
  if (buone.length === 0) return 0;
  return buone.reduce((a, p) => a + p.confidenza, 0);
}

/**
 * Trova come è girata la pagina e la raddrizza.
 *
 * Prova i quattro orientamenti su una copia **a bassa risoluzione**: bastano
 * 100 punti per pollice per capire da che parte sta il testo, e girare quattro
 * riconoscimenti a piena risoluzione costerebbe due minuti a pagina.
 */
export async function correggiOrientamento(
  pagina: PaginaRasterizzata
): Promise<{ pagina: PaginaRasterizzata; gradi: 0 | 90 | 180 | 270; punteggi: number[] }> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");

  // Copia ridotta per la prova: un terzo della risoluzione di lavoro.
  const fattore = 1 / 3;
  const piccola = createCanvas(
    Math.max(1, Math.round(pagina.larghezza * fattore)),
    Math.max(1, Math.round(pagina.altezza * fattore))
  );
  const cp = piccola.getContext("2d");
  cp.fillStyle = "#ffffff";
  cp.fillRect(0, 0, piccola.width, piccola.height);
  cp.drawImage(
    await loadImage(pagina.tela.toBuffer("image/png")),
    0,
    0,
    piccola.width,
    piccola.height
  );

  const gradiPossibili: Array<0 | 90 | 180 | 270> = [0, 90, 180, 270];
  const punteggi: number[] = [];
  let migliore: 0 | 90 | 180 | 270 = 0;
  let massimo = -1;

  for (const g of gradiPossibili) {
    const prova = await ruota(piccola, g);
    const riconosciuta = await riconosciPagina(
      { numero: pagina.numero, larghezza: prova.width, altezza: prova.height, tela: prova },
      { binarizza: false }
    );
    const punteggio = punteggioTesto(riconosciuta.parole);
    punteggi.push(Math.round(punteggio));
    if (punteggio > massimo) {
      massimo = punteggio;
      migliore = g;
    }
  }

  if (migliore === 0) return { pagina, gradi: 0, punteggi };

  const raddrizzata = await ruota(pagina.tela, migliore);
  return {
    pagina: {
      numero: pagina.numero,
      larghezza: raddrizzata.width,
      altezza: raddrizzata.height,
      tela: raddrizzata,
    },
    gradi: migliore,
    punteggi,
  };
}
