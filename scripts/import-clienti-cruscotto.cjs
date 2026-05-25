#!/usr/bin/env node
/**
 * Import periodico dell'anagrafica clienti dal file "Cruscotto Dinamico.xlsx"
 * (esportazione gestionale SICS) → tabella preventivatore.clienti_master.
 *
 * Granularità: (codice_cliente, id_destinazione) — un record per ogni
 * sede/divisione. Idempotente: UPSERT con detection cambi via hash_riga.
 *
 * I clienti che spariscono dal file vengono marcati attivo=false (NON eliminati,
 * per preservare le FK da documenti.cliente_master_id).
 *
 * Schedulazione su VM (esempio): cron settimanale lunedì 06:30
 *   30 6 * * 1 cd /opt/intranet-sics && /usr/bin/node scripts/import-clienti-cruscotto.cjs \
 *     --source /var/sics/cruscotto/Cruscotto_Dinamico.xlsx \
 *     >> /var/log/sics/cruscotto.log 2>&1
 *
 * Variabili env richieste (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Flags:
 *   --source <path>   Path del file .xlsx (default: ./Cruscotto Dinamico.xlsx)
 *   --dry-run         Anteprima senza scrivere
 *   --verbose         Log ogni riga
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Carica .env.local manualmente (no dotenv dep)
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvLocal();

const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

// ── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(name, def) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const SOURCE = argValue("--source", path.join(process.cwd(), "Cruscotto Dinamico.xlsx"));
const DRY_RUN = args.includes("--dry-run");
const VERBOSE = args.includes("--verbose");

// ── Supabase admin client ──────────────────────────────────────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error("Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(URL, KEY, { auth: { persistSession: false } });

// ── Helpers ────────────────────────────────────────────────────────────────
function rowHash(row) {
  // Hash stabile dei campi business-relevant (esclude metadati)
  const parts = [
    row.ragione_sociale,
    row.destinazione,
    row.cap,
    row.localita,
    row.cat_commerciale,
    row.cat_zona,
    row.cat_attivita,
    row.agente_nome,
    row.agente_codice,
    row.visite_n_meno_1,
    row.visite_n,
  ].map((x) => String(x ?? ""));
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex");
}

function cleanStr(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function cleanInt(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  console.log(`[${new Date().toISOString()}] Import Cruscotto → clienti_master`);
  console.log(`  Sorgente: ${SOURCE}`);
  console.log(`  Modo:     ${DRY_RUN ? "DRY-RUN" : "APPLY"}`);

  if (!fs.existsSync(SOURCE)) {
    console.error(`File non trovato: ${SOURCE}`);
    process.exit(1);
  }

  // 1) Log entry iniziale
  let logId = null;
  if (!DRY_RUN) {
    const { data: logRow, error: logErr } = await db
      .schema("preventivatore")
      .from("clienti_master_import_log")
      .insert({ file_sorgente: SOURCE })
      .select("id")
      .single();
    if (logErr) {
      console.error("Errore creazione log entry:", logErr);
      process.exit(1);
    }
    logId = logRow.id;
  }

  // 2) Parse del file Excel
  const wb = XLSX.readFile(SOURCE, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { defval: null });

  const records = rawRows
    .map((r) => ({
      codice_cliente:   cleanStr(r["Codice Cliente"]),
      ragione_sociale:  cleanStr(r["Ragione Sociale"]),
      destinazione:     cleanStr(r["Ragione Sociale Destinazione"]),
      id_destinazione:  cleanStr(r["Id Destinazione"]),
      cap:              cleanStr(r["Cap"]),
      localita:         cleanStr(r["Localita"]),
      cat_commerciale:  cleanStr(r["Cat Commerciale"]),
      cat_zona:         cleanStr(r["Cat Zona"]),
      cat_attivita:     cleanStr(r["Cat Attivitta"]),
      agente_nome:      cleanStr(r["Agente"]),
      agente_codice:    cleanStr(r["Codice Agente"]),
      visite_n_meno_1:  cleanInt(r["Visite n-1"]),
      visite_n:         cleanInt(r["Visite n"]),
    }))
    .filter((r) => r.codice_cliente && r.ragione_sociale);

  console.log(`  Righe valide: ${records.length} (su ${rawRows.length})`);

  // 3) Carica lo stato attuale di clienti_master per detection cambi
  const existing = new Map(); // key = codice|id_dest, value = { id, hash_riga, attivo, da_validare }
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await db
      .schema("preventivatore")
      .from("clienti_master")
      .select("id, codice_cliente, id_destinazione, hash_riga, attivo, da_validare")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error("Errore lettura clienti_master:", error);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    for (const e of data) {
      const key = `${e.codice_cliente}|${e.id_destinazione ?? ""}`;
      existing.set(key, e);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  console.log(`  Esistenti in DB: ${existing.size}`);

  // 4) Calcola batch da scrivere
  let inserite = 0;
  let aggiornate = 0;
  let invariate = 0;
  let errori = 0;
  const toUpsert = [];
  const seenKeys = new Set();

  for (const rec of records) {
    const hash = rowHash(rec);
    const key = `${rec.codice_cliente}|${rec.id_destinazione ?? ""}`;
    seenKeys.add(key);
    const prev = existing.get(key);

    if (!prev) {
      toUpsert.push({ ...rec, hash_riga: hash, attivo: true, ultimo_import_il: new Date().toISOString() });
      inserite++;
      if (VERBOSE) console.log(`  + ${rec.codice_cliente}/${rec.id_destinazione} ${rec.ragione_sociale}`);
    } else if (prev.hash_riga !== hash || prev.attivo === false) {
      toUpsert.push({ ...rec, hash_riga: hash, attivo: true, ultimo_import_il: new Date().toISOString() });
      aggiornate++;
      if (VERBOSE) console.log(`  ~ ${rec.codice_cliente}/${rec.id_destinazione} ${rec.ragione_sociale}`);
    } else {
      invariate++;
    }
  }

  // 5) Detect record spariti dal file → mark attivo=false (NON eliminare; preserva FK)
  const toDeactivate = [];
  for (const [key, e] of existing.entries()) {
    if (e.da_validare) continue; // i provvisori manuali non vanno toccati
    if (!seenKeys.has(key) && e.attivo) {
      toDeactivate.push(e.id);
    }
  }

  console.log(`  → ${inserite} nuove, ${aggiornate} aggiornate, ${invariate} invariate, ${toDeactivate.length} da disattivare`);

  if (DRY_RUN) {
    console.log("DRY-RUN — nessuna scrittura. Esempi:");
    for (const r of toUpsert.slice(0, 3)) console.log("  ", r);
    return;
  }

  // 6) UPSERT batch
  if (toUpsert.length > 0) {
    const BATCH = 500;
    for (let i = 0; i < toUpsert.length; i += BATCH) {
      const slice = toUpsert.slice(i, i + BATCH);
      const { error } = await db
        .schema("preventivatore")
        .from("clienti_master")
        .upsert(slice, { onConflict: "codice_cliente,id_destinazione" });
      if (error) {
        console.error(`Errore upsert batch ${i}:`, error);
        errori += slice.length;
      }
    }
  }

  // 7) Disattiva spariti
  if (toDeactivate.length > 0) {
    const { error } = await db
      .schema("preventivatore")
      .from("clienti_master")
      .update({ attivo: false, ultimo_import_il: new Date().toISOString() })
      .in("id", toDeactivate);
    if (error) {
      console.error("Errore disattivazione spariti:", error);
      errori += toDeactivate.length;
    }
  }

  // 8) Chiude log entry
  await db
    .schema("preventivatore")
    .from("clienti_master_import_log")
    .update({
      terminato_il: new Date().toISOString(),
      righe_totali: records.length,
      inserite,
      aggiornate,
      invariate,
      disattivate: toDeactivate.length,
      errori,
      esito: errori === 0 ? "ok" : "warn",
    })
    .eq("id", logId);

  console.log(`[${new Date().toISOString()}] Done. log_id=${logId}`);
})().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
