#!/usr/bin/env node
/**
 * V3 re-ingest (parte 3): popola `numero_preventivo`, `data_offerta`,
 * `numero_offerta` su preventivatore.documenti incrociando con il registro
 * "D.82-8 Registro Commesse_Progetti.xlsx".
 *
 * Colonne sorgente nel registro (header su riga 2):
 *  A  (col 0)  = codice cartella (S_24_001, C_25_38)
 *  N  (col 13) = PC N°               → documenti.numero_preventivo
 *  O  (col 14) = Data PC             → documenti.data_offerta (se ancora vuoto)
 *  R  (col 17) = Ordine Cliente N°   → documenti.numero_offerta (se ancora vuoto)
 *
 * Idempotente: aggiorna solo i campi vuoti nel DB. Tracciato in `stato_note`.
 *
 * Uso:
 *   node scripts/incrocia-registro-offerte.cjs --dry-run
 *   node scripts/incrocia-registro-offerte.cjs --source "C:/path/D.82-8...xlsx"
 */

const fs = require("fs");
const path = require("path");

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

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const VERBOSE = args.includes("--verbose");
const SOURCE = (() => {
  const i = args.indexOf("--source");
  return i >= 0 && args[i + 1]
    ? args[i + 1]
    : "C:/Users/sebav/Downloads/D.82-8 Registro Commesse_Progetti.xlsx";
})();

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function toIsoDate(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const dd = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
    if (dd) {
      const yyyy = dd[3].length === 2 ? `20${dd[3]}` : dd[3];
      return `${yyyy}-${dd[2].padStart(2, "0")}-${dd[1].padStart(2, "0")}`;
    }
  }
  return null;
}

function cleanText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function normalizeCodice(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/^([SC])[_-](\d{2})[_-]/, "$1_$2_")
    .replace(/^([SC])(\d{2})\/(\d+)/, "$1_$2_$3");
}

(async () => {
  console.log(`[${new Date().toISOString()}] Incrocia registro offerte (${DRY ? "DRY" : "APPLY"})`);
  if (!fs.existsSync(SOURCE)) { console.error("File registro non trovato"); process.exit(1); }

  const wb = XLSX.readFile(SOURCE, { cellDates: true });
  const ws = wb.Sheets["Foglio1"];
  const range = XLSX.utils.decode_range(ws["!ref"]);

  // Mappa codice → { numero_preventivo, data_offerta, numero_offerta }
  const map = new Map();
  let righeOk = 0;
  for (let r = 2; r <= range.e.r; r++) {
    const codice = normalizeCodice(ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v);
    if (!/^[SC]_\d{2}_\d+/.test(codice)) continue;
    const pcN = cleanText(ws[XLSX.utils.encode_cell({ r, c: 13 })]?.v);  // N
    const pcD = toIsoDate(ws[XLSX.utils.encode_cell({ r, c: 14 })]?.v);  // O
    const ocN = cleanText(ws[XLSX.utils.encode_cell({ r, c: 17 })]?.v);  // R
    if (pcN || pcD || ocN) {
      map.set(codice, { numero_preventivo: pcN, data_offerta: pcD, numero_offerta: ocN });
      righeOk++;
    }
  }
  console.log(`  Righe registro con almeno un dato: ${righeOk}`);

  const { data: docs, error } = await db
    .schema("preventivatore")
    .from("documenti")
    .select("id, codice, numero_preventivo, data_offerta, numero_offerta")
    .in("tipo_cartella", ["S", "C"])
    .limit(5000);
  if (error) { console.error(error); process.exit(1); }
  console.log(`  Documenti DB candidati: ${docs?.length ?? 0}`);

  let aggiornati = 0;
  let invariati = 0;
  let noMatch = 0;
  let errori = 0;
  let setNumPrev = 0, setDataOff = 0, setNumOff = 0;

  for (const d of docs ?? []) {
    const match = map.get(normalizeCodice(d.codice));
    if (!match) { noMatch++; continue; }

    const update = {};
    // numero_preventivo: NUOVO campo, sempre popolabile (no overwrite di valori esistenti)
    if (match.numero_preventivo && !d.numero_preventivo) {
      update.numero_preventivo = String(match.numero_preventivo);
      setNumPrev++;
    }
    // data_offerta è TEXT nel DB: popola solo se vuota
    if (match.data_offerta && (!d.data_offerta || !d.data_offerta.trim())) {
      update.data_offerta = match.data_offerta; // ISO YYYY-MM-DD
      setDataOff++;
    }
    // numero_offerta: popola solo se vuoto
    if (match.numero_offerta && !d.numero_offerta) {
      update.numero_offerta = String(match.numero_offerta);
      setNumOff++;
    }

    if (Object.keys(update).length === 0) { invariati++; continue; }
    if (DRY) {
      aggiornati++;
      if (VERBOSE) console.log(`  ${d.codice}: ${JSON.stringify(update)}`);
      continue;
    }
    const { error: upErr } = await db
      .schema("preventivatore")
      .from("documenti")
      .update(update)
      .eq("id", d.id);
    if (upErr) { errori++; console.error(`  ERR ${d.codice}: ${upErr.message}`); }
    else {
      aggiornati++;
      if (aggiornati % 50 === 0) console.log(`  ${aggiornati} aggiornati...`);
    }
  }

  console.log(`\nDone. Aggiornati: ${aggiornati} | invariati: ${invariati} | senza match: ${noMatch} | errori: ${errori}`);
  console.log(`  numero_preventivo set: ${setNumPrev}`);
  console.log(`  data_offerta set:      ${setDataOff}`);
  console.log(`  numero_offerta set:    ${setNumOff}`);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
