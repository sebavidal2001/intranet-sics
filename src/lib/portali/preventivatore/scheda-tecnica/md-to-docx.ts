// ─── Convertitore markdown → Word (.docx) — layout SICS ──────────────────────
// Trasforma il markdown della scheda tecnica in un Word brandizzato SICS:
//  - font Tenorite (font aziendale)
//  - header con logo SICS, footer con banda contatti + numero pagina
//  - gerarchia titoli pulita (intestazione, "Descrizione fornitura",
//    "CARATTERISTICHE TECNICHE ...", "Compreso/Escluso nella fornitura")
//  - righe orizzontali vere (`---`), elenchi puntati, grassetto/corsivo
//  - IMMAGINI: sintassi markdown `![didascalia](data:image/...;base64,...)`
//    → immagine centrata con didascalia (le foto/schemi allegati finiscono qui,
//    nel punto del testo in cui sono inserite).
//
// Gira lato client (dialog): logo/banda sono base64 inline (assets.ts).

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Header,
  Footer,
  PageNumber,
  HeadingLevel,
  AlignmentType,
  VerticalAlign,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";
import { SICS_HEADER } from "./assets";

const FONT = "Tenorite";
const AZ = "00A1BE";       // azzurro SICS
const DARK = "1A202C";
const GREY = "64748B";
const SLATE = "475569";    // nome azienda footer
const MUTED = "94A3B8";    // contatti footer
const FAINT = "CBD5E1";    // "by airfluid"
const BAND = "F4FAFB";     // sfondo banda footer (cyan chiarissimo)

// Contatti aziendali (dal letterhead SICS/Airfluid), distribuiti come testo.
const CONTATTI = {
  azienda: "Airfluid s.r.l.",
  indirizzo: " — via Fornace 26, 40023 Castel Guelfo (BO)",
  riga2: "+39 0542 670 543    ·    s-ics@s-ics.com    ·    P.IVA 00683421200",
  web: "www.s-ics.com",
  byline: "by airfluid",
};

// ─── Util base64 → Uint8Array (browser-safe) ─────────────────────────────────
function b64ToBytes(b64: string): Uint8Array {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─── Inline parser (grassetto **, corsivo _) ─────────────────────────────────
interface InlineSpan { text: string; bold?: boolean; italic?: boolean }
function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let i = 0, current = "", bold = false, italic = false;
  const flush = () => { if (current) { spans.push({ text: current, bold: bold || undefined, italic: italic || undefined }); current = ""; } };
  while (i < text.length) {
    if (text[i] === "*" && text[i + 1] === "*") { flush(); bold = !bold; i += 2; continue; }
    if (text[i] === "_") { flush(); italic = !italic; i += 1; continue; }
    current += text[i]; i += 1;
  }
  flush();
  return spans.length > 0 ? spans : [{ text }];
}
function inlineToRuns(text: string, opts?: { size?: number; color?: string }): TextRun[] {
  return parseInline(text).map(
    (s) => new TextRun({ text: s.text, bold: s.bold, italics: s.italic, font: FONT, size: opts?.size ?? 22, color: opts?.color })
  );
}

// ─── Tabelle markdown ────────────────────────────────────────────────────────
function isTableHeaderSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}
function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
function buildTable(headerCells: string[], rows: string[][]): Table {
  const totalCols = Math.max(headerCells.length, ...rows.map((r) => r.length));
  const b = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
  const borders = { top: b, bottom: b, left: b, right: b, insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" }, insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" } };
  const buildCell = (text: string, bold: boolean): TableCell =>
    new TableCell({
      width: { size: Math.floor(9000 / totalCols), type: WidthType.DXA },
      shading: bold ? { fill: "EAF7FA" } : undefined,
      children: [new Paragraph({ children: parseInline(text).map((s) => new TextRun({ text: s.text, bold: bold || s.bold, italics: s.italic, font: FONT, size: 20 })) })],
    });
  const headerRow = new TableRow({ tableHeader: true, children: Array.from({ length: totalCols }).map((_, i) => buildCell(headerCells[i] ?? "", true)) });
  const dataRows = rows.map((r) => new TableRow({ children: Array.from({ length: totalCols }).map((_, i) => buildCell(r[i] ?? "", false)) }));
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders, rows: [headerRow, ...dataRows] });
}

