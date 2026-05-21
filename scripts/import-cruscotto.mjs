/**
 * import-cruscotto.mjs — Import idempotente del Cruscotto articoli SICS
 *
 * Sorgenti supportate:
 *   - Excel (.xlsx) — usato oggi per il primo import
 *   - CSV (.csv)    — formato target sulla VM (più veloce)
 *
 * Schema target:
 *   - preventivatore.prodotti          (1 riga per codice)
 *   - preventivatore.prodotti_giacenze (1 riga per codice+magazzino registrato)
 *   - preventivatore.prodotti_import_log (audit)
 *
 * Usage:
 *   node import-cruscotto.mjs --file="C:/Users/sebav/Downloads/Cruscotto articoli.xlsx"
 *   node import-cruscotto.mjs --file=/opt/intranet-sics/imports/cruscotto/cruscotto.csv --csv
 *   node import-cruscotto.mjs --file=... --dry-run     # non scrive nulla, stampa solo i numeri
 *
 * Env richieste (in scripts/.env):
 *   SUPABASE_URL=...
 *   SUPABASE_SERVICE_KEY=...
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { basename } from 'path';

// ─── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name, def = null) {
  const m = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!m) return def;
  if (m === `--${name}`) return true;
  return m.split('=').slice(1).join('=');
}
const FILE = arg('file');
const FORCE_CSV = !!arg('csv');
const DRY_RUN = !!arg('dry-run');
const VERBOSE = !!arg('verbose');

if (!FILE) {
  console.error('❌ Manca --file=<path-al-cruscotto>');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Manca SUPABASE_URL o SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'preventivatore' },
});

// ─── Util ──────────────────────────────────────────────────────────────────
const t0 = Date.now();
function log(...m) { console.log(...m); }
function vlog(...m) { if (VERBOSE) console.log(...m); }

function md5File(path) {
  return createHash('md5').update(readFileSync(path)).digest('hex');
}

function normCodice(c) {
  return String(c || '').toUpperCase().replace(/[\s\.\-_/\\\*\?]+/g, '');
}

function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/[€%\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const x = Number.parseFloat(s);
  return Number.isFinite(x) ? x : null;
}

function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // formati: dd/mm/yy, dd/mm/yyyy, yyyy-mm-dd
  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yy] = m;
    if (yy.length === 2) yy = (Number(yy) > 50 ? '19' : '20') + yy;
    return `${yy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function hashRiga(p) {
  const s = [p.descrizione, p.uc, p.categoria, p.gruppo, p.cat_merc, p.reparto_codice, p.reparto_desc, p.ult_costo, p.data_ult_costo].join('|');
  return createHash('md5').update(s).digest('hex');
}

// ─── Lettura sorgente ──────────────────────────────────────────────────────
function readRows(path) {
  const isCsv = FORCE_CSV || /\.csv$/i.test(path);
  const wb = isCsv
    ? XLSX.read(readFileSync(path, 'utf8'), { type: 'string', raw: false })
    : XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false });
  if (!data.length) throw new Error('File vuoto');
  const headers = data[0].map((h) => String(h || '').trim());
  const rows = data.slice(1).filter((r) => r.some((c) => c !== '' && c !== null && c !== undefined));
  return { headers, rows };
}

function colIdx(headers, names) {
  for (const n of names) {
    const i = headers.findIndex((h) => h.toLowerCase() === n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

// ─── Parsing → record DB ───────────────────────────────────────────────────
function parseAll(path) {
  const { headers, rows } = readRows(path);
  vlog(`Headers (${headers.length}):`, headers.slice(0, 6).join(' | '), '…');

  const H = {
    codice:        colIdx(headers, ['Codice', 'codice']),
    descrizione:   colIdx(headers, ['Descrizione', 'descrizione']),
    uc:            colIdx(headers, ['Codice Uc', 'UC', 'uc', 'unita_misura']),
    categoria:     colIdx(headers, ['Cat Esposizione Descrizione', 'categoria']),
    cat_merc:      colIdx(headers, ['Cat Merceologica Descrizione', 'cat_merc']),
    gruppo:        colIdx(headers, ['Gruppo Articoli Descrizione', 'gruppo']),
    reparto_cod:   colIdx(headers, ['Reparto Codice', 'reparto_codice']),
    reparto_desc:  colIdx(headers, ['Reparto Descrizione', 'reparto_desc']),
    ult_costo:     colIdx(headers, ['Ult Costo', 'ult_costo']),
    data_costo:    colIdx(headers, ['Data Ult Costo', 'data_ult_costo']),
    magazzino:     colIdx(headers, ['Magazzino', 'magazzino']),
    esistenza:     colIdx(headers, ['Esistenza', 'esistenza']),
    disp:          colIdx(headers, ['Disponibilita', 'Disponibilità', 'disponibilita']),
  };

  if (H.codice < 0) throw new Error('Colonna "Codice" non trovata');

  // Mappa codice → anagrafica (prima riga vince), e codice → [giacenze]
  const anagrafica = new Map();
  const giacenze = [];

  for (const r of rows) {
    const cod = String(r[H.codice] || '').trim();
    if (!cod) continue;
    const mag = String(r[H.magazzino] || '').trim();
    if (!mag) continue;

    const ana = {
      codice: cod,
      codice_norm: normCodice(cod),
      descrizione: String(r[H.descrizione] || '').trim() || null,
      uc: H.uc >= 0 ? (String(r[H.uc] || '').trim() || null) : null,
      categoria: H.categoria >= 0 ? (String(r[H.categoria] || '').trim() || null) : null,
      cat_merc: H.cat_merc >= 0 ? (String(r[H.cat_merc] || '').trim() || null) : null,
      gruppo: H.gruppo >= 0 ? (String(r[H.gruppo] || '').trim() || null) : null,
      reparto_codice: H.reparto_cod >= 0 ? (String(r[H.reparto_cod] || '').trim() || null) : null,
      reparto_desc: H.reparto_desc >= 0 ? (String(r[H.reparto_desc] || '').trim() || null) : null,
      ult_costo: H.ult_costo >= 0 ? parseNumber(r[H.ult_costo]) : null,
      data_ult_costo: H.data_costo >= 0 ? parseDate(r[H.data_costo]) : null,
    };

    // Preferisci la riga del magazzino "1" come fonte anagrafica (dati più affidabili)
    const existing = anagrafica.get(cod);
    if (!existing || (mag === '1' && existing._mag !== '1')) {
      anagrafica.set(cod, { ...ana, _mag: mag });
    }

    giacenze.push({
      codice: cod,
      magazzino: mag,
      esistenza: parseNumber(r[H.esistenza]) ?? 0,
      disponibilita: H.disp >= 0 ? (parseNumber(r[H.disp]) ?? 0) : 0,
    });
  }

  // Pulisci _mag e calcola hash_riga
  const anagraficaArr = [];
  for (const a of anagrafica.values()) {
    delete a._mag;
    a.hash_riga = hashRiga(a);
    anagraficaArr.push(a);
  }

  return { anagrafica: anagraficaArr, giacenze, righe_lette: rows.length };
}

// ─── Upsert a batch ────────────────────────────────────────────────────────
async function upsertBatch(table, rows, conflictTarget, batchSize = 500) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error, count } = await supabase
      .from(table)
      .upsert(chunk, { onConflict: conflictTarget, count: 'exact', ignoreDuplicates: false });
    if (error) throw new Error(`upsert ${table} fallita batch ${i}: ${error.message}`);
    inserted += chunk.length;
    vlog(`  ${table} batch ${i}-${i + chunk.length}: ok`);
  }
  return inserted;
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  log('='.repeat(70));
  log(`IMPORT CRUSCOTTO`);
  log('='.repeat(70));
  log(`File:    ${FILE}`);
  const stat = statSync(FILE);
  log(`Size:    ${(stat.size / 1024).toFixed(1)} KB`);
  const md5 = md5File(FILE);
  log(`MD5:     ${md5}`);
  if (DRY_RUN) log('Mode:    DRY-RUN (nessuna scrittura DB)');

  // 1) Parse
  log('\n[1/5] Parsing sorgente…');
  const { anagrafica, giacenze, righe_lette } = parseAll(FILE);
  log(`  righe lette:    ${righe_lette}`);
  log(`  prodotti unici: ${anagrafica.length}`);
  log(`  giacenze tot:   ${giacenze.length}`);
  const magCount = new Map();
  for (const g of giacenze) magCount.set(g.magazzino, (magCount.get(g.magazzino) || 0) + 1);
  log(`  magazzini:      ${[...magCount.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}(${v})`).join(', ')}`);

  if (DRY_RUN) {
    log('\n[dry-run] Stop qui. Niente scritto.');
    return;
  }

  // 2) Skip se hash file uguale all'ultimo import OK
  log('\n[2/5] Check hash file…');
  const { data: lastLog } = await supabase
    .from('prodotti_import_log')
    .select('id, file_md5, esito, iniziato_il')
    .eq('esito', 'ok')
    .order('iniziato_il', { ascending: false })
    .limit(1);
  if (lastLog?.[0]?.file_md5 === md5) {
    log(`  hash uguale a import ${lastLog[0].iniziato_il} → skip`);
    await supabase.from('prodotti_import_log').insert({
      file_path: FILE, file_md5: md5, righe_lette,
      esito: 'skip_hash_uguale', finito_il: new Date().toISOString(),
      durata_ms: Date.now() - t0,
    });
    return;
  }
  log('  hash diverso → procedo con import');

  // 3) Apri log import
  log('\n[3/5] Avvio log import…');
  const { data: logRow, error: logErr } = await supabase
    .from('prodotti_import_log')
    .insert({ file_path: FILE, file_md5: md5, righe_lette })
    .select('id')
    .single();
  if (logErr) throw new Error('log insert fallito: ' + logErr.message);
  const logId = logRow.id;
  vlog('  log id:', logId);

  let stats = {
    prodotti_nuovi: 0, prodotti_aggiornati: 0, prodotti_disattivati: 0,
    giacenze_inserite: 0, giacenze_aggiornate: 0, giacenze_eliminate: 0,
  };

  try {
    // 4a) Prodotti: confronta con quanto c'è in DB per contare nuovi vs aggiornati
    log('\n[4/5] Upsert prodotti (anagrafica)…');
    const codici = anagrafica.map((a) => a.codice);
    const codiciSet = new Set(codici);

    // Codici già in DB con hash_riga
    const existingMap = new Map();
    const pageSize = 200;
    for (let i = 0; i < codici.length; i += pageSize) {
      const slice = codici.slice(i, i + pageSize);
      const { data: existing, error } = await supabase
        .from('prodotti')
        .select('codice, hash_riga, attivo')
        .in('codice', slice);
      if (error) throw new Error('select existing prodotti: ' + error.message);
      for (const e of existing || []) existingMap.set(e.codice, e);
    }

    const toUpsert = [];
    for (const a of anagrafica) {
      const ex = existingMap.get(a.codice);
      if (!ex) {
        stats.prodotti_nuovi++;
        toUpsert.push({ ...a, attivo: true, aggiornato_il: new Date().toISOString() });
      } else if (ex.hash_riga !== a.hash_riga || !ex.attivo) {
        stats.prodotti_aggiornati++;
        toUpsert.push({ ...a, attivo: true, aggiornato_il: new Date().toISOString() });
      }
      // hash_riga uguale → skip totale (zero scritture)
    }
    log(`  nuovi:       ${stats.prodotti_nuovi}`);
    log(`  aggiornati:  ${stats.prodotti_aggiornati}`);
    log(`  invariati:   ${anagrafica.length - stats.prodotti_nuovi - stats.prodotti_aggiornati}`);
    if (toUpsert.length > 0) {
      await upsertBatch('prodotti', toUpsert, 'codice');
    }

    // 4b) Soft delete: prodotti in DB ma non più nel file
    log('\n  soft delete (codici scomparsi)…');
    let disattivati = 0;
    const dbCodiciAttivi = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('prodotti')
        .select('codice')
        .eq('attivo', true)
        .range(from, from + 999);
      if (error) throw new Error('select attivi: ' + error.message);
      if (!data || data.length === 0) break;
      dbCodiciAttivi.push(...data.map((r) => r.codice));
      if (data.length < 1000) break;
      from += 1000;
    }
    const daDisattivare = dbCodiciAttivi.filter((c) => !codiciSet.has(c));
    for (let i = 0; i < daDisattivare.length; i += pageSize) {
      const slice = daDisattivare.slice(i, i + pageSize);
      const { error, count } = await supabase
        .from('prodotti')
        .update({ attivo: false, aggiornato_il: new Date().toISOString() })
        .in('codice', slice);
      if (error) throw new Error('disattivazione: ' + error.message);
      disattivati += slice.length;
    }
    stats.prodotti_disattivati = disattivati;
    log(`  disattivati: ${disattivati}`);

    // 5a) Giacenze: cancella quelle "orfane" (codice+mag non più nel file), poi upsert
    log('\n[5/5] Sync giacenze…');

    // Strategia: per ogni codice del file, calcola i magazzini presenti.
    // Poi DELETE solo le righe del DB la cui (codice, magazzino) non sta nel file.
    // Più efficiente: prima DELETE di tutto ciò che non è nel set, poi upsert massivo.

    // Carica giacenze attuali del DB per i codici del file
    const giacenzeDb = [];
    for (let i = 0; i < codici.length; i += pageSize) {
      const slice = codici.slice(i, i + pageSize);
      const { data, error } = await supabase
        .from('prodotti_giacenze')
        .select('codice, magazzino, esistenza, disponibilita')
        .in('codice', slice);
      if (error) throw new Error('select giacenze: ' + error.message);
      if (data) giacenzeDb.push(...data);
    }
    const dbKey = (g) => `${g.codice}${g.magazzino}`;
    const fileSet = new Set(giacenze.map(dbKey));
    const orfane = giacenzeDb.filter((g) => !fileSet.has(dbKey(g)));
    log(`  giacenze DB attuali (per codici del file): ${giacenzeDb.length}`);
    log(`  giacenze orfane da eliminare:              ${orfane.length}`);

    // DELETE orfane (a batch sui codici, filtrando per magazzino)
    // Più semplice: raggruppa per codice e cancella le righe per (codice, magazzini-non-nel-file)
    const orfanePerCod = new Map();
    for (const o of orfane) {
      if (!orfanePerCod.has(o.codice)) orfanePerCod.set(o.codice, []);
      orfanePerCod.get(o.codice).push(o.magazzino);
    }
    for (const [cod, mags] of orfanePerCod) {
      const { error } = await supabase
        .from('prodotti_giacenze')
        .delete()
        .eq('codice', cod)
        .in('magazzino', mags);
      if (error) throw new Error(`delete giacenze ${cod}: ${error.message}`);
    }
    stats.giacenze_eliminate = orfane.length;

    // Calcola nuove vs aggiornate per il log
    const dbGiacenzeMap = new Map(giacenzeDb.map((g) => [dbKey(g), g]));
    let nuove = 0;
    let aggiornate = 0;
    const giacenzeToUpsert = [];
    for (const g of giacenze) {
      const k = dbKey(g);
      const ex = dbGiacenzeMap.get(k);
      if (!ex) {
        nuove++;
        giacenzeToUpsert.push({ ...g, aggiornato_il: new Date().toISOString() });
      } else if (Number(ex.esistenza) !== g.esistenza || Number(ex.disponibilita) !== g.disponibilita) {
        aggiornate++;
        giacenzeToUpsert.push({ ...g, aggiornato_il: new Date().toISOString() });
      }
    }
    stats.giacenze_inserite = nuove;
    stats.giacenze_aggiornate = aggiornate;
    log(`  giacenze nuove:      ${nuove}`);
    log(`  giacenze aggiornate: ${aggiornate}`);
    log(`  giacenze invariate:  ${giacenze.length - nuove - aggiornate}`);

    if (giacenzeToUpsert.length > 0) {
      await upsertBatch('prodotti_giacenze', giacenzeToUpsert, 'codice,magazzino');
    }

    // Chiudi log
    const durata = Date.now() - t0;
    await supabase.from('prodotti_import_log').update({
      finito_il: new Date().toISOString(),
      esito: 'ok',
      durata_ms: durata,
      ...stats,
    }).eq('id', logId);

    log('\n' + '='.repeat(70));
    log('✓ IMPORT COMPLETATO');
    log('='.repeat(70));
    log(`Durata:     ${(durata / 1000).toFixed(2)}s`);
    log(`Prodotti:   +${stats.prodotti_nuovi} nuovi, ~${stats.prodotti_aggiornati} aggiornati, -${stats.prodotti_disattivati} disattivati`);
    log(`Giacenze:   +${stats.giacenze_inserite} nuove, ~${stats.giacenze_aggiornate} aggiornate, -${stats.giacenze_eliminate} eliminate`);
  } catch (err) {
    await supabase.from('prodotti_import_log').update({
      finito_il: new Date().toISOString(),
      esito: 'errore',
      errore: String(err.message || err),
      durata_ms: Date.now() - t0,
      ...stats,
    }).eq('id', logId);
    throw err;
  }
}

main().catch((err) => {
  console.error('\n❌ ERRORE:', err.message || err);
  process.exit(1);
});
