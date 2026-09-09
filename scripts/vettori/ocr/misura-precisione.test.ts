import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  bandeColonne,
  celleDiRiga,
  raggruppaInRighe,
  rasterizza,
  riconosciPagina,
  rileggiCelle,
} from "../../../src/lib/portali/vettori/fatture/ocr";
import {
  leggiNumero,
  ricomponiImporto,
} from "../../../src/lib/portali/vettori/fatture/numeri";

/**
 * Misura di precisione del riconoscimento ottico.
 *
 * Il documento è una fattura finta senza livello di testo, con valori noti
 * (`genera-fattura-scansionata.mjs`): è l'unico modo di dire quanto il motore
 * sbaglia invece di sperare che vada bene. Il confronto è alla cifra, sul
 * valore numerico e non sulla stringa — «310.0» e «310,0» sono lo stesso peso
 * scritto in due modi, e contarlo come errore direbbe una cosa falsa.
 *
 *   npx vitest run --config scripts/vettori/vitest-ocr.config.ts
 */

const CARTELLA = "src/tests/fixtures/fatture/ocr";

/** Le colonne del documento di prova, nell'ordine in cui compaiono. */
const COLONNE = {
  data: 0,
  ldv: 1,
  riferimento: 2,
  destinazione: 3,
  colli: 4,
  peso: 5,
  nolo: 6,
  extra: 7,
  totale: 8,
} as const;

const NUMERICHE = [COLONNE.colli, COLONNE.peso, COLONNE.nolo, COLONNE.extra, COLONNE.totale];

it(
  "legge la fattura scansionata di prova",
  async () => {
    const bytes = new Uint8Array(
      readFileSync(`${CARTELLA}/fedex-scansione-prova.pdf`)
    );
    const veri = JSON.parse(
      readFileSync(`${CARTELLA}/fedex-scansione-prova.json`, "utf8")
    ) as {
      righe: Array<Record<string, string | number>>;
      totali: Record<string, string>;
    };

    const avvio = Date.now();
    const pagine = await rasterizza(bytes, { dpi: 300 });
    expect(pagine).toHaveLength(1);

    const riconosciuta = await riconosciPagina(pagine[0]);
    console.log(
      `pagina ${pagine[0].larghezza}×${pagine[0].altezza}, ${riconosciuta.parole.length} parole, ${Date.now() - avvio} ms`
    );

    const righe = raggruppaInRighe(riconosciuta.parole);
    const dati = righe.filter((r) =>
      /^\d{2}\/\d{2}\/\d{4}$/.test(r[0]?.testo ?? "")
    );
    expect(dati).toHaveLength(veri.righe.length);

    const bande = bandeColonne(dati.flat(), riconosciuta.larghezza);
    console.log(`${bande.length} colonne riconosciute`);
    expect(bande.length).toBe(Object.keys(COLONNE).length);

    let esatti = 0;
    let totali = 0;
    const errori: string[] = [];

    for (let i = 0; i < dati.length; i++) {
      const celle = celleDiRiga(dati[i], bande);
      const vero = veri.righe[i];

      // Le celle numeriche arrivate spezzate, o che numero non sembrano, si
      // rileggono ritagliate. È il passaggio che ripara «94 80».
      const daRileggere = celle.filter(
        (c) =>
          NUMERICHE.includes(c.banda as never) &&
          (c.parole.length > 1 || leggiNumero(c.testo).valore === null)
      );
      const riletti = await rileggiCelle(pagine[0], daRileggere, "numero");
      const rilettura = new Map(
        daRileggere.map((c, k) => [c.banda, riletti[k]])
      );

      // Il riferimento si rilegge con l'alfabeto libero: quello ristretto alle
      // cifre trasforma la barra in un sette.
      const cellaRif = celle.find((c) => c.banda === COLONNE.riferimento);
      const rifRiletto =
        cellaRif && cellaRif.parole.length > 1
          ? (await rileggiCelle(pagine[0], [cellaRif], "riferimento"))[0]
          : null;

      const valore = (banda: number) => {
        const cella = celle.find((c) => c.banda === banda);
        if (!cella) return null;
        const r = rilettura.get(banda);
        if (r) {
          const n = leggiNumero(r.testo, { attesoNumerico: true });
          if (n.valore !== null) return n.valore;
        }
        const diretto = leggiNumero(cella.testo, { attesoNumerico: true });
        if (diretto.valore !== null) return diretto.valore;
        return ricomponiImporto(cella.parole.map((p) => p.testo)).valore;
      };

      const confronta = (nome: string, letto: unknown, atteso: unknown) => {
        totali++;
        if (letto === atteso) esatti++;
        else errori.push(`riga ${i + 1} ${nome}: letto ${letto}, atteso ${atteso}`);
      };

      const numero = (s: string) => Number(String(s).replace(",", "."));

      confronta("colli", valore(COLONNE.colli), Number(vero.colli));
      confronta("peso", valore(COLONNE.peso), numero(String(vero.peso)));
      confronta("nolo", valore(COLONNE.nolo), numero(String(vero.nolo)));
      confronta("extra", valore(COLONNE.extra), numero(String(vero.supp)));
      confronta("totale", valore(COLONNE.totale), numero(String(vero.tot)));

      const rifLetto = (rifRiletto?.testo ?? cellaRif?.testo ?? "").replace(/\s/g, "");
      confronta("riferimento", rifLetto, String(vero.rif));
    }

    console.log(`campi esatti ${esatti}/${totali}`);
    for (const e of errori) console.log("  ✗", e);

    // Sul documento di collaudo il riconoscimento deve essere completo: se un
    // campo sfugge qui, su una scansione vera ne sfuggiranno di più.
    expect(errori).toEqual([]);
    expect(esatti).toBe(totali);
  },
  600000
);
