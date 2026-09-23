import { rasterizza } from "./ocr";
import type { CodiceVettore, FatturaLetta, RigaFattura } from "./tipi";
import { chiediVisione, ErroreOpenRouter } from "@/lib/ai/openrouter";
import { leggiConfigAi, numeroParametro } from "@/lib/ai/config";
import { quadra } from "./index";

/**
 * Lettura delle fatture che arrivano come immagine, affidata a un modello.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUANDO SERVE
 *
 * Tre fatture su ventotto del 2026 non hanno un carattere di testo dentro il
 * PDF: la Trading Post di gennaio è una scansione ruotata, le FedEx di giugno e
 * luglio sono disegni. Il riconoscimento ottico ne recuperava una parte — su
 * quella di luglio cinque spedizioni su sei — e la sesta, da 9,04 €, è rimasta
 * fuori finché non è stata trascritta a mano.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PERCHÉ CI SI PUÒ FIDARE, PUR NON FIDANDOSI
 *
 * Di un modello non ci si fida: si verifica. Quello che esce di qui passa per
 * la **stessa quadratura** di ogni altra fattura — la somma delle righe contro
 * i totali stampati sul documento — e se non torna la fattura non si acquisisce.
 * Misurato sulle tre fatture vere, con le trascrizioni a mano come risposta
 * esatta: il modello economico prende entrambe le FedEx riga per riga e sbaglia
 * otto righe su ventitré della Trading Post; e quando sbaglia **non quadra**
 * (231,90 contro 232,18 stampati). Il difetto si presenta come tale.
 *
 * Da qui la strategia: si prova con il modello economico, e si passa a quello
 * più capace solo se la quadratura non torna. È una prova aritmetica a decidere
 * quando vale la pena spendere di più, non una regola scritta a priori.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * COSA NON SI CHIEDE AL MODELLO
 *
 * Di fare conti. Il prompt chiede i valori **come sono stampati** e dichiara
 * che `null` è una risposta legittima: un numero dedotto che fa quadrare la
 * fattura sarebbe il difetto peggiore possibile, perché supererebbe il
 * controllo senza corrispondere al documento. Dove FedEx espone «Spese di
 * trasporto» e «Sconto» separati, il modello riporta le due voci e la
 * sottrazione la facciamo qui.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ISTRUZIONI = `Sei davanti alle pagine di una fattura di un corriere espresso.
Estrai OGNI spedizione elencata, senza saltarne nessuna e senza ripeterne
nessuna: le pagine possono contenere lo stesso elenco due volte (una copia per
l'archivio elettronico) e in quel caso le spedizioni vanno contate UNA volta.

Per ogni spedizione riporta i valori COSI' COME SONO STAMPATI:
- numeroSpedizione: la lettera di vettura o il numero di spedizione del corriere
- data: la data della spedizione, formato AAAA-MM-GG
- riferimento: il numero di bolla o riferimento del cliente, se stampato
- controparte: mittente o destinatario, come scritto
- direzione: "entrata" se la merce arriva a noi (AIRFLUID e' il destinatario),
  "uscita" se parte da noi (AIRFLUID e' il mittente), null se non si capisce
- colli: il numero di colli o pezzi
- peso: il peso reale in kg
- pesoTassato: il peso fatturato, se diverso dal reale
- carburante: il supplemento carburante di QUELLA spedizione
- totale: il totale della spedizione

Per l'importo del trasporto NON fare conti: copia quello che vedi.
- se la fattura espone una sola voce di nolo, mettila in "nolo"
- se espone "Spese di trasporto" e "Sconto" separatamente, riportale in
  "speseTrasporto" e "sconto" e lascia "nolo" a null

Riporta gli estremi del documento e i totali che il documento DICHIARA in coda
(non sommarli tu: se non sono stampati, scrivi null).

Regola assoluta: se un valore non e' leggibile sul documento, scrivi null.
Non dedurlo, non calcolarlo, non copiarlo da un'altra riga.`;

/**
 * Lo schema è scritto in forma severa — ogni proprietà dichiarata e obbligatoria,
 * niente campi liberi — perché OpenRouter lo pretende così quando si chiede
 * `strict`. I valori assenti passano dal tipo `null`, non dall'assenza della
 * chiave: la differenza conta, perché «non l'ho trovato» deve poter arrivare.
 */
