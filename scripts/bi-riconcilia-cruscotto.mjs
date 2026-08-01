/**
 * bi-riconcilia-cruscotto.mjs — Report di riconciliazione PRE-import (Fase 1).
 *
 * Confronta uno snapshot del Cruscotto articoli con lo stato del database,
 * SENZA scrivere nulla. Usa il parser ufficiale del tracciato (40 colonne,
 * decimali con virgola, escape \x0d\x0a) in scripts/lib/cruscotto-parser.mjs.
 *
 * Controlli:
 *   1. intestazione: 40 colonne attese, nomi e ordine
 *   2. codici nel Cruscotto ma non in preventivatore.prodotti
 *   3. codici in prodotti ma non nel Cruscotto (MAI disattivati automaticamente)
 *   4. duplicati per codice articolo / per (codice, magazzino)
 *   5. articoli senza costo (restano NULL)
 *   6. magazzini non riconosciuti
 *   7. disponibilità diversa dalla formula (tolleranza 0,001)
 *   8. valori numerici o date non interpretabili
 *   9. righe senza chiave
 *  10. costi sospetti (possibili importi in lire non convertiti)
 *
 * Uso:
 *   node scripts/bi-riconcilia-cruscotto.mjs --file=<path.csv|xlsx> [--csv] [--out=<dir>]
 */

import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import {
  COLONNE_ATTESE, validaIntestazione, rigaToRecord,
  disponibilitaAttesa, parseNumIta, parseDataIso, parseCsv,
} from "./lib/cruscotto-parser.mjs";

for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  let v = line.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!process.env[k]) process.env[k] = v;
}

const arg = (n, d = null) => {
  const m = process.argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  return !m ? d : (m === `--${n}` ? true : m.split("=").slice(1).join("="));
};

const FILE = arg("file");
const OUT_DIR = arg("out", "supabase/backups/20260801_preflight");
const TOLLERANZA = 0.001;
const SOGLIA_COSTO_SOSPETTO = 50000; // oltre → probabile importo in lire
if (!FILE) { console.error("Manca --file=<path>"); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }, db: { schema: "preventivatore" },
});

