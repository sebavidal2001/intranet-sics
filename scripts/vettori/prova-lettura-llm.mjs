#!/usr/bin/env node
/**
 * Mette alla prova un modello multimodale sulla lettura di una fattura.
 *
 * Le fatture che nessun lettore automatico prende — la Trading Post di gennaio,
 * le FedEx di giugno e luglio — sono state trascritte a mano e verificate dalla
 * quadratura. Quelle trascrizioni sono la **risposta esatta**: qui si dà al
 * modello l'immagine della fattura e si confronta quello che ne tira fuori con
 * la risposta, riga per riga. Non è un'impressione su come "sembra scritto
 * bene": è un conteggio di quante spedizioni ha preso e quante ha sbagliato.
 *
 *   node scripts/vettori/prova-lettura-llm.mjs \
 *     --pdf "ft Fedex_06.pdf" --atteso docs/vettori-trascrizioni/fedex-159322244-2026-06.json \
 *     --modello gemini-2.5-flash-lite --dpi 200
 *
 * Stampa anche i token consumati: su un credito piccolo, sapere quanto costa
 * una pagina prima di lanciarne trenta è metà del lavoro.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const arg = (nome, ripiego = null) => {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : ripiego;
};

const PDF = arg("pdf");
const ATTESO = arg("atteso");
const MODELLO = arg("modello", "gemini-2.5-flash-lite");
const DPI = Number(arg("dpi", "200"));
const CARTELLA_PDF = process.env.VETTORI_FATTURE_DIR ?? ".";

if (!PDF || !ATTESO) {
  console.error("Servono --pdf e --atteso.");
  process.exit(1);
}

for (const file of [".env.local", "/opt/intranet-sics/.env.local"]) {
  if (!existsSync(file)) continue;
  for (const riga of readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = riga.indexOf("=");
    if (i < 0 || riga.startsWith("#")) continue;
    const chiave = riga.slice(0, i).trim();
    if (!process.env[chiave]) process.env[chiave] = riga.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const CHIAVE = process.env.GEMINI_API_KEY;
if (!CHIAVE) {
  console.error("GEMINI_API_KEY non trovata.");
  process.exit(1);
}

/**
 * Il prompt dice cosa serve e, soprattutto, cosa NON inventare.
 *
 * Un modello che trova la tabella ma non uno dei numeri tende a metterci uno
 * zero o a dedurlo dagli altri: sarebbe il difetto peggiore, perché produce una
 * fattura che quadra e non corrisponde al documento. `null` è una risposta
 * legittima; un numero inventato no.
 */
const ISTRUZIONI = `Sei davanti alle pagine di una fattura di un corriere espresso.
Estrai OGNI spedizione elencata, senza saltarne nessuna e senza ripeterne
nessuna: le pagine possono contenere lo stesso elenco due volte (una copia per
l'archivio elettronico) e in quel caso le spedizioni vanno contate UNA volta.

Per ogni spedizione riporta i valori COSÌ COME SONO STAMPATI:
- numeroSpedizione: la lettera di vettura o il numero di spedizione
- data: la data della spedizione, formato AAAA-MM-GG
- riferimento: il numero di bolla/riferimento del cliente, se stampato
- controparte: mittente o destinatario, come scritto
- colli: numero di pezzi
- peso: il peso reale in kg
- pesoTassato: il peso fatturato (se diverso dal reale)
- carburante: il supplemento carburante di QUELLA spedizione
- totale: il totale della spedizione
Per l'importo del trasporto NON fare conti: copia quello che vedi.
- se la fattura espone una sola voce di nolo, mettila in "nolo"
- se invece espone "Spese di trasporto" e "Sconto" separatamente, riportale in
  "speseTrasporto" e "sconto" e lascia "nolo" a null

Riporta anche gli estremi del documento (numero, data) e i totali dichiarati:
imponibile, totale documento.

Regola assoluta: se un valore non è leggibile sul documento, scrivi null.
Non dedurlo, non calcolarlo, non copiarlo da un'altra riga.`;

const SCHEMA = {
  type: "object",
  properties: {
    numero: { type: "string", nullable: true },
    data: { type: "string", nullable: true },
    imponibile: { type: "number", nullable: true },
    totaleDocumento: { type: "number", nullable: true },
    righe: {
      type: "array",
      items: {
        type: "object",
        properties: {
          numeroSpedizione: { type: "string", nullable: true },
          data: { type: "string", nullable: true },
          riferimento: { type: "string", nullable: true },
          controparte: { type: "string", nullable: true },
          colli: { type: "number", nullable: true },
          peso: { type: "number", nullable: true },
          pesoTassato: { type: "number", nullable: true },
          nolo: { type: "number", nullable: true },
          speseTrasporto: { type: "number", nullable: true },
          sconto: { type: "number", nullable: true },
          carburante: { type: "number", nullable: true },
          totale: { type: "number", nullable: true },
        },
        required: ["numeroSpedizione", "totale"],
      },
    },
  },
  required: ["righe"],
};

async function pagineDelPdf(percorso, dpi) {
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const canvasImport = () => import("@napi-rs/canvas");
  const bytes = new Uint8Array(readFileSync(percorso));
  const pdf = await getDocumentProxy(bytes.slice());
  const fuori = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const png = await renderPageAsImage(pdf, n, { scale: dpi / 72, canvasImport });
    fuori.push(Buffer.from(png));
  }
  return fuori;
}

