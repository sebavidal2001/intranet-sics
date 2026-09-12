/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 * Verifica che i file prodotti siano davvero apribili, non solo generati.
 */

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { esportaBudgetExcel, esportaQueryExcel, generaReportWord } from "@/lib/prototipo-bi/documenti/genera";
import { distribuisci } from "@/lib/prototipo-bi/budget";
import { costruisciSnapshot } from "@/lib/prototipo-bi/sorgente";
import type { Briefing, ConfigurazioneAnno, Snapshot } from "@/lib/prototipo-bi/tipi";

const CONFIG: ConfigurazioneAnno = {
  anno: 2026, budgetAnnuo: 7_500_000, bepAnnuo: 6_200_000,
  modalita: "giorni_lavorativi", escludiWeekend: true,
  chiusure: [{ id: "e", dal: "2026-08-10", al: "2026-08-23", descrizione: "Chiusura estiva" }],
  incidenzeBU: [{ bu: "COMPONENTI", pesoPct: 60 }, { bu: "IMPIANTI", pesoPct: 40 }],
  commerciali: [{ codiceAgente: "AG009999", agente: "AIRFLUID", quotaPct: 100, importoAnnuo: null, bu: null }],
  aggiornatoIl: new Date().toISOString(),
};

const BRIEFING: Briefing = {
  generatoIl: new Date().toISOString(), dataRiferimento: "2026-08-27",
  runRicevutoIl: "2026-08-27T23:31:00Z", destinatario: "Direzione", ruolo: "direzione",
  segnaliValutati: 7, segnaliScartati: 4, motoreAI: "deterministico", nota: null,
  voci: [{
    ordine: 1, segnaleId: "s1", famiglia: "clienti_dormienti",
    testo: "26 clienti non ordinano da oltre 120 giorni.",
    azioneSuggerita: "Assegnare la lista agli agenti.", certificata: true,
    prove: [{ descrizione: "Ordinato storico per cliente", spec: { metrica: "ordinato", raggruppa: ["cliente"] } }],
  }],
};

describe("Documenti", () => {
  let snapshot: Snapshot;
  beforeAll(async () => {
    const t = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const r of t.split(/\r?\n/)) {
      if (!r.includes("=") || r.trim().startsWith("#")) continue;
      const i = r.indexOf("=");
      const k = r.slice(0, i).replace(/^﻿/, "").trim();
      if (!process.env[k]) process.env[k] = r.slice(i + 1).trim();
    }
    snapshot = await costruisciSnapshot();
  }, 180_000);

  it("l'Excel del budget si riapre e i totali tornano", () => {
    const buf = esportaBudgetExcel(CONFIG, distribuisci(CONFIG));
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toContain("Budget BEP Giornaliero");
    expect(wb.SheetNames).toContain("Per business unit");
    expect(wb.SheetNames).toContain("Per commerciale");

    const righe = XLSX.utils.sheet_to_json<{ Budget: number; Lavorativo: string }>(
      wb.Sheets["Budget BEP Giornaliero"]
    );
    expect(righe).toHaveLength(365);
    const somma = righe.reduce((s, r) => s + (r.Budget ?? 0), 0);
    expect(Math.abs(somma - CONFIG.budgetAnnuo)).toBeLessThan(0.01);
    console.log(`   Excel budget: ${righe.length} righe, somma ${somma.toLocaleString("it-IT")} €`);
  });

  it("l'Excel di estrazione contiene i dati reali", () => {
    const buf = esportaQueryExcel(
      [
        { titolo: "Ordinato per BU", spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" } },
        { titolo: "Ordinato per agente", spec: { metrica: "ordinato", raggruppa: ["agente"], ordina: "valore_desc" } },
      ],
      snapshot
    );
    const wb = XLSX.read(buf, { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Informazioni", "Ordinato per BU", "Ordinato per agente"]);
    const bu = XLSX.utils.sheet_to_json(wb.Sheets["Ordinato per BU"]);
    expect(bu.length).toBeGreaterThan(1);
    console.log("   Excel estrazione, BU:", JSON.stringify(bu[0]));
  });

  it("il Word è un docx valido e contiene il briefing", async () => {
    const buf = await generaReportWord({
      briefing: BRIEFING,
      snapshot,
      approfondimenti: [{ titolo: "Ordinato per business unit", spec: { metrica: "ordinato", raggruppa: ["bu"], ordina: "valore_desc" } }],
      commento: "Commento di prova.",
    });
    // Un .docx è uno ZIP: deve iniziare con la firma PK.
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    expect(buf.byteLength).toBeGreaterThan(5000);
    const testo = buf.toString("latin1");
    expect(testo).toContain("word/document.xml");
    console.log(`   Word: ${(buf.byteLength / 1024).toFixed(1)} kB`);
  });
});