// ─── Riconoscitori riga ──────────────────────────────────────────────────────
const RE_HR = /^(-{3,}|\*{3,}|_{3,})$/;
const RE_IMG = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const RE_SECTION = /^(descrizione fornitura|caratteristiche tecniche.*|compreso nella fornitura|escluso dalla fornitura|compreso e escluso dalla fornitura|layout preliminare|note)\s*:?\s*$/i;
const RE_OGGETTO = /^oggetto\s*:/i;
const RE_SPETT = /^(spett\.?le|alla c\.?a\.?|offerta n)/i;

/** Immagine da data-URI base64: ritorna { bytes, w, h } o null (URL http non supportati sync). */
function parseImageMarkdown(line: string): { alt: string; bytes: Uint8Array; type: "png" | "jpg" | "gif" } | null {
  const m = line.match(RE_IMG);
  if (!m) return null;
  const alt = m[1];
  const src = m[2].trim();
  const dm = src.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/i);
  if (!dm) return null; // solo data-URI (le foto allegate saranno passate così)
  const fmt = dm[1].toLowerCase();
  const type = fmt === "gif" ? "gif" : fmt === "png" ? "png" : "jpg";
  try {
    return { alt, bytes: b64ToBytes(dm[2]), type };
  } catch {
    return null;
  }
}

