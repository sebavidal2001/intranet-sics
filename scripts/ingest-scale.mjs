/**
 * ingest-scale.mjs — SICS Preventivatore RAG Ingestion
 *
 * Indicizza i preventivi storici SCALE/BALLATOI in Supabase (schema preventivatore).
 * Un record documenti per cartella; Word + Excel condividono lo stesso documento_id.
 *
 * Usage:
 *   node ingest-scale.mjs          → processa tutte le cartelle
 *   node ingest-scale.mjs --test   → processa solo le prime 3 cartelle (dry run con insert)
 *   node ingest-scale.mjs --dry    → dry run senza insert DB, solo stampa chunks
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { readdirSync, statSync, readFileSync } from 'fs';
import { join, basename, extname } from 'path';

// ─── Config ──────────────────────────────────────────────────────────────────
const SOURCE_DIR = process.env.SOURCE_DIR;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const IS_TEST  = process.argv.includes('--test');
const IS_DRY   = process.argv.includes('--dry');
const IS_FORCE = process.argv.includes('--force'); // Cancella e re-indicizza documenti esistenti
// --only S_24_041  → processa solo quella cartella specifica
const ONLY_CODE = (() => {
  const idx = process.argv.indexOf('--only');
  return idx !== -1 ? process.argv[idx + 1] : null;
})();
const EMBEDDING_DELAY_MS = 600; // Rate limiting Gemini
const CATEGORIA = 'scale';

// Cartelle da escludere
const CARTELLE_ESCLUSE = ['S_25_128']; // SORMA 2023, fuori scope

if (!SOURCE_DIR || !SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) {
  console.error('❌ Variabili mancanti nel file .env');
  process.exit(1);
}

// ─── Clients ─────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const genai = new GoogleGenerativeAI(GEMINI_API_KEY);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Pausa per rate limiting */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Genera embedding con gemini-embedding-2 (3072 dim) */
async function getEmbedding(text) {
  const model = genai.getGenerativeModel({ model: 'gemini-embedding-2' });
  const result = await model.embedContent(text);
  return result.embedding.values; // array di 3072 float
}

/**
 * Risolve le revisioni: dato un array di file nella stessa cartella,
 * restituisce solo il file con revisione più alta per ogni "nome base".
 * Regole:
 *  - "_calcolato" è preferito sulla versione non-calcolato a parità di revisione
 *    (contiene formule pre-valutate, più affidabile con XLSX.js)
 *  - A parità di base+rev, viene tenuto un solo file (quello calcolato se esiste)
 * Es: ["PM6013-REV2.xlsx", "PM6013-REV2_calcolato.xlsx"] → ["PM6013-REV2_calcolato.xlsx"]
 */
function risolviRevisioni(files) {
  const revRegex = /-rev\.?(\d+)/i;

  // Separa file "AGGIUNTA" dai file principali.
  // Un file AGGIUNTA è un addendum parziale — va usato solo se non esiste
  // nessun file principale per quella cartella.
  const principali = files.filter(f => !/aggiunta/i.test(basename(f)));
  const aggiunta   = files.filter(f =>  /aggiunta/i.test(basename(f)));
  const working    = principali.length > 0 ? principali : aggiunta;

  // chiave: nome_base_senza_rev (senza _calcolato) → { file, rev, isCalcolato }
  const gruppi = {};

  for (const f of working) {
    const nome = basename(f);
    const isCalcolato = /_calcolato\.[^.]+$/i.test(nome);
    // Rimuovi _calcolato e revisione per ottenere la chiave canonica
    const nomeBase = nome
      .replace(/_calcolato(\.[^.]+)$/i, '$1')      // strip _calcolato
      .replace(/[\s]*-?\s*rev\.?\s*\d+/gi, '')     // strip -REVn
      .trim();

    const match = nome.match(revRegex);
    const rev = match ? parseInt(match[1]) : -1;

    const existing = gruppi[nomeBase];
    const isBetter =
      !existing ||
      rev > existing.rev ||
      (rev === existing.rev && isCalcolato && !existing.isCalcolato);

    if (isBetter) {
      gruppi[nomeBase] = { file: f, rev, isCalcolato };
    }
  }

  return Object.values(gruppi).map(g => g.file);
}

