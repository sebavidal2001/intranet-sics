#!/usr/bin/env node
/**
 * V3 re-ingest (parte 2): popola le 4 colonne tempi consegna su
 * preventivatore.documenti incrociando con il file "D.82-8 Registro
 * Commesse_Progetti.xlsx" (master registro SICS).
 *
 * Colonne sorgente nel registro (header row 2):
 *  A  = codice cartella ("S_24_001", "C_25_38", ...)
 *  AM = Data consegna richiesta   → documenti.data_consegna_richiesta
 *  AN = Data consegna confermata  → documenti.data_consegna_confermata
 *  AQ = Data consegna effettiva   → documenti.data_consegna_effettiva
 *
 * Idempotente: aggiorna solo le 4 colonne, NON tocca altri campi. Le date già
 * popolate vengono sovrascritte solo se il valore nel registro è diverso.
 *
 * Uso:
 *   node scripts/incrocia-registro-consegne.cjs --dry-run
 *   node scripts/incrocia-registro-consegne.cjs --source "C:/path/D.82-8...xlsx"
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
  if (!v) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // Excel serial → date (giorni da 1899-12-30, con quirk)
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    // Prova vari formati
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const ddmmyyyy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
    if (ddmmyyyy) {
      const [, dd, mm, yyyy] = ddmmyyyy;
      return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
  }
  return null;
}

function normalizeCodice(s) {
  return String(s ?? "")
    .trim()
    .toUpperCase()
    .replace(/^([SC])[_-](\d{2})[_-]/, "$1_$2_")
    .replace(/^([SC])(\d{2})\/(\d+)/, "$1_$2_$3"); // C24/08 → C_24_08
}

(async () => {
  console.log(`[${new Date().toISOString()}] Incrocia registro consegne (${DRY ? "DRY" : "APPLY"})`);
  console.log(`  Source: ${SOURCE}`);

  if (!fs.existsSync(SOURCE)) {
    console.error("File registro non trovato");
    process.exit(1);
  }

  const wb = XLSX.readFile(SOURCE, { cellDates: true });
  const ws = wb.Sheets["Foglio1"];
  if (!ws) {
    console.error("Foglio1 non trovato nel registro");
    process.exit(1);
  }
  const range = XLSX.utils.decode_range(ws["!ref"]);

  // Costruisci map codice→consegne (header su riga 2 = r=1)
  const dateByCodice = new Map();
  let righeValide = 0;
  let codiciSenzaData = 0;

  for (let r = 2; r <= range.e.r; r++) {
    const codiceRaw = ws[XLSX.utils.encode_cell({ r, c: 0 })]?.v;
    if (!codiceRaw) continue;
    const codice = normalizeCodice(codiceRaw);
    if (!/^[SC]_\d{2}_\d+/.test(codice)) continue;

    const am = ws[XLSX.utils.encode_cell({ r, c: 38 })]?.v; // Data consegna richiesta
    const an = ws[XLSX.utils.encode_cell({ r, c: 39 })]?.v; // Data consegna confermata
    const aq = ws[XLSX.utils.encode_cell({ r, c: 42 })]?.v; // Data consegna effettiva

    const dRich = toIsoDate(am);
    const dConf = toIsoDate(an);
    const dEff = toIsoDate(aq);

    if (dRich || dConf || dEff) {
      dateByCodice.set(codice, {
        data_consegna_richiesta: dRich,
        data_consegna_confermata: dConf,
        data_consegna_effettiva: dEff,
      });
      righeValide++;
    } else {
      codiciSenzaData++;
    }
  }
  console.log(`  Righe registro con date: ${righeValide} (senza date: ${codiciSenzaData})`);

  // Per ogni documento DB cerca match nel registro
  const { data: docs, error } = await db
    .schema("preventivatore")
    .from("documenti")
    .select("id, codice, data_consegna_richiesta, data_consegna_confermata, data_consegna_effettiva")
    .in("tipo_cartella", ["S", "C"])
    .limit(5000);
  if (error) { console.error(error); process.exit(1); }
  console.log(`  Documenti DB candidati: ${docs?.length ?? 0}`);

  let aggiornati = 0;
  let invariati = 0;
  let noMatch = 0;
  let errori = 0;

  for (const d of docs ?? []) {
    const match = dateByCodice.get(normalizeCodice(d.codice));
    if (!match) { noMatch++; continue; }

    const update = {};
    if (match.data_consegna_richiesta && match.data_consegna_richiesta !== d.data_consegna_richiesta) {
      update.data_consegna_richiesta = match.data_consegna_richiesta;
    }
    if (match.data_consegna_confermata && match.data_consegna_confermata !== d.data_consegna_confermata) {
      update.data_consegna_confermata = match.data_consegna_confermata;
    }
    if (match.data_consegna_effettiva && match.data_consegna_effettiva !== d.data_consegna_effettiva) {
      update.data_consegna_effettiva = match.data_consegna_effettiva;
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
    if (upErr) {
      errori++;
      console.error(`  ERR ${d.codice}: ${upErr.message}`);
    } else {
      aggiornati++;
      if (aggiornati % 50 === 0) console.log(`  ${aggiornati} aggiornati...`);
    }
  }

  console.log(`\nDone. Aggiornati: ${aggiornati} | invariati: ${invariati} | senza match nel registro: ${noMatch} | errori: ${errori}`);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