async function chiedi(modello, pagine) {
  const parti = [
    { text: ISTRUZIONI },
    ...pagine.map((png) => ({
      inline_data: { mime_type: "image/png", data: png.toString("base64") },
    })),
  ];
  const inizio = Date.now();
  const risposta = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modello}:generateContent?key=${CHIAVE}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: parti }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
          temperature: 0,
        },
      }),
    }
  );
  const corpo = await risposta.json();
  if (!risposta.ok) {
    throw new Error(`${risposta.status}: ${JSON.stringify(corpo).slice(0, 400)}`);
  }
  const testo = corpo.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return {
    letto: JSON.parse(testo),
    uso: corpo.usageMetadata ?? {},
    secondi: Math.round((Date.now() - inizio) / 100) / 10,
  };
}

const vicino = (a, b, tolleranza = 0.011) =>
  a == null && b == null ? true : a == null || b == null ? false : Math.abs(a - b) <= tolleranza;

/** Nelle trascrizioni il totale non è scritto: è nolo + supplementi + carburante. */
const totaleAtteso = (r) =>
  Math.round(((r.nolo ?? 0) + (r.supplementi ?? 0) + (r.carburante ?? 0)) * 100) / 100;

function confronta(letto, atteso) {
  const attese = atteso.righe;
  const lette = letto.righe ?? [];
  const esiti = [];
  let esatte = 0;

  for (const a of attese) {
    const l = lette.find((x) => String(x.numeroSpedizione ?? "").replace(/\D/g, "") ===
                                String(a.numeroSpedizione ?? "").replace(/\D/g, ""));
    if (!l) {
      esiti.push(`MANCA   ${a.numeroSpedizione} (${totaleAtteso(a)} €)`);
      continue;
    }
    const sbagliati = [];
    const atteso_totale = totaleAtteso(a);
    if (!vicino(l.totale, atteso_totale)) {
      sbagliati.push(`totale ${l.totale} invece di ${atteso_totale}`);
    }
    // Il nolo è quello netto: se la fattura espone spese e sconto separati, il
    // modello riporta quelli e la somma la facciamo qui — così non gli si
    // chiede di fare conti, che è il momento in cui un modello inventa.
    const noloLetto = l.nolo ?? (l.speseTrasporto != null
      ? Math.round((l.speseTrasporto - Math.abs(l.sconto ?? 0)) * 100) / 100
      : null);
    if (a.nolo != null && noloLetto != null && !vicino(noloLetto, a.nolo)) {
      sbagliati.push(`nolo ${noloLetto} invece di ${a.nolo}`);
    }
    // Il peso reale e quello fatturato sono stampati in punti diversi del
    // documento: prenderne uno per l'altro è ambiguità della fattura, non un
    // errore di lettura. Si segnala senza contarlo come sbaglio.
    const pesi = [a.peso, a.pesoTassato].filter((x) => x != null);
    if (l.peso != null && pesi.length > 0 && !pesi.some((x) => vicino(l.peso, x))) {
      sbagliati.push(`peso ${l.peso} che non è né ${a.peso} né ${a.pesoTassato}`);
    }
    if (a.colli != null && l.colli != null && l.colli !== a.colli) {
      sbagliati.push(`colli ${l.colli} invece di ${a.colli}`);
    }
    if (a.data && l.data && l.data !== a.data) sbagliati.push(`data ${l.data} invece di ${a.data}`);
    if (sbagliati.length === 0) esatte++;
    else esiti.push(`SBAGLIA ${a.numeroSpedizione}: ${sbagliati.join("; ")}`);
  }

  const inPiu = lette.filter((l) => !attese.some((a) =>
    String(a.numeroSpedizione ?? "").replace(/\D/g, "") ===
    String(l.numeroSpedizione ?? "").replace(/\D/g, "")));
  for (const l of inPiu) esiti.push(`IN PIÙ  ${l.numeroSpedizione} (${l.totale} €)`);

  const somma = lette.reduce((acc, r) => acc + (Number(r.totale) || 0), 0);
  return { esatte, attese: attese.length, lette: lette.length, esiti, somma };
}

const atteso = JSON.parse(readFileSync(ATTESO, "utf8"));
const percorso = existsSync(PDF) ? PDF : join(CARTELLA_PDF, PDF);
const pagine = await pagineDelPdf(percorso, DPI);

console.log(`${PDF} — ${pagine.length} pagine a ${DPI} dpi, modello ${MODELLO}`);
const { letto, uso, secondi } = await chiedi(MODELLO, pagine);
const esito = confronta(letto, atteso);

console.log(`  estremi: numero ${letto.numero ?? "—"} (atteso ${atteso.numero}), ` +
            `data ${letto.data ?? "—"} (attesa ${atteso.data})`);
console.log(`  imponibile dichiarato: ${letto.imponibile ?? "—"} ` +
            `(atteso ${atteso.totaliDichiarati.totaleRighe ?? atteso.totaliDichiarati.totaleDocumento})`);
console.log(`  righe: ${esito.lette} lette su ${esito.attese} attese, ` +
            `${esito.esatte} esatte in ogni campo`);
const sommaAttesa = atteso.righe.reduce((acc, r) => acc + totaleAtteso(r), 0);
console.log(`  somma dei totali: ${esito.somma.toFixed(2)} (attesa ${sommaAttesa.toFixed(2)})` +
            `${vicino(esito.somma, sommaAttesa, 0.02) ? " — quadra" : " — NON quadra"}`);
for (const e of esito.esiti) console.log(`    ${e}`);
console.log(`  token: ${uso.promptTokenCount ?? "?"} in ingresso, ` +
            `${uso.candidatesTokenCount ?? "?"} in uscita — ${secondi}s`);
