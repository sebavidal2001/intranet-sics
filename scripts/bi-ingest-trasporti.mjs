/**
 * bi-ingest-trasporti.mjs — Carica un run `trasporti_documenti` nello staging
 * e lancia l'ingest atomico della migration 099.
 *
 * Uso dal runner Linux:
 *   node scripts/bi-ingest-trasporti.mjs <directory-run> --profilo=<live|riconciliazione>
 *
 * Opzioni:
 *   --run-id=<id>      identificativo del run (default: nome directory)
 *   --captured-at=<t>  istante estrazione (default: manifest o mtime CSV)
 *   --batch=<n>        righe per caricamento staging (default: 2000)
 *   --dry-run          valida e ripulisce lo staging, senza aggiornare la tabella
 *
 * La directory deve contenere `trasporti_documenti.csv`; `manifest.json` è
 * facoltativo. Il profilo è volutamente obbligatorio: trattare per errore un
 * file live come riconciliazione marcherebbe assenti documenti ancora validi.
 * Dal manifest sono attesi `completed_at`, `source`, la scheda in `files` e
 * `mode`, che dichiara `live` o `riconciliazione`: se presente deve coincidere
 * con `--profilo`, altrimenti il run viene fermato e registrato come fallito.
 * L'assenza di `mode` resta tollerata e viene segnalata nel log per compatibilità
 * con i run creati prima dell'introduzione del campo.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import {
  COLONNE_TRASPORTI,
  calcolaFinestraDal,
  convertiRigaTrasporti,
  creaBlocchi,
  parseArgomentiTrasporti,
  parseCsv,
  validaIntestazioneTrasporti,
  verificaModeManifestTrasporti,
} from "./lib/trasporti-parser.mjs";

// ─── Configurazione ─────────────────────────────────────────────────────────
for (const fileEnv of [".env.local", "scripts/.env"]) {
  const percorso = path.join(process.cwd(), fileEnv);
  if (!fs.existsSync(percorso)) continue;
  for (const linea of fs.readFileSync(percorso, "utf8").split(/\r?\n/)) {
    if (!linea || linea.startsWith("#") || !linea.includes("=")) continue;
    const separatore = linea.indexOf("=");
    const chiave = linea.slice(0, separatore).trim();
    let valore = linea.slice(separatore + 1).trim();
    if ((valore.startsWith('"') && valore.endsWith('"')) ||
        (valore.startsWith("'") && valore.endsWith("'"))) {
      valore = valore.slice(1, -1);
    }
    if (!process.env[chiave]) process.env[chiave] = valore;
  }
}

function messaggioErrore(errore) {
  return errore instanceof Error ? errore.message : String(errore);
}

function leggiManifest(runDirectory) {
  const percorso = path.join(runDirectory, "manifest.json");
  if (!fs.existsSync(percorso)) return null;
  const contenuto = JSON.parse(fs.readFileSync(percorso, "utf8"));
  if (!contenuto || typeof contenuto !== "object" || Array.isArray(contenuto)) {
    throw new Error("manifest.json non contiene un oggetto JSON");
  }
  return contenuto;
}

function schedaDataset(manifest) {
  if (!manifest || !Array.isArray(manifest.files)) return null;
  const scheda = manifest.files.find((file) =>
    file && typeof file === "object" && file.dataset === "trasporti_documenti");
  return scheda && typeof scheda === "object" ? scheda : null;
}

function validaRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)) {
    throw new Error("run_id non valido: usare 1-128 caratteri alfanumerici, punto, trattino, underscore o due punti");
  }
  return runId;
}

const opzioni = parseArgomentiTrasporti(process.argv.slice(2));
const RUN_DIRECTORY = path.resolve(opzioni.runDirectory);
if (!fs.existsSync(RUN_DIRECTORY) || !fs.statSync(RUN_DIRECTORY).isDirectory()) {
  throw new Error(`Directory del run non trovata: ${RUN_DIRECTORY}`);
}

const FILE = path.join(RUN_DIRECTORY, "trasporti_documenti.csv");
if (!fs.existsSync(FILE) || !fs.statSync(FILE).isFile()) {
  throw new Error(`CSV non trovato: ${FILE}`);
}

const manifest = leggiManifest(RUN_DIRECTORY);
const fileManifest = schedaDataset(manifest);
const stat = fs.statSync(FILE);
const RUN_ID = validaRunId(opzioni.runId ?? path.basename(RUN_DIRECTORY));
const CAPTURED_AT = opzioni.capturedAt ??
  (typeof manifest?.completed_at === "string" ? manifest.completed_at : stat.mtime.toISOString());
const FINESTRA_DAL = opzioni.profilo === "riconciliazione"
  ? calcolaFinestraDal(CAPTURED_AT)
  : null;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) {
  throw new Error("Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
}

// Lo schema bi resta fuori da PostgREST: si usano soltanto i wrapper public
// SECURITY DEFINER della migration 099, concessi al service_role.
const rpc = createClient(URL, KEY, { auth: { persistSession: false } });

async function segnaFallito(messaggio, pulisci = false) {
  await rpc.rpc("bi_trasporti_run_fail", {
    p_run_id: RUN_ID,
    p_errore: String(messaggio).slice(0, 4000),
    p_pulisci: pulisci,
  });
}

// ─── Esecuzione ─────────────────────────────────────────────────────────────
(async () => {
  console.log(`Ingest Trasporti\n  directory:   ${RUN_DIRECTORY}`);
  console.log(`  file:        ${FILE}`);
  console.log(`  profilo:     ${opzioni.profilo}`);
  console.log(`  run_id:      ${RUN_ID}`);
  console.log(`  captured_at: ${CAPTURED_AT}`);
  if (FINESTRA_DAL) console.log(`  finestra_da: ${FINESTRA_DAL}`);

  try {
    verificaModeManifestTrasporti(manifest, opzioni.profilo);

    const contenuto = fs.readFileSync(FILE);
    const sha256 = crypto.createHash("sha256").update(contenuto).digest("hex");
    const dati = parseCsv(contenuto.toString("utf8"), ";");
    if (dati.length < 2) throw new Error("Il file non contiene righe dati");

    const intestazione = validaIntestazioneTrasporti(dati[0]);
    if (!intestazione.ok) {
      throw new Error(
        `Intestazione non conforme — mancanti: [${intestazione.mancanti.join(", ")}] · ` +
        `inattese: [${intestazione.inattese.join(", ")}] · ` +
        `ordine: ${intestazione.ordineDiverso ? "diverso" : "corretto"}`,
      );
    }
    console.log(`  colonne:     ${intestazione.nColonne}/${COLONNE_TRASPORTI.length} conformi e ordinate`);

    const righe = dati.slice(1).map((riga, indice) =>
      convertiRigaTrasporti(intestazione.headers, riga, RUN_ID, indice + 1));
    console.log(`  righe:       ${righe.length}`);

    if (fileManifest?.rows !== undefined && Number(fileManifest.rows) !== righe.length) {
      throw new Error(`manifest dichiara ${fileManifest.rows} righe, il CSV ne contiene ${righe.length}`);
    }
    if (typeof fileManifest?.sha256 === "string" && fileManifest.sha256.toLowerCase() !== sha256) {
      throw new Error("SHA-256 del CSV diverso da quello dichiarato nel manifest");
    }

    const source = typeof manifest?.source === "string" ? manifest.source : "SRVWOA";
    const { error: erroreRun } = await rpc.rpc("bi_trasporti_run_start", {
      p_run_id: RUN_ID,
      p_profilo: opzioni.profilo,
      p_source: source,
      p_captured_at: CAPTURED_AT,
      p_finestra_dal: FINESTRA_DAL,
      p_sha256: sha256,
      p_metadata: {
        file: path.basename(FILE),
        bytes: stat.size,
        directory: path.basename(RUN_DIRECTORY),
      },
    });
    if (erroreRun) throw new Error(`registrazione run: ${erroreRun.message}`);

    let caricate = 0;
    const blocchi = creaBlocchi(righe, opzioni.batch);
    for (let indice = 0; indice < blocchi.length; indice++) {
      const blocco = blocchi[indice];
      const primaRiga = indice * opzioni.batch + 1;
      const ultimaRiga = primaRiga + blocco.length - 1;
      const { data, error } = await rpc.rpc("bi_trasporti_staging_load", {
        p_run_id: RUN_ID,
        p_righe: blocco,
      });
      if (error) throw new Error(`staging righe ${primaRiga}-${ultimaRiga}: ${error.message}`);
      caricate += Number(data ?? 0);
      process.stdout.write(`\r  caricate:    ${caricate}/${righe.length}`);
    }
    console.log("");
    if (caricate !== righe.length) {
      throw new Error(`caricate ${caricate} righe su ${righe.length} lette dal file`);
    }

    const { data: anomalie, error: erroreValidazione } = await rpc.rpc(
      "bi_trasporti_valida",
      { p_run_id: RUN_ID },
    );
    if (erroreValidazione) throw new Error(`validazione: ${erroreValidazione.message}`);

    const controlli = Array.isArray(anomalie) ? anomalie : [];
    const bloccanti = controlli.filter((anomalia) => anomalia.bloccante === true);
    if (controlli.length) {
      console.log("\n  Controlli:");
      for (const anomalia of controlli) {
        console.log(
          `    ${anomalia.bloccante ? "BLOCCA" : "avviso"}  ${anomalia.tipo} ` +
          `(${anomalia.occorrenze}) — ${anomalia.dettaglio}`,
        );
      }
    } else {
      console.log("\n  Controlli:   nessuna anomalia");
    }

    if (opzioni.dryRun) {
      await segnaFallito("dry-run: nessun ingest eseguito", true);
      console.log("\n  Dry-run: staging ripulito, produzione non toccata.");
      process.exitCode = bloccanti.length ? 1 : 0;
      return;
    }

    if (bloccanti.length) {
      throw new Error(`validazione fallita: ${bloccanti.map((anomalia) => anomalia.tipo).join(", ")}`);
    }

    const { data: esito, error: erroreIngest } = await rpc.rpc("bi_trasporti_ingest", {
      p_run_id: RUN_ID,
      p_profilo: opzioni.profilo,
      p_captured_at: CAPTURED_AT,
    });
    if (erroreIngest) throw new Error(`ingest: ${erroreIngest.message}`);

    console.log("\n─── ESITO ───");
    if (esito && typeof esito === "object" && !Array.isArray(esito)) {
      for (const [chiave, valore] of Object.entries(esito)) {
        if (chiave === "anomalie") continue;
        console.log(`  ${chiave.padEnd(24)}: ${valore}`);
      }
    }
    console.log(`\n✓ Run ${RUN_ID} pubblicato.`);
  } catch (errore) {
    await segnaFallito(messaggioErrore(errore));
    // Lo staging resta per la diagnosi; dry-run è l'unico caso che lo pulisce.
    throw errore;
  }
})().catch((errore) => {
  console.error(`\nERRORE: ${messaggioErrore(errore)}`);
  process.exitCode = 1;
});
