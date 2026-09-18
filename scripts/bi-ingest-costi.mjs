/**
 * bi-ingest-costi.mjs — Carica lo storico costi del listino "Ultimo Costo"
 * nello staging e lancia l'ingest a upsert.
 *
 * Perché non è un dataset a run come gli altri
 * --------------------------------------------
 * I sette dataset commerciali vivono nel modello run-swap: ogni notte
 * `bi_activate_run` sostituisce in blocco tutto il contenuto corrente. Qui i
 * dati sono CUMULATIVI — lo storico dei costi dal 1999 — e gli anni chiusi non
 * vanno riscritti. Quindi upsert su chiave naturale (codice_articolo,
 * valido_dal), e una finestra esplicita per dire cosa si sta ricaricando.
 *
 * Uso:
 *   node scripts/bi-ingest-costi.mjs --file=<path.csv> [opzioni]
 *
 *   --ricarica        modalità NOTTURNA: il file è una finestra temporale, e
 *                     dentro quella finestra si cancella ciò che non c'è più.
 *                     La finestra si DEDUCE DAL FILE (anno minimo presente),
 *                     mai da un parametro — vedi la nota qui sotto.
 *   (assente)         backfill: si scrive quello che c'è e non si cancella
 *                     nulla. È la modalità UNA TANTUM.
 *   --anno-da=<YYYY>  override esplicito della finestra. Rifiutato se è
 *                     precedente all'anno minimo del file.
 *
 * Perché la finestra si deduce dal file
 * -------------------------------------
 * La prima stesura prendeva `--anno-da=2026` come parametro, e la notturna lo
 * avrebbe avuto scritto fisso nello shell script. Il 1° gennaio 2027 la query
 * sul gestionale estrae solo il 2027 (usa `DATEFORMAT(getdate(),'YYYY-01-01')`),
 * ma `--anno-da=2026` avrebbe detto "cancella dal 2026 in poi tutto ciò che non
 * è nel file": l'INTERO 2026 sarebbe sparito, in silenzio, a Capodanno.
 * Deducendo la finestra dal file quella divergenza non è più possibile, perché
 * non ci sono due fonti da tenere allineate.
 *   --run-id=<id>     identificativo del caricamento (default: COSTI-<timestamp>)
 *   --dry-run         carica lo staging, mostra la validazione, NON ingesta
 *   --batch=<n>       righe per chiamata (default 5000)
 *
 * Tracciato atteso, tre colonne senza intestazione (SQL Anywhere con
 * `FORMAT ASCII` non la scrive):
 *
 *   codice_articolo ; valido_dal (YYYY-MM-DD) ; costo (decimale italiano)
 *
 * Exit code: 0 riuscito, 1 fallito. Il tentativo resta in
 * bi.costi_listino_ingest con esito='fallito' e il messaggio.
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { parseCsv, pulisciTesto, parseNumIta, parseDataIso } from "./lib/cruscotto-parser.mjs";

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
const BATCH = Number(arg("batch", 5000));
const RICARICA = !!arg("ricarica");
const ANNO_DA_GREZZO = arg("anno-da");
if (!FILE) { console.error("Manca --file=<path.csv>"); process.exit(1); }
if (!fs.existsSync(FILE)) { console.error(`File non trovato: ${FILE}`); process.exit(1); }

let ANNO_DA_ESPLICITO = null;
if (ANNO_DA_GREZZO !== null && ANNO_DA_GREZZO !== true) {
  ANNO_DA_ESPLICITO = Number(ANNO_DA_GREZZO);
  if (!Number.isInteger(ANNO_DA_ESPLICITO) || ANNO_DA_ESPLICITO < 1990 || ANNO_DA_ESPLICITO > 2100) {
    console.error(`--anno-da non valido: "${ANNO_DA_GREZZO}"`);
    process.exit(1);
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error("Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

// Lo schema bi non è esposto via PostgREST di proposito: si passa dai wrapper
// public.bi_costi_* (migration 112), concessi al solo service_role.
const rpc = createClient(URL, KEY, { auth: { persistSession: false } });

const RUN_ID = arg("run-id") || `COSTI-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;

// ─── Parsing ───────────────────────────────────────────────────────────────
const COLONNE = 3;

/**
 * Il file non ha intestazione, quindi la struttura non si può dimostrare
 * leggendo dei nomi: si dimostra dai valori. Tre colonne, la seconda una data,
 * la terza un numero positivo. Se il tracciato cambiasse — per esempio se
 * qualcuno invertisse data e costo — questi controlli smetterebbero di tornare
 * invece di caricare numeri nel campo sbagliato.
 */
function convertiRiga(riga, numRiga) {
  if (riga.length !== COLONNE) {
    throw new Error(`riga ${numRiga}: ${riga.length} colonne invece di ${COLONNE}`);
  }
  const codice = pulisciTesto(riga[0]);
  if (!codice) throw new Error(`riga ${numRiga}: codice articolo vuoto`);

  const data = parseDataIso(riga[1]);
  if (!data) throw new Error(`riga ${numRiga}: data illeggibile ("${riga[1]}")`);

  const costo = parseNumIta(riga[2]);
  if (costo === null || Number.isNaN(costo)) {
    throw new Error(`riga ${numRiga}: costo non numerico ("${riga[2]}")`);
  }

  // Il codice va in maiuscolo e senza spazi ai bordi, e basta: è la stessa
  // chiave di chiaveArticolo() in src/lib/prototipo-bi/sorgente.ts. Qualsiasi
  // altra normalizzazione lo scollegherebbe da "Codice Articolo" delle viste
  // di vendita.
  return { run_id: RUN_ID, codice_articolo: codice.toUpperCase(), valido_dal: data, costo };
}

