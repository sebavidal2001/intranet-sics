import { it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  bandeColonne,
  celleDiRiga,
  correggiOrientamento,
  raggruppaInRighe,
  rasterizza,
  riconosciPagina,
} from "../../../src/lib/portali/vettori/fatture/ocr";
import { leggiFedexOcr } from "../../../src/lib/portali/vettori/fatture/fedex";
import { quadra } from "../../../src/lib/portali/vettori/fatture";

/**
 * Calibrazione su fatture FedEx **vere**.
 *
 * Il documento sintetico dimostra che la catena regge su una scansione
 * difficile; questo dice se regge sul tracciato che FedEx usa davvero. Stampa
 * tutto quello che legge, riga per riga, perché la prima volta serve guardare —
 * non passare o fallire.
 *
 * I PDF non stanno nel repository: sono documenti aziendali. Il percorso si
 * passa con FEDEX_PDF, e senza quella variabile la prova si salta.
 *
 *   FEDEX_PDF=/percorso/fedex-07.pdf npx vitest run \
 *     --config scripts/vettori/vitest-ocr.config.ts \
 *     scripts/vettori/ocr/calibra-fedex.test.ts
 */

const PDF = process.env.FEDEX_PDF;

it.skipIf(!PDF || !existsSync(PDF))(
  "guarda cosa legge su una fattura FedEx vera",
  async () => {
    const bytes = new Uint8Array(readFileSync(PDF!));

    // --- primo sguardo: cosa c'è sulla pagina ---
    const pagine = await rasterizza(bytes, { dpi: 300 });
    console.log(`\n${pagine.length} pagine a ${pagine[0].larghezza}×${pagine[0].altezza}`);

    for (const grezza of pagine) {
      const { pagina: p, gradi, punteggi } = await correggiOrientamento(grezza);
      console.log(`  orientamento: ${gradi} gradi (punteggi 0/90/180/270: ${punteggi.join(" ")})`);
      const r = await riconosciPagina(p);
      const righe = raggruppaInRighe(r.parole);
      console.log(`\n───────── pagina ${p.numero}: ${r.parole.length} parole, ${righe.length} righe`);
      for (const riga of righe.slice(0, 60)) {
        const media = Math.round(
          riga.reduce((a, w) => a + w.confidenza, 0) / riga.length
        );
        console.log(`  [${String(media).padStart(3)}%] ${riga.map((w) => w.testo).join(" | ")}`);
      }
      if (righe.length > 60) console.log(`  … altre ${righe.length - 60} righe`);

      // Colonne ricostruite sulle righe che sembrano spedizioni.
      const dati = righe.filter((x) => /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(x[0]?.testo ?? ""));
      if (dati.length > 0) {
        const bande = bandeColonne(dati.flat(), r.larghezza);
        console.log(`\n  ${dati.length} righe con data in testa, ${bande.length} colonne:`);
        for (const riga of dati.slice(0, 20)) {
          console.log(
            "   ",
            celleDiRiga(riga, bande)
              .map((c) => `${c.banda}:${c.testo}`)
              .join("  ")
          );
        }
      }
    }

    // --- secondo sguardo: cosa ne ricava il lettore ---
    console.log("\n═════════ lettura completa ═════════");
    // Senza FEDEX_DPI si usa il valore predefinito del modulo (400), che e quello
    // che gira in produzione: una prova a una risoluzione diversa da quella vera
    // direbbe poco.
    const dpi = process.env.FEDEX_DPI ? Number(process.env.FEDEX_DPI) : undefined;
    console.log(`lettura a ${dpi ?? "predefiniti"} dpi`);
    const esito = await leggiFedexOcr(bytes, dpi ? { dpi } : {});
    console.log("ruoli:", esito.ruoli);
    for (const s of esito.spiegazioni) console.log("  ·", s);
    console.log("totali:", esito.fattura.totali);
    console.log(`righe lette: ${esito.fattura.righe.length}`);
    for (const r of esito.fattura.righe.slice(0, 30)) {
      console.log(
        `  ${r.data} ${r.riferimento ?? "—"} ${r.controparte ?? "—"} ` +
          `colli ${r.colli} peso ${r.peso} nolo ${r.nolo} supp ${r.supplementi} tot ${r.totale}`
      );
    }
    if (esito.fattura.righeNonLette.length > 0) {
      console.log(`non lette (${esito.fattura.righeNonLette.length}):`);
      for (const x of esito.fattura.righeNonLette.slice(0, 10)) console.log("  ✗", x);
    }

    const q = quadra(esito.fattura);
    console.log(
      "\nquadratura:",
      q.ok,
      q.confronti.map((c) => `${c.voce}: ${c.dichiarato} vs ${c.calcolato}`).join(" | ")
    );
    for (const n of q.note) console.log("  ·", n);
  },
  900000
);