/**
 * Estrae codice_progetto e cliente dal nome cartella.
 * Es: "S_24_032 BIOCHIMICA (SCALE-PEDANE)" → { codice: "S_24_032", cliente: "BIOCHIMICA" }
 */
function parseFolderName(folderName) {
  const codiceMatch = folderName.match(/^(S_\d+_\d+)/);
  const codice = codiceMatch ? codiceMatch[1] : folderName;

  // Cliente = parola dopo il codice, prima di eventuale parentesi
  const rest = folderName.replace(/^S_\d+_\d+\s*/, '').trim();
  const cliente = rest.split(/[\s(]/)[0] || '';

  return { codice, cliente };
}

/**
 * Determina il tipo prodotto dal titolo voce
 */
function tipoFromTitolo(titolo) {
  const t = titolo.toLowerCase();
  if (t.includes('ballatoio') && t.includes('scala')) return 'scala+ballatoio';
  if (t.includes('ballatoio')) return 'ballatoio';
  if (t.includes('scala')) return 'scala';
  if (t.includes('pedana')) return 'pedana';
  if (t.includes('camminamento')) return 'camminamento';
  if (t.includes('cancello')) return 'cancello';
  if (t.includes('passerella')) return 'passerella';
  return 'altro';
}

// ─── Excel Processing ─────────────────────────────────────────────────────────

/**
 * Processa un file Excel: ogni sheet = un chunk tecnico.
 * Restituisce array di { testo, metadata, righe }.
 * Il campo `righe` contiene le voci distinta strutturate per l'insert in righe_distinta.
 */
function processaExcel(filePath, codiceProgetto, cliente) {
  const chunks = [];
  let wb;

  try {
    const buf = readFileSync(filePath);
    wb = XLSX.read(buf, { type: 'buffer' });
  } catch (e) {
    console.warn(`  ⚠️  Excel illeggibile: ${basename(filePath)} — ${e.message}`);
    return chunks;
  }

  for (const sheetName of wb.SheetNames) {
    // Skip VERIFICA COSTI
    if (/verifica|costi/i.test(sheetName)) continue;

    const ws = wb.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: '',
      blankrows: true,
    });

    // Row 3 (index 2) = titolo voce + qty
    if (!data[2] || !data[2][0]) continue;
    const titoloVoce = String(data[2][0] || '').trim();
    if (!titoloVoce || titoloVoce === 'DESCIZIONE' || titoloVoce === 'DESCRIZIONE') continue;

    const qty = parseFloat(data[2][2]) || 1;

    // Specs dimensionali (righe 4-8, indici 3-7)
    // Skip se il label è un'intestazione di tabella (DESCRIZIONE, Q.TA', DISTINTA ecc.)
    const HEADER_SKIP = /^(DESCRIZIONE|CODICE|Q\.TA|DISTINTA|QUANTITA|PROGETTO|CLIENTE)/i;
    const specs = [];
    for (let i = 3; i <= Math.min(7, data.length - 1); i++) {
      const label = String(data[i]?.[0] || '').trim();
      const valore = String(data[i]?.[2] || '').trim();
      if (label && valore && valore !== '0' && !HEADER_SKIP.test(label)) {
        specs.push(`${label}: ${valore}`);
      }
    }

    // Trova sezione DISTINTA
    let distintoStartIdx = -1;
    let headerIdx = -1;
    for (let i = 0; i < data.length; i++) {
      const cellA = String(data[i]?.[0] || '').trim().toUpperCase();
      if (cellA === 'DISTINTA') {
        distintoStartIdx = i;
        headerIdx = i + 1; // riga successiva = header DESCRIZIONE|CODICE|Q.TA'
        break;
      }
    }

    // Rileva mapping colonne dalla riga header DISTINTA
    let descCol = 0, codCol = 1, qtyCol = 2;
    if (headerIdx >= 0 && data[headerIdx]) {
      const h0 = String(data[headerIdx][0] || '').trim().toUpperCase();
      if (h0 === 'CODICE') {
        // Colonne invertite
        descCol = 1; codCol = 0; qtyCol = 2;
      }
    }

    // Rileva colonne prezzo/ricarico/totale dall'header DISTINTA
    // Layout tipico: [desc/cod, cod/desc, qty, prezzo_unitario, ricarico_pct, totale_riga]
    let prezzoCol = 3, ricaricCol = 4, totaleCol = 5;
    if (headerIdx >= 0 && data[headerIdx]) {
      // Scorri le celle dell'header per trovare le colonne prezzi in modo robusto
      for (let c = 2; c < 8; c++) {
        const h = String(data[headerIdx]?.[c] || '').trim().toUpperCase();
        if (/PREZZO|COSTO|P\.U\.|PU\b/i.test(h))   prezzoCol   = c;
        if (/RICARICO|RICAR|MARKUP|RIC\b/i.test(h)) ricaricCol  = c;
        if (/TOTALE|TOT\b|IMPORTO/i.test(h))        totaleCol   = c;
      }
    }

    // Leggi componenti dalla distinta
    const materiali = [];
    const manodopera = [];
    const righeDistinta = []; // voci strutturate per righe_distinta
    if (headerIdx >= 0) {
      for (let i = headerIdx + 1; i < data.length; i++) {
        const cellA = String(data[i]?.[0] || '').trim();
        const cellB = String(data[i]?.[1] || '').trim();
        const cellC = String(data[i]?.[2] || '').trim();

        // Stop se riga completamente vuota o troviamo footer
        if (!cellA && !cellB && !cellC) continue;
        if (/TOTALE|RICARICO|IMBALLAGGIO|TEMPI|ACCESSORI/i.test(cellA)) break;

        const desc     = descCol === 0 ? cellA : cellB;
        const cod      = codCol  === 0 ? cellA : cellB;
        const qtyRow   = parseFloat(cellC) || 0;
        const prezzoRaw = data[i]?.[prezzoCol];
        const prezzoU  = prezzoRaw !== '' && prezzoRaw !== undefined ? parseFloat(prezzoRaw) || null : null;
        const ricarico = parseFloat(data[i]?.[ricaricCol]) || null;
        const totale   = parseFloat(data[i]?.[totaleCol]) || null;

        if (!desc) continue;

        // Distingue manodopera da materiali
        if (/PROGETTAZIONE|TAGLIO|MONTAGGIO|COLLAUDO|CABLAGGIO|VERNICIATURA\s+MANODOP/i.test(desc)) {
          if (qtyRow > 0) manodopera.push(`${desc} ${qtyRow}h`);
        } else if (qtyRow > 0) {
          const codPart    = cod && cod !== desc ? ` (${cod})` : '';
          const prezzoPart = prezzoU != null ? ` @€${prezzoU.toFixed(2)}` : '';
          materiali.push(`${desc}${codPart} x${qtyRow}${prezzoPart}`);

          // Riga strutturata per la tabella righe_distinta
          righeDistinta.push({
            sheet_name:      sheetName,
            codice_articolo: cod && cod !== desc ? cod : null,
            descrizione:     desc,
            quantita:        qtyRow,
            prezzo_unitario: prezzoU,
            ricarico_pct:    ricarico,
            totale_riga:     totale,
          });
        }
      }

      // Footer manodopera (PROGETTAZIONE, TAGLIO, MONTAGGIO come righe separate)
      for (let i = headerIdx + 1; i < data.length; i++) {
        const cellA = String(data[i]?.[0] || '').trim();
        const cellC = parseFloat(data[i]?.[2]) || 0;
        if (/^PROGETTAZIONE$|^TAGLIO|^MONTAGGIO$/i.test(cellA) && cellC > 0) {
          if (!manodopera.find(m => m.startsWith(cellA))) {
            manodopera.push(`${cellA} ${cellC}h`);
          }
        }
      }
    }

    // ── Leggi totali e prezzi finali per il chunk di riepilogo ────────────────
    let totMat = null, ricaricMatPct = null, ricaricMatVal = null;
    let totMan = null, ricaricManPct = null, ricaricManVal = null;
    let imballo = null, tempiAcc = null, speseGen = null;
    let totaleCosti = null, totaleNetto = null, margine = null, prezzoFinale = null;

    if (headerIdx >= 0) {
      for (let i = headerIdx + 1; i < data.length; i++) {
        const cellA = String(data[i]?.[0] || '').trim().toUpperCase();
        const cellC = data[i]?.[2];
        const cellD = data[i]?.[prezzoCol];
        const cellT = data[i]?.[totaleCol]; // colonna totale (usata per i footer)
        const valC = parseFloat(cellC) || null;
        const valD = parseFloat(cellD) || null;
        // I footer (TOTALE, PREZZO FINALE ecc.) hanno il valore nella colonna totale,
        // non in quella del prezzo unitario — prova totaleCol prima, poi prezzoCol
        const valFooter = parseFloat(cellT) || parseFloat(cellD) || null;

        if (/^TOTALE\s*(MATERIALE|MAT\.?)\b/i.test(cellA) && valFooter != null) totMat = valFooter;
        if (/^TOTALE\s*(MANODOPERA|MAN\.?|MANOD\.?)\b/i.test(cellA) && valFooter != null) totMan = valFooter;
        if (/RICARICO/i.test(cellA) && totMat != null && ricaricMatPct == null) {
          ricaricMatPct = valC; ricaricMatVal = valFooter;
        }
        if (/RICARICO/i.test(cellA) && totMan != null && ricaricManPct == null && ricaricMatPct != null) {
          ricaricManPct = valC; ricaricManVal = valFooter;
        }
        if (/IMBALL/i.test(cellA) && valFooter != null) imballo = valFooter;
        if (/TEMPI\s*ACCESSORI/i.test(cellA) && valFooter != null) tempiAcc = valFooter;
        if (/SPESE\s*GENERALI/i.test(cellA) && valFooter != null) speseGen = valFooter;
        if (/^TOTALE\s*COSTI\b/i.test(cellA) && valFooter != null) totaleCosti = valFooter;
        if (/^TOTALE\b/i.test(cellA) && !/COSTI|MATERIALE|MANODOPERA/i.test(cellA) && valFooter != null) totaleNetto = valFooter;
        if (/MARGINE/i.test(cellA) && valC != null) margine = valC;
        if (/^PREZZO\s*FINALE\b/i.test(cellA) && valFooter != null) prezzoFinale = valFooter;
      }
    }

    // ── Leggi manodopera con costo orario ────────────────────────────────────
    // Struttura tipica: PROGETTAZIONE, TAGLIO, MONTAGGIO con colonne ore/costo_h/totale
    const manodoperaStrutturata = [];
    if (headerIdx >= 0) {
      // Cerca sezione manodopera (dopo la distinta materiali)
      let inMano = false;
      for (let i = headerIdx + 1; i < data.length; i++) {
        const cellA = String(data[i]?.[0] || '').trim();
        if (/^PREZZO\s*FINALE/i.test(cellA)) break;
        if (/PROGETTAZIONE|TAGLIO\s*&|MONTAGGIO|COLLAUDO/i.test(cellA)) inMano = true;
        if (inMano && /PROGETTAZIONE|TAGLIO|MONTAGGIO|COLLAUDO|VERNICIATURA\s+MANODOP/i.test(cellA)) {
          const ore = parseFloat(data[i]?.[qtyCol] ?? data[i]?.[2]) || 0;
          const costoH = parseFloat(data[i]?.[prezzoCol]) || null;
          const totaleMan = parseFloat(data[i]?.[totaleCol]) || null;
          if (ore > 0) {
            manodoperaStrutturata.push({ voce: cellA, ore, costoH, totaleMan });
          }
        }
      }
    }

    // ── Costruisci testo chunk nel formato strutturato ─────────────────────
    const lines = [`${titoloVoce} | qt: ${qty}`];
    if (specs.length) lines.push(specs.join(' | '));

    if (righeDistinta.length > 0) {
      lines.push('');
      lines.push('DISTINTA MATERIALI:');
      for (const r of righeDistinta) {
        const codPart = r.codice_articolo ? ` (${r.codice_articolo})` : '';
        const qtaPart = r.quantita != null ? `, q.tà ${r.quantita}` : '';
        const prezzoPart = r.prezzo_unitario != null ? `, costo €${r.prezzo_unitario.toFixed(2)}` : '';
        const totalePart = r.totale_riga != null ? `, totale €${r.totale_riga.toFixed(2)}` : '';
        lines.push(`  - ${r.descrizione}${codPart}${qtaPart}${prezzoPart}${totalePart}`);
      }

      if (totMat != null) {
        lines.push('');
        lines.push(`TOTALE MATERIALE: €${totMat.toFixed(2)}`);
        if (ricaricMatPct != null && ricaricMatVal != null) {
          lines.push(`  ricarico ${ricaricMatPct.toFixed(1)}% → €${ricaricMatVal.toFixed(2)}`);
        }
      }
    }

    if (manodoperaStrutturata.length > 0) {
      lines.push('');
      lines.push('MANODOPERA:');
      for (const m of manodoperaStrutturata) {
        const costoHPart = m.costoH != null ? ` × €${m.costoH.toFixed(2)}/h` : '';
        const totalePart = m.totaleMan != null ? ` = €${m.totaleMan.toFixed(2)}` : '';
        lines.push(`  - ${m.voce}: ${m.ore}h${costoHPart}${totalePart}`);
      }
      if (totMan != null) {
        lines.push('');
        lines.push(`TOTALE MANODOPERA: €${totMan.toFixed(2)}`);
        if (ricaricManPct != null && ricaricManVal != null) {
          lines.push(`  ricarico ${ricaricManPct.toFixed(1)}% → €${ricaricManVal.toFixed(2)}`);
        }
      }
    }

    if (imballo != null || tempiAcc != null || speseGen != null) {
      lines.push('');
      lines.push('ALTRI COSTI:');
      if (imballo != null)  lines.push(`  - IMBALLAGGIO: 1.0% = €${imballo.toFixed(2)}`);
      if (tempiAcc != null) lines.push(`  - TEMPI ACCESSORI DI PRODUZIONE: 2.8% = €${tempiAcc.toFixed(2)}`);
      if (speseGen != null) lines.push(`  - COPERTURA SPESE GENERALI AZIENDALI: 24.2% = €${speseGen.toFixed(2)}`);
    }

    if (totaleCosti != null) lines.push('');
    if (totaleCosti != null) lines.push(`TOTALE COSTI: €${totaleCosti.toFixed(2)}`);
    if (totaleNetto != null) lines.push(`TOTALE: €${totaleNetto.toFixed(2)}`);
    if (margine != null)     lines.push(`MARGINE TRATTATIVA: ${margine.toFixed(1)}%`);
    if (prezzoFinale != null) lines.push(`PREZZO FINALE: €${prezzoFinale.toFixed(2)}`);

    const testo = lines.join('\n');

    // Estrai dimensioni numeriche per metadata
    const getSpecVal = (label) => {
      const found = specs.find(s => s.toLowerCase().startsWith(label.toLowerCase()));
      if (!found) return null;
      const num = parseFloat(found.split(':')[1]);
      return isNaN(num) ? null : num;
    };

    chunks.push({
      testo,
      righeDistinta,
      metadata: {
        source_file: basename(filePath),
        source_type: 'excel',
        sheet: sheetName,
        cartella: basename(filePath.split(codiceProgetto)[0] + codiceProgetto + (filePath.split(codiceProgetto)[1]?.split('\\')[0] || '')),
        codice_progetto: codiceProgetto,
        cliente,
        tipo_prodotto: tipoFromTitolo(titoloVoce),
        qty,
        larghezza_mm: getSpecVal('larghezza'),
        altezza_mm: getSpecVal('altezza') || getSpecVal('altezza pianerottolo'),
        n_gradini: getSpecVal('n° gradini') || getSpecVal('gradini'),
      },
    });
  }

  return chunks;
}