// ─── Convertitore principale ─────────────────────────────────────────────────
export async function markdownToDocxBuffer(opts: {
  titoloDocumento: string;
  intestazione?: string; // non renderizzato: l'intestazione (Spett.le/Oggetto) è nel markdown
  markdown: string;
}): Promise<Uint8Array> {
  const lines = opts.markdown.replace(/\r\n/g, "\n").split("\n");
  const children: Array<Paragraph | Table> = [];

  const sezione = (text: string) =>
    new Paragraph({
      spacing: { before: 260, after: 120 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: AZ, space: 2 } },
      children: [new TextRun({ text: text.replace(/\s*:\s*$/, ""), bold: true, font: FONT, size: 26, color: AZ, allCaps: false })],
    });

  let i = 0;
  let primoParagrafo = true;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { children.push(new Paragraph({ children: [], spacing: { before: 40, after: 40 } })); i += 1; continue; }

    // Riga orizzontale (---) → sottile separatore azzurro
    if (RE_HR.test(trimmed)) {
      children.push(new Paragraph({ spacing: { before: 40, after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "D9E7EA", space: 1 } }, children: [] }));
      i += 1; continue;
    }

    // Immagine (data-URI) → centrata + didascalia
    const img = parseImageMarkdown(trimmed);
    if (img) {
      children.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 160, after: 40 },
        children: [new ImageRun({ type: img.type, data: img.bytes, transformation: { width: 460, height: 300 } })],
      }));
      if (img.alt) children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: img.alt, italics: true, font: FONT, size: 18, color: GREY })] }));
      i += 1; continue;
    }

    // Heading markdown (# ## ###)
    const h1 = trimmed.match(/^#\s+(.+)$/);
    const h2 = trimmed.match(/^##\s+(.+)$/);
    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h1) { children.push(sezione(h1[1])); i += 1; continue; }
    if (h2) { children.push(sezione(h2[1])); i += 1; continue; }
    if (h3) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 }, children: inlineToRuns(h3[1], { size: 24, color: DARK }) }));
      i += 1; continue;
    }

    // Etichette di sezione SICS (anche senza markdown) → sub-heading brandizzato
    const puro = trimmed.replace(/\*\*/g, "");
    if (RE_SECTION.test(puro)) { children.push(sezione(puro)); i += 1; continue; }

    // "Oggetto:" → riga in risalto
    if (RE_OGGETTO.test(puro)) {
      children.push(new Paragraph({ spacing: { before: 80, after: 160 }, children: inlineToRuns(puro, { size: 24, color: DARK }) }));
      i += 1; continue;
    }

    // Tabella
    if (/^\|.+\|\s*$/.test(trimmed) && lines[i + 1] && isTableHeaderSeparator(lines[i + 1])) {
      const header = splitRow(trimmed);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|\s*$/.test(lines[i].trim())) { rows.push(splitRow(lines[i])); i += 1; }
      children.push(buildTable(header, rows));
      children.push(new Paragraph({ children: [], spacing: { after: 120 } }));
      continue;
    }

    // Elenco puntato
    if (/^[-*]\s+/.test(trimmed)) {
      children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: inlineToRuns(trimmed.replace(/^[-*]\s+/, "")) }));
      i += 1; continue;
    }

    // Paragrafo. I primi (intestazione Spett.le/Alla c.a.) restano allineati a sx;
    // gli altri giustificati per una resa pulita.
    const isIntest = RE_SPETT.test(puro);
    children.push(new Paragraph({
      spacing: { after: isIntest ? 20 : 120 },
      alignment: isIntest || primoParagrafo ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
      children: inlineToRuns(trimmed),
    }));
    if (!isIntest) primoParagrafo = false;
    i += 1;
  }

  // ── Header: logo SICS + ISO + filo cyan coordinato ──
  const header = new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: 60 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: AZ, space: 6 } },
        children: [new ImageRun({ type: "png", data: b64ToBytes(SICS_HEADER.b64), transformation: { width: SICS_HEADER.width, height: SICS_HEADER.height } })],
      }),
    ],
  });

  // ── Footer: banda accento cyan (Proposta C) — contatti a sx, web + pagina a dx ──
  const noBorder = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
  const footerCell = (align: (typeof AlignmentType)[keyof typeof AlignmentType], paras: Paragraph[]) =>
    new TableCell({
      verticalAlign: VerticalAlign.CENTER,
      shading: { fill: BAND },
      margins: { top: 90, bottom: 90, left: 160, right: 160 },
      borders: { top: { style: BorderStyle.SINGLE, size: 12, color: AZ }, bottom: noBorder, left: noBorder, right: noBorder },
      children: paras.map((p) => p),
      width: { size: align === AlignmentType.RIGHT ? 30 : 70, type: WidthType.PERCENTAGE },
    });

  const footerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
    columnWidths: [6300, 2700],
    rows: [new TableRow({ children: [
      footerCell(AlignmentType.LEFT, [
        new Paragraph({ spacing: { after: 20 }, children: [
          new TextRun({ text: CONTATTI.azienda, bold: true, font: FONT, size: 17, color: SLATE }),
          new TextRun({ text: CONTATTI.indirizzo, font: FONT, size: 17, color: MUTED }),
        ] }),
        new Paragraph({ children: [new TextRun({ text: CONTATTI.riga2, font: FONT, size: 17, color: MUTED })] }),
      ]),
      footerCell(AlignmentType.RIGHT, [
        new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 10 }, children: [new TextRun({ text: CONTATTI.web, bold: true, font: FONT, size: 18, color: AZ })] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 10 }, children: [new TextRun({ text: CONTATTI.byline, font: FONT, size: 15, color: FAINT })] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 15, color: MUTED }),
          new TextRun({ text: " / ", font: FONT, size: 15, color: MUTED }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 15, color: MUTED }),
        ] }),
      ]),
    ] })],
  });
  const footer = new Footer({ children: [footerTable] });

  const doc = new Document({
    creator: "SICS Preventivatore",
    title: opts.titoloDocumento,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            // margini ariosi: logo header e banda footer NON toccano il testo
            margin: { top: 2050, bottom: 1650, left: 1134, right: 1134, header: 560, footer: 360 },
          },
        },
        headers: { default: header },
        footers: { default: footer },
        children,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
