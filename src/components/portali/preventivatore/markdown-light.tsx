"use client";

import { Fragment } from "react";

// Markdown renderer ULTRA-LEGGERO per output AI tipo "riassumi documento".
// Gestisce:
//   ## Heading       → h3
//   **bold**         → <strong>
//   * lista          → <ul><li>
//   1. numerata      → <ol><li>
//   ---              → divider
// Niente parser completo, niente dipendenze. Sufficiente per testi LLM strutturati.

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    if (match[1]) {
      parts.push(<strong key={`${keyPrefix}-b-${i}`}>{match[1]}</strong>);
    } else if (match[2]) {
      parts.push(
        <code
          key={`${keyPrefix}-c-${i}`}
          className="bg-bg-page px-1 py-0.5 rounded text-[12px] font-mono"
        >
          {match[2]}
        </code>
      );
    }
    lastIdx = match.index + match[0].length;
    i += 1;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

export function MarkdownLight({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listBuf: { type: "ul" | "ol"; items: string[] } | null = null;
  let key = 0;

  const flushList = () => {
    if (!listBuf) return;
    if (listBuf.type === "ul") {
      blocks.push(
        <ul key={`l-${key++}`} className="list-disc pl-5 my-2 space-y-1">
          {listBuf.items.map((it, i) => (
            <li key={i} className="text-text leading-relaxed">
              {renderInline(it, `ul-${key}-${i}`)}
            </li>
          ))}
        </ul>
      );
    } else {
      blocks.push(
        <ol key={`l-${key++}`} className="list-decimal pl-5 my-2 space-y-1">
          {listBuf.items.map((it, i) => (
            <li key={i} className="text-text leading-relaxed">
              {renderInline(it, `ol-${key}-${i}`)}
            </li>
          ))}
        </ol>
      );
    }
    listBuf = null;
  };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx];
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }
    // Heading
    if (/^#{2,3}\s+/.test(line)) {
      flushList();
      const level = line.match(/^#+/)![0].length;
      const txt = line.replace(/^#+\s+/, "");
      const cls =
        level === 2
          ? "text-base font-semibold text-text mt-4 mb-2 pb-1 border-b border-border"
          : "text-sm font-semibold text-text mt-3 mb-1.5";
      blocks.push(
        <h3 key={`h-${key++}`} className={cls}>
          {renderInline(txt, `h-${key}`)}
        </h3>
      );
      continue;
    }
    // Lista non-ordinata: - X o * X (con possibile indentazione)
    const ulM = line.match(/^[*\-]\s+(.+)$/);
    if (ulM) {
      if (!listBuf || listBuf.type !== "ul") {
        flushList();
        listBuf = { type: "ul", items: [] };
      }
      listBuf.items.push(ulM[1]);
      continue;
    }
    // Lista ordinata: 1. X
    const olM = line.match(/^\d+\.\s+(.+)$/);
    if (olM) {
      if (!listBuf || listBuf.type !== "ol") {
        flushList();
        listBuf = { type: "ol", items: [] };
      }
      listBuf.items.push(olM[1]);
      continue;
    }
    // Divider
    if (/^---+$/.test(line)) {
      flushList();
      blocks.push(<hr key={`hr-${key++}`} className="my-3 border-border" />);
      continue;
    }
    // Paragrafo normale
    flushList();
    blocks.push(
      <p key={`p-${key++}`} className="text-sm text-text leading-relaxed my-1.5">
        {renderInline(line, `p-${key}`)}
      </p>
    );
  }
  flushList();

  return <Fragment>{blocks}</Fragment>;
}
