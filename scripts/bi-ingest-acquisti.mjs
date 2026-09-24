/**
 * bi-ingest-acquisti.mjs — Carica le righe d'ordine a fornitore (profilo
 * "acquisti") nello staging e lancia l'ingest a ricarico di finestra.
 *
 * Gemello di bi-ingest-costi.mjs, con una differenza: qui non c'e' backfill.
 * Il file notturno porta TUTTO dal 2024 (un ordine resta vivo per mesi: arrivi
 * parziali, chiusure forzate, date riconfermate), e bi.ingest_acquisti
 * sostituisce ogni riga dalla data d'ordine minima del file in avanti. La
 * finestra esce dal file, mai da un parametro.
 *
 * Uso:
 *   node scripts/bi-ingest-acquisti.mjs --file=<path.csv> [--run-id=<id>] [--dry-run] [--batch=<n>]
 *
 * Tracciato: 24 colonne senza intestazione, nell'ordine di
 * scripts/bi-bridge/query/ACQUISTI.sql (vedi COLONNE qui sotto).
 *
 * Exit code: 0 riuscito, 1 fallito. Il tentativo resta in bi.acquisti_ingest.
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { parseCsv, pulisciTesto, parseNumIta, parseDataIso } from "./lib/cruscotto-parser.mjs";

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
const RUN_ID = arg("run-id") || `ACQUISTI-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;

// ─── Tracciato ─────────────────────────────────────────────────────────────
const COLONNE = [
  "id_riga", "profilo", "numero_ordine", "data_ordine", "creato_il", "codice_fornitore",
  "fornitore", "buyer_utente", "buyer", "codice_articolo", "descrizione", "gruppo_articoli",
  "quantita", "qta_evasa", "prezzo_netto", "valore", "data_prevista", "data_confermata",
  "data_richiesta", "riga_evasa", "chiusa_forzata", "primo_arrivo", "ultimo_arrivo", "qta_arrivata",
];
const PROFILI = new Set(["OF", "OFT", "OFR"]);

function numero(v, colonna, numRiga) {
  const n = parseNumIta(v);
  if (n === null) return 0;
  if (Number.isNaN(n)) throw new Error(`riga ${numRiga}: ${colonna} non numerico ("${v}")`);
  return n;
}

function data(v, colonna, numRiga) {
  const d = parseDataIso(v);
  if (d === undefined) throw new Error(`riga ${numRiga}: ${colonna} illeggibile ("${v}")`);
  return d;
}

function flag(v) {
  return String(v ?? "").trim().toUpperCase() === "S";
}

/**
 * Senza intestazione la struttura si dimostra dai valori: id numerico, profilo
 * fra quelli estratti, date leggibili. Se il tracciato si spostasse di una
 * colonna questi controlli smetterebbero di tornare invece di caricare una
 * data nel campo del fornitore.
 */
function convertiRiga(riga, numRiga) {
  if (riga.length !== COLONNE.length) {
    throw new Error(`riga ${numRiga}: ${riga.length} colonne invece di ${COLONNE.length}`);
  }
  const c = Object.fromEntries(COLONNE.map((nome, i) => [nome, riga[i]]));
  const id = Number(String(c.id_riga).trim());
  if (!Number.isInteger(id) || id <= 0) throw new Error(`riga ${numRiga}: id_riga non valido ("${c.id_riga}")`);
  const profilo = pulisciTesto(c.profilo);
  if (!PROFILI.has(profilo)) throw new Error(`riga ${numRiga}: profilo inatteso ("${c.profilo}")`);
  const dataOrdine = data(c.data_ordine, "data_ordine", numRiga);
  if (!dataOrdine) throw new Error(`riga ${numRiga}: data_ordine mancante`);
  const creato = pulisciTesto(c.creato_il);

  return {
    run_id: RUN_ID,
    id_riga: id,
    profilo,
    numero_ordine: Number.parseInt(String(c.numero_ordine), 10) || null,
    data_ordine: dataOrdine,
    creato_il: creato && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(creato) ? creato : null,
    codice_fornitore: pulisciTesto(c.codice_fornitore),
    fornitore: pulisciTesto(c.fornitore),
    buyer_utente: pulisciTesto(c.buyer_utente),
    buyer: pulisciTesto(c.buyer),
    codice_articolo: (pulisciTesto(c.codice_articolo) ?? "").toUpperCase(),
    descrizione: pulisciTesto(c.descrizione),
    gruppo_articoli: pulisciTesto(c.gruppo_articoli),
    quantita: numero(c.quantita, "quantita", numRiga),
    qta_evasa: numero(c.qta_evasa, "qta_evasa", numRiga),
    prezzo_netto: numero(c.prezzo_netto, "prezzo_netto", numRiga),
    valore: numero(c.valore, "valore", numRiga),
    data_prevista: data(c.data_prevista, "data_prevista", numRiga),
    data_confermata: data(c.data_confermata, "data_confermata", numRiga),
    data_richiesta: data(c.data_richiesta, "data_richiesta", numRiga),
    riga_evasa: flag(c.riga_evasa),
    chiusa_forzata: flag(c.chiusa_forzata),
    primo_arrivo: data(c.primo_arrivo, "primo_arrivo", numRiga),
    ultimo_arrivo: data(c.ultimo_arrivo, "ultimo_arrivo", numRiga),
    qta_arrivata: numero(c.qta_arrivata, "qta_arrivata", numRiga),
  };
}

async function segnaFallito(messaggio) {
  await rpc.rpc("bi_acquisti_run_fail", { p_run_id: RUN_ID, p_messaggio: String(messaggio).slice(0, 2000) });
}

async function main() {
  console.log(`Ingest ordini di acquisto\n  file:    ${FILE}\n  run_id:  ${RUN_ID}`);
  const dati = parseCsv(fs.readFileSync(FILE, "utf8"), ";");
  // Il receiver tollera un'intestazione (header_first_field = id_riga): se c'e', si salta.
  if (dati.length > 0 && String(dati[0][0]).trim() === "id_riga") dati.shift();
  if (dati.length === 0) throw new Error("Il file non contiene righe");

  const righe = dati.map((r, i) => convertiRiga(r, i + 1));
  console.log(`  righe:   ${righe.length}`);

  const { error: eRun } = await rpc.rpc("bi_acquisti_run_start", { p_run_id: RUN_ID });
  if (eRun) throw new Error(`registrazione run: ${eRun.message}`);

  try {
    let caricate = 0;
    for (let i = 0; i < righe.length; i += BATCH) {
      const { data: n, error } = await rpc.rpc("bi_acquisti_staging_load", {
        p_run_id: RUN_ID,
        p_righe: righe.slice(i, i + BATCH),
      });
      if (error) throw new Error(`staging righe ${i}-${i + BATCH}: ${error.message}`);
      caricate += Number(n ?? 0);
    }
    console.log(`  staging: ${caricate}`);
    if (caricate !== righe.length) throw new Error(`caricate ${caricate} righe su ${righe.length} lette dal file`);

    const { data: anomalie, error: eVal } = await rpc.rpc("bi_acquisti_valida", { p_run_id: RUN_ID });
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

    const { data: esito, error: eIng } = await rpc.rpc("bi_acquisti_ingest", { p_run_id: RUN_ID });
    if (eIng) throw new Error(`ingest: ${eIng.message}`);
    const r = Array.isArray(esito) ? esito[0] : esito;
    console.log(`  finestra dal: ${r?.finestra_dal}`);
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
