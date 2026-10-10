/**
 * bi-ingest-fornitori.mjs — Carica nello staging e ingesta i dataset delle
 * fatture fornitore, delle condizioni di pagamento e dello scadenzario (profilo
 * pipeline "acquisti", migration 150).
 *
 * Un solo script per i tre dataset: cambia il tracciato, non il flusso.
 *
 * Uso:
 *   node scripts/bi-ingest-fornitori.mjs --dataset=<fatture_fornitore|documenti_pagamento|scadenzario>
 *        --file=<path.csv> [--run-id=<id>] [--dry-run] [--batch=<n>]
 *
 * Tracciati: senza intestazione, nell'ordine delle query in
 * scripts/bi-bridge/query/ (FATTURE_FORNITORE.sql, DOCUMENTI_PAGAMENTO.sql,
 * SCADENZARIO.sql). Se il numero di colonne non torna, il file si rifiuta.
 *
 * Exit code: 0 riuscito, 1 fallito. Il tentativo resta in bi.fornitori_ingest.
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { parseCsv } from "./lib/cruscotto-parser.mjs";
import { TRACCIATI, convertiRiga } from "./lib/fornitori-tracciati.mjs";

for (const f of [".env.local", "scripts/.env"]) {
  const p = path.join(process.cwd(), f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

const arg = (n, d = null) => {
  const m = process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  return !m ? d : (m === `--${n}` ? true : m.split("=").slice(1).join("="));
};

async function main() {
  const DATASET = arg("dataset");
  const FILE = arg("file");
  const DRY_RUN = !!arg("dry-run");
  const BATCH = Number(arg("batch", 2000));
  const tracciato = TRACCIATI[DATASET];
  if (!tracciato) { console.error(`--dataset deve essere uno fra: ${Object.keys(TRACCIATI).join(", ")}`); process.exit(1); }
  if (!FILE) { console.error("Manca --file=<path.csv>"); process.exit(1); }
  if (!fs.existsSync(FILE)) { console.error(`File non trovato: ${FILE}`); process.exit(1); }

  const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!SUPA_URL || !KEY) { console.error("Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
  const rpc = createClient(SUPA_URL, KEY, { auth: { persistSession: false } });
  const RUN_ID = arg("run-id") || `FORNITORI-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;

  console.log(`Ingest ${DATASET}\n  file:    ${FILE}\n  run_id:  ${RUN_ID}`);
  const dati = parseCsv(fs.readFileSync(FILE, "utf8"), ";");
  if (dati.length > 0 && String(dati[0][0]).trim() === tracciato.chiave) dati.shift();
  if (dati.length === 0) throw new Error("Il file non contiene righe");

  const righe = dati.map((r, i) => convertiRiga(tracciato, r, i + 1));
  console.log(`  righe:   ${righe.length}`);

  const { error: eRun } = await rpc.rpc("bi_fornitori_run_start", { p_run_id: RUN_ID, p_dataset: DATASET });
  if (eRun) throw new Error(`registrazione run: ${eRun.message}`);

  const segnaFallito = (m) => rpc.rpc("bi_fornitori_run_fail", { p_run_id: RUN_ID, p_dataset: DATASET, p_messaggio: String(m).slice(0, 2000) });

  try {
    let caricate = 0;
    for (let i = 0; i < righe.length; i += BATCH) {
      const { data: n, error } = await rpc.rpc("bi_fornitori_staging_load", {
        p_run_id: RUN_ID,
        p_dataset: DATASET,
        p_righe: righe.slice(i, i + BATCH),
      });
      if (error) throw new Error(`staging righe ${i}-${i + BATCH}: ${error.message}`);
      caricate += Number(n ?? 0);
    }
    console.log(`  staging: ${caricate}`);
    if (caricate !== righe.length) throw new Error(`caricate ${caricate} righe su ${righe.length} lette dal file`);

    if (DRY_RUN) {
      console.log("  dry-run: staging caricato, ingest NON eseguito.");
      await segnaFallito("dry-run: staging ripulito senza ingest");
      return;
    }

    const { data: esito, error: eIng } = await rpc.rpc("bi_fornitori_ingest", { p_run_id: RUN_ID, p_dataset: DATASET });
    if (eIng) throw new Error(`ingest: ${eIng.message}`);
    const r = Array.isArray(esito) ? esito[0] : esito;
    console.log(`  finestra dal: ${r?.finestra_dal ?? "(integrale)"}`);
    console.log(`  inserite:     ${r?.inserite ?? 0}`);
    console.log(`  eliminate:    ${r?.eliminate ?? 0}`);
    console.log("  fatto.");
  } catch (e) {
    await segnaFallito(e?.message ?? e);
    throw e;
  }
}

main().catch((e) => {
  console.error(`
ERRORE: ${e?.message ?? e}`);
  process.exit(1);
});