const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["vettore", "numero", "data", "totali", "righe"],
  properties: {
    vettore: { type: ["string", "null"], enum: ["gls", "tnt", "fedex", "trading_post", null] },
    numero: { type: ["string", "null"] },
    data: { type: ["string", "null"] },
    totali: {
      type: "object",
      additionalProperties: false,
      required: ["spedizioni", "colli", "peso", "nolo", "imponibile", "totaleDocumento"],
      properties: {
        spedizioni: { type: ["number", "null"] },
        colli: { type: ["number", "null"] },
        peso: { type: ["number", "null"] },
        nolo: { type: ["number", "null"] },
        imponibile: { type: ["number", "null"] },
        totaleDocumento: { type: ["number", "null"] },
      },
    },
    righe: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "numeroSpedizione", "data", "riferimento", "controparte", "direzione",
          "colli", "peso", "pesoTassato", "nolo", "speseTrasporto", "sconto",
          "carburante", "totale",
        ],
        properties: {
          numeroSpedizione: { type: ["string", "null"] },
          data: { type: ["string", "null"] },
          riferimento: { type: ["string", "null"] },
          controparte: { type: ["string", "null"] },
          direzione: { type: ["string", "null"], enum: ["entrata", "uscita", null] },
          colli: { type: ["number", "null"] },
          peso: { type: ["number", "null"] },
          pesoTassato: { type: ["number", "null"] },
          nolo: { type: ["number", "null"] },
          speseTrasporto: { type: ["number", "null"] },
          sconto: { type: ["number", "null"] },
          carburante: { type: ["number", "null"] },
          totale: { type: ["number", "null"] },
        },
      },
    },
  },
};

interface RigaLetta {
  numeroSpedizione: string | null;
  data: string | null;
  riferimento: string | null;
  controparte: string | null;
  direzione: "entrata" | "uscita" | null;
  colli: number | null;
  peso: number | null;
  pesoTassato: number | null;
  nolo: number | null;
  speseTrasporto: number | null;
  sconto: number | null;
  carburante: number | null;
  totale: number | null;
}

interface FatturaGrezza {
  vettore: CodiceVettore | null;
  numero: string | null;
  data: string | null;
  totali: {
    spedizioni: number | null;
    colli: number | null;
    peso: number | null;
    nolo: number | null;
    imponibile: number | null;
    totaleDocumento: number | null;
  };
  righe: RigaLetta[];
}

const arrotonda = (v: number) => Math.round(v * 100) / 100;

function normalizzaData(v: string | null): string | null {
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (iso) return v.trim();
  const it = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v.trim());
  if (!it) return null;
  return `${it[3]}-${it[2].padStart(2, "0")}-${it[1].padStart(2, "0")}`;
}

function componiFattura(grezza: FatturaGrezza, vettore: CodiceVettore): FatturaLetta {
  const righe: RigaFattura[] = grezza.righe.map((r, i) => {
    // Il nolo netto: se il documento espone spese e sconto separati, la
    // sottrazione la facciamo qui. Lo sconto si prende in valore assoluto — sul
    // documento è negativo, ma non sempre il segno sopravvive alla lettura.
    const nolo =
      r.nolo ??
      (r.speseTrasporto != null
        ? arrotonda(r.speseTrasporto - Math.abs(r.sconto ?? 0))
        : null);
    const carburante = r.carburante ?? 0;
    const totale =
      r.totale ?? (nolo != null ? arrotonda(nolo + carburante) : null);

    return {
      numero: i + 1,
      data: normalizzaData(r.data),
      numeroSpedizione: r.numeroSpedizione,
      riferimento: r.riferimento,
      controparte: r.controparte,
      direzione: r.direzione,
      colli: r.colli,
      peso: r.peso,
      pesoVolumetrico: r.pesoTassato != null && r.peso != null && r.pesoTassato > r.peso
        ? r.pesoTassato
        : null,
      pesoTassato: r.pesoTassato ?? r.peso,
      nolo,
      supplementi: 0,
      carburante,
      totale,
      dettaglio: {
        origine: "letta da modello multimodale",
        spese_trasporto: r.speseTrasporto ?? "",
        sconto: r.sconto ?? "",
      },
    };
  });

  return {
    vettore,
    numero: grezza.numero,
    data: normalizzaData(grezza.data),
    anno: normalizzaData(grezza.data) ? Number(normalizzaData(grezza.data)!.slice(0, 4)) : null,
    mese: normalizzaData(grezza.data) ? Number(normalizzaData(grezza.data)!.slice(5, 7)) : null,
    righe,
    totali: {
      spedizioni: grezza.totali.spedizioni,
      colli: grezza.totali.colli,
      peso: grezza.totali.peso,
      // TNT totalizza il peso tassato, gli altri quello reale: è la stessa
      // distinzione che fanno i lettori di testo, e sbagliarla farebbe fallire
      // la quadratura di una fattura corretta.
      pesoRiferito: vettore === "tnt" ? "tassato" : "reale",
      nolo: grezza.totali.nolo,
      supplementi: null,
      adeguamento: null,
      carburante: null,
      percentualeCarburante: null,
      totaleDocumento: grezza.totali.totaleDocumento ?? grezza.totali.imponibile,
      totaleRighe: grezza.totali.imponibile,
    },
    righeNonLette: [],
    avvertenze: [],
  };
}

