/**
 * bi-ingest-clienti.mjs — Carica l'anagrafica clienti di Impresa (profilo
 * "clienti") nello staging e lancia l'ingest a sostituzione totale.
 *
 * Gemello di bi-ingest-acquisti.mjs, ma senza finestra: il file e' una
 * fotografia dei clienti (~7.300 righe) e bi.ingest_clienti sostituisce l'intera
 * tabella in una transazione, dopo aver rifiutato un file palesemente monco.
 *
 * Uso:
 *   node scripts/bi-ingest-clienti.mjs --file=<path.csv> [--run-id=<id>] [--dry-run] [--batch=<n>]
 *
 * Tracciato: 14 colonne senza intestazione, nell'ordine di
 * scripts/bi-bridge/query/CLIENTI_ANAGRAFICA.sql (vedi COLONNE qui sotto).
 *
 * Exit code: 0 riuscito, 1 fallito. Il tentativo resta in bi.clienti_ingest.
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { parseCsv, pulisciTesto } from "./lib/cruscotto-parser.mjs";

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

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!SUPA_URL || !KEY) { console.error("Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const rpc = createClient(SUPA_URL, KEY, { auth: { persistSession: false } });
const RUN_ID = arg("run-id") || `CLIENTI-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;

// ─── Tracciato ─────────────────────────────────────────────────────────────
const COLONNE = [
  "codice_cliente", "ragione_sociale", "cat_attivita_codice", "cat_attivita",
  "cat_commerciale_codice", "cat_commerciale", "cat_zona_codice", "cat_zona",
  "agente_codice", "agente", "tipo", "attivo", "creato_il", "modificato_il",
];
const TIPI = new Set(["C", "P"]);
const RE_DATA_ORA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Senza intestazione la struttura si dimostra dai valori: codice a cifre/lettere
 * senza spazi, tipo C/P, flag S/N, date nel formato atteso. Se il tracciato si
 * spostasse di una colonna questi controlli smetterebbero di tornare invece di
 * caricare una data nel campo dell'agente.
 */
function convertiRiga(riga, numRiga) {
  if (riga.length !== COLONNE.length) {
    throw new Error(`riga ${numRiga}: ${riga.length} colonne invece di ${COLONNE.length}`);
  }
  const c = Object.fromEntries(COLONNE.map((nome, i) => [nome, riga[i]]));
  const codice = pulisciTesto(c.codice_cliente);
  if (!codice || /\s/.test(codice)) throw new Error(`riga ${numRiga}: codice_cliente non valido ("${c.codice_cliente}")`);
  const tipo = pulisciTesto(c.tipo);
  if (!tipo || !TIPI.has(tipo)) throw new Error(`riga ${numRiga}: tipo inatteso ("${c.tipo}")`);
  const attivo = String(c.attivo ?? "").trim().toUpperCase();
  if (attivo !== "S" && attivo !== "N") throw new Error(`riga ${numRiga}: attivo inatteso ("${c.attivo}")`);
  const dataOra = (v, nome) => {
    const t = pulisciTesto(v);
    if (!t) return null;
    if (!RE_DATA_ORA.test(t)) throw new Error(`riga ${numRiga}: ${nome} illeggibile ("${v}")`);
    return t;
  };

  return {
    run_id: RUN_ID,
    codice_cliente: codice,
    ragione_sociale: pulisciTesto(c.ragione_sociale),
    cat_attivita_codice: pulisciTesto(c.cat_attivita_codice),
    cat_attivita: pulisciTesto(c.cat_attivita),
    cat_commerciale_codice: pulisciTesto(c.cat_commerciale_codice),
    cat_commerciale: pulisciTesto(c.cat_commerciale),
    cat_zona_codice: pulisciTesto(c.cat_zona_codice),
    cat_zona: pulisciTesto(c.cat_zona),
    agente_codice: pulisciTesto(c.agente_codice),
    agente: pulisciTesto(c.agente),
    tipo,
    attivo: attivo === "S",
    creato_il: dataOra(c.creato_il, "creato_il"),
    modificato_il: dataOra(c.modificato_il, "modificato_il"),
  };
}

async function segnaFallito(messaggio) {
  await rpc.rpc("bi_clienti_run_fail", { p_run_id: RUN_ID, p_messaggio: String(messaggio).slice(0, 2000) });
}

async function main() {
  console.log(`Ingest anagrafica clienti\n  file:    ${FILE}\n  run_id:  ${RUN_ID}`);
  const dati = parseCsv(fs.readFileSync(FILE, "utf8"), ";");
  // Il receiver tollera un'intestazione (header_first_field = codice_cliente): se c'e', si salta.
  if (dati.length > 0 && String(dati[0][0]).trim() === "codice_cliente") dati.shift();
  if (dati.length === 0) throw new Error("Il file non contiene righe");

  const righe = dati.map((r, i) => convertiRiga(r, i + 1));
  console.log(`  righe:   ${righe.length}`);

  const { error: eRun } = await rpc.rpc("bi_clienti_run_start", { p_run_id: RUN_ID });
  if (eRun) throw new Error(`registrazione run: ${eRun.message}`);

  try {
    let caricate = 0;
    for (let i = 0; i < righe.length; i += BATCH) {
      const { data: n, error } = await rpc.rpc("bi_clienti_staging_load", {
        p_run_id: RUN_ID,
        p_righe: righe.slice(i, i + BATCH),
      });
      if (error) throw new Error(`staging righe ${i}-${i + BATCH}: ${error.message}`);
      caricate += Number(n ?? 0);
    }
    console.log(`  staging: ${caricate}`);
    if (caricate !== righe.length) throw new Error(`caricate ${caricate} righe su ${righe.length} lette dal file`);

    const { data: anomalie, error: eVal } = await rpc.rpc("bi_clienti_valida", { p_run_id: RUN_ID });
    if (eVal) throw new Error(`validazione: ${eVal.message}`);
    for (const a of anomalie ?? []) {
      console.log(`    ${a.bloccante ? "BLOCCA" : "avviso"}  ${a.tipo} (${a.occorrenze}) — ${a.dettaglio}`);
    }
    if ((anomalie ?? []).some((a) => a.bloccante)) throw new Error("Validazione bloccante: ingest non eseguito");

    if (DRY_RUN) {
      console.log("  dry-run: staging caricato, ingest NON eseguito.");
      await segnaFallito("dry-run: staging ripulito senza ingest");
      return;
    }

    const { data: esito, error: eIng } = await rpc.rpc("bi_clienti_ingest", { p_run_id: RUN_ID });
    if (eIng) throw new Error(`ingest: ${eIng.message}`);
    const r = Array.isArray(esito) ? esito[0] : esito;
    console.log(`  inserite:     ${r?.inserite ?? 0}`);
    console.log(`  clienti nuovi: ${r?.nuovi ?? 0}`);
    console.log(`  sostituite:   ${r?.eliminati ?? 0}`);
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
