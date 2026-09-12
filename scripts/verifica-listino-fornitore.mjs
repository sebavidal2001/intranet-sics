/**
 * verifica-listino-fornitore.mjs — Prova end-to-end di un listino fornitore.
 *
 * Fa quello che farebbe la pagina Impostazioni — legge l'Excel, lo valida contro
 * il tracciato del fornitore (fisso nel codice, vedi src/lib/.../listini.ts) e
 * salva le voci — ma da riga di comando, per verificare senza passare dalla UI.
 *
 * Se il file non corrisponde al tracciato esce con codice 1 e stampa il motivo,
 * esattamente come farebbe la pagina.
 *
 * Uso:
 *   npx tsx scripts/verifica-listino-fornitore.mjs "C:\path\Dorner.xlsx"
 *   npx tsx scripts/verifica-listino-fornitore.mjs file.xlsx --fornitore=ALUSIC
 *
 *   --attiva     il listino entra subito in vigore (default: caricato spento)
 *   --dry-run    parsa e mostra il riepilogo senza scrivere niente a DB
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

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

const FILE = process.argv[2];
if (!FILE || FILE.startsWith("--")) {
  console.error("Uso: npx tsx scripts/verifica-listino-fornitore.mjs <file.xlsx> [--fornitore=DORNER] [--attiva] [--dry-run]");
  process.exit(1);
}

const FORNITORE = String(arg("fornitore", "DORNER")).toUpperCase();
const ATTIVA = !!arg("attiva");
const DRY = !!arg("dry-run");

// Stessa validazione della UI e della route: il tracciato del fornitore è fisso
// nel codice, qui non si scelgono colonne. Il modulo TS viene compilato al volo
// da tsx; se non c'è, si spiega come lanciarlo.
let validaEParsa, TRACCIATI, normalizzaCodice;
try {
  ({ validaEParsa, TRACCIATI, normalizzaCodice } = await import("../src/lib/portali/preventivatore/listini.ts"));
} catch {
  console.error("Serve tsx per leggere il tracciato condiviso:");
  console.error("  npx tsx scripts/verifica-listino-fornitore.mjs <file> [opzioni]");
  process.exit(1);
}

if (!(FORNITORE in TRACCIATI)) {
  console.error(`Fornitore "${FORNITORE}" non gestito. Disponibili: ${Object.keys(TRACCIATI).join(", ")}`);
  process.exit(1);
}

// ── 1) Lettura e validazione del file ────────────────────────────────────────
const wb = XLSX.read(fs.readFileSync(FILE), { type: "buffer" });
const nomeFoglio = wb.SheetNames[0] ?? null;
const righe = nomeFoglio
  ? XLSX.utils.sheet_to_json(wb.Sheets[nomeFoglio], { header: 1, raw: true, defval: null })
  : [];

const esito = validaEParsa(righe, FORNITORE, nomeFoglio);

console.log("");
for (const r of esito.log) console.log(`  › ${r}`);
for (const p of esito.problemi) {
  console.log("");
  console.log(`  ${p.gravita === "errore" ? "ERRORE" : "AVVISO"}: ${p.messaggio}`);
  if (p.azione) console.log(`          ${p.azione}`);
}
if (!esito.ok) {
  console.error("");
  console.error("Caricamento bloccato: il file non corrisponde al tracciato.");
  process.exit(1);
}
const prime = esito.voci.slice(0, 3);
console.log("");
for (const v of prime) console.log(`  ${v.codice.padEnd(16)} ${String(v.prezzo_origine).padStart(10)} → ${v.costo}`);

if (DRY) { console.log("\n--dry-run: niente scritto a DB.\n"); process.exit(0); }

// ── 2) Salvataggio (stessa sequenza della route POST) ─────────────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error("Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(URL, KEY, { auth: { persistSession: false } });

const tracciato = TRACCIATI[FORNITORE];
const { data: listino, error: errIns } = await db
  .schema("preventivatore")
  .from("listini_fornitore")
  .insert({
    fornitore: FORNITORE,
    nome_file: path.basename(FILE),
    colonne: {
      codice: tracciato.colonnaCodice,
      descrizione: tracciato.colonnaDescrizione,
      prezzo: tracciato.colonnaPrezzo,
      divisore: tracciato.divisore,
    },
    righe_lette: esito.righe_lette,
    righe_valide: esito.voci.length,
    validazione: {
      nomeFoglio,
      log: esito.log,
      problemi: esito.problemi,
      righe_lette: esito.righe_lette,
      righe_scartate: esito.righe_scartate,
      codici_in_conflitto: esito.codici_in_conflitto.slice(0, 100),
    },
    note: "Caricato da scripts/verifica-listino-fornitore.mjs",
    attivo: false,
  })
  .select("id")
  .single();
if (errIns) { console.error("Insert listino:", errIns.message); process.exit(1); }

const voci = esito.voci.map((v) => ({
  listino_id: listino.id,
  codice_norm: normalizzaCodice(v.codice),
  codice: v.codice,
  descrizione: v.descrizione,
  prezzo_origine: v.prezzo_origine,
  costo: v.costo,
  riga_file: v.riga_file,
}));
for (let i = 0; i < voci.length; i += 500) {
  const { error } = await db.schema("preventivatore").from("listini_fornitore_voci").insert(voci.slice(i, i + 500));
  if (error) {
    console.error("Insert voci:", error.message);
    await db.schema("preventivatore").from("listini_fornitore").delete().eq("id", listino.id);
    process.exit(1);
  }
}

if (ATTIVA) {
  await db.schema("preventivatore").from("listini_fornitore")
    .update({ attivo: false }).eq("attivo", true).ilike("fornitore", FORNITORE);
  await db.schema("preventivatore").from("listini_fornitore")
    .update({ attivo: true }).eq("id", listino.id);
}

// ── 3) Confronto con l'anagrafica ────────────────────────────────────────────
const { data: conf } = await db
  .schema("preventivatore")
  .rpc("listino_confronto_anagrafica", { p_listino_id: listino.id, p_campione: 10 });

console.log(`\nListino ${FORNITORE} salvato (${ATTIVA ? "ATTIVO" : "spento"}) — id ${listino.id}`);
if (conf) {
  console.log(`  ${conf.in_anagrafica} codici sostituiscono l'UC · ${conf.solo_listino} codici nuovi solo a listino`);
  if (conf.delta_medio_pct != null) console.log(`  scostamento medio dall'UC: ${conf.delta_medio_pct > 0 ? "+" : ""}${conf.delta_medio_pct}%`);
  if (conf.fornitori_gestionale?.length) {
    console.log("  fornitori del gestionale toccati:");
    for (const f of conf.fornitori_gestionale) console.log(`    ${f.fornitore} — ${f.articoli} articoli`);
  }
  if (conf.campione?.length) {
    console.log("\n  codice            UC        listino     Δ");
    for (const c of conf.campione)
      console.log(`  ${String(c.codice).padEnd(16)} ${String(c.ult_costo).padStart(9)} ${String(c.costo_listino).padStart(10)}  ${c.delta_pct > 0 ? "+" : ""}${c.delta_pct}%`);
  }
}
console.log("");
