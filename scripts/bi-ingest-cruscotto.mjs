/**
 * bi-ingest-cruscotto.mjs — Carica un CSV Cruscotto nello staging e lancia
 * l'ingest atomico (Fase 3).
 *
 * Il lavoro pesante sta nel database: questo script si limita a parsare il
 * file con il parser ufficiale del tracciato, riversarlo in bi.cruscotto_staging
 * e chiamare bi.ingest_cruscotto(). Da lì in poi è tutto una transazione sola:
 * o passa tutto o non passa niente.
 *
 * Uso:
 *   node scripts/bi-ingest-cruscotto.mjs --file=<path.csv> [opzioni]
 *
 *   --run-id=<id>     identificativo del run (default: CRUSCOTTO-<timestamp>)
 *   --captured-at=<t> istante dell'estrazione (default: mtime del file)
 *   --dry-run         carica lo staging, mostra la validazione, NON ingesta
 *   --batch=<n>       righe per insert (default 2000)
 *
 * Exit code: 0 riuscito, 1 fallito. Il run resta 'failed' in bi.cruscotto_runs
 * con il messaggio di errore, così il monitoraggio lo vede.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import {
  COLONNE_ATTESE, validaIntestazione, parseCsv,
  pulisciTesto, parseNumIta, parseDataIso,
} from "./lib/cruscotto-parser.mjs";

// ─── Configurazione ────────────────────────────────────────────────────────
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

const FILE = arg("file");
const DRY_RUN = !!arg("dry-run");
const BATCH = Number(arg("batch", 2000));
if (!FILE) { console.error("Manca --file=<path.csv>"); process.exit(1); }
if (!fs.existsSync(FILE)) { console.error(`File non trovato: ${FILE}`); process.exit(1); }

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error("Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

// Lo schema bi non è esposto via PostgREST di proposito: si passa dai wrapper
// public.bi_cruscotto_* (migration 075g), concessi al solo service_role.
const rpc = createClient(URL, KEY, { auth: { persistSession: false } });

const stat = fs.statSync(FILE);
const RUN_ID = arg("run-id") || `CRUSCOTTO-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
const CAPTURED_AT = arg("captured-at") || stat.mtime.toISOString();

// ─── Parsing ───────────────────────────────────────────────────────────────
// Le colonne numeriche e le date vanno convertite qui: lo staging le tipizza,
// così un valore illeggibile emerge subito e non diventa uno zero silenzioso.
const NUMERICHE = new Set(COLONNE_ATTESE.filter((c) => c.startsWith("qta_"))
  .concat(["esistenza", "disponibilita", "Ult_Costo"]));

function convertiRiga(headers, riga, numRiga) {
  const rec = { run_id: RUN_ID, riga_num: numRiga };
  for (let i = 0; i < headers.length; i++) {
    const col = headers[i];
    const grezzo = riga[i];
    // I nomi in staging sono minuscoli; il CSV ha Ult_Costo/data_Ult_Costo.
    const campo = col.toLowerCase();
    if (col === "data_Ult_Costo") {
      const d = parseDataIso(grezzo);
      if (d === undefined) throw new Error(`riga ${numRiga}: data_Ult_Costo illeggibile ("${grezzo}")`);
      rec.data_ult_costo = d;
    } else if (NUMERICHE.has(col)) {
      const n = parseNumIta(grezzo);
      if (Number.isNaN(n)) throw new Error(`riga ${numRiga}: ${col} non numerico ("${grezzo}")`);
      rec[campo] = n;
    } else {
      rec[campo] = pulisciTesto(grezzo);
    }
  }
  return rec;
}

// ─── Esecuzione ────────────────────────────────────────────────────────────
async function segnaFallito(messaggio, pulisci = false) {
  await rpc.rpc("bi_cruscotto_run_fail", {
    p_run_id: RUN_ID,
    p_errore: String(messaggio).slice(0, 4000),
    p_pulisci: pulisci,
  });
}

(async () => {
  console.log(`Ingest Cruscotto\n  file:        ${FILE}`);
  console.log(`  run_id:      ${RUN_ID}`);
  console.log(`  captured_at: ${CAPTURED_AT}`);

  const contenuto = fs.readFileSync(FILE);
  const sha256 = crypto.createHash("sha256").update(contenuto).digest("hex");
  const dati = parseCsv(contenuto.toString("utf8"), ";");
  if (dati.length < 2) throw new Error("Il file non contiene righe dati");

  const headers = dati[0].map((h) => String(h ?? "").trim());
  const val = validaIntestazione(headers);
  if (!val.ok) {
    throw new Error(`Intestazione non conforme — mancanti: [${val.mancanti.join(", ")}] · inattese: [${val.inattese.join(", ")}]`);
  }
  console.log(`  colonne:     ${val.nColonne}/${COLONNE_ATTESE.length} conformi`);

  const righe = dati.slice(1).map((r, i) => convertiRiga(headers, r, i + 1));
  console.log(`  righe:       ${righe.length}`);

  // Registrazione del run PRIMA di caricare: se qualcosa va storto a metà,
  // resta traccia del tentativo invece di uno staging orfano.
  const { error: eRun } = await rpc.rpc("bi_cruscotto_run_start", {
    p_run_id: RUN_ID,
    p_source: "SRVWOA",
    p_captured_at: CAPTURED_AT,
    p_sha256: sha256,
    p_metadata: { file: path.basename(FILE), bytes: stat.size },
  });
  if (eRun) throw new Error(`registrazione run: ${eRun.message}`);

  try {
    let caricate = 0;
    for (let i = 0; i < righe.length; i += BATCH) {
      const { data, error } = await rpc.rpc("bi_cruscotto_staging_load", {
        p_run_id: RUN_ID,
        p_righe: righe.slice(i, i + BATCH),
      });
      if (error) throw new Error(`staging righe ${i}-${i + BATCH}: ${error.message}`);
      caricate += Number(data ?? 0);
      process.stdout.write(`\r  caricate:    ${caricate}/${righe.length}`);
    }
    console.log("");
    if (caricate !== righe.length) {
      throw new Error(`caricate ${caricate} righe su ${righe.length} lette dal file`);
    }

    const { data: anomalie, error: eVal } = await rpc.rpc("bi_cruscotto_valida", { p_run_id: RUN_ID });
    if (eVal) throw new Error(`validazione: ${eVal.message}`);

    const bloccanti = (anomalie ?? []).filter((a) => a.bloccante);
    if (anomalie?.length) {
      console.log("\n  Controlli:");
      for (const a of anomalie) {
        console.log(`    ${a.bloccante ? "BLOCCA" : "avviso"}  ${a.tipo} (${a.occorrenze}) — ${a.dettaglio}`);
      }
    } else {
      console.log("\n  Controlli:   nessuna anomalia");
    }

    if (DRY_RUN) {
      await segnaFallito("dry-run: nessun ingest eseguito", true);
      console.log("\n  Dry-run: staging ripulito, produzione non toccata.");
      // exitCode invece di exit(): lasciando chiudere il processo da solo si
      // evita l'assertion di libuv su Windows quando restano handle aperti.
      process.exitCode = bloccanti.length ? 1 : 0;
      return;
    }

    if (bloccanti.length) throw new Error(`validazione fallita: ${bloccanti.map((a) => a.tipo).join(", ")}`);

    const { data: esito, error: eIng } = await rpc.rpc("bi_cruscotto_ingest", {
      p_run_id: RUN_ID, p_captured_at: CAPTURED_AT,
    });
    if (eIng) throw new Error(`ingest: ${eIng.message}`);

    console.log("\n─── ESITO ───");
    for (const [k, v] of Object.entries(esito)) {
      if (k === "anomalie") continue;
      console.log(`  ${k.padEnd(24)}: ${v}`);
    }
    console.log(`\n✓ Run ${RUN_ID} pubblicato.`);
  } catch (e) {
    await segnaFallito(e.message ?? e);
    // Lo staging resta: serve a capire cosa è arrivato. Lo ripulisce il run
    // successivo o la retention.
    throw e;
  }
})().catch((e) => {
  console.error(`\nERRORE: ${e.message ?? e}`);
  process.exitCode = 1;
});
