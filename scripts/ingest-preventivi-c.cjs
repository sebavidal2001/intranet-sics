#!/usr/bin/env node
/**
 * Ingestion delle cartelle C ("verifica prezzi" — progetti ripetitivi).
 *
 * Differenze chiave rispetto agli S (ingest-preventivi-v2.cjs):
 *  - 1 foglio standard ~26×N celle, NO distinta analitica (no righe_distinta)
 *  - Layout fisso a totali aggregati (label in col A, valori in col E e I)
 *  - Multi-foglio = N articoli separati nello stesso documenti (N chunks + N blocchi)
 *  - tipo_cartella='C' + tipo='storico' (i C sono archivio, no workflow)
 *
 * Esclusioni automatiche:
 *  - File solo .docx (cartelle senza Excel)
 *  - File .lnk (shortcut Windows → S)
 *  - Vecchio template (header tabellare riga ~6, >40 righe)
 *  - Multi-grid (>1 totale_materiale o >1 totale_manodopera nello stesso foglio)
 *  - Allegati ausiliari: D.82-9 Check list*, APPUNTI.docx, IMPLEMENTAZIONI.xlsx,
 *    ANALISI PROGRAMMA*, NASTRI + UNLOADING*, ANALISI CONSUNTIVO-PREVENTIVO,
 *    VERIFICA a CONSUNTIVO, ANALISI CONSUNTIVE
 *  - Versioni REV vecchie (tiene solo l'ultima)
 *
 * Uso:
 *   node scripts/ingest-preventivi-c.cjs --dry-run                       # anteprima
 *   node scripts/ingest-preventivi-c.cjs --commit                       # scrive DB
 *   node scripts/ingest-preventivi-c.cjs --commit --only C_25_38        # singola cartella
 *   node scripts/ingest-preventivi-c.cjs --commit --year 2026           # solo 2026
 *   --source <root>    Cartella sorgente (default: env CARTELLE_C_SOURCE_DIR o ~/Downloads/...)
 */

const fs = require("fs");
const path = require("path");

// Load .env.local
(function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})();

const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

// ── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, def) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const SOURCE = val("--source", process.env.CARTELLE_C_SOURCE_DIR ||
  "C:/Users/sebav/Downloads/wetransfer_preventivi-x-configuratore_2026-05-14_1511/PREVENTIVI x CONFIGURATORE");
const DRY = !flag("--commit");
const ONLY = val("--only", null);
const YEAR = val("--year", null);
const VERBOSE = flag("--verbose");

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

// ── Helpers ────────────────────────────────────────────────────────────────
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const txt = (v) => (v === null || v === undefined ? null : String(v).trim() || null);

// Identifica file standard "VERIFICA PREZZI" (vs vecchio template / multi-grid / aggregato)
function isStandardSheet(ws) {
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  const rows = range.e.r + 1;
  if (rows > 30) return false; // troppo grande
  const a1 = String(ws["A1"]?.v ?? "").toLowerCase();
  const a3 = String(ws["A3"]?.v ?? "");
  const a19 = String(ws["A19"]?.v ?? "").toLowerCase();
  if (!a1.includes("progetto")) return false;
  if (!a19.includes("prezzo finale")) return false;
  if (!a3) return false;
  return true;
}

// File "non standard" da escludere a priori dal filename
function shouldSkipFile(name) {
  const n = name.toLowerCase();
  if (/check\s*list/i.test(n)) return "checklist";
  if (/^appunti/i.test(n)) return "appunti";
  if (/^implementazioni/i.test(n)) return "implementazioni";
  if (/analisi\s+programma/i.test(n)) return "analisi_aggregato";
  if (/nastri\s*\+\s*unloading/i.test(n)) return "multi_grid";
  if (/analisi\s+consuntivo/i.test(n)) return "analisi_consuntivo";
  if (/consuntivo-preventivo/i.test(n)) return "analisi_consuntivo";
  if (/consuntive/i.test(n)) return "consuntive";
  if (/verifica\s+a\s+consuntivo/i.test(n)) return "verifica_a_consuntivo";
  if (/\.lnk$/i.test(n)) return "lnk_shortcut";
  if (/\.docx?$/i.test(n)) return "word";
  if (/^vecchie/i.test(n)) return "vecchie_quotazioni";
  return null;
}

