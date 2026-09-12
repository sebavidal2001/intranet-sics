/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Produzione di documenti: l'analista non risponde solo a schermo, consegna
 * file. Usa le librerie già presenti nel progetto (xlsx, docx) — nessuna
 * dipendenza nuova.
 */

import * as XLSX from "xlsx";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { esegui, formattaEuro } from "../semantico";
import type {
  Briefing,
  ConfigurazioneAnno,
  DistribuzioneBudget,
  RisultatoQuery,
  Snapshot,
  SpecQuery,
} from "../tipi";

const INTESTAZIONE_PROTOTIPO =
  "PROTOTIPO — NON IN PRODUZIONE · documento generato dal BI Direzionale SICS in fase di valutazione";

// ─────────────────────────────────────────────────────────────────────────────
// Excel
// ─────────────────────────────────────────────────────────────────────────────

function foglioDaRisultato(res: RisultatoQuery, titolo: string) {
  const chiavi = res.righe[0] ? Object.keys(res.righe[0].chiavi) : [];
  const righe = res.righe.map((r) => {
    const base: Record<string, string | number> = {};
    for (const k of chiavi) base[k] = r.chiavi[k] ?? "";
    if (chiavi.length === 0) base["Voce"] = r.etichetta;
    base[res.unita === "euro" ? "Valore (€)" : "Valore"] = r.valore;
    base["Righe"] = r.conteggio;
    return base;
  });
  const ws = XLSX.utils.json_to_sheet(righe);
  ws["!cols"] = [{ wch: 42 }, { wch: 18 }, { wch: 14 }, { wch: 10 }];
  void titolo;
  return ws;
}

