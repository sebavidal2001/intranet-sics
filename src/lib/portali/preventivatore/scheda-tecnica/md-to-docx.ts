// ─── Convertitore markdown → Word (.docx) ────────────────────────────────────
// Trasforma il markdown generato dall'AI per la scheda tecnica in un Word ben
// formattato (heading veri, tabelle Word, grassetto, paragrafi), senza lasciare
// gli `#`/`**` raw nel testo scaricato.
//
// Supporta:
//  - heading h1/h2/h3 (# ## ###)
//  - paragrafi
//  - elenchi puntati (- / *)
//  - **grassetto** e *corsivo*
//  - tabelle markdown | a | b |
//                     | - | - |
//                     | x | y |

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from "docx";

// ─── Inline parser (grassetto, corsivo) ──────────────────────────────────────

interface InlineSpan { text: string; bold?: boolean; italic?: boolean }

function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  let i = 0;
  let current = "";
  let bold = false;
  let italic = false;

  const flush = () => {
    if (current) {
      spans.push({ text: current, bold: bold || undefined, italic: italic || undefined });
      current = "";
    }
  };

  while (i < text.length) {
    if (text[i] === "*" && text[i + 1] === "*") {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    if (text[i] === "*" || text[i] === "_") {
      // potrebbe essere italic — ma per evitare conflitti con * dei list item
      // (gestiti a monte) qui consideriamo solo _ ... _ come italic affidabile
      if (text[i] === "_") {
        flush();
        italic = !italic;
        i += 1;
        continue;
      }
    }
    current += text[i];
    i += 1;
  }
  flush();
  return spans.length > 0 ? spans : [{ text }];
}

function inlineToRuns(text: string): TextRun[] {
  return parseInline(text).map(
    (s) =>
      new TextRun({
        text: s.text,
        bold: s.bold,
        italics: s.italic,
        font: "Calibri",
        size: 22, // 11pt
      })
  );
}

// ─── Table parsing ────────────────────────────────────────────────────────────

function isTableHeaderSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}
function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function buildTable(headerCells: string[], rows: string[][]): Table {
  const totalCols = Math.max(headerCells.length, ...rows.map((r) => r.length));
  const borders = {
    top: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" },
    left: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" },
    right: { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" },
    insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "D9D9D9" },
  };

  const buildCell = (text: string, bold: boolean): TableCell =>
    new TableCell({
      width: { size: Math.floor(9000 / totalCols), type: WidthType.DXA },
      shading: bold ? { fill: "F2F2F2" } : undefined,
      children: [
        new Paragraph({
          children: parseInline(text).map(
            (s) =>
              new TextRun({
                text: s.text,
                bold: bold || s.bold,
                italics: s.italic,
                font: "Calibri",
                size: 20,
              })
          ),
        }),
      ],
    });

  const headerRow = new TableRow({
    tableHeader: true,
    children: Array.from({ length: totalCols }).map((_, i) => buildCell(headerCells[i] ?? "", true)),
  });
  const dataRows = rows.map(
    (r) =>
      new TableRow({
        children: Array.from({ length: totalCols }).map((_, i) => buildCell(r[i] ?? "", false)),
      })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [headerRow, ...dataRows],
  });
}

// ─── Main converter ──────────────────────────────────────────────────────────

export async function markdownToDocxBuffer(opts: {
  titoloDocumento: string;
  intestazione?: string; // sottotitolo (es. cliente · data)
  markdown: string;
}): Promise<Uint8Array> {
  const lines = opts.markdown.replace(/\r\n/g, "\n").split("\n");
  const children: Array<Paragraph | Table> = [];

  // Titolo principale del documento
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [
        new TextRun({ text: opts.titoloDocumento, bold: true, size: 36, font: "Calibri", color: "00A1BE" }),
      ],
    })
  );
  if (opts.intestazione) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 240 },
        children: [new TextRun({ text: opts.intestazione, italics: true, size: 22, font: "Calibri", color: "64748B" })],
      })
    );
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Riga vuota → paragrafo vuoto sottile
    if (!trimmed) {
      children.push(new Paragraph({ children: [], spacing: { before: 80, after: 80 } }));
      i += 1;
      continue;
    }

    // Heading
    const h1 = trimmed.match(/^#\s+(.+)$/);
    const h2 = trimmed.match(/^##\s+(.+)$/);
    const h3 = trimmed.match(/^###\s+(.+)$/);
    const headingRun = (text: string, color: string, size: number) =>
      parseInline(text).map(
        (s) =>
          new TextRun({
            text: s.text,
            bold: true,
            italics: s.italic,
            font: "Calibri",
            size,
            color,
          })
      );
    if (h1) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 280, after: 120 },
          children: headingRun(h1[1], "00A1BE", 30),
        })
      );
      i += 1;
      continue;
    }
    if (h2) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 240, after: 100 },
          children: headingRun(h2[1], "1A202C", 26),
        })
      );
      i += 1;
      continue;
    }
    if (h3) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 200, after: 80 },
          children: headingRun(h3[1], "1A202C", 24),
        })
      );
      i += 1;
      continue;
    }

    // Tabella: riga corrente "| ... |" e riga successiva separatore
    if (/^\|.+\|\s*$/.test(trimmed) && lines[i + 1] && isTableHeaderSeparator(lines[i + 1])) {
      const header = splitRow(trimmed);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && /^\|.+\|\s*$/.test(lines[i].trim())) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      children.push(buildTable(header, rows));
      children.push(new Paragraph({ children: [], spacing: { after: 120 } }));
      continue;
    }

    // Bullet list
    if (/^[-*]\s+/.test(trimmed)) {
      const text = trimmed.replace(/^[-*]\s+/, "");
      children.push(
        new Paragraph({
          bullet: { level: 0 },
          spacing: { after: 60 },
          children: inlineToRuns(text),
        })
      );
      i += 1;
      continue;
    }

    // Paragrafo normale
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        alignment: AlignmentType.JUSTIFIED,
        children: inlineToRuns(trimmed),
      })
    );
    i += 1;
  }

  const doc = new Document({
    creator: "SICS Preventivatore",
    title: opts.titoloDocumento,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        children,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}