// ─── Esecuzione ────────────────────────────────────────────────────────────
async function segnaFallito(messaggio) {
  await rpc.rpc("bi_costi_run_fail", {
    p_run_id: RUN_ID,
    p_messaggio: String(messaggio).slice(0, 2000),
  });
}

(async () => {
  console.log(`Ingest storico costi\n  file:    ${FILE}`);
  console.log(`  run_id:  ${RUN_ID}`);

  const contenuto = fs.readFileSync(FILE, "utf8");
  const dati = parseCsv(contenuto, ";");
  if (dati.length === 0) throw new Error("Il file non contiene righe");

  const righe = dati.map((r, i) => convertiRiga(r, i + 1));
  console.log(`  righe:   ${righe.length}`);

  // La finestra di cancellazione esce DAL FILE, non da un parametro: è ciò che
  // impedisce a Capodanno di cancellare l'anno precedente (vedi l'intestazione).
  // Ciclo e non `Math.min(...righe.map(...))`: lo spread passa un argomento
  // per elemento, e con le 402.170 righe del backfill fa saltare lo stack
  // ("Maximum call stack size exceeded"). Non si vede sui file dell'anno
  // corrente, che di righe ne hanno undicimila.
  let annoMinFile = Infinity;
  for (const r of righe) {
    const anno = Number(r.valido_dal.slice(0, 4));
    if (anno < annoMinFile) annoMinFile = anno;
  }
  let ANNO_DA = null;
  if (RICARICA || ANNO_DA_ESPLICITO !== null) {
    ANNO_DA = ANNO_DA_ESPLICITO ?? annoMinFile;
    if (ANNO_DA < annoMinFile) {
      throw new Error(
        `--anno-da=${ANNO_DA} è precedente all'anno minimo del file (${annoMinFile}): ` +
        `il ricarico cancellerebbe gli anni ${ANNO_DA}–${annoMinFile - 1}, che questo file non contiene. ` +
        `Usa --ricarica e lascia che la finestra esca dal file.`,
      );
    }
  }
  console.log(`  modo:    ${ANNO_DA === null
    ? "backfill (nessuna cancellazione)"
    : `ricarico dal ${ANNO_DA}${ANNO_DA_ESPLICITO === null ? " (dedotto dal file)" : " (imposto)"}`}`);

  // Struttura, per campione: le date devono coprire più di un giorno e i costi
  // devono essere tutti positivi. Un file in cui tutte le date sono uguali non
  // è uno storico.
  const date = new Set(righe.slice(0, 5000).map((r) => r.valido_dal));
  if (righe.length > 100 && date.size < 2) {
    throw new Error(`Struttura sospetta: ${date.size} data distinta sulle prime righe, non sembra uno storico`);
  }

  const { error: eRun } = await rpc.rpc("bi_costi_run_start", {
    p_run_id: RUN_ID,
    p_anno_da: ANNO_DA,
  });
  if (eRun) throw new Error(`registrazione run: ${eRun.message}`);

  try {
    let caricate = 0;
    for (let i = 0; i < righe.length; i += BATCH) {
      const { data, error } = await rpc.rpc("bi_costi_staging_load", {
        p_run_id: RUN_ID,
        p_righe: righe.slice(i, i + BATCH),
      });
      if (error) throw new Error(`staging righe ${i}-${i + BATCH}: ${error.message}`);
      caricate += Number(data ?? 0);
      process.stdout.write(`\r  staging: ${caricate}/${righe.length}`);
    }
    console.log("");
    if (caricate !== righe.length) {
      throw new Error(`caricate ${caricate} righe su ${righe.length} lette dal file`);
    }

    const { data: anomalie, error: eVal } = await rpc.rpc("bi_costi_valida", { p_run_id: RUN_ID });
    if (eVal) throw new Error(`validazione: ${eVal.message}`);

    if (anomalie?.length) {
      console.log("  Controlli:");
      for (const a of anomalie) {
        console.log(`    ${a.bloccante ? "BLOCCA" : "avviso"}  ${a.tipo} (${a.occorrenze}) — ${a.dettaglio}`);
      }
    } else {
      console.log("  Controlli: nessuna anomalia");
    }
    if ((anomalie ?? []).some((a) => a.bloccante)) {
      throw new Error("Validazione bloccante: ingest non eseguito");
    }

    if (DRY_RUN) {
      console.log("  dry-run: staging caricato, ingest NON eseguito.");
      await segnaFallito("dry-run: staging ripulito senza ingest");
      process.exit(0);
    }

    const { data: esito, error: eIng } = await rpc.rpc("bi_costi_ingest", {
      p_run_id: RUN_ID,
      p_anno_da: ANNO_DA,
    });
    if (eIng) throw new Error(`ingest: ${eIng.message}`);

    const r = Array.isArray(esito) ? esito[0] : esito;
    console.log(`  inserite:   ${r?.inserite ?? 0}`);
    console.log(`  aggiornate: ${r?.aggiornate ?? 0}`);
    console.log(`  eliminate:  ${r?.eliminate ?? 0}`);
    console.log(`  duplicate nel file: ${r?.duplicate ?? 0}`);
    console.log("  fatto.");
  } catch (e) {
    await segnaFallito(e?.message ?? e);
    throw e;
  }
})().catch((e) => {
  console.error(`\nERRORE: ${e?.message ?? e}`);
  process.exit(1);
});