/** Esporta una o più query certificate in un unico Excel. */
export function esportaQueryExcel(
  blocchi: { titolo: string; spec: SpecQuery }[],
  snapshot: Snapshot
): Buffer {
  const wb = XLSX.utils.book_new();

  const copertina = XLSX.utils.aoa_to_sheet([
    [INTESTAZIONE_PROTOTIPO],
    [],
    ["Generato il", new Date().toLocaleString("it-IT")],
    ["Dati aggiornati al", snapshot.dataMassima ?? "n/d"],
    ["Run pubblicato", snapshot.runCorrente ?? "n/d"],
    ["Ricevuto il", snapshot.runRicevutoIl ?? "n/d"],
    [],
    ["Fogli inclusi"],
    ...blocchi.map((b) => [b.titolo]),
  ]);
  copertina["!cols"] = [{ wch: 30 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, copertina, "Informazioni");

  const usati = new Set<string>();
  for (const b of blocchi) {
    const res = esegui(b.spec, snapshot);
    // I nomi foglio Excel: max 31 caratteri, niente caratteri speciali.
    let nome = b.titolo.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Foglio";
    let i = 2;
    while (usati.has(nome)) nome = `${nome.slice(0, 28)} ${i++}`;
    usati.add(nome);
    XLSX.utils.book_append_sheet(wb, foglioDaRisultato(res, b.titolo), nome);
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Esporta tabelle già calcolate (incluse query SQL esplorative) in Excel. */
export function esportaTabelleExcel(
  blocchi: { titolo: string; righe: Record<string, unknown>[]; natura: string }[],
  snapshot: Snapshot
): Buffer {
  const wb = XLSX.utils.book_new();
  const copertina = XLSX.utils.aoa_to_sheet([
    [INTESTAZIONE_PROTOTIPO],
    [],
    ["Generato il", new Date().toLocaleString("it-IT")],
    ["Dati commerciali aggiornati al", snapshot.dataMassima ?? "n/d"],
    ["Run pubblicato", snapshot.runCorrente ?? "n/d"],
    [],
    ["Foglio", "Natura"],
    ...blocchi.map((b) => [b.titolo, b.natura]),
  ]);
  copertina["!cols"] = [{ wch: 38 }, { wch: 42 }];
  XLSX.utils.book_append_sheet(wb, copertina, "Informazioni");

  const usati = new Set<string>();
  for (const b of blocchi) {
    const ws = XLSX.utils.json_to_sheet(b.righe.length ? b.righe : [{ Esito: "Nessuna riga" }]);
    ws["!cols"] = Object.keys(b.righe[0] ?? { Esito: "" }).map(() => ({ wch: 22 }));
    let nome = b.titolo.replace(/[\/?*[\]:]/g, " ").slice(0, 31) || "Foglio";
    let i = 2;
    while (usati.has(nome)) nome = `${nome.slice(0, 28)} ${i++}`;
    usati.add(nome);
    XLSX.utils.book_append_sheet(wb, ws, nome);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Esporta la distribuzione budget/BEP: sostituisce i tre Excel manuali. */
export function esportaBudgetExcel(
  config: ConfigurazioneAnno,
  d: DistribuzioneBudget
): Buffer {
  const wb = XLSX.utils.book_new();

  const riepilogo = XLSX.utils.aoa_to_sheet([
    [INTESTAZIONE_PROTOTIPO],
    [],
    ["Anno", config.anno],
    ["Budget annuo (€)", config.budgetAnnuo],
    ["BEP annuo (€)", config.bepAnnuo],
    ["Modalità", config.modalita === "giorni_lavorativi" ? "Per giorni lavorativi" : "Lineare per mese"],
    ["Giorni lavorativi", d.giorniLavorativi],
    ["Budget giornaliero (€)", d.budgetGiornaliero],
    ["BEP giornaliero (€)", d.bepGiornaliero],
    [],
    ["Chiusure aziendali"],
    ["Dal", "Al", "Descrizione"],
    ...config.chiusure.map((c) => [c.dal, c.al, c.descrizione]),
    [],
    ["Incidenza business unit"],
    ["Business unit", "Peso %", "Budget annuo (€)"],
    ...config.incidenzeBU.map((i) => [
      i.bu,
      i.pesoPct,
      Math.round((config.budgetAnnuo * i.pesoPct) / 100),
    ]),
  ]);
  riepilogo["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 34 }];
  XLSX.utils.book_append_sheet(wb, riepilogo, "Riepilogo");

  const giornaliero = XLSX.utils.json_to_sheet(
    d.giorni.map((g) => ({
      Data: g.data,
      Anno: g.anno,
      Mese: g.mese,
      AnnoSettimana: g.settimanaIso,
      Lavorativo: g.lavorativo ? "SI" : "NO",
      Budget: g.budget,
      BEP: g.bep,
    }))
  );
  XLSX.utils.book_append_sheet(wb, giornaliero, "Budget BEP Giornaliero");

  if (d.perBU.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        d.perBU.map((r) => ({ Data: r.data, Area: r.chiave, Budget: r.budget, BEP: r.bep }))
      ),
      "Per business unit"
    );
  }

  if (d.perAgente.length > 0) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        d.perAgente.map((r) => ({ Data: r.data, Agente: r.chiave, Budget: r.budget, BEP: r.bep }))
      ),
      "Per commerciale"
    );
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Word
// ─────────────────────────────────────────────────────────────────────────────

function p(testo: string, opzioni: { grassetto?: boolean; size?: number; colore?: string } = {}) {
  return new Paragraph({
    children: [
      new TextRun({
        text: testo,
        bold: opzioni.grassetto,
        size: opzioni.size ?? 22,
        color: opzioni.colore,
        font: "Calibri",
      }),
    ],
    spacing: { after: 120 },
  });
}

function tabella(intestazioni: string[], righe: (string | number)[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: intestazioni.map(
          (h) =>
            new TableCell({
              children: [p(h, { grassetto: true, size: 20 })],
              shading: { fill: "E2E8F0" },
            })
        ),
      }),
      ...righe.map(
        (r) =>
          new TableRow({
            children: r.map(
              (c) => new TableCell({ children: [p(String(c), { size: 20 })] })
            ),
          })
      ),
    ],
  });
}

