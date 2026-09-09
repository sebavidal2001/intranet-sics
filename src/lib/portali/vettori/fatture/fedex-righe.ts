import type { RigaFattura, TotaliDichiarati } from "./tipi";
import { raggruppaInRighe, type PaginaRiconosciuta, type Parola } from "./ocr";
import { leggiNumero, plausibile } from "./numeri";

/**
 * Il tracciato vero delle fatture FedEx.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NON È UNA TABELLA
 *
 * Le fatture di GLS, TNT e Trading Post elencano le spedizioni in colonne. FedEx
 * no: ogni spedizione è un **blocco** di tre o quattro righe.
 *
 *     875090067682  30/07/2026   FedEx Priority   11,70 kg   12310   12,58
 *     Imponibile IVA 22.00%
 *     Applicato peso volumetrico
 *     Su questa spedizione FedEx ha applicato un supplemento carburante del 24.30 %
 *
 * Da qui tre conseguenze che cambiano il modo di leggerla:
 *
 *   1) LA RIGA COMINCIA CON LA LETTERA DI VETTURA, non con la data. Dodici
 *      cifre attaccate: è l'àncora più solida di tutto il documento, perché
 *      nessun altro testo della pagina ha quella forma.
 *
 *   2) IL CARBURANTE È PER SPEDIZIONE. Sulla fattura di luglio 2026 convivono
 *      25,22% e 24,30% sulla stessa fattura; su quella di agosto 24,30% e
 *      23,84%. Prendere una percentuale sola dalla testata e applicarla a
 *      tutte le righe darebbe scostamenti inventati su metà delle spedizioni.
 *
 *   3) IL TOTALE STAMPATO È IVA COMPRESA. «Importo dovuto 85,23 EUR» contro
 *      69,86 di imponibile: confrontarlo con la somma delle righe senza
 *      togliere l'IVA farebbe fallire la quadratura di ogni fattura.
 *
 * L'àncora e il totale insieme danno la verifica che conta: se la somma delle
 * righe lette, più IVA, fa l'importo dovuto stampato, allora non è sfuggita
 * nessuna spedizione. È una prova aritmetica, non un'impressione.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Lettera di vettura FedEx: dodici cifre attaccate. */
const LETTERA_VETTURA = /^\d{12}$/;
const DATA = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/;
/** «11,70 kg» oppure «1,90kg»: lo spazio prima dell'unità non è garantito. */
const PESO = /^(\d{1,3}(?:[.,]\d{1,3})?)\s*kg$/i;
const CARBURANTE = /carburante\s+del\s+([\d.,]+)\s*%/i;
const IMPORTO_DOVUTO = /importo\s+dovuto/i;
const NUMERO_FATTURA = /numero\s+fattura/i;
const DATA_FATTURA = /^data\s+fattura/i;
/** L'aliquota IVA stampata sotto ogni spedizione. */
const ALIQUOTA = /imponibile\s+iva\s+([\d.,]+)\s*%/i;

export interface BloccoSpedizione {
  letteraVettura: string;
  data: string | null;
  riferimento: string | null;
  peso: number | null;
  pesoVolumetricoApplicato: boolean;
  importo: number | null;
  percentualeCarburante: number | null;
  servizio: string | null;
  /** Confidenza più bassa fra le parole della riga principale. */
  confidenza: number;
  /** Il testo della riga come è stato letto, per mostrarlo se qualcosa manca. */
  testo: string;
}

export interface LetturaPerRighe {
  numero: string | null;
  data: string | null;
  /** Totale stampato, **IVA compresa**. */
  importoDovuto: number | null;
  aliquotaIva: number | null;
  blocchi: BloccoSpedizione[];
  /** Righe che cominciavano con una lettera di vettura ma non si sono lasciate leggere. */
  nonLette: string[];
}

const testoDi = (riga: Parola[]) => riga.map((p) => p.testo).join(" ");

/**
 * Estrae i blocchi spedizione dalle pagine riconosciute.
 *
 * Le pagine si scorrono tutte insieme perché un blocco può cominciare in fondo
 * a una pagina e continuare in cima alla successiva: le righe accessorie —
 * aliquota, peso volumetrico, carburante — appartengono alla lettera di vettura
 * **più vicina sopra di loro**, e questo vale anche a cavallo del salto pagina.
 */
