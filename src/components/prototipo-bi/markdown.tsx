"use client";

/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Renderer Markdown minimo.
 *
 * Perché scritto a mano invece di installare `react-markdown`: aggiungere una
 * dipendenza modificherebbe `package.json`, che è tracciato da git, e il
 * prototipo deve restare invisibile al repository. Qui serve comunque solo il
 * sottoinsieme che l'analista produce davvero: titoli, grassetto, corsivo,
 * elenchi, tabelle, codice e righe orizzontali.
 *
 * Nessun HTML grezzo viene interpretato: il testo passa da React, quindi non
 * c'è modo di iniettare markup attraverso la risposta del modello.
 */

import { Fragment } from "react";

/** Grassetto, corsivo e codice dentro una riga. */
function inline(testo: string, chiave: string): React.ReactNode[] {
  const pezzi: React.ReactNode[] = [];
  // L'ordine conta: prima il codice, che non deve essere reinterpretato.
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let ultimo = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = regex.exec(testo)) !== null) {
    if (m.index > ultimo) pezzi.push(testo.slice(ultimo, m.index));
    const t = m[0];
    const k = `${chiave}-${i++}`;

    if (t.startsWith("`")) {
      pezzi.push(
        <code key={k} className="px-1 py-0.5 rounded bg-bg-page text-[0.9em] font-mono">
          {t.slice(1, -1)}
        </code>
      );
    } else if (t.startsWith("**") || t.startsWith("__")) {
      pezzi.push(
        <strong key={k} className="font-semibold text-text">
          {t.slice(2, -2)}
        </strong>
      );
    } else {
      pezzi.push(<em key={k}>{t.slice(1, -1)}</em>);
    }
    ultimo = m.index + t.length;
  }
  if (ultimo < testo.length) pezzi.push(testo.slice(ultimo));
  return pezzi;
}

function celle(riga: string): string[] {
  return riga
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());
}

/** Vero se la riga è il separatore di intestazione di una tabella. */
function separatoreTabella(riga: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(riga) && riga.includes("-");
}

