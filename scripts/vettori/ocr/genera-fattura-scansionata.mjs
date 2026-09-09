/**
 * Costruisce una fattura FINTA senza livello di testo, per misurare la
 * precisione del riconoscimento ottico.
 *
 * Perché serve: i PDF FedEx veri sono immagini, e senza un documento di prova
 * non c'è modo di dire quanto il riconoscimento sbaglia — si può solo sperare.
 * Qui i valori di partenza sono noti, quindi l'errore è misurabile alla cifra.
 *
 * Il documento imita i difetti di una scansione, non un PDF pulito: grana,
 * inclinazione di una frazione di grado, contrasto non pieno. Senza quei
 * difetti la misura direbbe che il riconoscimento è perfetto, e sarebbe una
 * bugia sul comportamento con la carta vera.
 *
 * Uso:
 *   node scripts/vettori/ocr/genera-fattura-scansionata.mjs [destinazione]
 */
import { createCanvas } from "@napi-rs/canvas";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const destinazione =
  process.argv[2] ?? "src/tests/fixtures/fatture/ocr";

/** I valori veri. Il collaudo confronta il riconosciuto con questi. */
export const RIGHE = [
  { data: "02/07/2026", ldv: "7794 8821 0034", rif: "2026/004512", dest: "MILANO",       colli: 2, peso: "148,0", nolo: "76,49", supp: "10,00", carb: "20,99", tot: "107,48" },
  { data: "09/07/2026", ldv: "7794 8821 0158", rif: "2026/004587", dest: "TORINO",       colli: 1, peso: "62,5",  nolo: "41,20", supp: "0,00",  carb: "10,01", tot: "51,21"  },
  { data: "17/07/2026", ldv: "7794 8822 0091", rif: "2026/004641", dest: "NAPOLI",       colli: 4, peso: "310,0", nolo: "94,80", supp: "30,00", carb: "30,34", tot: "155,14" },
  { data: "24/07/2026", ldv: "7794 8822 0233", rif: "2026/004702", dest: "BOLOGNA",      colli: 1, peso: "23,4",  nolo: "28,60", supp: "0,00",  carb: "6,95",  tot: "35,55"  },
];

export const TOTALI = {
  numero: "8-441-70266",
  data: "31/07/2026",
  nolo: "241,09",
  supplementi: "40,00",
  carburante: "68,29",
  totale: "349,38",
  percentualeCarburante: "24,30",
};

/* ------------------------------------------------------------------ */

function disegna() {
  // A4 a 200 dpi: è la risoluzione con cui escono le scansioni d'ufficio.
  const larghezza = 1654;
  const altezza = 2339;
  const t = createCanvas(larghezza, altezza);
  const c = t.getContext("2d");

  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, larghezza, altezza);
  c.fillStyle = "#111111";

  c.font = "bold 46px Arial";
  c.fillText("FedEx Express Italy S.r.l.", 90, 130);
  c.font = "26px Arial";
  c.fillText("Fattura n. " + TOTALI.numero, 90, 190);
  c.fillText("Data documento " + TOTALI.data, 90, 232);
  c.fillText("Supplemento carburante del periodo: " + TOTALI.percentualeCarburante + " %", 90, 274);

  // intestazione tabella
  const colonne = [
    { x: 90,   nome: "Data" },
    { x: 250,  nome: "Lettera di vettura" },
    { x: 610,  nome: "Riferimento" },
    { x: 850,  nome: "Destinazione" },
    { x: 1090, nome: "Colli" },
    { x: 1190, nome: "Peso" },
    { x: 1310, nome: "Nolo" },
    { x: 1420, nome: "Extra" },
    { x: 1530, nome: "Totale" },
  ];
  c.font = "bold 24px Arial";
  colonne.forEach((col) => c.fillText(col.nome, col.x, 380));
  c.fillRect(90, 396, larghezza - 180, 2);

  c.font = "24px Arial";
  let y = 450;
  for (const r of RIGHE) {
    c.fillText(r.data, 90, y);
    c.fillText(r.ldv, 250, y);
    c.fillText(r.rif, 610, y);
    c.fillText(r.dest, 850, y);
    c.fillText(String(r.colli), 1120, y);
    c.fillText(r.peso, 1190, y);
    c.fillText(r.nolo, 1310, y);
    c.fillText(r.supp, 1420, y);
    c.fillText(r.tot, 1530, y);
    y += 58;
  }

  c.fillRect(90, y + 10, larghezza - 180, 2);
  y += 70;
  c.font = "bold 26px Arial";
  c.fillText("Totale nolo", 1050, y);
  c.fillText(TOTALI.nolo, 1450, y);
  y += 46;
  c.fillText("Totale supplementi", 1050, y);
  c.fillText(TOTALI.supplementi, 1450, y);
  y += 46;
  c.fillText("Totale carburante", 1050, y);
  c.fillText(TOTALI.carburante, 1450, y);
  y += 52;
  c.font = "bold 32px Arial";
  c.fillText("TOTALE DOCUMENTO", 1000, y);
  c.fillText(TOTALI.totale, 1430, y);

  return t;
}