export function leggiPerRighe(pagine: PaginaRiconosciuta[]): LetturaPerRighe {
  const righe: Parola[][] = [];
  for (const p of pagine) righe.push(...raggruppaInRighe(p.parole));

  const blocchi: BloccoSpedizione[] = [];
  const nonLette: string[] = [];
  let numero: string | null = null;
  let data: string | null = null;
  let importoDovuto: number | null = null;
  let aliquotaIva: number | null = null;

  for (const riga of righe) {
    const testo = testoDi(riga);

    // ---- testata ----
    if (numero === null && NUMERO_FATTURA.test(testo)) {
      const n = riga.find((p) => /^\d{6,12}$/.test(p.testo));
      if (n) numero = n.testo;
    }
    if (data === null && DATA_FATTURA.test(testo.trim())) {
      const d = riga.map((p) => p.testo).find((t) => DATA.test(t));
      if (d) data = normalizzaData(d);
    }
    if (importoDovuto === null && IMPORTO_DOVUTO.test(testo)) {
      // L'importo è l'ultimo numero della riga, prima della valuta.
      for (let i = riga.length - 1; i >= 0; i--) {
        const n = leggiNumero(riga[i].testo, { attesoNumerico: true });
        if (n.valore !== null && plausibile(n.valore, "importo")) {
          importoDovuto = n.valore;
          break;
        }
      }
    }
    if (aliquotaIva === null) {
      const m = ALIQUOTA.exec(testo);
      if (m) {
        const n = leggiNumero(m[1], { attesoNumerico: true });
        if (n.valore !== null && plausibile(n.valore, "percentuale")) {
          aliquotaIva = n.valore / 100;
        }
      }
    }

    // ---- righe accessorie del blocco aperto ----
    const ultimo = blocchi[blocchi.length - 1];
    if (ultimo) {
      if (/applicato\s+peso\s+volumetrico/i.test(testo)) {
        ultimo.pesoVolumetricoApplicato = true;
      }
      const c = CARBURANTE.exec(testo);
      if (c && ultimo.percentualeCarburante === null) {
        const n = leggiNumero(c[1], { attesoNumerico: true });
        if (n.valore !== null && plausibile(n.valore, "percentuale")) {
          ultimo.percentualeCarburante = n.valore / 100;
        }
      }
    }

    // ---- inizio di un blocco ----
    const ancora = riga.findIndex((p) => LETTERA_VETTURA.test(p.testo));
    if (ancora === -1) continue;

    const blocco = componiBlocco(riga, ancora);
    if (blocco.importo === null) nonLette.push(testo);
    blocchi.push(blocco);
  }

  return {
    numero,
    data,
    importoDovuto,
    aliquotaIva,
    blocchi: unifica(blocchi),
    nonLette,
  };
}

/**
 * Una spedizione compare una volta sola, anche se la pagina è ripetuta.
 *
 * Le fatture FedEx portano in coda la «copia di documento informatico
 * trasmesso al SDI»: le stesse spedizioni, stampate una seconda volta. Senza
 * unificarle la fattura di agosto risultava di quattro spedizioni invece di
 * due, con il totale doppio — e la quadratura avrebbe dato la colpa al vettore.
 *
 * La chiave è la lettera di vettura, che è un identificativo e non si ripete
 * per caso. Fra due copie si tiene quella letta meglio: la seconda stampa è
 * spesso più sbiadita, e sulla fattura di agosto la copia dava 2 kg dove
 * l'originale dava 11,70.
 */
function unifica(blocchi: BloccoSpedizione[]): BloccoSpedizione[] {
  const per = new Map<string, BloccoSpedizione>();
  for (const b of blocchi) {
    const gia = per.get(b.letteraVettura);
    if (!gia || completezza(b) > completezza(gia)) per.set(b.letteraVettura, b);
  }
  return [...per.values()];
}

/**
 * Quanti campi è riuscito a leggere un blocco.
 *
 * Si contano **solo i campi**, senza la confidenza. A parità di campi vince la
 * prima occorrenza, che è la stampa originale: la copia in coda al documento è
 * più sbiadita, e sulla fattura di agosto dava 2 kg dove l'originale dava
 * 11,70. Mettere la confidenza nel punteggio faceva vincere la copia, perché il
 * motore può dirsi sicuro anche di una lettura sbagliata.
 */