export function Markdown({ testo }: { testo: string }) {
  const righe = testo.replace(/\r\n/g, "\n").split("\n");
  const blocchi: React.ReactNode[] = [];

  let i = 0;
  let chiave = 0;
  const k = () => `md-${chiave++}`;

  while (i < righe.length) {
    const riga = righe[i];

    // Riga vuota
    if (!riga.trim()) {
      i++;
      continue;
    }

    // Blocco di codice
    if (riga.trim().startsWith("```")) {
      const dentro: string[] = [];
      i++;
      while (i < righe.length && !righe[i].trim().startsWith("```")) {
        dentro.push(righe[i]);
        i++;
      }
      i++;
      blocchi.push(
        <pre
          key={k()}
          className="my-2 p-3 rounded-lg bg-bg-page overflow-x-auto text-xs font-mono leading-relaxed"
        >
          {dentro.join("\n")}
        </pre>
      );
      continue;
    }

    // Riga orizzontale
    if (/^\s*([-*_])\1{2,}\s*$/.test(riga)) {
      blocchi.push(<hr key={k()} className="my-3 border-border" />);
      i++;
      continue;
    }

    // Titolo
    const titolo = /^(#{1,4})\s+(.*)$/.exec(riga);
    if (titolo) {
      const livello = titolo[1].length;
      const contenuto = inline(titolo[2], k());
      const classi =
        livello === 1
          ? "text-base font-tenorite font-bold mt-3 mb-1.5"
          : livello === 2
            ? "text-[15px] font-tenorite font-semibold mt-3 mb-1.5"
            : "text-[13px] font-tenorite font-semibold uppercase tracking-wide text-text-muted mt-2.5 mb-1";
      blocchi.push(
        <div key={k()} className={classi}>
          {contenuto}
        </div>
      );
      i++;
      continue;
    }

    // Tabella
    if (riga.includes("|") && i + 1 < righe.length && separatoreTabella(righe[i + 1])) {
      const intestazioni = celle(riga);
      i += 2;
      const corpo: string[][] = [];
      while (i < righe.length && righe[i].includes("|") && righe[i].trim()) {
        corpo.push(celle(righe[i]));
        i++;
      }
      blocchi.push(
        <div key={k()} className="my-2 overflow-x-auto">
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="border-b border-border">
                {intestazioni.map((h, j) => (
                  <th
                    key={j}
                    className={`py-1.5 px-2 font-tenorite text-[11px] uppercase tracking-wide text-text-muted ${
                      j === 0 ? "text-left" : "text-right"
                    }`}
                  >
                    {inline(h, `h${j}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corpo.map((r, j) => (
                <tr key={j} className="border-b border-border/50 last:border-0">
                  {r.map((c, x) => (
                    <td
                      key={x}
                      className={`py-1.5 px-2 ${x === 0 ? "text-left" : "text-right tabular-nums"}`}
                    >
                      {inline(c, `c${j}-${x}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // Elenco puntato o numerato
    const puntato = /^\s*[-*•]\s+(.*)$/.exec(riga);
    const numerato = /^\s*(\d+)[.)]\s+(.*)$/.exec(riga);
    if (puntato || numerato) {
      const ordinato = Boolean(numerato);
      const voci: string[] = [];
      while (i < righe.length) {
        const p = /^\s*[-*•]\s+(.*)$/.exec(righe[i]);
        const n = /^\s*(\d+)[.)]\s+(.*)$/.exec(righe[i]);
        if (ordinato && n) voci.push(n[2]);
        else if (!ordinato && p) voci.push(p[1]);
        else break;
        i++;
      }
      const Elenco = ordinato ? "ol" : "ul";
      blocchi.push(
        <Elenco
          key={k()}
          className={`my-1.5 space-y-1 ${ordinato ? "list-decimal" : "list-disc"} pl-5`}
        >
          {voci.map((v, j) => (
            <li key={j} className="leading-relaxed">
              {inline(v, `l${j}`)}
            </li>
          ))}
        </Elenco>
      );
      continue;
    }

    // Citazione
    const citazione = /^\s*>\s?(.*)$/.exec(riga);
    if (citazione) {
      const voci: string[] = [];
      while (i < righe.length) {
        const c = /^\s*>\s?(.*)$/.exec(righe[i]);
        if (!c) break;
        voci.push(c[1]);
        i++;
      }
      blocchi.push(
        <blockquote
          key={k()}
          className="my-2 pl-3 border-l-2 border-primary/40 text-text-muted italic"
        >
          {voci.map((v, j) => (
            <p key={j}>{inline(v, `q${j}`)}</p>
          ))}
        </blockquote>
      );
      continue;
    }

    // Paragrafo: righe consecutive non vuote
    const paragrafo: string[] = [];
    while (
      i < righe.length &&
      righe[i].trim() &&
      !/^(#{1,4})\s/.test(righe[i]) &&
      !/^\s*[-*•]\s/.test(righe[i]) &&
      !/^\s*\d+[.)]\s/.test(righe[i]) &&
      !righe[i].trim().startsWith("```") &&
      !righe[i].trim().startsWith(">") &&
      !(righe[i].includes("|") && i + 1 < righe.length && separatoreTabella(righe[i + 1]))
    ) {
      paragrafo.push(righe[i]);
      i++;
    }
    if (paragrafo.length > 0) {
      blocchi.push(
        <p key={k()} className="my-1.5 leading-relaxed">
          {paragrafo.map((r, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              {inline(r, `p${j}`)}
            </Fragment>
          ))}
        </p>
      );
    } else {
      // Nessuna regola ha consumato la riga: si evita il ciclo infinito.
      i++;
    }
  }

  return <div className="text-[15px]">{blocchi}</div>;
}