// ─── Word Processing ──────────────────────────────────────────────────────────

/**
 * Processa un file Word: ogni "Nr. X" = un chunk commerciale.
 * Restituisce { chunks: [{testo, metadata}], numero_offerta, data_offerta }.
 */
async function processaWord(filePath, codiceProgetto, cliente) {
  let rawText;
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    rawText = result.value;
  } catch (e) {
    console.warn(`  ⚠️  Word illeggibile: ${basename(filePath)}`);
    return { chunks: [], numero_offerta: null, data_offerta: null };
  }

  // Estrai metadati intestazione
  const offertaMatch = rawText.match(/Offerta\s+nr\.?\s*(\d+)/i);
  const dataMatch = rawText.match(/del\s+(\d{1,2}[\s/.-]\d{1,2}[\s/.-]\d{2,4})/i);
  const numero_offerta = offertaMatch ? offertaMatch[1] : null;
  const data_offerta = dataMatch ? dataMatch[1].trim() : null;

  // Split per voci numerate — richiede lettera maiuscola dopo il numero
  // per evitare di splittare su "Offerta nr. 375 del..." (d minuscola)
  const vociRaw = rawText.split(/(?=Nr\.?\s+\d+\s+[A-ZÀÈÌÒÙ])/i);
  const chunks = [];
  let vociProcessate = 0;

  // Sezioni da appendere all'ultimo chunk
  const sezioniFinali = [];
  const sezioniMatch = rawText.match(/(Compreso nella fornitura[\s\S]*?)(Escluso dalla fornitura[\s\S]*?)(?=Nr\.\s*\d+|$)/i);
  if (sezioniMatch) sezioniFinali.push(sezioniMatch[0].trim());

  for (let i = 0; i < vociRaw.length; i++) {
    const voce = vociRaw[i].trim();
    if (!voce) continue;

    // Filtra: deve iniziare con Nr. e avere un numero voce piccolo (1-30)
    // I numeri offerta sono 3 cifre (es. 375, 507), le voci reali sono 1-10
    const numMatch = voce.match(/^Nr\.?\s*(\d+)/i);
    if (!numMatch) continue;
    const voceNumero = parseInt(numMatch[1]);
    if (voceNumero > 30) continue; // Scarta intestazione con numero offerta

    let testoVoce = voce;

    // Appendi sezioni Compreso/Escluso all'ultimo chunk
    const isLast = i === vociRaw.length - 1 || !vociRaw.slice(i + 1).some(v => /^Nr\.?\s*\d+/i.test(v.trim()));
    if (isLast && sezioniFinali.length) {
      // Rimuovi sezioni già presenti nel testo per evitare duplicati, poi riappendi
      const senzaSezioni = testoVoce.replace(/Compreso nella fornitura[\s\S]*/i, '').trim();
      testoVoce = senzaSezioni + '\n\n' + sezioniFinali.join('\n\n');
    }

    chunks.push({
      testo: testoVoce.replace(/\s+/g, ' ').replace(/ ([;,.])/g, '$1').trim(),
      metadata: {
        source_file: basename(filePath),
        source_type: 'word',
        codice_progetto: codiceProgetto,
        cliente,
        numero_offerta,
        data_offerta,
        voce_numero: voceNumero,
        tipo_prodotto: tipoFromTitolo(voce),
      },
    });

    vociProcessate++;
  }

  return { chunks, numero_offerta, data_offerta };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 SICS Preventivatore — Ingestion Scale`);
  console.log(`   Source: ${SOURCE_DIR}`);
  const modeStr = IS_DRY ? 'DRY RUN' : IS_TEST ? 'TEST (prime 3 cartelle)' : IS_FORCE ? 'PRODUZIONE + FORCE (re-index)' : 'PRODUZIONE';
  console.log(`   Mode: ${modeStr}`);
  if (ONLY_CODE) console.log(`   Filter: solo ${ONLY_CODE}`);
  console.log('');

  // Lista cartelle
  const allFolders = readdirSync(SOURCE_DIR)
    .filter(f => {
      const fullPath = join(SOURCE_DIR, f);
      return statSync(fullPath).isDirectory() && /^S_\d+_\d+/i.test(f);
    })
    .sort();

  const folders = IS_TEST ? allFolders.slice(0, 3) : allFolders;

  let totDocs = 0, totChunks = 0, totErrori = 0;

  for (const folderName of folders) {
    const folderPath = join(SOURCE_DIR, folderName);
    const { codice, cliente } = parseFolderName(folderName);

    // Skip cartelle escluse o non corrispondenti al filtro --only
    if (CARTELLE_ESCLUSE.some(e => codice.startsWith(e))) {
      console.log(`⏭️  Skip (esclusa): ${folderName}`);
      continue;
    }
    if (ONLY_CODE && codice !== ONLY_CODE) {
      continue; // silent skip
    }

    console.log(`\n📁 ${folderName}`);
    console.log(`   Codice: ${codice} | Cliente: ${cliente}`);

    // Lista file nella cartella
    const allFiles = readdirSync(folderPath).map(f => join(folderPath, f));
    const wordFiles = risolviRevisioni(allFiles.filter(f => extname(f).toLowerCase() === '.docx' && !basename(f).startsWith('~$')));
    const excelFiles = risolviRevisioni(allFiles.filter(f => extname(f).toLowerCase() === '.xlsx' && !basename(f).startsWith('~$')));

    if (!wordFiles.length && !excelFiles.length) {
      console.log('   ⚠️  Nessun file valido — skip');
      continue;
    }

    // Verifica se documento esiste già (skip in dry run)
    let existingId = null;
    if (!IS_DRY) {
      const { data: existing } = await supabase
        .schema('preventivatore')
        .from('documenti')
        .select('id')
        .eq('codice', codice)
        .maybeSingle();

      if (existing) {
        existingId = existing.id;
        if (!IS_FORCE) {
          console.log(`   ⏭️  Già indicizzato — skip (usa --force per re-indicizzare)`);
          continue;
        }
        // --force: cancella SOLO i chunk (preserva importo_preventivo, importo_ordinato, stato)
        console.log(`   🔄  --force: elimino chunk esistenti di ${codice} (importi e stato preservati)...`);
        const { error: delChunkErr } = await supabase
          .schema('preventivatore')
          .from('chunks')
          .delete()
          .eq('documento_id', existingId);
        if (delChunkErr) {
          console.error(`   ❌ Errore delete chunks: ${delChunkErr.message}`);
          totErrori++;
          continue;
        }
        // Elimina anche righe_distinta (ricostruite dall'ingestion)
        await supabase.schema('preventivatore').from('righe_distinta').delete().eq('documento_id', existingId);
      }
    }

    let numero_offerta = null;
    let data_offerta = null;

    // Processa prima il Word per estrarre numero_offerta e data_offerta
    const allChunks = [];

    for (const wordFile of wordFiles) {
      console.log(`   📄 Word: ${basename(wordFile)}`);
      const { chunks, numero_offerta: no, data_offerta: da } = await processaWord(wordFile, codice, cliente);
      if (no) numero_offerta = no;
      if (da) data_offerta = da;
      allChunks.push(...chunks);
      console.log(`      → ${chunks.length} chunk(s) commerciali`);
    }

    for (const excelFile of excelFiles) {
      console.log(`   📊 Excel: ${basename(excelFile)}`);
      const chunks = processaExcel(excelFile, codice, cliente);
      allChunks.push(...chunks);
      console.log(`      → ${chunks.length} chunk(s) tecnici`);
    }

    if (!allChunks.length) {
      console.log('   ⚠️  Nessun chunk prodotto — skip');
      continue;
    }

    if (IS_DRY) {
      console.log(`   🔍 DRY: ${allChunks.length} chunks totali (no insert)`);
      allChunks.forEach((c, i) => {
        console.log(`\n  ── CHUNK [${i}] ──────────────────────`);
        console.log(c.testo);
        if (c.righeDistinta?.length) console.log(`  (${c.righeDistinta.length} righe strutturate)`);
      });
      continue;
    }

    // Crea o aggiorna documento master
    let documentoId = null;
    if (existingId) {
      // --force: aggiorna solo i campi tecnici, preserva importo_preventivo/ordinato/stato
      const { error: updErr } = await supabase
        .schema('preventivatore')
        .from('documenti')
        .update({ cliente, numero_offerta, data_offerta })
        .eq('id', existingId);
      if (updErr) {
        console.error(`   ❌ Errore update documento: ${updErr.message}`);
        totErrori++;
        continue;
      }
      documentoId = existingId;
    } else {
      const { data: doc, error: docErr } = await supabase
        .schema('preventivatore')
        .from('documenti')
        .insert({
          codice,
          tipo: 'storico',
          cliente,
          numero_offerta,
          data_offerta,
          categoria: CATEGORIA,
          stato: 'pending',
        })
        .select('id')
        .single();

      if (docErr || !doc) {
        console.error(`   ❌ Errore insert documento: ${docErr?.message}`);
        totErrori++;
        continue;
      }
      documentoId = doc.id;
    }
    totDocs++;

    // Insert chunks con embedding
    let chunkIndex = 0;
    for (const chunk of allChunks) {
      try {
        process.stdout.write(`   ⚡ Embedding chunk ${chunkIndex + 1}/${allChunks.length}...`);
        const embedding = await getEmbedding(chunk.testo);

        const { error: chunkErr } = await supabase
          .schema('preventivatore')
          .from('chunks')
          .insert({
            documento_id: documentoId,
            chunk_index: chunkIndex,
            contenuto: chunk.testo,
            embedding: JSON.stringify(embedding),
            metadata: chunk.metadata,
          });

        if (chunkErr) {
          process.stdout.write(` ❌ ${chunkErr.message}\n`);
          totErrori++;
        } else {
          process.stdout.write(` ✓\n`);
          totChunks++;

          // Insert righe_distinta strutturate (solo per chunk Excel con voci BOM)
          if (chunk.righeDistinta && chunk.righeDistinta.length > 0) {
            const righePayload = chunk.righeDistinta.map(r => ({
              ...r,
              documento_id: documentoId,
            }));
            const { error: righeErr } = await supabase
              .schema('preventivatore')
              .from('righe_distinta')
              .insert(righePayload);
            if (righeErr) {
              console.warn(`   ⚠️  righe_distinta insert warn: ${righeErr.message}`);
            }
          }
        }

        chunkIndex++;
        await sleep(EMBEDDING_DELAY_MS);
      } catch (e) {
        process.stdout.write(` ❌ ${e.message}\n`);
        totErrori++;
        chunkIndex++;
      }
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`✅ Ingestion completata`);
  console.log(`   Documenti inseriti : ${totDocs}`);
  console.log(`   Chunks indicizzati : ${totChunks}`);
  console.log(`   Errori             : ${totErrori}`);
  console.log(`${'─'.repeat(50)}\n`);
}

main().catch(e => {
  console.error('❌ Errore fatale:', e);
  process.exit(1);
});
