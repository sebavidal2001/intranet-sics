#!/usr/bin/env node
/**
 * Carica i CAP della migration 101 su un database Supabase gestito.
 *
 * Serve perche' la 101 pesa 284 KB e su Supabase si applica dal pannello o via
 * MCP, dove un file di quella dimensione non passa. In produzione (PostgreSQL
 * sulla VM) la migration si applica intera con psql e questo script non serve.
 *
 * La sorgente e' la migration stessa, non una copia dei dati: due elenchi che
 * possono divergere sono peggio di un parser. Se il formato generato cambia, il
 * conteggio atteso non torna e lo script si ferma invece di caricare meta' Italia.
 *
 *   node scripts/vettori/carica-cap.mjs            # carica
 *   node scripts/vettori/carica-cap.mjs --verifica # solo lettura, non scrive
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const QUI = dirname(fileURLToPath(import.meta.url));
const RADICE = resolve(QUI, "..", "..");
const MIGRATION = resolve(
  RADICE,
  "supabase/migrations/101_vettori_cap_riaddebito_simulazioni.sql"
);

/** Quanto deve uscire dal parser. Un numero diverso significa formato cambiato. */
const ATTESI = { cap: 4678, prefissi: 205 };
const LOTTO = 500;

function leggiEnv() {
  // Il file .env.local resta illeggibile a chiunque non sia questo processo:
  // le chiavi non passano dalla riga di comando ne' finiscono nei log.
  const testo = readFileSync(resolve(RADICE, ".env.local"), "utf8");
  const env = {};
  for (const riga of testo.split(/\r?\n/)) {
    const m = riga.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Mancano NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }
  return { url: url.replace(/\/$/, ""), key };
}

/** `ARRAY['MI','CO']` -> ["MI","CO"]. Le stringhe SQL raddoppiano l'apice. */
function leggiArray(sql) {
  const dentro = sql.match(/^ARRAY\[(.*)\]$/s);
  if (!dentro) throw new Error(`Array non riconosciuto: ${sql}`);
  const corpo = dentro[1];
  if (corpo.trim() === "") return [];
  const valori = [];
  const re = /'((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(corpo)) !== null) valori.push(m[1].replace(/''/g, "'"));
  return valori;
}

function estrai(sql, marcatore, aritmetica) {
  const inizio = sql.indexOf(marcatore);
  if (inizio < 0) throw new Error(`Blocco non trovato: ${marcatore}`);
  const dopo = sql.slice(inizio + marcatore.length);
  // La lista finisce alla prima parentesi chiusa seguita da `;`. Cercare il
  // punto e virgola a inizio riga non basta: l'ultima riga di valori e il
  // terminatore stanno appiccicati, e il blocco si mangerebbe quello dopo.
  const fine = dopo.search(/\)\s*;/);
  if (fine < 0) throw new Error(`Blocco senza terminatore: ${marcatore}`);
  const blocco = dopo.slice(0, fine + 1);
  return blocco
    .split(/\),\r?\n\(/)
    .map((pezzo, i, tutti) => {
      let t = pezzo.trim();
      if (i === 0) t = t.replace(/^\(/, "");
      if (i === tutti.length - 1) t = t.replace(/\)$/, "");
      return aritmetica(t);
    });
}

