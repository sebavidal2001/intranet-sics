#!/usr/bin/env node
/**
 * Job batch: popola `chunks.embedding` per i chunks dei preventivatore.documenti
 * che ne sono privi (NULL). Utile dopo l'ingestion delle cartelle C e dopo i
 * salvataggi dei nuovi preventivi G dal builder.
 *
 * Strategy:
 *  - Gemini `gemini-embedding-2` (3072 dim) con fallback automatico a
 *    OpenRouter (`google/gemini-embedding-2-preview`) su 429/RESOURCE_EXHAUSTED.
 *  - Idempotente: skippa chunks con embedding gia' popolato.
 *  - Filtri: --tipo_cartella C|G|S, --solo-doc <codice>, --limit N
 *
 * Uso:
 *   node scripts/genera-embeddings-mancanti.cjs                  # tutti i chunks NULL
 *   node scripts/genera-embeddings-mancanti.cjs --tipo_cartella C
 *   node scripts/genera-embeddings-mancanti.cjs --limit 50
 *   node scripts/genera-embeddings-mancanti.cjs --dry-run
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *                   GEMINI_API_KEY (preferito), OPENROUTER_API_KEY (fallback).
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
const { GoogleGenerativeAI } = require("@google/generative-ai");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, def) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const TIPO_CART_FILTER = val("--tipo_cartella", null); // C | G | S
const SOLO_DOC = val("--solo-doc", null);
const LIMIT = parseInt(val("--limit", "10000"), 10);
const DRY = flag("--dry-run");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!URL || !KEY) {
  console.error("Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!GEMINI_API_KEY && !OPENROUTER_API_KEY) {
  console.error("Mancano GEMINI_API_KEY e OPENROUTER_API_KEY (almeno uno serve)");
  process.exit(1);
}

const db = createClient(URL, KEY, { auth: { persistSession: false } });
const geminiModelName = process.env.EMBEDDING_MODEL || "gemini-embedding-2";
const openrouterModelName = process.env.OPENROUTER_EMBEDDING_MODEL || "google/gemini-embedding-2-preview";

const geminiModel = GEMINI_API_KEY
  ? new GoogleGenerativeAI(GEMINI_API_KEY).getGenerativeModel({ model: geminiModelName })
  : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  geminiBlocked: false,
  geminiCalls: 0,
  openrouterCalls: 0,
  errori: 0,
};

async function viaGemini(text) {
  const r = await geminiModel.embedContent(text);
  return r.embedding.values;
}

async function viaOpenRouter(text) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://intranet.s-ics.com",
          "X-Title": "SICS preventivatore embedding backfill",
        },
        body: JSON.stringify({ model: openrouterModelName, input: text }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
      const emb = json?.data?.[0]?.embedding;
      if (!Array.isArray(emb)) throw new Error("OpenRouter: embedding mancante");
      return emb;
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(2000 * attempt);
    }
  }
  throw new Error("OpenRouter unreachable");
}

async function embed(text) {
  if (!state.geminiBlocked && geminiModel) {
    try {
      const v = await viaGemini(text);
      state.geminiCalls++;
      return { values: v, provider: "gemini" };
    } catch (err) {
      const msg = String((err && err.message) || err);
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
        console.warn(`  Gemini quota esaurita: passo a OpenRouter per il resto della run`);
        state.geminiBlocked = true;
      } else {
        // Errore non legato a quota: ritento con OpenRouter una volta
        console.warn(`  Gemini errore (${msg.slice(0, 100)}): fallback OpenRouter`);
      }
    }
  }
  if (!OPENROUTER_API_KEY) throw new Error("Gemini bloccato e OPENROUTER_API_KEY mancante");
  const v = await viaOpenRouter(text);
  state.openrouterCalls++;
  return { values: v, provider: "openrouter" };
}

(async () => {
  console.log(`[${new Date().toISOString()}] Backfill embedding chunks (${DRY ? "DRY" : "APPLY"})`);
  console.log(`  Provider: Gemini ${geminiModel ? "ON" : "OFF"} / OpenRouter ${OPENROUTER_API_KEY ? "ON" : "OFF"}`);

  // 1) Trova chunks con embedding NULL, opzionale filtro tipo_cartella o doc
  let q = db.schema("preventivatore").from("chunks")
    .select("id, documento_id, chunk_index, contenuto, documenti:documento_id(codice, tipo_cartella)")
    .is("embedding", null)
    .order("created_at", { ascending: true })
    .limit(LIMIT);

  const { data: chunks, error: chErr } = await q;
  if (chErr) { console.error("Errore query chunks:", chErr); process.exit(1); }

  let candidati = chunks ?? [];

  // Post-filter (l'inner join non supporta sempre filtro su tabella collegata in PostgREST con `.is()`)
  if (TIPO_CART_FILTER) {
    candidati = candidati.filter((c) => c.documenti?.tipo_cartella === TIPO_CART_FILTER);
  }
  if (SOLO_DOC) {
    candidati = candidati.filter((c) => c.documenti?.codice === SOLO_DOC);
  }

  console.log(`  Chunks da processare: ${candidati.length}`);
  if (candidati.length === 0) {
    console.log("  Niente da fare.");
    return;
  }
  if (DRY) {
    for (const c of candidati.slice(0, 5)) {
      console.log(`  ${c.documenti?.codice}/${c.chunk_index} (${(c.contenuto ?? "").length} chars)`);
    }
    return;
  }

  // 2) Loop sequenziale (rispetta rate limits Gemini 100 RPM = ~1.5/sec)
  let done = 0;
  for (const c of candidati) {
    const text = (c.contenuto ?? "").slice(0, 30000); // limite token-safe
    if (!text.trim()) {
      state.errori++;
      console.warn(`  skip ${c.documenti?.codice}/${c.chunk_index}: contenuto vuoto`);
      continue;
    }
    try {
      const { values, provider } = await embed(text);
      const { error: updErr } = await db
        .schema("preventivatore")
        .from("chunks")
        .update({ embedding: values })
        .eq("id", c.id);
      if (updErr) {
        state.errori++;
        console.error(`  ERR update ${c.id}: ${updErr.message}`);
      } else {
        done++;
        if (done % 10 === 0 || done === candidati.length) {
          console.log(`  ${done}/${candidati.length}  (gemini=${state.geminiCalls} openrouter=${state.openrouterCalls} err=${state.errori})  ultimo provider=${provider}`);
        }
      }
    } catch (err) {
      state.errori++;
      console.error(`  ERR embed ${c.documenti?.codice}/${c.chunk_index}: ${err instanceof Error ? err.message : err}`);
    }
    // pausa leggera ogni 5 chiamate
    if ((state.geminiCalls + state.openrouterCalls) % 5 === 0) await sleep(300);
  }

  console.log(`\nDone. ${done} embedding popolati. errori=${state.errori}`);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