// Estrae i dati standard da UN foglio del template VERIFICA PREZZI
function extractSheet(ws, sheetName) {
  const cell = (a1) => ws[a1]?.v;
  const codiceArt = txt(cell("A3"));
  const quantita = num(cell("I3"));
  // h manodopera (colonna C, righe 6-10)
  const h = {
    progettazione: num(cell("C6")),
    lavorazione:   num(cell("C7")),
    montaggio:     num(cell("C8")),
    collaudo:      num(cell("C9")),
    manuale:       num(cell("C10")),
  };
  // €/h (colonna D)
  const oraria = {
    progettazione: num(cell("D6")),
    lavorazione:   num(cell("D7")),
    montaggio:     num(cell("D8")),
    collaudo:      num(cell("D9")),
    manuale:       num(cell("D10")),
  };
  // costo manodopera (colonna E)
  const costo_md = {
    progettazione: num(cell("E6")),
    lavorazione:   num(cell("E7")),
    montaggio:     num(cell("E8")),
    collaudo:      num(cell("E9")),
    manuale:       num(cell("E10")),
  };

  // Cerca le label "TOTALE MATERIALE" e "MATERIA PRIMA" su col A (la posizione varia di ±1)
  let materia_prima_costo = null;
  let materia_prima_prezzo = null;
  let totale_manodopera_costo = null;
  let totale_manodopera_prezzo = null;
  let tempi_accessori = null;
  let spese_generali = null;
  let imballaggio = null;
  let totale_costi = null;
  let totale = null;
  let prezzo_finale = null;
  let margine_trattativa_pct = null;
  let prezzo_ultima_vendita = null;
  let margine_commessa_eur = null;
  let margine_commessa_pct = null;

  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let r = 0; r <= range.e.r; r++) {
    const a = String(ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v ?? "").trim().toLowerCase();
    if (!a) continue;
    const e = num(ws[XLSX.utils.encode_cell({ r, c: 4 })]?.v);
    const i = num(ws[XLSX.utils.encode_cell({ r, c: 8 })]?.v);
    const h_v = num(ws[XLSX.utils.encode_cell({ r, c: 7 })]?.v);

    if (a === "materia prima" || a.startsWith("totale materiale")) {
      if (materia_prima_costo === null) {
        materia_prima_costo = e;
        materia_prima_prezzo = i;
      }
    } else if (a === "totale manodopera") {
      totale_manodopera_costo = e;
      totale_manodopera_prezzo = i;
    } else if (a.includes("tempi accessori")) {
      tempi_accessori = i ?? e;
    } else if (a.includes("spese generali")) {
      spese_generali = i ?? e;
    } else if (a.includes("imballaggio")) {
      imballaggio = i;
    } else if (a === "totale costi") {
      totale_costi = e;
    } else if (a === "totale") {
      totale = i;
    } else if (a.startsWith("margine trattativa")) {
      margine_trattativa_pct = i;
    } else if (a === "prezzo finale") {
      prezzo_finale = i;
    } else if (a.startsWith("prezzo ultima vendita")) {
      prezzo_ultima_vendita = i;
    } else if (a.startsWith("margine commessa")) {
      margine_commessa_eur = i;
      margine_commessa_pct = h_v;
    }
  }

  // L3 = "ULTIMO COSTO", M3 valore €, L4 anno (YYYY)
  const ultimoCostoValore = num(ws["M3"]?.v);
  const annoMatch = String(ws["L4"]?.v ?? "").match(/(\d{4})/);
  const ultimoCostoAnno = annoMatch ? parseInt(annoMatch[1], 10) : null;

  return {
    sheet_name: sheetName,
    codice_articolo: codiceArt,
    quantita,
    manodopera_h: h,
    manodopera_orario: oraria,
    manodopera_costo: costo_md,
    materia_prima_costo,
    materia_prima_prezzo,
    totale_manodopera_costo,
    totale_manodopera_prezzo,
    tempi_accessori,
    spese_generali,
    imballaggio,
    totale_costi,
    totale,
    margine_trattativa_pct,
    prezzo_finale,
    prezzo_ultima_vendita,
    margine_commessa_eur,
    margine_commessa_pct,
    ultimo_costo_valore: ultimoCostoValore,
    ultimo_costo_anno: ultimoCostoAnno,
  };
}