/** Report direzionale in Word a partire dal briefing e da query certificate. */
export async function generaReportWord(opzioni: {
  briefing: Briefing;
  snapshot: Snapshot;
  approfondimenti?: { titolo: string; spec: SpecQuery }[];
  approfondimentiSql?: { titolo: string; righe: Record<string, unknown>[] }[];
  commento?: string | null;
}): Promise<Buffer> {
  const { briefing, snapshot } = opzioni;

  const figli: (Paragraph | Table)[] = [
    new Paragraph({
      children: [
        new TextRun({
          text: INTESTAZIONE_PROTOTIPO,
          bold: true,
          size: 16,
          color: "B91C1C",
          font: "Calibri",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    new Paragraph({
      text: "Briefing direzionale",
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }),
    p(
      `Destinatario: ${briefing.destinatario} · Dati aggiornati al ${briefing.dataRiferimento}` +
        (briefing.runRicevutoIl
          ? ` · Caricamento del ${new Date(briefing.runRicevutoIl).toLocaleString("it-IT")}`
          : ""),
      { size: 18, colore: "64748B" }
    ),
    p(
      `Segnali valutati: ${briefing.segnaliValutati} · selezionati: ${briefing.voci.length} · ` +
        `redazione: ${briefing.motoreAI === "openrouter" ? "assistita" : "deterministica"}`,
      { size: 18, colore: "64748B" }
    ),
  ];

  if (briefing.voci.length === 0) {
    figli.push(p("Nessun segnale rilevante nel periodo. Il silenzio è un risultato valido."));
  }

  for (const v of briefing.voci) {
    figli.push(
      new Paragraph({
        text: `${v.ordine}. ${v.famiglia.replace(/_/g, " ")}`,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 80 },
      })
    );
    figli.push(p(v.testo));
    if (v.azioneSuggerita) {
      figli.push(p(`Azione suggerita: ${v.azioneSuggerita}`, { grassetto: true }));
    }
    if (v.prove.length > 0) {
      figli.push(
        p(
          `Verificabile con: ${v.prove.map((pr) => pr.descrizione).join("; ")}`,
          { size: 18, colore: "64748B" }
        )
      );
    }
  }

  if (opzioni.commento) {
    figli.push(
      new Paragraph({ text: "Commento", heading: HeadingLevel.HEADING_2, spacing: { before: 240 } })
    );
    for (const riga of opzioni.commento.split("\n").filter(Boolean)) figli.push(p(riga));
  }

  for (const a of opzioni.approfondimenti ?? []) {
    const res = esegui(a.spec, snapshot);
    figli.push(
      new Paragraph({ text: a.titolo, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
    );
    figli.push(
      tabella(
        ["Voce", res.unita === "euro" ? "Valore" : "Quantità"],
        res.righe
          .slice(0, 20)
          .map((r) => [
            r.etichetta,
            res.unita === "euro" ? formattaEuro(r.valore) : String(r.valore),
          ])
      )
    );
    figli.push(
      p(
        `Totale: ${res.unita === "euro" ? formattaEuro(res.totale) : res.totale}`,
        { grassetto: true }
      )
    );
  }

  for (const a of opzioni.approfondimentiSql ?? []) {
    const intestazioni = Object.keys(a.righe[0] ?? {}).slice(0, 8);
    figli.push(
      new Paragraph({ text: a.titolo, heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 } })
    );
    if (intestazioni.length === 0) {
      figli.push(p("La query non ha restituito righe."));
    } else {
      figli.push(
        tabella(
          intestazioni,
          a.righe.slice(0, 20).map((r) => intestazioni.map((h) => String(r[h] ?? "").slice(0, 90)))
        )
      );
      if (a.righe.length > 20) figli.push(p(`Mostrate 20 righe su ${a.righe.length}.`, { size: 18, colore: "64748B" }));
    }
    figli.push(p("Fonte: SQL esplorativo di sola lettura sulle viste BI autorizzate.", { size: 18, colore: "B45309" }));
  }

  figli.push(
    p(
      "Le metriche certificate e le eventuali query SQL esplorative sono indicate separatamente " +
        "e rieseguibili. Il documento è prodotto da un prototipo non ancora in produzione.",
      { size: 16, colore: "64748B" }
    )
  );

  const doc = new Document({ sections: [{ children: figli }] });
  return Packer.toBuffer(doc);
}
