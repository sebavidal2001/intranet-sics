#!/usr/bin/env node
/**
 * V3 re-ingest (parte 1): popola righe_distinta con tipo_riga='manodopera' per
 * i preventivi storici S. Oggi gli S V2 hanno la manodopera SOLO come totale
 * aggregato in chunks.metadata.totals.totale_manodopera (no breakdown).
 *
 * Strategia minima e sicura:
 *  - Per ogni documenti con tipo='storico' e tipo_cartella IN ('S','C')
 *  - Se NESSUNA riga manodopera esiste già → inserisce UNA riga aggregata
 *    con descrizione 'MANODOPERA (totale aggregato V2)', tipo_riga='manodopera',
 *    totale_riga = totale_manodopera del chunk principale.
 *  - Idempotente: la verifica esistenza riga manodopera previene duplicati.
 *
 * Limiti noti: il breakdown per categoria (PROGETTAZIONE/LAVORAZIONE/MONTAGGIO/
 * COLLAUDO/MANUALE) NON viene estratto qui — richiederebbe rilettura dei file
 * Excel originali. Va in v3 fase 2 quando lo script di re-ingest pieno toccherà
 * di nuovo i file sorgente.
 *
 * Uso: node scripts/v3-popola-manodopera-storici.cjs [--dry-run] [--limit N]
 */

const fs = require("fs");
const path = require("path");

(function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})();

const { createClient } = require("@supabase/supabase-js");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const LIMIT = (() => { const i = args.indexOf("--limit"); return i >= 0 ? parseInt(args[i + 1], 10) || 1000 : 1000; })();

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });

function numFromMetadata(meta) {
  if (!meta || typeof meta !== "object") return null;
  const totals = meta.totals ?? meta.totali ?? {};
  // V2: chunks.metadata.totals.totale_manodopera (oggetto {raw, ceil_2} o numero)
  const tm = totals.totale_manodopera ?? totals.totale_man_dopera ?? null;
  // Per le C: chunks.metadata.totali_c.manodopera.totale_costo
  const tmC = meta?.totali_c?.manodopera?.totale_costo ?? null;
  const candidato = tm ?? tmC;
  if (candidato === null || candidato === undefined) return null;
  if (typeof candidato === "number") return Number.isFinite(candidato) ? candidato : null;
  if (typeof candidato === "object") {
    const v = candidato.raw ?? candidato.ceil_2 ?? null;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return null;
}

(async () => {
  console.log(`[${new Date().toISOString()}] V3 popola manodopera storici (${DRY ? "DRY" : "APPLY"})`);

  // Trova documenti storici da processare (S e C già importati)
  const { data: docs, error } = await db
    .schema("preventivatore")
    .from("documenti")
    .select("id, codice, tipo, tipo_cartella")
    .eq("tipo", "storico")
    .in("tipo_cartella", ["S", "C"])
    .limit(LIMIT);
  if (error) { console.error(error); process.exit(1); }
  console.log(`  Documenti candidati: ${docs?.length ?? 0}`);

  let inseriti = 0;
  let skipExist = 0;
  let skipNoData = 0;
  let errori = 0;

  for (const d of docs ?? []) {
    // 1) verifica se esiste già una riga manodopera
    const { count } = await db
      .schema("preventivatore")
      .from("righe_distinta")
      .select("id", { count: "exact", head: true })
      .eq("documento_id", d.id)
      .eq("tipo_riga", "manodopera");
    if ((count ?? 0) > 0) { skipExist++; continue; }

    // 2) leggi chunks per estrarre totale_manodopera
    const { data: chunks } = await db
      .schema("preventivatore")
      .from("chunks")
      .select("metadata")
      .eq("documento_id", d.id);

    let totale = 0;
    let trovato = false;
    for (const c of chunks ?? []) {
      const v = numFromMetadata(c.metadata);
      if (v !== null && v > 0) {
        totale += v;
        trovato = true;
      }
    }
    if (!trovato) { skipNoData++; continue; }

    if (DRY) {
      console.log(`  ${d.codice} (${d.tipo_cartella}): inserirei MANODOPERA = ${totale.toFixed(2)} EUR`);
      inseriti++;
      continue;
    }

    const { error: insErr } = await db
      .schema("preventivatore")
      .from("righe_distinta")
      .insert({
        documento_id: d.id,
        sheet_name: "_aggregato_v3",
        codice_articolo: null,
        descrizione: "MANODOPERA (totale aggregato V2 — breakdown non disponibile)",
        quantita: 1,
        prezzo_unitario: totale,
        totale_riga: totale,
        totale_riga_ceil_2: Math.ceil(totale * 100) / 100,
        tipo_riga: "manodopera",
      });
    if (insErr) {
      errori++;
      console.error(`  ERR ${d.codice}: ${insErr.message}`);
    } else {
      inseriti++;
      if (inseriti % 50 === 0) console.log(`  ${inseriti}/${docs.length} ...`);
    }
  }

  console.log(`\nDone. Inseriti: ${inseriti} | già esistenti: ${skipExist} | senza dato: ${skipNoData} | errori: ${errori}`);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