function summaryText(folderCode, cliente, descrizione, sheets) {
  const lines = [`Cartella ${folderCode} - Cliente: ${cliente}`];
  if (descrizione) lines.push(`Descrizione: ${descrizione}`);
  lines.push("");
  for (const s of sheets) {
    lines.push(`Articolo ${s.codice_articolo || "?"} (qta ${s.quantita ?? "?"})`);
    if (s.materia_prima_costo !== null) lines.push(`  Materia prima: costo ${s.materia_prima_costo} EUR, prezzo ${s.materia_prima_prezzo} EUR`);
    if (s.totale_manodopera_costo !== null) {
      const ore = Object.entries(s.manodopera_h).filter(([, v]) => v && v > 0).map(([k, v]) => `${k} ${v}h`).join(", ");
      lines.push(`  Manodopera: costo ${s.totale_manodopera_costo} EUR, prezzo ${s.totale_manodopera_prezzo} EUR (${ore})`);
    }
    if (s.tempi_accessori !== null) lines.push(`  Tempi accessori: ${s.tempi_accessori} EUR`);
    if (s.spese_generali !== null) lines.push(`  Spese generali: ${s.spese_generali} EUR`);
    if (s.imballaggio !== null) lines.push(`  Imballaggio: ${s.imballaggio} EUR`);
    if (s.totale_costi !== null) lines.push(`  Totale costi: ${s.totale_costi} EUR`);
    if (s.prezzo_finale !== null) lines.push(`  Prezzo finale: ${s.prezzo_finale} EUR`);
    if (s.prezzo_ultima_vendita !== null) lines.push(`  Ultima vendita: ${s.prezzo_ultima_vendita} EUR | margine ${s.margine_commessa_eur ?? "?"} EUR (${s.margine_commessa_pct ? (s.margine_commessa_pct * 100).toFixed(1) + "%" : "?"})`);
    if (s.ultimo_costo_valore !== null) lines.push(`  Ultimo costo storico (${s.ultimo_costo_anno ?? "?"}): ${s.ultimo_costo_valore} EUR`);
    lines.push("");
  }
  return lines.join("\n");
}

