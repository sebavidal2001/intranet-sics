import { it } from "vitest";
import { readFileSync } from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createWorker, PSM } from "tesseract.js";
import {
  rasterizza,
  riconosciPagina,
  raggruppaInRighe,
  bandeColonne,
  celleDiRiga,
} from "../../../src/lib/portali/vettori/fatture/ocr";

/**
 * Banco di prova per la seconda passata sui ritagli.
 *
 * La misura sul documento di collaudo dice che la rilettura ritagliata
 * *peggiora* il risultato: «7794 8821 0034» torna «778488210034», con un 4
 * perso, e la confidenza dichiarata è zero. Qui si confrontano le
 * combinazioni di modalità di segmentazione e alfabeto sullo stesso ritaglio,
 * per capire se la seconda passata si può salvare o va tolta.
 */

it(
  "confronta le modalità di rilettura su celle vere",
  async () => {
    const bytes = new Uint8Array(
      readFileSync("src/tests/fixtures/fatture/ocr/fedex-scansione-prova.pdf")
    );
    const pagine = await rasterizza(bytes, { dpi: 300 });
    const riconosciuta = await riconosciPagina(pagine[0]);
    const righe = raggruppaInRighe(riconosciuta.parole);
    const dati = righe.filter((r) =>
      /^\d{2}\/\d{2}\/\d{4}$/.test(r[0]?.testo ?? "")
    );
    const bande = bandeColonne(dati.flat(), riconosciuta.larghezza);

    // La riga più difficile: quella dove il motore ha spezzato l'importo.
    const difficile = celleDiRiga(dati[2], bande);
    const campioni = [
      { atteso: "94,80", cella: difficile[6] },
      { atteso: "310,0", cella: difficile[5] },
      { atteso: "155,14", cella: difficile[8] },
      { atteso: "2026/004641", cella: difficile[2] },
    ];

    const combinazioni = [
      { nome: "riga singola, cifre", psm: PSM.SINGLE_LINE, alfabeto: "0123456789.,-" },
      { nome: "parola singola, cifre", psm: PSM.SINGLE_WORD, alfabeto: "0123456789.,-" },
      { nome: "blocco, cifre", psm: PSM.SINGLE_BLOCK, alfabeto: "0123456789.,-" },
      { nome: "riga singola, libero", psm: PSM.SINGLE_LINE, alfabeto: "" },
      { nome: "blocco, libero", psm: PSM.SINGLE_BLOCK, alfabeto: "" },
    ];

    for (const c of combinazioni) {
      const motore = await createWorker("eng", 1, { logger: () => {} });
      const parametri: Record<string, unknown> = { tessedit_pageseg_mode: c.psm };
      if (c.alfabeto) parametri.tessedit_char_whitelist = c.alfabeto;
      await motore.setParameters(parametri as never);

      const esiti: string[] = [];
      for (const campione of campioni) {
        const r = campione.cella;
        const margine = 20;
        const ingrandimento = 2;
        const l = r.x1 - r.x0;
        const a = r.y1 - r.y0;
        const tela = createCanvas(
          (l + margine * 2) * ingrandimento,
          (a + margine * 2) * ingrandimento
        );
        const ctx = tela.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, tela.width, tela.height);
        const png = pagine[0].tela.toBuffer("image/png");
        const img = await loadImage(png);
        ctx.drawImage(
          img,
          r.x0 - margine,
          r.y0 - margine,
          l + margine * 2,
          a + margine * 2,
          0,
          0,
          tela.width,
          tela.height
        );

        const esito = await motore.recognize(tela.toBuffer("image/png"));
        const letto = esito.data.text.replace(/\s+/g, "").trim();
        const giusto = letto === campione.atteso.replace(/\s/g, "");
        esiti.push(
          `${campione.atteso} → «${letto}» ${giusto ? "OK" : "NO"} (${Math.round(esito.data.confidence)}%)`
        );
      }
      await motore.terminate();
      console.log(`${c.nome.padEnd(24)} ${esiti.join("  |  ")}`);
    }

    // Riferimento: cosa aveva letto la prima passata, senza ritaglio.
    console.log(
      "prima passata".padEnd(24),
      campioni.map((c) => `«${c.cella.testo}»`).join("  |  ")
    );
  },
  600000
);
