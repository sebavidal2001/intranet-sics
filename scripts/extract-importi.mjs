/**
 * extract-importi.mjs — Estrae PREZZO FINALE dagli Excel originali
 * Sola lettura: non tocca il DB, stampa solo i valori trovati.
 *
 * Usage (dalla cartella scripts/):
 *   node extract-importi.mjs
 */

import 'dotenv/config';
import * as XLSX from 'xlsx';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, basename, extname } from 'path';

const SOURCE_DIR = process.env.SOURCE_DIR;
if (!SOURCE_DIR) { console.error('❌ SOURCE_DIR mancante nel .env'); process.exit(1); }

const CARTELLE_ESCLUSE = ['S_25_128'];

// ─── Estrai PREZZO FINALE da un Excel ──────────────────────────────────────
function estraiPrezzoFinale(filePath) {
  let wb;
  try {
    wb = XLSX.read(readFileSync(filePath), { type: 'buffer' });
  } catch {
    return null;
  }

  let maxPrezzo = null; // Se ci sono più sheet, prendi il più alto (è il totale complessivo)

  for (const sheetName of wb.SheetNames) {
    if (/verifica|costi/i.test(sheetName)) continue;

    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true });

    // Rileva headerIdx
    let headerIdx = -1;
    for (let i = 0; i < data.length; i++) {
      const cellA = String(data[i]?.[0] || '').trim().toUpperCase();
      if (cellA === 'DISTINTA') { headerIdx = i + 1; break; }
    }
    if (headerIdx < 0) continue;

    // Rileva totaleCol dall'header
    let prezzoCol = 3, totaleCol = 5;
    for (let c = 2; c < 8; c++) {
      const h = String(data[headerIdx]?.[c] || '').trim().toUpperCase();
      if (/PREZZO|COSTO|P\.U\.|PU\b/i.test(h)) prezzoCol = c;
      if (/TOTALE|TOT\b|IMPORTO/i.test(h)) totaleCol = c;
    }

    // Cerca PREZZO FINALE nelle righe footer — controlla ENTRAMBE le colonne
    for (let i = headerIdx + 1; i < data.length; i++) {
      const cellA = String(data[i]?.[0] || '').trim().toUpperCase();
      if (!/^PREZZO\s*FINALE/i.test(cellA)) continue;

      // Prova prima totaleCol, poi prezzoCol, poi scansiona tutte le colonne
      const candidates = [
        data[i]?.[totaleCol],
        data[i]?.[prezzoCol],
        ...Array.from({ length: 8 }, (_, c) => data[i]?.[c]),
      ];
      for (const v of candidates) {
        const n = parseFloat(v);
        if (n && n > 0) {
          if (maxPrezzo === null || n > maxPrezzo) maxPrezzo = n;
          break;
        }
      }
    }
  }

  return maxPrezzo;
}

// ─── Scan cartelle ──────────────────────────────────────────────────────────
const cartelle = readdirSync(SOURCE_DIR)
  .filter(n => /^S_\d{2}_\d{3}\b/i.test(n))
  .filter(n => {
    const codice = n.match(/^(S_\d{2}_\d{3})/i)?.[1];
    return codice && !CARTELLE_ESCLUSE.includes(codice);
  })
  .sort();

console.log(`\n📂 SOURCE_DIR: ${SOURCE_DIR}`);
console.log(`📋 Cartelle trovate: ${cartelle.length}\n`);
console.log('─'.repeat(60));

const risultati = [];
let nonTrovati = [];

for (const cartella of cartelle) {
  const codice = cartella.match(/^(S_\d{2}_\d{3})/i)?.[1];
  if (!codice) continue;

  const dir = join(SOURCE_DIR, cartella);
  if (!statSync(dir).isDirectory()) continue;

  const files = readdirSync(dir)
    .filter(f => extname(f).toLowerCase() === '.xlsx' && !f.startsWith('~$'))
    .map(f => join(dir, f));

  if (files.length === 0) {
    nonTrovati.push(codice);
    continue;
  }

  // Preferisci _calcolato, poi prendi il file con revisione più alta
  const calcolato = files.find(f => /_calcolato/i.test(basename(f)));
  const target = calcolato ?? files[files.length - 1];

  const prezzo = estraiPrezzoFinale(target);

  if (prezzo !== null) {
    risultati.push({ codice, importo: prezzo, file: basename(target) });
    console.log(`✅  ${codice.padEnd(12)} €${prezzo.toFixed(2).padStart(10)}   (${basename(target)})`);
  } else {
    nonTrovati.push(codice);
    console.log(`❌  ${codice.padEnd(12)} — PREZZO FINALE non trovato`);
  }
}

console.log('─'.repeat(60));
console.log(`\n✅ Trovati: ${risultati.length} / ${cartelle.length}`);
console.log(`❌ Mancanti: ${nonTrovati.length} → ${nonTrovati.join(', ')}`);

// Stampa SQL UPDATE pronti da eseguire (solo per review, non eseguiti)
if (risultati.length > 0) {
  console.log('\n\n── SQL UPDATE (da verificare prima di eseguire) ─────────────\n');
  for (const r of risultati) {
    console.log(`UPDATE preventivatore.documenti SET importo_preventivo = ${r.importo.toFixed(2)} WHERE codice = '${r.codice}';`);
  }
}
