/**
 * import-campagne-excel.mjs — Carica nel Portale Campagne lo storico e i
 * destinatari dal foglio "Database clienti AF.xlsx" (migration 131).
 *
 * Uso:
 *   node scripts/import-campagne-excel.mjs --file=<path.xlsx>              # solo simulazione
 *   node scripts/import-campagne-excel.mjs --file=<path.xlsx> --applica    # scrive
 *
 *   --foglio=<nome>        foglio da leggere (default: il primo con "Codice Cliente")
 *   --includi-potenziali   i clienti "Potenziale" con la cella vuota diventano destinatari
 *                          (default NO: decisione del 03/10/2026, solo i clienti)
 *   --consenti-attive      permette l'import su campagne gia' ATTIVE (vedi sotto)
 *   --report=<file.json>   scrive il dettaglio (piano, avvisi, clienti da verificare)
 *
 * Senza --applica non si tocca il database e non servono credenziali.
 *
 * Perche' le campagne devono essere SOSPESE
 * -----------------------------------------
 * Le tre campagne 2026 nascono sospese (migration 131). Importando lo storico
 * mentre una e' attiva, il back office potrebbe vedersi suggerire una campagna
 * che il cliente ha gia' ricevuto, nell'intervallo fra due batch. Lo script
 * rifiuta di scrivere su una campagna attiva; si attiva DOPO l'import.
 *
 * Idempotente: si puo' rilanciare. Un cliente che ha gia' un invio non
 * annullato per quella campagna (anche creato dal programma) viene saltato e
 * mai sovrascritto; i destinatari gia' presenti restano com'e'.
 *
 * Non atomico: le scritture passano da PostgREST a blocchi. Se si interrompe,
 * si rilancia e completa quello che manca.
 *
 * Gli invii importati hanno origine='import_excel', senza referente ne' numero
 * d'ordine (nel foglio non esistono) e con la data del foglio, che e' la data
 * del DDT. `assegnata_il` e' l'istante dell'import: non si inventa un'ora.
 */

import fs from "fs";
import path from "path";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import {
  trovaColonne,
  leggiClienti,
  costruisciPiano,
  riepilogaAvvisi,
  serialeExcelAData,
} from "./lib/campagne-excel.mjs";

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
const APPLICA = !!arg("applica");
const INCLUDI_POTENZIALI = !!arg("includi-potenziali");
const CONSENTI_ATTIVE = !!arg("consenti-attive");
const FOGLIO = arg("foglio");
const REPORT = arg("report");

if (!FILE || FILE === true) { console.error("Manca --file=<path.xlsx>"); process.exit(1); }
if (!fs.existsSync(FILE)) { console.error(`File non trovato: ${FILE}`); process.exit(1); }

// La xlsx 0.20 in versione ESM non legge i file finche' non le si da' il modulo fs;
// la 0.18 non ha set_fs. Dove gira lo script (PC o VM) puo' esserci l'una o l'altra.
if (typeof XLSX.set_fs === "function") XLSX.set_fs(fs);

// ─── Lettura del foglio ────────────────────────────────────────────────────
// Le date si riconoscono dal formato della cella e si convertono dal seriale a
// mano: lasciare fare a SheetJS (cellDates) le sposta per il fuso orario.
function leggiFoglio(file, nomeFoglio) {
  // cellNF: senza, SheetJS non espone il formato (`z`) e una data e' un numero qualunque.
  const wb = XLSX.readFile(file, { cellDates: false, cellNF: true });
  const nomi = nomeFoglio ? [nomeFoglio] : wb.SheetNames;
  for (const nome of nomi) {
    const ws = wb.Sheets[nome];
    if (!ws || !ws["!ref"]) continue;
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const cella = (r, c) => {
      const x = ws[XLSX.utils.encode_cell({ r, c })];
      if (!x) return null;
      if (x.t === "n" && x.z && XLSX.SSF.is_date(x.z)) return { data: serialeExcelAData(x.v) };
      if (x.t === "n") return String(x.v);
      if (x.t === "b") return x.v ? "TRUE" : "FALSE";
      return x.v === undefined ? null : String(x.v);
    };
    const intestazione = [];
    for (let c = range.s.c; c <= range.e.c; c++) intestazione.push(cella(range.s.r, c) ?? "");
    if (!intestazione.some((h) => /^codice cliente$/i.test(String(h).trim()))) continue;
    const righe = [];
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const riga = [];
      for (let c = range.s.c; c <= range.e.c; c++) riga.push(cella(r, c));
      righe.push(riga);
    }
    return { nome, intestazione, righe };
  }
  throw new Error(`Nessun foglio con l'intestazione "Codice Cliente" in ${file}`);
}

const foglio = leggiFoglio(FILE, FOGLIO === true ? null : FOGLIO);
const colonne = trovaColonne(foglio.intestazione);
const { clienti, avvisi: avvisiLettura } = leggiClienti(foglio.righe, colonne);
const piano = costruisciPiano(clienti, colonne, { includiPotenziali: INCLUDI_POTENZIALI });
const avvisi = [...avvisiLettura, ...piano.avvisi];