function completezza(b: BloccoSpedizione): number {
  return (
    (b.importo !== null ? 1 : 0) +
    (b.peso !== null ? 1 : 0) +
    (b.riferimento !== null ? 1 : 0) +
    (b.data !== null ? 1 : 0)
  );
}

/**
 * Ricava i campi dalla riga principale di un blocco.
 *
 * L'ordine dei campi è stabile — lettera di vettura, data, servizio, peso,
 * riferimento, importo — ma il riconoscimento infila caratteri spuri fra l'uno
 * e l'altro: sulla fattura di luglio una riga è tornata come
 * `873375799476 23/06/2026 | | FedEx Priority | D | | J | B6,90 kg | | 9563 | 16,75`.
 * Per questo non si legge per posizione ma **per forma**: ogni campo si
 * riconosce da come è fatto, e quello che non ha una forma nota si scarta.
 */
function componiBlocco(riga: Parola[], ancora: number): BloccoSpedizione {
  const dopo = riga.slice(ancora + 1);
  const testi = dopo.map((p) => p.testo);

  const data = testi.find((t) => DATA.test(t)) ?? null;

  // Il peso può essere in una parola sola («1,90kg») o in due («13,10» «kg»).
  let peso: number | null = null;
  for (let i = 0; i < testi.length; i++) {
    const singolo = PESO.exec(testi[i]);
    if (singolo) {
      peso = leggiNumero(singolo[1], { attesoNumerico: true }).valore;
      break;
    }
    if (/^kg$/i.test(testi[i]) && i > 0) {
      const n = leggiNumero(testi[i - 1].replace(/^[^\d]+/, ""), { attesoNumerico: true });
      if (n.valore !== null) {
        peso = n.valore;
        break;
      }
    }
  }

  // L'importo è l'ultimo numero con i decimali della riga: il riferimento è
  // intero, il peso porta «kg», la data ha le barre.
  let importo: number | null = null;
  for (let i = testi.length - 1; i >= 0; i--) {
    const pulito = testi[i].replace(/^[^\d]+/, "");
    if (!/^\d{1,5}[.,]\d{2}$/.test(pulito)) continue;
    const n = leggiNumero(pulito, { attesoNumerico: true });
    if (n.valore !== null && plausibile(n.valore, "importo")) {
      importo = n.valore;
      break;
    }
  }

  // Il riferimento è il nostro numero interno: un intero di quattro o cinque
  // cifre, spesso preceduto da una parentesi quadra che il motore inventa
  // («|12310», «[10776»).
  //
  // La regola importante è quello che il riferimento **non** è. Togliendo tutti
  // i caratteri non numerici, «12,58» diventa «1258» e passa per un
  // riferimento: è l'errore che la prima versione faceva su ogni riga, e il
  // risultato era che ogni spedizione veniva agganciata al proprio importo
  // invece che alla propria bolla. Quindi si scarta qualunque testo che
  // contenga un separatore decimale, e si scarta l'importo già riconosciuto.
  let riferimento: string | null = null;
  for (const t of testi) {
    if (/[.,]/.test(t)) continue;
    const pulito = t.replace(/[^\d]/g, "");
    if (!/^\d{4,6}$/.test(pulito)) continue;
    if (data && pulito === data.replace(/\D/g, "")) continue;
    riferimento = pulito;
  }

  const servizio = /priority/i.test(testi.join(" "))
    ? "FedEx Priority"
    : /economy/i.test(testi.join(" "))
      ? "FedEx Economy"
      : null;

  return {
    letteraVettura: riga[ancora].testo,
    data: normalizzaData(data),
    riferimento,
    peso: peso !== null && plausibile(peso, "peso") ? peso : null,
    pesoVolumetricoApplicato: false,
    importo,
    percentualeCarburante: null,
    servizio,
    confidenza: Math.min(...riga.map((p) => p.confidenza)),
    testo: testoDi(riga),
  };
}