function leggi(file) {
  const isCsv = arg("csv") || /\.csv$/i.test(file);
  if (isCsv) {
    // Parser dedicato: il tracciato SQL Anywhere ha TUTTI i campi quotati.
    const data = parseCsv(fs.readFileSync(file, "utf8"), ";");
    return { headers: data[0].map((h) => String(h ?? "").trim()), righe: data.slice(1) };
  }
  const wb = XLSX.read(fs.readFileSync(file), { type: "buffer", cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  return { headers: data[0].map((h) => String(h ?? "").trim()), righe: data.slice(1) };
}

(async () => {
  console.log("Riconciliazione Cruscotto ↔ database (sola lettura)\n  file:", FILE);
  const { headers, righe } = leggi(FILE);

  // ── 1) Intestazione ──
  const val = validaIntestazione(headers);
  console.log(`  colonne: ${val.nColonne} (attese ${COLONNE_ATTESE.length}) · righe: ${righe.length}`);
  if (!val.ok) {
    console.log(`  ⚠ mancanti: ${val.mancanti.join(", ") || "-"}`);
    console.log(`  ⚠ inattese: ${val.inattese.join(", ") || "-"}`);
  } else {
    console.log(`  ✓ intestazione conforme${val.ordineDiverso ? " (ordine diverso dall'atteso)" : ""}`);
  }

  // ── stato DB ──
  const codiciDb = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("prodotti").select("codice").range(from, from + 999);
    if (error) throw new Error("select prodotti: " + error.message);
    if (!data?.length) break;
    data.forEach((r) => codiciDb.add(r.codice));
    if (data.length < 1000) break;
  }
  const magazziniDb = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("prodotti_giacenze").select("magazzino").range(from, from + 999);
    if (error) throw new Error("select giacenze: " + error.message);
    if (!data?.length) break;
    data.forEach((r) => magazziniDb.add(r.magazzino));
    if (data.length < 1000) break;
  }
  console.log(`  DB: ${codiciDb.size} codici · magazzini: ${[...magazziniDb].sort().join(", ")}`);

  // ── analisi ──
  const anomalie = [];
  const add = (tipo, codice, magazzino, dettaglio) => anomalie.push({ tipo, codice, magazzino, dettaglio });
  const chiavi = new Map();
  const codiciFile = new Map();
  const contatori = { senzaCosto: 0, dispErrata: 0, numInvalidi: 0, dataInvalida: 0, senzaChiave: 0, costoSospetto: 0 };

  for (const riga of righe) {
    const r = rigaToRecord(headers, riga);

    if (!r.codice || !r.magazzino) {
      contatori.senzaChiave++;
      add("riga_senza_chiave", r.codice ?? "(vuoto)", r.magazzino ?? "(vuoto)", "codice o magazzino mancante");
      continue;
    }

    codiciFile.set(r.codice, (codiciFile.get(r.codice) ?? 0) + 1);
    const key = `${r.codice}|${r.magazzino}`;
    chiavi.set(key, (chiavi.get(key) ?? 0) + 1);

    // costo
    if (Number.isNaN(r.ult_costo)) {
      contatori.numInvalidi++;
      add("numero_non_valido", r.codice, r.magazzino, "Ult_Costo non interpretabile");
    } else if (r.ult_costo === null) {
      contatori.senzaCosto++;
      add("articolo_senza_costo", r.codice, r.magazzino, "Ult_Costo vuoto → resterà NULL");
    } else if (r.ult_costo > SOGLIA_COSTO_SOSPETTO) {
      contatori.costoSospetto++;
      add("costo_sospetto", r.codice, r.magazzino, `${r.ult_costo} (data ${r.data_ult_costo ?? "n/d"}): possibile importo in lire`);
    }

    if (r.data_ult_costo === undefined) {
      contatori.dataInvalida++;
      add("data_non_valida", r.codice, r.magazzino, "data_Ult_Costo non interpretabile");
    }

    if (!magazziniDb.has(r.magazzino)) add("magazzino_non_riconosciuto", r.codice, r.magazzino, "non presente oggi in prodotti_giacenze");

    // quantità non numeriche
    const qtaNaN = Object.entries(r).filter(([k, v]) => k.startsWith("qta_") && Number.isNaN(v)).map(([k]) => k);
    if (qtaNaN.length) {
      contatori.numInvalidi++;
      add("numero_non_valido", r.codice, r.magazzino, `quantità non numeriche: ${qtaNaN.join(", ")}`);
    } else {
      const atteso = disponibilitaAttesa(r);
      const disp = Number(r.disponibilita ?? 0) || 0;
      if (Math.abs(atteso - disp) > TOLLERANZA) {
        contatori.dispErrata++;
        add("disponibilita_non_coerente", r.codice, r.magazzino, `attesa ${atteso}, trovata ${disp}`);
      }
    }
  }

  for (const [key, n] of chiavi) if (n > 1) { const [c, m] = key.split("|"); add("duplicato_codice_magazzino", c, m, `${n} righe`); }

  const nuovi = [...codiciFile.keys()].filter((c) => !codiciDb.has(c));
  const mancanti = [...codiciDb].filter((c) => !codiciFile.has(c));
  nuovi.forEach((c) => add("codice_nuovo_non_in_db", c, "", "nel Cruscotto, assente in prodotti"));
  mancanti.forEach((c) => add("codice_db_non_nel_cruscotto", c, "", "in prodotti, assente nel Cruscotto → NON disattivato automaticamente"));

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
  const out = path.join(OUT_DIR, `riconciliazione-cruscotto-${stamp}.csv`);
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  fs.writeFileSync(out, ["tipo;codice;magazzino;dettaglio",
    ...anomalie.map((a) => [a.tipo, a.codice, a.magazzino, a.dettaglio].map(esc).join(";"))].join("\n"), "utf8");

  const per = anomalie.reduce((m, a) => ((m[a.tipo] = (m[a.tipo] ?? 0) + 1), m), {});
  console.log("\n─── RIEPILOGO ───");
  console.log(`  righe snapshot        : ${righe.length}`);
  console.log(`  articoli unici        : ${codiciFile.size}`);
  console.log(`  coppie codice+mag     : ${chiavi.size}`);
  console.log(`  codici nuovi          : ${nuovi.length}`);
  console.log(`  codici solo in DB     : ${mancanti.length}`);
  console.log(`  senza costo           : ${contatori.senzaCosto}`);
  console.log(`  costi sospetti (lire?): ${contatori.costoSospetto}`);
  console.log(`  disponibilità anomala : ${contatori.dispErrata}`);
  console.log(`  numeri non validi     : ${contatori.numInvalidi}`);
  console.log(`  date non valide       : ${contatori.dataInvalida}`);
  console.log(`  righe senza chiave    : ${contatori.senzaChiave}`);
  console.log("\n  per tipo:", per);
  console.log(`\n✓ Report: ${out} (${anomalie.length} righe)`);
})().catch((e) => { console.error("ERRORE:", e.message || e); process.exit(1); });
