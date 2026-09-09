import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { leggiFedexOcr } from "../../../src/lib/portali/vettori/fatture/fedex";
import { quadra } from "../../../src/lib/portali/vettori/fatture";

/**
 * La catena completa: dal PDF senza testo alla fattura letta.
 *
 * Verifica quello che nessun test unitario può dire — che riconoscimento,
 * ricostruzione delle colonne, assegnazione dei ruoli e composizione della
 * fattura funzionino **insieme**, sullo stesso documento e con i valori veri
 * a fianco.
 */

const CARTELLA = "src/tests/fixtures/fatture/ocr";

it(
  "legge per intero la fattura FedEx scansionata",
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

    const esito = await leggiFedexOcr(bytes);

    console.log("ruoli assegnati:", esito.ruoli);
    for (const s of esito.spiegazioni) console.log("  ·", s);
    console.log("totali letti:", esito.fattura.totali);
    for (const r of esito.fattura.righe) {
      console.log(
        `  riga ${r.numero}: ${r.data} ${r.riferimento} ${r.controparte} ` +
          `colli ${r.colli} peso ${r.peso} nolo ${r.nolo} supp ${r.supplementi} ` +
          `carb ${r.carburante} tot ${r.totale}`
      );
    }
    if (esito.fattura.righeNonLette.length > 0) {
      console.log("non lette:", esito.fattura.righeNonLette);
    }

    const numero = (s: string) => Number(String(s).replace(",", "."));

    expect(esito.fattura.righe).toHaveLength(veri.righe.length);
    expect(esito.fattura.righeNonLette).toEqual([]);

    esito.fattura.righe.forEach((letta, i) => {
      const vero = veri.righe[i];
      expect(letta.data, `riga ${i + 1} data`).toBe(
        String(vero.data).split("/").reverse().join("-")
      );
      expect(letta.riferimento, `riga ${i + 1} riferimento`).toBe(String(vero.rif));
      expect(letta.colli, `riga ${i + 1} colli`).toBe(Number(vero.colli));
      expect(letta.peso, `riga ${i + 1} peso`).toBe(numero(String(vero.peso)));
      expect(letta.nolo, `riga ${i + 1} nolo`).toBe(numero(String(vero.nolo)));
      expect(letta.supplementi, `riga ${i + 1} supplementi`).toBe(
        numero(String(vero.supp))
      );
      expect(letta.totale, `riga ${i + 1} totale`).toBe(numero(String(vero.tot)));
    });

    // I totali stampati sono il metro della quadratura: senza, non si può
    // dire se la lettura è completa.
    expect(esito.fattura.totali.totaleDocumento).toBe(numero(veri.totali.totale));
    expect(esito.fattura.totali.nolo).toBe(numero(veri.totali.nolo));

    // La somma delle righe deve coincidere con il totale stampato: è la
    // verifica che nessuna spedizione sia sfuggita.
    const somma =
      Math.round(
        esito.fattura.righe.reduce((a, r) => a + (r.totale ?? 0), 0) * 100
      ) / 100;
    expect(somma).toBe(numero(veri.totali.totale));

    // LA VERIFICA CHE CONTA: la quadratura contro i totali stampati. È il gate
    // dell'acquisizione, e l'unico controllo che dice se la lettura è
    // *completa* invece che soltanto plausibile — una riga saltata non si vede
    // guardando le righe lette.
    const q = quadra(esito.fattura);
    console.log(
      "quadratura:",
      q.ok,
      q.confronti.map((c) => `${c.voce} ${c.differenza}`).join(", ")
    );
    expect(q.ok, q.note.join(" ")).toBe(true);

    // L'immagine della pagina serve alla schermata di conferma.
    expect(esito.pagine[0].immagine.startsWith("data:image/png;base64,")).toBe(true);
  },
  600000
);