/** Da `02/07/2026` a `2026-07-02`. */
export function normalizzaData(testo: string | null): string | null {
  if (!testo) return null;
  const m = DATA.exec(testo.trim());
  if (!m) return null;
  const giorno = Number(m[1]);
  const mese = Number(m[2]);
  if (mese < 1 || mese > 12 || giorno < 1 || giorno > 31) return null;
  return `${m[3]}-${String(mese).padStart(2, "0")}-${String(giorno).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/*  Conversione nel formato comune                                     */
/* ------------------------------------------------------------------ */

/**
 * Dai blocchi alle righe di fattura.
 *
 * L'importo stampato accanto alla spedizione è il **totale**, carburante
 * compreso. Il nolo si ricava togliendolo: `importo / (1 + percentuale)`. Si
 * fa così e non moltiplicando un nolo ipotetico perché il totale è il numero
 * scritto sul documento, e deve restare quello anche se la percentuale fosse
 * letta male di un decimo.
 */
export function verso_righe(lettura: LetturaPerRighe): {
  righe: RigaFattura[];
  totali: TotaliDichiarati;
  avvertenze: string[];
} {
  const avvertenze: string[] = [];
  const righe: RigaFattura[] = [];

  const percentuali = new Set<number>();

  lettura.blocchi.forEach((b, i) => {
    if (b.importo === null) return;
    if (b.percentualeCarburante !== null) percentuali.add(b.percentualeCarburante);

    const carburante =
      b.percentualeCarburante === null
        ? 0
        : Math.round((b.importo - b.importo / (1 + b.percentualeCarburante)) * 100) / 100;

    righe.push({
      numero: i + 1,
      data: b.data,
      numeroSpedizione: b.letteraVettura,
      riferimento: b.riferimento,
      // FedEx non stampa il nome del destinatario sulla riga: resta all'aggancio
      // alla bolla, che lo conosce dal gestionale.
      controparte: null,
      direzione: null,
      colli: null,
      peso: b.peso,
      pesoVolumetrico: b.pesoVolumetricoApplicato ? b.peso : null,
      pesoTassato: b.peso,
      nolo: Math.round((b.importo - carburante) * 100) / 100,
      supplementi: 0,
      carburante,
      totale: b.importo,
      dettaglio: {
        lettera_vettura: b.letteraVettura,
        servizio: b.servizio ?? "",
        percentuale_carburante: b.percentualeCarburante ?? "",
        peso_volumetrico_applicato: b.pesoVolumetricoApplicato ? "sì" : "no",
        confidenza: Math.round(b.confidenza),
      },
    });
  });

  if (percentuali.size > 1) {
    avvertenze.push(
      `La fattura applica ${percentuali.size} percentuali di carburante diverse (${[...percentuali]
        .map((p) => `${(p * 100).toFixed(2)}%`)
        .join(", ")}): ogni spedizione ha la sua, come stampato sul documento.`
    );
  }

  const volumetrici = lettura.blocchi.filter((b) => b.pesoVolumetricoApplicato).length;
  if (volumetrici > 0) {
    avvertenze.push(
      `${volumetrici} spedizioni sono state tariffate a peso volumetrico: il peso indicato è quello che fa prezzo, non quello della merce.`
    );
  }

  // Il totale stampato è IVA compresa: si riporta al netto per poterlo
  // confrontare con la somma delle righe.
  const iva = lettura.aliquotaIva ?? 0.22;
  const netto =
    lettura.importoDovuto === null
      ? null
      : Math.round((lettura.importoDovuto / (1 + iva)) * 100) / 100;

  if (lettura.importoDovuto !== null && lettura.aliquotaIva === null) {
    avvertenze.push(
      "Aliquota IVA non letta sul documento: per riportare il totale al netto si è usato il 22%."
    );
  }

  return {
    righe,
    totali: {
      spedizioni: null,
      colli: null,
      peso: null,
      pesoRiferito: "tassato",
      nolo: null,
      supplementi: null,
      adeguamento: null,
      carburante: null,
      percentualeCarburante: null,
      totaleDocumento: netto,
      // Su FedEx l'importo accanto a ogni spedizione è già completo di
      // carburante: la somma delle righe deve fare l'imponibile del documento.
      totaleRighe: netto,
    },
    avvertenze,
  };
}