// ─── Riepilogo ─────────────────────────────────────────────────────────────
const n = (x) => x.toLocaleString("it-IT");
console.log(`\nFoglio "${foglio.nome}": ${n(foglio.righe.length)} righe, ${n(clienti.size)} clienti distinti`);
console.log(`Pubblico: ${INCLUDI_POTENZIALI ? "Attivo + Potenziale" : "solo Attivo"}, rivenditori sempre esclusi\n`);
console.log("Campagna   Destinatari  Invii  consegnata  banco  preparata  esclusi(potenz.)  esclusi(riv.)");
for (const c of piano.campagne) {
  const s = c.stats;
  console.log(
    `${c.codice.padEnd(9)} ${String(n(s.destinatari)).padStart(11)} ${String(n(s.invii)).padStart(6)} ` +
    `${String(n(s.consegnata)).padStart(11)} ${String(n(s.consegnata_banco)).padStart(6)} ${String(n(s.preparata)).padStart(10)} ` +
    `${String(n(s.esclusiPotenziali)).padStart(17)} ${String(n(s.escluseRivenditori)).padStart(14)}`
  );
}

const perTipo = riepilogaAvvisi(avvisi);
console.log("\nAvvisi:");
for (const [tipo, lista] of Object.entries(perTipo).sort()) {
  console.log(`  ${tipo}: ${n(lista.length)}`);
  const mostra = tipo === "rivenditore_non_marcato" || tipo === "marcato_non_rivenditore" ? 3 : 8;
  for (const a of lista.slice(0, mostra)) console.log(`     ${a.codice}  ${a.dettaglio}`);
  if (lista.length > mostra) console.log(`     ... e altri ${n(lista.length - mostra)}`);
}
console.log(`\nClienti da verificare (senza categoria o agente): ${n(piano.daVerificare.length)}`);

if (REPORT && REPORT !== true) {
  fs.writeFileSync(REPORT, JSON.stringify({ foglio: foglio.nome, piano, avvisi }, null, 2), "utf8");
  console.log(`Report scritto in ${REPORT}`);
}

if (!APPLICA) {
  console.log("\nSimulazione: non e' stato scritto nulla. Aggiungere --applica per caricare.");
  process.exit(0);
}

// ─── Scrittura ─────────────────────────────────────────────────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error("Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

// Lo schema campagne dev'essere in pgrst.db_schemas: se non lo e', PostgREST
// risponde 406 e lo script si ferma qui, non scrive "a vuoto".
const db = createClient(URL, KEY, { auth: { persistSession: false }, db: { schema: "campagne" } });

const aBlocchi = (v, dim) => Array.from({ length: Math.ceil(v.length / dim) }, (_, i) => v.slice(i * dim, (i + 1) * dim));
const fallisci = (contesto, error) => { console.error(`\nERRORE ${contesto}: ${error.message}${error.hint ? ` (${error.hint})` : ""}`); process.exit(1); };

const { data: campagneDb, error: errCamp } = await db.from("campagne").select("id, codice, stato");
if (errCamp) fallisci("lettura campagne", errCamp);
const perCodice = new Map((campagneDb ?? []).map((c) => [c.codice, c]));

const mancanti = piano.campagne.filter((c) => !perCodice.has(c.codice)).map((c) => c.codice);
if (mancanti.length) {
  console.error(`\nCampagne non presenti nel database: ${mancanti.join(", ")}. Creale prima dal portale (o dalla migration 131).`);
  process.exit(1);
}
const attive = piano.campagne.filter((c) => perCodice.get(c.codice).stato === "attiva").map((c) => c.codice);
if (attive.length && !CONSENTI_ATTIVE) {
  console.error(`\nCampagne gia' ATTIVE: ${attive.join(", ")}. Importare ora rischia suggerimenti sbagliati nel frattempo.`);
  console.error("Sospenderle, importare e poi riattivarle; oppure --consenti-attive se e' voluto.");
  process.exit(1);
}

let totInvii = 0, totSaltati = 0, totDest = 0;
for (const c of piano.campagne) {
  const id = perCodice.get(c.codice).id;

  // Chi ha gia' un invio non annullato per questa campagna non si tocca.
  const esistenti = new Set();
  for (let da = 0; ; da += 1000) {
    const { data, error } = await db.from("invii").select("codice_cliente").eq("campagna_id", id).neq("stato", "annullata").range(da, da + 999);
    if (error) fallisci(`lettura invii di ${c.codice}`, error);
    for (const r of data) esistenti.add(r.codice_cliente);
    if (data.length < 1000) break;
  }
  const nuovi = c.invii.filter((i) => !esistenti.has(i.codice_cliente));
  totSaltati += c.invii.length - nuovi.length;

  for (const blocco of aBlocchi(nuovi, 500)) {
    const righe = blocco.map(({ campagna_codice, ...resto }) => ({ ...resto, campagna_id: id }));
    const { error } = await db.from("invii").insert(righe);
    if (error) fallisci(`inserimento invii di ${c.codice}`, error);
  }
  totInvii += nuovi.length;

  // Destinatari: la chiave primaria (campagna, cliente) rende il rilancio innocuo.
  for (const blocco of aBlocchi(c.destinatari, 1000)) {
    const { error } = await db
      .from("destinatari")
      .upsert(blocco.map((codice_cliente) => ({ campagna_id: id, codice_cliente })), { onConflict: "campagna_id,codice_cliente", ignoreDuplicates: true });
    if (error) fallisci(`inserimento destinatari di ${c.codice}`, error);
  }
  totDest += c.destinatari.length;

  console.log(`  ${c.codice}: ${n(nuovi.length)} invii scritti, ${n(c.invii.length - nuovi.length)} gia' presenti, ${n(c.destinatari.length)} destinatari`);
}

console.log(`\nFatto: ${n(totInvii)} invii scritti (${n(totSaltati)} saltati perche' gia' presenti), ${n(totDest)} destinatari elaborati.`);
console.log("Le campagne restano sospese: verificare i numeri e poi attivarle dal portale.");