function leggiMigration() {
  // Il file nasce concatenando pezzi scritti su Windows e su Linux: i fine riga
  // sono misti. psql non se ne accorge, un parser che cerca "\n" si.
  const sql = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n");

  const cap = estrai(sql, "INSERT INTO vettori.cap_province (cap, province, comuni) VALUES\n", (t) => {
    const m = t.match(/^'(\d{5})',(ARRAY\[.*?\])::char\(2\)\[\],(ARRAY\[.*\])$/s);
    if (!m) throw new Error(`Riga CAP non riconosciuta: ${t.slice(0, 120)}`);
    return { cap: m[1], province: leggiArray(m[2]), comuni: leggiArray(m[3]) };
  });

  const prefissi = estrai(sql, "INSERT INTO vettori.cap_prefissi (prefisso, province) VALUES\n", (t) => {
    const m = t.match(/^'(\d{3})',(ARRAY\[.*\])::char\(2\)\[\]$/s);
    if (!m) throw new Error(`Riga prefisso non riconosciuta: ${t.slice(0, 120)}`);
    return { prefisso: m[1], province: leggiArray(m[2]) };
  });

  if (cap.length !== ATTESI.cap || prefissi.length !== ATTESI.prefissi) {
    throw new Error(
      `Il parser ha estratto ${cap.length} CAP e ${prefissi.length} prefissi, ` +
        `attesi ${ATTESI.cap} e ${ATTESI.prefissi}. Il formato della migration e cambiato: ` +
        `aggiornare ATTESI dopo aver controllato cosa e successo.`
    );
  }
  return { cap, prefissi };
}

async function inserisci({ url, key }, tabella, righe, chiave) {
  for (let i = 0; i < righe.length; i += LOTTO) {
    const lotto = righe.slice(i, i + LOTTO);
    const risposta = await fetch(`${url}/rest/v1/${tabella}?on_conflict=${chiave}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Content-Profile": "vettori",
        // I CAP gia presenti (San Marino, quelli visti dal gestionale) non
        // vanno sovrascritti dall'elenco ANCI: sono aggiunte deliberate.
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(lotto),
    });
    if (!risposta.ok) {
      throw new Error(
        `${tabella}: HTTP ${risposta.status} sul lotto ${i}-${i + lotto.length}: ${await risposta.text()}`
      );
    }
    process.stdout.write(`  ${tabella}: ${Math.min(i + LOTTO, righe.length)}/${righe.length}\r`);
  }
  process.stdout.write("\n");
}

async function conta({ url, key }, tabella) {
  const risposta = await fetch(`${url}/rest/v1/${tabella}?select=*`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Accept-Profile": "vettori",
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  if (!risposta.ok) throw new Error(`${tabella}: HTTP ${risposta.status}`);
  return Number(risposta.headers.get("content-range")?.split("/")[1] ?? -1);
}

async function main() {
  const soloVerifica = process.argv.includes("--verifica");
  const { cap, prefissi } = leggiMigration();
  console.log(`Letti dalla migration: ${cap.length} CAP, ${prefissi.length} prefissi.`);

  const ambigui = cap.filter((c) => c.province.length > 1);
  console.log(`CAP a cavallo di due province: ${ambigui.map((c) => c.cap).join(", ")}`);

  const conn = leggiEnv();
  console.log(`Destinazione: ${conn.url}`);
  console.log(`Prima:  cap_province=${await conta(conn, "cap_province")} cap_prefissi=${await conta(conn, "cap_prefissi")}`);

  if (soloVerifica) {
    console.log("--verifica: non scrivo nulla.");
    return;
  }

  await inserisci(conn, "cap_province", cap, "cap");
  await inserisci(conn, "cap_prefissi", prefissi, "prefisso");

  const dopoCap = await conta(conn, "cap_province");
  const dopoPref = await conta(conn, "cap_prefissi");
  console.log(`Dopo:   cap_province=${dopoCap} cap_prefissi=${dopoPref}`);

  // Dieci righe in piu' dei CAP ANCI: San Marino, che nell'elenco non c'e' ed
  // e' inserito dalla parte schema. Il Vaticano invece c'e' gia, come Roma.
  // Se il conto non torna, qualcosa non e' stato scritto.
  const attesoCap = ATTESI.cap + 10;
  if (dopoCap < attesoCap || dopoPref !== ATTESI.prefissi) {
    throw new Error(
      `Conteggio finale inatteso: cap_province=${dopoCap} (atteso almeno ${attesoCap}), cap_prefissi=${dopoPref} (atteso ${ATTESI.prefissi}).`
    );
  }
  console.log("Caricamento completato.");
}

main().catch((e) => {
  console.error(`\nERRORE: ${e.message}`);
  process.exit(1);
});
