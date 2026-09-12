/**
 * Carica lo storico spedizioni ricostruito dai fogli Excel dell'amministrazione
 * nel database di **sviluppo** (Supabase), leggendo le credenziali dall'ambiente.
 *
 * La produzione è stata caricata direttamente con psql sulla VM: questo script
 * serve ad allineare lo sviluppo senza far passare 724 righe di dati aziendali
 * attraverso una conversazione.
 *
 * Il CSV atteso è quello prodotto da `scripts/vettori/estrai-storico-excel.py`,
 * separato da tabulazioni, senza intestazione, con le colonne:
 *   direzione, vettore_codice, numero_riferimento, numero_riferimento_norm,
 *   data_documento, controparte_nome, colli_bolla, peso_bolla, note
 *
 * Uso:
 *   node scripts/vettori/carica-storico-excel.mjs <file.tsv>
 *   node scripts/vettori/carica-storico-excel.mjs <file.tsv> --annulla
 *
 * `--annulla` cancella soltanto le righe con `origine = 'excel_storico'`: le
 * spedizioni arrivate dalla pipeline o inserite a mano non vengono toccate.
 */
import nextEnv from "@next/env";
import { readFileSync } from "node:fs";

nextEnv.loadEnvConfig(process.cwd());

const progetto = process.env.SUPABASE_PROJECT_ID;
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!progetto || !token) {
  console.error("Mancano SUPABASE_PROJECT_ID o SUPABASE_ACCESS_TOKEN nell'ambiente.");
  process.exit(1);
}

async function esegui(query, descrizione) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${progetto}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    console.error(`${descrizione}: ${res.status}`, await res.text());
    process.exit(1);
  }
  return res.json();
}

if (process.argv.includes("--annulla")) {
  await esegui(
    "DELETE FROM vettori.spedizioni WHERE origine = 'excel_storico';",
    "Cancellazione"
  );
  console.log("Righe con origine 'excel_storico' rimosse dallo sviluppo.");
  process.exit(0);
}

const percorso = process.argv[2];
if (!percorso) {
  console.error("Indicare il file TSV da caricare.");
  process.exit(1);
}

const cita = (v) => (v === "" || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const numero = (v) => (v === "" || v === undefined ? "NULL" : String(Number(v)));

const righe = readFileSync(percorso, "utf8")
  .split(/\r?\n/)
  .filter((r) => r.trim())
  .map((r) => r.split("\t"));

// A blocchi: una sola istruzione da 724 righe è scomoda da diagnosticare se
// fallisce, e l'API ha comunque un limite sulla dimensione del corpo.
const BLOCCO = 200;
let inserite = 0;

for (let i = 0; i < righe.length; i += BLOCCO) {
  const gruppo = righe.slice(i, i + BLOCCO);
  const valori = gruppo
    .map(([dir, vet, rif, norm, data, nome, colli, peso, note]) =>
      `(${cita(dir)}, ${cita(vet)}, ${cita(rif)}, ${cita(norm)}, ${cita(data)}::date, ` +
      `${cita(nome)}, ${numero(colli)}, ${numero(peso)}, ${cita(note)})`
    )
    .join(",\n");

  await esegui(
    `INSERT INTO vettori.spedizioni
       (direzione, vettore_id, numero_riferimento, numero_riferimento_norm,
        data_documento, controparte_nome, colli_bolla, peso_bolla, origine, stato, note)
     SELECT x.direzione, v.id, x.rif, x.norm, x.data, x.nome, x.colli, x.peso,
            'excel_storico', 'attesa', x.note
     FROM (VALUES\n${valori}\n) AS x(direzione, vettore_codice, rif, norm, data, nome, colli, peso, note)
     LEFT JOIN vettori.vettori v ON v.codice = x.vettore_codice
     ON CONFLICT DO NOTHING;`,
    `Blocco a partire dalla riga ${i + 1}`
  );
  inserite += gruppo.length;
  console.log(`  caricate ${inserite}/${righe.length}`);
}

const conteggio = await esegui(
  "SELECT count(*)::int AS righe FROM vettori.spedizioni WHERE origine = 'excel_storico';",
  "Verifica"
);
console.log("Storico caricato sullo sviluppo. Righe presenti:", conteggio);