export interface TentativoLettura {
  modello: string;
  righe: number;
  quadra: boolean;
  tokenIngresso: number | null;
  tokenUscita: number | null;
  costo: number | null;
  millisecondi: number;
  errore?: string;
}

export interface LetturaConModello {
  fattura: FatturaLetta | null;
  tentativi: TentativoLettura[];
  spiegazioni: string[];
}

/**
 * Legge una fattura dalle immagini delle sue pagine.
 *
 * Prova il modello primario; se quello che ne esce non quadra con i totali del
 * documento, riprova con quello di riserva. Restituisce la lettura migliore
 * ottenuta — anche quando non quadra, perché l'operatore deve poter vedere cosa
 * è stato letto prima di decidere; a impedire l'acquisizione ci pensa il
 * chiamante, che la quadratura la rifà per conto suo.
 */
export async function leggiFatturaConModello(
  bytes: Uint8Array,
  vettoreAtteso?: CodiceVettore | null
): Promise<LetturaConModello> {
  const config = await leggiConfigAi("vettoriLetturaFattura");
  const spiegazioni: string[] = [];
  const tentativi: TentativoLettura[] = [];

  if (!config.attivo) {
    return {
      fattura: null,
      tentativi,
      spiegazioni: ["La lettura assistita è disattivata nella configurazione AI."],
    };
  }

  const dpi = numeroParametro(config, "dpi", 200);
  const massimoPagine = numeroParametro(config, "massimo_pagine", 8);
  const timeoutMs = numeroParametro(config, "timeout_secondi", 120) * 1000;
  // Le fatture più lunghe misurate hanno prodotto 3.500 token: ottomila sono
  // larghi e tengono il credito riservato vicino a quello che serve davvero.
  const massimoToken = numeroParametro(config, "massimo_token_risposta", 8000);

  const pagine = await rasterizza(bytes, { dpi, massimoPagine });
  const immagini = pagine.map((p) => new Uint8Array(p.tela.toBuffer("image/png")));
  spiegazioni.push(`${immagini.length} pagine rasterizzate a ${dpi} dpi.`);

  const modelli = [config.modelloPrimario, config.modelloRiserva].filter(
    (m): m is string => Boolean(m)
  );

  let migliore: FatturaLetta | null = null;

  for (const modello of modelli) {
    try {
      const risposta = await chiediVisione({
        modello,
        istruzioni: ISTRUZIONI,
        immagini,
        schema: SCHEMA,
        timeoutMs,
        massimoToken,
      });
      const grezza = risposta.contenuto as FatturaGrezza;
      const vettore = (vettoreAtteso ?? grezza.vettore) as CodiceVettore | null;

      if (!vettore) {
        tentativi.push({
          modello, righe: grezza.righe?.length ?? 0, quadra: false,
          tokenIngresso: risposta.tokenIngresso, tokenUscita: risposta.tokenUscita,
          costo: risposta.costo, millisecondi: risposta.millisecondi,
          errore: "vettore non riconosciuto",
        });
        continue;
      }

      const fattura = componiFattura(grezza, vettore);
      const esito = quadra(fattura);
      tentativi.push({
        modello,
        righe: fattura.righe.length,
        quadra: esito.ok,
        tokenIngresso: risposta.tokenIngresso,
        tokenUscita: risposta.tokenUscita,
        costo: risposta.costo,
        millisecondi: risposta.millisecondi,
      });

      // La prima lettura si tiene comunque: se anche la riserva non quadrerà,
      // all'operatore si mostra qualcosa invece di una pagina vuota.
      if (migliore === null) migliore = fattura;
      if (esito.ok) {
        migliore = fattura;
        fattura.avvertenze.push(
          `Fattura letta dal modello ${modello}: i valori non vengono da una lettura ` +
            "del testo del documento, che qui non c'è. La quadratura con i totali stampati " +
            "è la verifica che la lettura sia fedele."
        );
        return { fattura, tentativi, spiegazioni };
      }
      spiegazioni.push(
        `${modello}: ${fattura.righe.length} righe lette, ma la somma non torna con i totali stampati.`
      );
    } catch (e) {
      const messaggio = e instanceof Error ? e.message : String(e);
      tentativi.push({
        modello, righe: 0, quadra: false, tokenIngresso: null, tokenUscita: null,
        costo: null, millisecondi: 0, errore: messaggio,
      });
      spiegazioni.push(messaggio);
      // Una chiave mancante o un modello inesistente non migliorano al secondo
      // tentativo: inutile spendere un'altra chiamata.
      if (e instanceof ErroreOpenRouter && !e.ripetibile) break;
    }
  }

  if (migliore) {
    migliore.avvertenze.push(
      "Nessuno dei modelli ha prodotto una lettura che quadra con i totali stampati: " +
        "quello che si vede è la lettura migliore ottenuta, da controllare riga per riga."
    );
  }
  return { fattura: migliore, tentativi, spiegazioni };
}
