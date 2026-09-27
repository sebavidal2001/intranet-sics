#!/usr/bin/env node
/** Backfill idempotente degli embedding mancanti di chunk e schede approvate. */

const fs = require("fs");
const path = require("path");

(function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
})();

const { createClient } = require("@supabase/supabase-js");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const val = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const DIMENSIONE = 3072;
// Tutta l'AI passa da OpenRouter: stesso modello gemini-embedding-2, vettori identici
// a quelli calcolati prima via Google (verificato: coseno 1,00000).
const MODELLO_DEFAULT = "google/gemini-embedding-2-preview";
const tipoCartella = val("--tipo_cartella", null);
const soloDocumento = val("--solo-doc", null);
const limite = Number.parseInt(val("--limit", "10000"), 10);
const dryRun = flag("--dry-run");
const includiSchede = flag("--schede");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openRouterKey = process.env.OPENROUTER_API_KEY;

function erroreConfigurazione(messaggio) {
  console.error(messaggio);
  process.exit(2);
}

if (!url || !serviceKey) erroreConfigurazione("Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
if (!openRouterKey) erroreConfigurazione("Manca OPENROUTER_API_KEY");
if (!Number.isInteger(limite) || limite <= 0) erroreConfigurazione("--limit deve essere un intero positivo");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validaVettore(vettore) {
  if (!Array.isArray(vettore) || vettore.length !== DIMENSIONE || !vettore.every(Number.isFinite)) {
    const ricevuti = Array.isArray(vettore) ? vettore.length : "non-array";
    throw new Error(`Embedding non valido: attesi ${DIMENSIONE} numeri finiti, ricevuti ${ricevuti}`);
  }
  return vettore;
}

async function leggiModello() {
  const { data, error } = await db
    .schema("preventivatore")
    .from("ai_config")
    .select("valore")
    .eq("chiave", "modello_embedding")
    .maybeSingle();
  if (error) throw new Error(`Configurazione ai_config illeggibile: ${error.message}`);
  const valore = (data?.valore || process.env.EMBEDDING_MODEL || "").trim().replace(/^openrouter:/, "");
  // Il vecchio valore "gemini-embedding-2" era l'ID Google dello stesso modello.
  return !valore || valore === "gemini-embedding-2" ? MODELLO_DEFAULT : valore;
}

async function viaOpenRouter(testo, modello) {
  const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://intranet.s-ics.com",
      "X-Title": "SICS preventivatore embedding backfill",
    },
    body: JSON.stringify({ model: modello, input: testo }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
  return validaVettore(payload?.data?.[0]?.embedding);
}

async function creaEmbedder(modello) {
  return async (testo) => {
    let ultimoErrore;
    for (let tentativo = 1; tentativo <= 3; tentativo += 1) {
      try {
        return { vettore: await viaOpenRouter(testo, modello), modello };
      } catch (errore) {
        ultimoErrore = errore;
        await sleep(1000 * tentativo);
      }
    }
    throw ultimoErrore;
  };
}

async function caricaChunks() {
  const { data, error } = await db
    .schema("preventivatore")
    .from("chunks")
    .select("id, chunk_index, contenuto, documenti:documento_id(codice, tipo_cartella)")
    .is("embedding", null)
    .order("created_at", { ascending: true })
    .limit(limite);
  if (error) throw new Error(`Query chunks fallita: ${error.message}`);
  return (data ?? []).filter((chunk) =>
    (!tipoCartella || chunk.documenti?.tipo_cartella === tipoCartella) &&
    (!soloDocumento || chunk.documenti?.codice === soloDocumento)
  );
}

async function caricaSchede() {
  if (!includiSchede) return [];
  const { data, error } = await db
    .schema("preventivatore")
    .from("schede_approvate")
    .select("id, contenuto_md")
    .is("embedding", null)
    .order("created_at", { ascending: true })
    .limit(limite);
  if (error) throw new Error(`Query schede fallita: ${error.message}`);
  return data ?? [];
}

async function aggiorna(tabella, id, risultato) {
  const { error } = await db
    .schema("preventivatore")
    .from(tabella)
    .update({
      embedding: risultato.vettore,
      embedding_modello: risultato.modello,
      embedded_at: new Date().toISOString(),
    })
    .eq("id", id)
    .is("embedding", null);
  if (error) throw new Error(error.message);
}

(async () => {
  let modello;
  try {
    modello = await leggiModello();
  } catch (errore) {
    erroreConfigurazione(errore instanceof Error ? errore.message : String(errore));
  }
  const embed = await creaEmbedder(modello);
  const [chunks, schede] = await Promise.all([caricaChunks(), caricaSchede()]);
  if (chunks.length === 0 && schede.length === 0) return;

  if (dryRun) {
    console.log(`Da elaborare: ${chunks.length} chunk, ${schede.length} schede`);
    return;
  }

  let completati = 0;
  let errori = 0;
  const elementi = [
    ...chunks.map((chunk) => ({ tabella: "chunks", id: chunk.id, testo: chunk.contenuto, max: 30000 })),
    ...schede.map((scheda) => ({ tabella: "schede_approvate", id: scheda.id, testo: scheda.contenuto_md, max: 8000 })),
  ];

  for (const elemento of elementi) {
    const testo = String(elemento.testo ?? "").trim().slice(0, elemento.max);
    if (!testo) {
      errori += 1;
      continue;
    }
    try {
      const risultato = await embed(testo);
      await aggiorna(elemento.tabella, elemento.id, risultato);
      completati += 1;
    } catch (errore) {
      errori += 1;
      console.error(`Errore ${elemento.tabella}/${elemento.id}: ${errore instanceof Error ? errore.message : errore}`);
    }
    if (completati % 5 === 0) await sleep(300);
  }

  console.log(`Embedding aggiornati: ${completati}; errori: ${errori}`);
})().catch((errore) => {
  // Gli errori transitori di rete/DB non rendono il timer systemd permanentemente fallito.
  console.error(errore instanceof Error ? errore.message : errore);
});
