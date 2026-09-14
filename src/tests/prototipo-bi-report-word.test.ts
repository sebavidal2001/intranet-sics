/**
 * Il report Word: quattro metriche per mese devono uscire come UNA tabella di
 * confronto, non come quattro tabelle scollegate.
 *
 * Il difetto che questi test presidiano e' quello del report del 12/09/2026:
 * un blocco intitolato «Ordinato vs BEP e Budget per Mese» produceva una
 * tabella con la sola colonna "Valore", e le altre metriche finivano in
 * tabelle separate piu' sotto — impossibile leggerci un confronto.
 */

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { generaReportWord } from "@/lib/prototipo-bi/documenti/genera";
import { serieDaConfigurazione } from "@/lib/prototipo-bi/budget-fonte";
import { configurazioneVuota } from "@/lib/prototipo-bi/budget";
import { validaSpec } from "@/lib/prototipo-bi/semantico";
import type { Briefing, RigaFatto, Snapshot } from "@/lib/prototipo-bi/tipi";

const ANNO = 2026;

function riga(data: string, importo: number, over: Partial<RigaFatto> = {}): RigaFatto {
  return {
    data,
    importo,
    bu: "SISTEMI",
    categoria: "X",
    agente: "MARIO ROSSI",
    codiceAgente: "A01",
    cliente: "CLIENTE UNO",
    codiceCliente: "C01",
    documento: `D-${data}-${importo}`,
    articolo: "ART-1",
    descrizioneArticolo: "Articolo",
    quantita: 1,
    costoUnitario: null,
    dataCosto: null,
    ...over,
  };
}

function snapshot(): Snapshot {
  const vuoto: RigaFatto[] = [];
  return {
    generatoIl: new Date().toISOString(),
    runCorrente: "run-test",
    runRicevutoIl: new Date().toISOString(),
    dataMassima: `${ANNO}-03-31`,
    dataMinima: `${ANNO}-01-01`,
    dataset: {
      ordinato: [riga(`${ANNO}-01-15`, 100_000), riga(`${ANNO}-02-16`, 250_000)],
      fatturato: [riga(`${ANNO}-01-20`, 80_000), riga(`${ANNO}-02-20`, 200_000)],
      consegnato: vuoto,
      portafoglio: vuoto,
      preventivi_aperti: vuoto,
      controllo_banco: vuoto,
      consegnato_futuro_per_mese: vuoto,
    },
    conteggi: {},
    serieBudget: {
      [ANNO]: serieDaConfigurazione({
        ...configurazioneVuota(ANNO),
        budgetAnnuo: 6_000_000,
        bepAnnuo: 4_800_000,
      }),
    },
  };
}

const briefing: Briefing = {
  generatoIl: new Date().toISOString(),
  dataRiferimento: `${ANNO}-03-31`,
  runRicevutoIl: null,
  destinatario: "Super Admin",
  ruolo: "direzione",
  voci: [],
  segnaliValutati: 0,
  segnaliScartati: 0,
  motoreAI: "deterministico",
  nota: null,
};

function specMese(metrica: string) {
  return validaSpec({
    metrica,
    granularita: "mese",
    periodo: { dal: `${ANNO}-01-01`, al: `${ANNO}-03-31` },
    ordina: "etichetta",
  });
}

/** Estrae il testo delle tabelle: una riga di output per riga di tabella. */
async function tabelleDelDocumento(buffer: Buffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");
  const tabelle = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
  return tabelle.map((t) =>
    (t.match(/<w:tr[\s\S]*?<\/w:tr>/g) ?? []).map((r) =>
      (r.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? [])
        .map((c) => (c.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
          .map((x) => x.replace(/<[^>]+>/g, ""))
          .join(""))
        .join(" | ")
    )
  );
}

describe("report Word", () => {
  it("unisce in UNA tabella le metriche con la stessa forma", async () => {
    const buffer = await generaReportWord({
      briefing,
      snapshot: snapshot(),
      approfondimenti: [
        { titolo: "Ordinato vs BEP e Budget per Mese", spec: specMese("ordinato") },
        { titolo: "Fatturato per Mese", spec: specMese("fatturato") },
        { titolo: "Punto di Pareggio (BEP) Mensile", spec: specMese("bep") },
        { titolo: "Budget Mensile", spec: specMese("budget") },
      ],
    });

    const tabelle = await tabelleDelDocumento(buffer);
    expect(tabelle).toHaveLength(1);

    const [intestazione, ...righe] = tabelle[0];
    expect(intestazione).toContain("Mese");
    for (const atteso of ["Ordinato (€)", "Fatturato (€)", "BEP (€)", "Budget (€)"]) {
      expect(intestazione).toContain(atteso);
    }

    // Gennaio: ordinato 100.000 e fatturato 80.000 sono diversi fra loro e
    // diversi da BEP e budget. E' il controllo che il report di stamattina
    // avrebbe fallito.
    const gennaio = righe.find((r) => r.startsWith(`${ANNO}-01`))!;
    const celle = gennaio.split(" | ").map((c) => c.trim());
    expect(new Set(celle.slice(1)).size).toBe(4);
  });

  it("NON unisce blocchi con filtri diversi, che non sono confrontabili", async () => {
    const conFiltro = (bu: string) =>
      validaSpec({
        metrica: "ordinato",
        granularita: "mese",
        periodo: { dal: `${ANNO}-01-01`, al: `${ANNO}-03-31` },
        filtri: [{ campo: "bu", op: "eq", valore: bu }],
      });

    const buffer = await generaReportWord({
      briefing,
      snapshot: snapshot(),
      approfondimenti: [
        { titolo: "Ordinato SISTEMI", spec: conFiltro("SISTEMI") },
        { titolo: "Ordinato COSTRUITO", spec: conFiltro("COSTRUITO") },
      ],
    });

    expect(await tabelleDelDocumento(buffer)).toHaveLength(2);
  });

  it("tiene le voci presenti in una sola metrica, con la cella vuota", async () => {
    const s = snapshot();
    // Marzo esiste nel budget/BEP ma non negli ordini.
    const buffer = await generaReportWord({
      briefing,
      snapshot: s,
      approfondimenti: [
        { titolo: "Ordinato", spec: specMese("ordinato") },
        { titolo: "BEP", spec: specMese("bep") },
      ],
    });

    const righe = (await tabelleDelDocumento(buffer))[0];
    const marzo = righe.find((r) => r.startsWith(`${ANNO}-03`));
    expect(marzo).toBeDefined();
    expect(marzo).toContain("—");
  });

  it("mette in chiaro la metrica anche quando il titolo promette altro", async () => {
    const buffer = await generaReportWord({
      briefing,
      snapshot: snapshot(),
      approfondimenti: [
        { titolo: "Copertura Costi e Marginalità per Mese", spec: specMese("ordinato") },
      ],
    });
    const zip = await JSZip.loadAsync(buffer);
    const xml = (await zip.file("word/document.xml")!.async("string")).replace(/<[^>]+>/g, "");

    expect(xml).toContain("Ordinato (€)");
    expect(xml).toContain("Metrica certificata: Ordinato");
  });
});
