/**
 * bi-riconcilia-cruscotto.mjs — Report di riconciliazione PRE-import (Fase 1).
 *
 * Confronta uno snapshot del Cruscotto articoli (CSV o XLSX) con lo stato
 * corrente del database, SENZA scrivere nulla. Produce un report CSV con le
 * anomalie da valutare prima di attivare la pipeline.
 *
 * Controlli prodotti:
 *   1. codici nel Cruscotto ma non in preventivatore.prodotti
 *   2. codici in prodotti ma non nel Cruscotto  (NON vengono disattivati)
 *   3. duplicati per codice articolo
 *   4. duplicati per (codice, magazzino)
 *   5. articoli senza costo (ultimo_costo NULL/vuoto)
 *   6. magazzini non presenti oggi in prodotti_giacenze
 *   7. righe con disponibilita != esistenza + ord_fornitori - ord_clienti - imp_produzione
 *   8. valori numerici non validi
 *   9. righe senza chiave (codice o magazzino mancante)
 *
 * Uso:
 *   node scripts/bi-riconcilia-cruscotto.mjs --file=<path.csv|path.xlsx> [--csv] [--out=<dir>]
 */

import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

// ─── env ────────────────────────────────────────────────────────────────────
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const arg = (n, d = null) => {
  const m = process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (!m) return d;
  return m === `--${n}` ? true : m.split("=").slice(1).join("=");
};

const FILE = arg("file");
const FORCE_CSV = !!arg("csv");
const OUT_DIR = arg("out", "supabase/backups/20260801_preflight");
if (!FILE) { console.error("Manca --file=<path>"); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }, db: { schema: "preventivatore" },
});

// ─── parsing numerico coerente con l'import esistente ────────────────────────
function parseNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v).trim().replace(/[€%\s]/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  if (s === "") return null;
  const x = Number.parseFloat(s);
  return Number.isFinite(x) ? x : NaN; // NaN = valore non valido (controllo 8)
}

const COL = {
  codice: ["codice", "Codice"],
  magazzino: ["magazzino", "Magazzino"],
  costo: ["ultimo_costo", "Ult Costo", "ult_costo"],
  esistenza: ["esistenza", "Esistenza"],
  disponibilita: ["disponibilita", "Disponibilita", "Disponibilità"],
  ordForn: ["qta_ord_fornitori", "Qta Ord Fornitori"],
  ordCli: ["qta_ord_clienti", "Qta Ord Clienti"],
  impProd: ["qta_imp_produzione", "Qta Imp Produzione"],
};

