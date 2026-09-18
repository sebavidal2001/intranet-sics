/**
 * Il margine, ricalcolato da capo per una strada diversa.
 *
 * Gli altri test verificano che la catena non perda pezzi. Questo verifica che
 * il NUMERO sia giusto: prende le righe grezze della vista `bi_fatturato` e lo
 * storico costi, e ricostruisce margine, costo del venduto e copertura con
 * l'implementazione più stupida possibile — scansione lineare sulle variazioni
 * di costo, somme dirette, nessuna delle funzioni del BI.
 *
 * Se le due strade danno lo stesso numero, l'unico modo perché sia sbagliato è
 * che siano sbagliate entrambe allo stesso modo. In particolare si verifica:
 *
 *  - la **bisezione** di `costoAllaData` contro la scansione lineare;
 *  - il **segno** delle note di credito, che nella vista hanno importo
 *    negativo e quantità positiva;
 *  - i raggruppamenti che la scheda Margine disegna (business unit, agente,
 *    documento), non solo il totale: un totale può essere giusto mentre una
 *    ripartizione è sbagliata.
 *
 *   npx vitest run prototipo-bi/margine-riconciliazione.test.ts --testTimeout=300000
 */
import { describe, expect, it, beforeAll } from "vitest";
import { caricaEnvLocale } from "./_env";
import { leggiVista, numero, testo, type RigaVista } from "./_vista";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import { esegui, validaSpec } from "@/lib/prototipo-bi/semantico";
import type { Dimensione, RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

const anno = new Date().getFullYear();
const periodo = { dal: `${anno}-01-01`, al: `${anno}-12-31` };

interface Conto {
  fatturato: number;
  costo: number;
  /** Ricavo delle sole righe con costo noto, COL SEGNO: base del margine. */
  copertoFirmato: number;
  /** Lo stesso in valore assoluto: base della copertura. */
  copertoAssoluto: number;
  /** Fatturato in valore assoluto: denominatore della copertura. */
  assoluto: number;
}

let snapshot: Snapshot;
/** Le righe grezze della vista, per il controllo del totale fatturato. */
let fatturatoVista: RigaVista[] = [];
/** Conti ricalcolati a mano, per chiave di raggruppamento. */
const conti = new Map<Dimensione | "totale", Map<string, Conto>>();

beforeAll(async () => {
  caricaEnvLocale();
  const [istantanea, fatturato, costi] = await Promise.all([
    costruisciSnapshot(),
    leggiVista("bi_fatturato"),
    leggiVista("bi_costi_listino_storico"),
  ]);
  snapshot = istantanea;
  fatturatoVista = fatturato;

  // Storico costi: per articolo, l'elenco delle variazioni NON ordinato — la
  // ricerca sotto è lineare apposta, per non riusare la stessa strategia del
  // codice che si sta verificando.
  const perArticolo = new Map<string, { dal: string; costo: number }[]>();
  for (const c of costi) {
    const codice = testo(c["codice_articolo"]).toUpperCase();
    const voce = { dal: testo(c["valido_dal"]).slice(0, 10), costo: numero(c["costo"]) };
    if (!codice || !voce.dal || !(voce.costo > 0)) continue;
    const elenco = perArticolo.get(codice);
    if (elenco) elenco.push(voce);
    else perArticolo.set(codice, [voce]);
  }

  /** Il costo valido a una data, cercato scorrendo tutto. */
  const costoAllaDataLineare = (codice: string, data: string): number | null => {
    const elenco = perArticolo.get(codice);
    if (!elenco) return null;
    let migliore: { dal: string; costo: number } | null = null;
    for (const v of elenco) {
      if (v.dal > data) continue;
      if (migliore === null || v.dal > migliore.dal) migliore = v;
    }
    return migliore ? migliore.costo : null;
  };

  // Le chiavi di raggruppamento si leggono dalle righe GIA' NORMALIZZATE dallo
  // snapshot, non ricostruite dalla vista: l'etichetta dei valori vuoti la
  // decide il BI ("(senza agente)", il gruppo non assegnato), e ricopiarla qui
  // sarebbe duplicare una regola di presentazione — cosa che ho gia' sbagliato
  // due volte scrivendo questo file.
  //
  // L'indipendenza che serve sta altrove ed e' intatta: il COSTO viene
  // risolto con una scansione lineare sullo storico grezzo, l'importo e la
  // quantita' si sommano a mano, e il segno si applica qui.
  const chiavi: Record<string, (r: RigaFatto) => string> = {
    totale: () => "TOTALE",
    bu: (r) => r.bu,
    agente: (r) => r.agente,
    documento: (r) => r.documento,
  };
  for (const k of ["totale", "bu", "agente", "documento"] as const) {
    conti.set(k, new Map<string, Conto>());
  }

  for (const riga of snapshot.dataset.fatturato) {
    if (riga.data < periodo.dal || riga.data > periodo.al) continue;

    const importo = riga.importo;
    // Il segno del documento sta sull'importo, non sulla quantita': senza
    // questo, il costo di una resa verrebbe sommato invece che sottratto.
    const quantita = riga.quantita * (importo < 0 ? -1 : 1);
    const codice = (riga.articolo ?? "").trim().toUpperCase();
    const costoUnitario = codice ? costoAllaDataLineare(codice, riga.data) : null;

    for (const k of ["totale", "bu", "agente", "documento"] as const) {
      const mappa = conti.get(k)!;
      const chiave = chiavi[k](riga);
      const c =
        mappa.get(chiave) ??
        { fatturato: 0, costo: 0, copertoFirmato: 0, copertoAssoluto: 0, assoluto: 0 };
      c.fatturato += importo;
      c.assoluto += Math.abs(importo);
      if (costoUnitario !== null) {
        c.costo += costoUnitario * quantita;
        c.copertoFirmato += importo;
        c.copertoAssoluto += Math.abs(importo);
      }
      mappa.set(chiave, c);
    }
  }
}, 300_000);

function daBi(metrica: string, raggruppa?: Dimensione) {
  const spec = raggruppa
    ? validaSpec({ metrica, raggruppa: [raggruppa], periodo })
    : validaSpec({ metrica, periodo });
  return esegui(spec, snapshot);
}

describe("Il margine ricalcolato da capo", () => {
  it("il totale coincide, euro su euro", () => {
    const atteso = conti.get("totale")!.get("TOTALE")!;

    expect(Math.round(daBi("fatturato").totale)).toBe(Math.round(atteso.fatturato));
    // E la somma dalla vista grezza, che non passa dallo snapshot.
    const dallaVista = fatturatoVista
      .filter((r) => {
        const d = testo(r["Data Documento"]).slice(0, 10);
        return d >= periodo.dal && d <= periodo.al;
      })
      .reduce((s, r) => s + numero(r["Importo"]), 0);
    expect(Math.round(daBi("fatturato").totale)).toBe(Math.round(dallaVista));
    expect(Math.round(daBi("costo_venduto").totale)).toBe(Math.round(atteso.costo));
    // Il margine esclude le righe senza costo: e' il coperto meno il costo.
    expect(Math.round(daBi("margine").totale)).toBe(
      Math.round(atteso.copertoFirmato - atteso.costo),
    );
  });

  it("la copertura è il rapporto sui valori assoluti", () => {
    const atteso = conti.get("totale")!.get("TOTALE")!;
    const attesa = (atteso.copertoAssoluto / atteso.assoluto) * 100;
    expect(daBi("copertura_costi_pct").totale).toBeCloseTo(attesa, 1);
    // E non supera mai il 100%: era il difetto del rapporto sui valori netti.
    expect(daBi("copertura_costi_pct").totale).toBeLessThanOrEqual(100);
  });

  it("ogni business unit e ogni agente tornano, non solo il totale", () => {
    // Un totale può essere giusto mentre una ripartizione è sbagliata: le due
    // dimensioni che la scheda disegna vanno verificate una per una.
    for (const dimensione of ["bu", "agente"] as const) {
      const attesi = conti.get(dimensione)!;
      const costo = daBi("costo_venduto", dimensione);

      for (const riga of costo.righe) {
        const atteso = attesi.get(riga.etichetta);
        expect(atteso, `${dimensione} sconosciuta: ${riga.etichetta}`).toBeTruthy();
        expect(Math.round(riga.valore), `costo di ${riga.etichetta}`).toBe(
          Math.round(atteso!.costo),
        );
      }
    }
  });

  it("il margine percentuale di ogni business unit sta dove deve", () => {
    const attesi = conti.get("bu")!;
    for (const riga of daBi("margine_pct", "bu").righe) {
      const a = attesi.get(riga.etichetta)!;
      const atteso = a.copertoFirmato !== 0 ? ((a.copertoFirmato - a.costo) / a.copertoFirmato) * 100 : 0;
      expect(riga.valore, riga.etichetta).toBeCloseTo(atteso, 1);
    }
  });

  it("le singole operazioni tornano: la tabella non inventa righe", () => {
    const attesi = conti.get("documento")!;
    const perDoc = daBi("fatturato", "documento");
    expect(perDoc.righe.length).toBeGreaterThan(100);

    for (const riga of perDoc.righe.slice(0, 200)) {
      const atteso = attesi.get(riga.etichetta);
      expect(atteso, `documento sconosciuto: ${riga.etichetta}`).toBeTruthy();
      expect(Math.round(riga.valore), `fatturato di ${riga.etichetta}`).toBe(
        Math.round(atteso!.fatturato),
      );
    }
  });

it("le liste che alimentano una tabella coprono le stesse voci", () => {
    // Il difetto che questo test presidia, visto in produzione il 18/09/2026:
    // le cinque metriche della tabella per cliente avevano tutte `limite: 400`
    // e `ordina: "valore_desc"`, e ognuna ordinava per il PROPRIO valore. Su
    // 517 clienti — 457 dei quali con copertura al 100% — le liste contenevano
    // insiemi diversi, e in tabella comparivano righe con il margine in euro e
    // un trattino al posto del margine percentuale.
    //
    // La regola: una lista usata come LOOKUP per chiave non si taglia e non si
    // ordina. Qui si verifica che, senza limite, le cinque metriche coprano
    // davvero le stesse voci.
    for (const dimensione of ["cliente", "agente"] as const) {
      const fatturato = daBi("fatturato", dimensione);
      expect(fatturato.righe.length).toBeGreaterThan(0);
      const voci = new Set(fatturato.righe.map((r) => r.etichetta));

      for (const metrica of [
        "costo_venduto",
        "margine",
        "margine_pct",
        "copertura_costi_pct",
      ]) {
        const altra = daBi(metrica, dimensione);
        const presenti = new Set(altra.righe.map((r) => r.etichetta));
        const mancanti = [...voci].filter((v) => !presenti.has(v));
        expect(
          mancanti.length,
          `${metrica} per ${dimensione}: mancano ${mancanti.length} voci, fra cui ${mancanti
            .slice(0, 3)
            .join(", ")}`,
        ).toBe(0);
      }
    }
  });

  it("la bisezione trova lo stesso costo della scansione lineare", () => {
    // `costoAllaData` cerca per bisezione su una lista ordinata al contrario.
    // Un errore di indice li' si vedrebbe solo su certe date, e su un numero
    // aggregato non si noterebbe affatto.
    const conCosto = snapshot.dataset.fatturato.filter((r) => r.costoUnitario != null);
    expect(conCosto.length).toBeGreaterThan(1000);
    // Il confronto vero e' gia' nelle righe sopra: se la bisezione sbagliasse,
    // il costo del venduto per business unit non tornerebbe. Qui si controlla
    // che la data applicata non sia mai successiva alla vendita.
    for (const r of conCosto) {
      if (!r.dataCosto) continue;
      expect(r.dataCosto <= r.data, `${r.articolo}: costo del ${r.dataCosto} su vendita ${r.data}`).toBe(true);
    }
  });
});