/** Sporca l'immagine come farebbe uno scanner. */
function sporca(tela) {
  const c = tela.getContext("2d");
  const dati = c.getImageData(0, 0, tela.width, tela.height);
  const p = dati.data;
  for (let i = 0; i < p.length; i += 4) {
    // Grana: ±14 livelli. Abbastanza da non lasciare il bianco perfettamente
    // bianco, che è quello che distingue una scansione da un PDF nativo.
    const rumore = (Math.random() - 0.5) * 28;
    // Contrasto ridotto: il nero pieno diventa grigio scuro, il bianco grigino.
    for (let k = 0; k < 3; k++) {
      p[i + k] = Math.max(0, Math.min(255, 18 + p[i + k] * 0.88 + rumore));
    }
  }
  c.putImageData(dati, 0, 0);

  // Inclinazione: mezzo grado, come un foglio appoggiato storto sul vetro.
  const ruotata = createCanvas(tela.width, tela.height);
  const rc = ruotata.getContext("2d");
  rc.fillStyle = "#f4f2ee";
  rc.fillRect(0, 0, ruotata.width, ruotata.height);
  rc.translate(tela.width / 2, tela.height / 2);
  rc.rotate((0.5 * Math.PI) / 180);
  rc.translate(-tela.width / 2, -tela.height / 2);
  rc.drawImage(tela, 0, 0);
  return ruotata;
}

/**
 * Impacchetta il PNG in un PDF minimo.
 *
 * Il PDF contiene **solo** l'immagine: nessun font, nessun testo. È esattamente
 * la situazione delle fatture FedEx, dove `extractText` restituisce una stringa
 * vuota.
 */
function impacchetta(png, larghezza, altezza) {
  const oggetti = [];
  const aggiungi = (corpo) => {
    oggetti.push(corpo);
    return oggetti.length;
  };

  const contenuto = Buffer.from(
    `q\n${larghezza} 0 0 ${altezza} 0 0 cm\n/Im0 Do\nQ\n`,
    "latin1"
  );

  aggiungi(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"));
  aggiungi(Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "latin1"));
  aggiungi(
    Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${larghezza} ${altezza}] ` +
        `/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
      "latin1"
    )
  );
  aggiungi(
    Buffer.concat([
      Buffer.from(`<< /Length ${contenuto.length} >>\nstream\n`, "latin1"),
      contenuto,
      Buffer.from("\nendstream", "latin1"),
    ])
  );
  aggiungi(
    Buffer.concat([
      Buffer.from(
        `<< /Type /XObject /Subtype /Image /Width ${larghezza} /Height ${altezza} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
          `/Length ${png.length} >>\nstream\n`,
        "latin1"
      ),
      png,
      Buffer.from("\nendstream", "latin1"),
    ])
  );

  const pezzi = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const posizioni = [];
  let posizione = pezzi[0].length;

  oggetti.forEach((corpo, i) => {
    posizioni.push(posizione);
    const pezzo = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`, "latin1"),
      corpo,
      Buffer.from("\nendobj\n", "latin1"),
    ]);
    pezzi.push(pezzo);
    posizione += pezzo.length;
  });

  let xref = `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
  for (const p of posizioni) xref += `${String(p).padStart(10, "0")} 00000 n \n`;
  xref += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${posizione}\n%%EOF\n`;
  pezzi.push(Buffer.from(xref, "latin1"));

  return Buffer.concat(pezzi);
}

/* ------------------------------------------------------------------ */

const pulita = disegna();
const scansionata = sporca(pulita);
// JPEG di qualità media: la compressione con perdita è parte di quello che
// rende difficile una scansione, e va nella misura.
const jpeg = scansionata.toBuffer("image/jpeg", 78);

await mkdir(destinazione, { recursive: true });
const pdf = impacchetta(jpeg, scansionata.width, scansionata.height);
await writeFile(path.join(destinazione, "fedex-scansione-prova.pdf"), pdf);
await writeFile(
  path.join(destinazione, "fedex-scansione-prova.json"),
  JSON.stringify({ righe: RIGHE, totali: TOTALI }, null, 2)
);

console.log(
  `Scritti ${path.join(destinazione, "fedex-scansione-prova.pdf")} (${(pdf.length / 1024) | 0} kB) e il file dei valori veri.`
);
