/**
 * bi-cruscotto-stato.mjs — Stato e manutenzione della pipeline BI.
 *
 * Copre ENTRAMBI i flussi: i sette dataset commerciali e il Cruscotto articoli.
 * Il nome resta quello originale perché è il percorso richiamato dal runner
 * systemd sul server.
 *
 * Perché guarda anche il commerciale: il 4 agosto 2026 l'estrazione commerciale
 * non è partita e nessuno se n'è accorto. Power BI non segnala niente quando i
 * dati ci sono ma sono vecchi — mostra numeri plausibili e basta. Il problema è
 * emerso per caso, confrontando il report con un giro manuale di riserva.
 * Un dato fermo che sembra fresco è peggio di un errore visibile.
 *
 * Uso:
 *   node scripts/bi-cruscotto-stato.mjs                 semaforo dei due flussi
 *   node scripts/bi-cruscotto-stato.mjs --json          stato in JSON, per script
 *   node scripts/bi-cruscotto-stato.mjs --retention     esegue anche la pulizia
 *   node scripts/bi-cruscotto-stato.mjs --max-ore=48    soglia di freschezza
 *
 * Exit code: 0 se entrambi i flussi sono "ok", 1 in ogni altro caso. Così può
 * essere usato da un controllo automatico senza interpretare l'output.
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

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

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error("Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const db = createClient(URL, KEY, { auth: { persistSession: false } });
const JSON_OUT = !!arg("json");
const MAX_ORE = Number(arg("max-ore", 30));

const SIMBOLO = { ok: "OK", attenzione: "ATTENZIONE", critico: "CRITICO" };

(async () => {
  const { data: tutto, error } = await db.rpc("bi_pipeline_health", {
    p_max_ore_commerciale: MAX_ORE,
    p_max_ore_cruscotto: MAX_ORE,
  });
  if (error) throw new Error(`health: ${error.message}`);

  const comm = tutto.commerciale;
  const health = tutto.cruscotto;

  let retention = null;
  if (arg("retention")) {
    const { data, error: e } = await db.rpc("bi_cruscotto_retention", {
      p_giorni_falliti: Number(arg("giorni-falliti", 90)),
      p_giorni_staging: Number(arg("giorni-staging", 7)),
    });
    if (e) throw new Error(`retention: ${e.message}`);
    retention = data;
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ ...tutto, retention }, null, 2));
  } else {
    console.log(`Pipeline BI — ${SIMBOLO[tutto.stato] ?? tutto.stato}`);
    for (const motivo of tutto.motivi ?? []) console.log(`  · ${motivo}`);

    console.log(`\n── Commerciale (7 dataset) — ${SIMBOLO[comm.stato] ?? comm.stato}`);
    console.log(`  run corrente    : ${comm.run_corrente ?? "nessuno"}`);
    console.log(`  pubblicato il   : ${comm.pubblicato_il ?? "-"}`);
    console.log(`  ore dall'ultimo : ${comm.ore_dall_aggiornamento ?? "-"}`);

    console.log(`\n── Cruscotto articoli — ${SIMBOLO[health.stato] ?? health.stato}`);
    console.log(`  run corrente    : ${health.run_corrente ?? "nessuno"}`);
    console.log(`  pubblicato il   : ${health.pubblicato_il ?? "-"}`);
    console.log(`  ore dall'ultimo : ${health.ore_dall_aggiornamento ?? "-"}`);
    console.log(`  righe / articoli: ${health.righe ?? "-"} / ${health.articoli ?? "-"}`);
    console.log(`  falliti in 48h  : ${health.run_falliti_48h}`);
    if (health.ultimo_errore) console.log(`  ultimo errore   : ${health.ultimo_errore}`);
    console.log(`\n  storico   costi: ${health.storico.costi_totali} (${health.storico.costi_aperti} aperti)`);
    console.log(`         giacenze: ${health.storico.giacenze_totali} (${health.storico.giacenze_aperte} aperte)`);
    console.log(`  produzione     : ${health.produzione.prodotti_attivi} articoli attivi, ${health.produzione.giacenze} giacenze`);

    if (retention) {
      console.log(`\n  Retention: ${retention.run_eliminati} run e ${retention.staging_eliminate} righe di staging rimossi.`);
    }
  }

  // exitCode invece di exit(): lasciando chiudere il processo da solo si evita
  // l'assertion di libuv su Windows quando restano handle aperti.
  process.exitCode = tutto.stato === "ok" ? 0 : 1;
})().catch((e) => {
  console.error(`ERRORE: ${e.message ?? e}`);
  process.exitCode = 1;
});