// ── Scan folders ───────────────────────────────────────────────────────────
function findCFolders(root) {
  const folders = [];
  for (const y of fs.readdirSync(root, { withFileTypes: true })) {
    if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue;
    if (YEAR && y.name !== YEAR) continue;
    const yd = path.join(root, y.name);
    for (const d of fs.readdirSync(yd, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const m = d.name.match(/^C_(\d{2})_(\d+)/i);
      if (!m) continue;
      const code = `C_${m[1]}_${m[2]}`;
      if (ONLY && code !== ONLY) continue;
      folders.push({
        codice: code,
        anno: 2000 + parseInt(m[1], 10),
        path: path.join(yd, d.name),
        nome: d.name,
      });
    }
  }
  return folders;
}

function parseFolderMeta(folderName) {
  // "C_25_38 CURTI (TELAIO SCARICO MACCHINA 95264560)" → cliente="CURTI", descrizione=parens
  const m = folderName.match(/^C_\d{2}_\d+\s*([^()]+?)\s*(?:\((.*)\))?\s*$/);
  if (!m) return { cliente: null, descrizione: null };
  return { cliente: txt(m[1]), descrizione: txt(m[2] ?? null) };
}

// Cliente master lookup — con fallback a destinazione e a token (es. "IMA SAFE"
// trova IMA spa + dest "div.SAFE"; "SER.MAC." trova SER.MAC srl).
async function lookupClienteMaster(ragione) {
  if (!ragione) return null;
  const cleaned = ragione.replace(/['"]/g, "").trim().toUpperCase();

  // Strategia 1: prefix match sulla ragione_sociale
  let { data } = await db.schema("preventivatore").from("clienti_master")
    .select("id, ragione_sociale, destinazione, id_destinazione")
    .ilike("ragione_sociale", `${cleaned}%`)
    .limit(50);

  // Strategia 2: se nulla, prova con il primo token (es. "IMA SAFE" → "IMA")
  // poi filtra per destinazione che contiene il resto.
  if (!data || data.length === 0) {
    const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
    if (tokens.length > 1) {
      const primo = tokens[0];
      const resto = tokens.slice(1).join(" ").toUpperCase();
      const { data: d2 } = await db.schema("preventivatore").from("clienti_master")
        .select("id, ragione_sociale, destinazione, id_destinazione")
        .ilike("ragione_sociale", `${primo}%`)
        .limit(200);
      data = (d2 ?? []).filter((r) => (r.destinazione ?? "").toUpperCase().includes(resto));
      if (data.length === 0 && d2 && d2.length > 0) {
        // fallback: prendi HQ del primo token
        data = d2;
      }
    } else {
      // Strategia 3: contains sulla destinazione
      const { data: d3 } = await db.schema("preventivatore").from("clienti_master")
        .select("id, ragione_sociale, destinazione, id_destinazione")
        .ilike("destinazione", `%${cleaned}%`)
        .limit(50);
      data = d3 ?? [];
    }
  }

  if (!data || data.length === 0) return null;

  // Preferenza HQ pura (ragione=destinazione), poi id_destinazione minore
  const sorted = data.sort((a, b) => {
    const ah = (a.ragione_sociale ?? "").trim() === (a.destinazione ?? "").trim() ? 0 : 1;
    const bh = (b.ragione_sociale ?? "").trim() === (b.destinazione ?? "").trim() ? 0 : 1;
    if (ah !== bh) return ah - bh;
    const ai = parseInt(a.id_destinazione, 10);
    const bi = parseInt(b.id_destinazione, 10);
    if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
    return 0;
  });
  return sorted[0];
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`[${new Date().toISOString()}] Ingestion cartelle C  (${DRY ? "DRY-RUN" : "COMMIT"})`);
  console.log(`  Sorgente: ${SOURCE}`);
  if (ONLY) console.log(`  Filtro:   ${ONLY}`);
  if (YEAR) console.log(`  Anno:     ${YEAR}`);

  if (!fs.existsSync(SOURCE)) { console.error("Cartella sorgente non trovata"); process.exit(1); }
  const folders = findCFolders(SOURCE);
  console.log(`  Cartelle C trovate: ${folders.length}`);

  const stats = { processate: 0, scartate: 0, errori: 0, articoli: 0 };
  const audit = [];

  for (const f of folders) {
    const meta = parseFolderMeta(f.nome);
    const files = fs.readdirSync(f.path);

    // Trova il/i file Excel candidati (esclude allegati e file non standard)
    const xlsxCandidates = files
      .filter((n) => /\.xlsx$/i.test(n))
      .filter((n) => !shouldSkipFile(n));

    // Logica varianti: preferisci VERIFICA PREZZI > AFD.*.xlsx > altri
    let candidate = xlsxCandidates.find((n) => /verifica\s+prezzi\s+con\s+aumenti/i.test(n))
                 || xlsxCandidates.find((n) => /verifica\s+prezzi/i.test(n))
                 || xlsxCandidates.find((n) => /verifica\s+prezzo/i.test(n))
                 || xlsxCandidates.find((n) => /^AFD\..*\.xlsx$/i.test(n))
                 || xlsxCandidates.find((n) => /^D\..*\.xlsx$/i.test(n))
                 || xlsxCandidates.find((n) => /^AIRF-/i.test(n))
                 || xlsxCandidates[0];

    if (!candidate) {
      audit.push({ codice: f.codice, esito: "skip", motivo: "no_xlsx", files });
      stats.scartate++;
      continue;
    }

    const filePath = path.join(f.path, candidate);
    let wb;
    try { wb = XLSX.readFile(filePath, { cellDates: false, cellFormula: false, cellStyles: false }); }
    catch (e) { audit.push({ codice: f.codice, esito: "errore", motivo: "read_fail", err: e.message }); stats.errori++; continue; }

    const standardSheets = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      if (isStandardSheet(ws)) standardSheets.push({ name, ws });
    }

    if (standardSheets.length === 0) {
      audit.push({ codice: f.codice, esito: "skip", motivo: "no_standard_sheet", file: candidate, fogli: wb.SheetNames });
      stats.scartate++;
      continue;
    }

    const sheets = standardSheets.map((s) => extractSheet(s.ws, s.name));

    // Codici articolo aggregati per documenti.codici_articolo
    const codiciAfd = sheets.map((s) => s.codice_articolo).filter(Boolean);
    const importoTotale = sheets.map((s) => s.prezzo_finale).filter((x) => x !== null).reduce((a, b) => a + b, 0) || null;

    // Lookup cliente_master
    const clienteMaster = await lookupClienteMaster(meta.cliente);

    audit.push({
      codice: f.codice, esito: "ok", cliente: meta.cliente, descrizione: meta.descrizione,
      file: candidate, n_articoli: sheets.length, codici: codiciAfd,
      importo_totale: importoTotale,
      cliente_master: clienteMaster ? `[${clienteMaster.id_destinazione}] ${clienteMaster.ragione_sociale}` : "(non risolto)",
    });

    if (DRY) {
      if (VERBOSE) console.log(`  ✓ ${f.codice}  ${meta.cliente?.padEnd(20)}  ${sheets.length} art.  ${importoTotale ? Math.round(importoTotale) + " EUR" : "?"}`);
      stats.processate++;
      stats.articoli += sheets.length;
      continue;
    }

    // ── COMMIT: INSERT documenti + N chunks + N blocchi ───────────────────
    // documenti (UPSERT by codice)
    const docPayload = {
      codice: f.codice,
      tipo: "storico",
      tipo_cartella: "C",
      cliente: meta.cliente,
      cliente_master_id: clienteMaster?.id ?? null,
      anno: f.anno,
      tipo_prodotto: "verifica_prezzi",
      codici_articolo: codiciAfd,
      importo_preventivo: importoTotale ?? null,
      importo_finale_raw: importoTotale ?? null,
      importo_source: "verifica_prezzi_c",
      versione_ingest: "c_v1",
      stato: "storico",
      note: meta.descrizione || null,
    };
    // upsert
    const { data: existingDoc } = await db.schema("preventivatore").from("documenti")
      .select("id").eq("codice", f.codice).maybeSingle();
    let docId;
    if (existingDoc) {
      docId = existingDoc.id;
      const { error } = await db.schema("preventivatore").from("documenti")
        .update({ ...docPayload, updated_at: new Date().toISOString() }).eq("id", docId);
      if (error) { console.error(`  ERR update ${f.codice}:`, error.message); stats.errori++; continue; }
      // Pulisci chunks e blocchi esistenti per re-import pulito
      await db.schema("preventivatore").from("chunks").delete().eq("documento_id", docId);
      await db.schema("preventivatore").from("blocchi").delete().eq("documento_id", docId);
    } else {
      const { data, error } = await db.schema("preventivatore").from("documenti").insert(docPayload).select("id").single();
      if (error) { console.error(`  ERR insert ${f.codice}:`, error.message); stats.errori++; continue; }
      docId = data.id;
    }

    // Chunk testuale (uno per articolo) e blocchi
    const chunksPayload = sheets.map((s, idx) => ({
      documento_id: docId,
      chunk_index: idx,
      contenuto: summaryText(f.codice, meta.cliente, meta.descrizione, [s]),
      metadata: {
        tipo: "preventivo_c",
        template: "verifica_prezzi",
        sheet_name: s.sheet_name,
        codice_articolo: s.codice_articolo,
        quantita: s.quantita,
        totali_c: {
          materia_prima:   { costo: s.materia_prima_costo, prezzo: s.materia_prima_prezzo },
          manodopera:      { h: s.manodopera_h, orario: s.manodopera_orario, costo_dettaglio: s.manodopera_costo,
                             totale_costo: s.totale_manodopera_costo, totale_prezzo: s.totale_manodopera_prezzo },
          tempi_accessori: s.tempi_accessori,
          spese_generali:  s.spese_generali,
          imballaggio:     s.imballaggio,
          totale_costi:    s.totale_costi,
          totale:          s.totale,
          margine_trattativa_pct: s.margine_trattativa_pct,
          prezzo_finale:   s.prezzo_finale,
          prezzo_ultima_vendita: s.prezzo_ultima_vendita,
          margine_commessa_eur: s.margine_commessa_eur,
          margine_commessa_pct: s.margine_commessa_pct,
        },
        ultimo_costo_storico: s.ultimo_costo_valore !== null
          ? { anno: s.ultimo_costo_anno, valore: s.ultimo_costo_valore }
          : null,
      },
    }));
    await db.schema("preventivatore").from("chunks").insert(chunksPayload);

    const blocchiPayload = sheets.map((s) => ({
      documento_id: docId,
      codice_blocco: s.codice_articolo,
      sheet_name: s.sheet_name,
      totale_raw: s.prezzo_finale,
      totale_ceil_2: s.prezzo_finale !== null ? Math.ceil(s.prezzo_finale * 100) / 100 : null,
    }));
    await db.schema("preventivatore").from("blocchi").insert(blocchiPayload);

    stats.processate++;
    stats.articoli += sheets.length;
    if (VERBOSE) console.log(`  ✓ ${f.codice}  ${meta.cliente?.padEnd(20)}  ${sheets.length} art.  ${importoTotale ? Math.round(importoTotale) + " EUR" : "?"}`);
  }

  console.log(`\n=== Stats ===`);
  console.log(`  Cartelle processate: ${stats.processate}`);
  console.log(`  Cartelle scartate:   ${stats.scartate}`);
  console.log(`  Errori:              ${stats.errori}`);
  console.log(`  Articoli totali:     ${stats.articoli}`);

  // Salva audit
  const auditPath = path.join(process.cwd(), "ingest-c-audit.json");
  fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2));
  console.log(`Audit salvato in: ${auditPath}`);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