function idx(headers, names) {
  for (const n of names) {
    const i = headers.findIndex((h) => String(h).trim().toLowerCase() === n.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

function leggi(file) {
  const isCsv = FORCE_CSV || /\.csv$/i.test(file);
  const wb = isCsv
    ? XLSX.read(fs.readFileSync(file, "utf8"), { type: "string", raw: false, FS: ";" })
    : XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  return { headers: data[0].map((h) => String(h || "").trim()), righe: data.slice(1) };
}

// ─── main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log("Riconciliazione Cruscotto ↔ database (sola lettura)\n  file:", FILE);
  const { headers, righe } = leggi(FILE);
  const H = Object.fromEntries(Object.entries(COL).map(([k, names]) => [k, idx(headers, names)]));
  if (H.codice < 0) throw new Error('Colonna "codice" non trovata');
  console.log(`  colonne: ${headers.length} · righe: ${righe.length}`);

  // ── stato DB ──
  const codiciDb = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("prodotti").select("codice").range(from, from + 999);
    if (error) throw new Error("select prodotti: " + error.message);
    if (!data?.length) break;
    data.forEach((r) => codiciDb.add(r.codice));
    if (data.length < 1000) break;
  }
  const magazziniDb = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("prodotti_giacenze").select("magazzino").range(from, from + 999);
    if (error) throw new Error("select giacenze: " + error.message);
    if (!data?.length) break;
    data.forEach((r) => magazziniDb.add(r.magazzino));
    if (data.length < 1000) break;
  }
  console.log(`  DB: ${codiciDb.size} codici · magazzini: ${[...magazziniDb].sort().join(", ")}`);

  // ── analisi ──
  const anomalie = [];
  const add = (tipo, codice, magazzino, dettaglio) => anomalie.push({ tipo, codice, magazzino, dettaglio });

  const visteChiavi = new Map();   // codice|magazzino -> n
  const codiciFile = new Map();    // codice -> n righe
  let senzaCosto = 0, dispErrata = 0, numInvalidi = 0, senzaChiave = 0;

  for (const r of righe) {
    const codice = String(r[H.codice] ?? "").trim();
    const magazzino = H.magazzino >= 0 ? String(r[H.magazzino] ?? "").trim() : "";
    if (!codice || !magazzino) { senzaChiave++; add("riga_senza_chiave", codice || "(vuoto)", magazzino || "(vuoto)", "codice o magazzino mancante"); continue; }

    codiciFile.set(codice, (codiciFile.get(codice) ?? 0) + 1);
    const key = `${codice}|${magazzino}`;
    visteChiavi.set(key, (visteChiavi.get(key) ?? 0) + 1);

    const costo = H.costo >= 0 ? parseNum(r[H.costo]) : null;
    if (Number.isNaN(costo)) { numInvalidi++; add("numero_non_valido", codice, magazzino, `ultimo_costo="${r[H.costo]}"`); }
    else if (costo === null) { senzaCosto++; add("articolo_senza_costo", codice, magazzino, "ultimo_costo assente → resterà NULL"); }

    if (!magazziniDb.has(magazzino)) add("magazzino_non_riconosciuto", codice, magazzino, "non presente oggi in prodotti_giacenze");

    // disponibilità derivata
    if (H.esistenza >= 0 && H.disponibilita >= 0 && H.ordForn >= 0 && H.ordCli >= 0 && H.impProd >= 0) {
      const e = parseNum(r[H.esistenza]) ?? 0, d = parseNum(r[H.disponibilita]) ?? 0;
      const of = parseNum(r[H.ordForn]) ?? 0, oc = parseNum(r[H.ordCli]) ?? 0, ip = parseNum(r[H.impProd]) ?? 0;
      if ([e, d, of, oc, ip].some(Number.isNaN)) { numInvalidi++; add("numero_non_valido", codice, magazzino, "quantità non numeriche"); }
      else {
        const atteso = e + of - oc - ip;
        if (Math.abs(atteso - d) > 0.001) { dispErrata++; add("disponibilita_non_coerente", codice, magazzino, `attesa ${atteso}, trovata ${d}`); }
      }
    }
  }

  for (const [key, n] of visteChiavi) if (n > 1) add("duplicato_codice_magazzino", key.split("|")[0], key.split("|")[1], `${n} righe`);

  const nuovi = [...codiciFile.keys()].filter((c) => !codiciDb.has(c));
  const mancanti = [...codiciDb].filter((c) => !codiciFile.has(c));
  nuovi.forEach((c) => add("codice_nuovo_non_in_db", c, "", "presente nel Cruscotto, assente in prodotti"));
  mancanti.forEach((c) => add("codice_db_non_nel_cruscotto", c, "", "presente in prodotti, assente nel Cruscotto → NON disattivato automaticamente"));

  // ── report ──
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
  const out = path.join(OUT_DIR, `riconciliazione-cruscotto-${stamp}.csv`);
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  fs.writeFileSync(out, ["tipo;codice;magazzino;dettaglio", ...anomalie.map((a) => [a.tipo, a.codice, a.magazzino, a.dettaglio].map(esc).join(";"))].join("\n"), "utf8");

  const per = anomalie.reduce((m, a) => ((m[a.tipo] = (m[a.tipo] ?? 0) + 1), m), {});
  console.log("\n─── RIEPILOGO ───");
  console.log(`  righe snapshot        : ${righe.length}`);
  console.log(`  articoli unici        : ${codiciFile.size}`);
  console.log(`  coppie codice+mag     : ${visteChiavi.size}`);
  console.log(`  codici nuovi          : ${nuovi.length}`);
  console.log(`  codici solo in DB     : ${mancanti.length}`);
  console.log(`  senza costo           : ${senzaCosto}`);
  console.log(`  disponibilità anomala : ${dispErrata}`);
  console.log(`  numeri non validi     : ${numInvalidi}`);
  console.log(`  righe senza chiave    : ${senzaChiave}`);
  console.log("\n  dettaglio per tipo:", per);
  console.log(`\n✓ Report: ${out} (${anomalie.length} righe)`);
})().catch((e) => { console.error("ERRORE:", e.message || e); process.exit(1); });
