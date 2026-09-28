/**
 * Ricalcola i controlli delle fatture già in archivio.
 *
 * Serve dopo ogni correzione a quello da cui il controllo dipende — un listino
 * anticipato, una percentuale carburante trovata dopo, una regola nuova — che
 * altrimenti varrebbe solo per le fatture caricate da quel momento. Usa la
 * stessa funzione dell'acquisizione (`calcolaControlloRiga`): nessun conto
 * diverso. Aggancio alle bolle, righe di fattura e anomalie già decise non si
 * toccano (vedi `ricalcolo.ts`).
 *
 * Eseguire dalla radice del progetto, sulla macchina che ha le credenziali del
 * database da scrivere (in produzione: la VM, con il suo `.env.local`):
 *
 *   npx vitest run --config scripts/vettori/vitest-ricalcola.config.ts
 *
 * Senza altro stampa cosa cambierebbe. Per scrivere: VETTORI_RICALCOLA=1.
 * Per limitarsi a un vettore: VETTORI_RICALCOLA_VETTORE=gls
 */
import { it, expect } from "vitest";
import { createAdminClient } from "../../src/lib/supabase/admin";
import { ricalcolaFattura, type EsitoRicalcolo } from "../../src/lib/portali/vettori/ricalcolo";

process.loadEnvFile(".env.local");

const SCRIVI = process.env.VETTORI_RICALCOLA === "1";
const SOLO_VETTORE = process.env.VETTORI_RICALCOLA_VETTORE;

it("ricalcola i controlli in archivio", async () => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("vettori")
    .from("fatture")
    .select("id, numero, data_fattura, vettori!inner(codice)")
    .order("data_fattura");
  expect(error).toBeNull();
  const fatture = ((data ?? []) as unknown as Array<{ id: string; numero: string; vettori: { codice: string } }>)
    .filter((f) => !SOLO_VETTORE || f.vettori.codice === SOLO_VETTORE);

  const esiti: EsitoRicalcolo[] = [];
  for (const f of fatture) esiti.push(await ricalcolaFattura(f.id, { scrivi: SCRIVI }));

  const somma = (k: "prima" | "dopo") => {
    const out: Record<string, number> = {};
    for (const e of esiti) for (const [esito, n] of Object.entries(e[k])) out[esito] = (out[esito] ?? 0) + n;
    return out;
  };
  const perVettore = new Map<string, { fatturato: number; attesoPrima: number; attesoDopo: number; prima: Record<string, number>; dopo: Record<string, number> }>();
  for (const e of esiti) {
    const v = perVettore.get(e.vettore) ?? { fatturato: 0, attesoPrima: 0, attesoDopo: 0, prima: {}, dopo: {} };
    v.fatturato += e.fatturato; v.attesoPrima += e.attesoPrima; v.attesoDopo += e.attesoDopo;
    for (const [k, n] of Object.entries(e.prima)) v.prima[k] = (v.prima[k] ?? 0) + n;
    for (const [k, n] of Object.entries(e.dopo)) v.dopo[k] = (v.dopo[k] ?? 0) + n;
    perVettore.set(e.vettore, v);
  }

  console.log(SCRIVI ? "\nSCRITTO in archivio.\n" : "\nANTEPRIMA: nulla è stato scritto (VETTORI_RICALCOLA=1 per scrivere).\n");
  console.log(`Fatture: ${esiti.length}, righe: ${esiti.reduce((t, e) => t + e.righe, 0)}`);
  console.log("Esiti prima:", somma("prima"));
  console.log("Esiti dopo: ", somma("dopo"));
  for (const [v, t] of perVettore) {
    console.log(`\n${v}: fatturato ${t.fatturato.toFixed(2)} | atteso prima ${t.attesoPrima.toFixed(2)} → dopo ${t.attesoDopo.toFixed(2)}`);
    console.log("  prima", t.prima, "\n  dopo ", t.dopo);
  }
  if (SCRIVI) console.log(`\nAnomalie aperte rigenerate: ${esiti.reduce((t, e) => t + e.anomalieRimosse, 0)} tolte, ${esiti.reduce((t, e) => t + e.anomalieCreate, 0)} create.`);
  const cambiate = esiti.flatMap((e) => e.cambiate.map((c) => ({ fattura: `${e.vettore} ${e.numero}`, ...c })));
  console.log(`\nRighe con esito o atteso cambiato: ${cambiate.length}`);
  for (const c of cambiate.slice(0, 40)) {
    console.log(`  ${c.fattura} r${c.riga}: ${c.prima} → ${c.dopo}, atteso ${c.attesoPrima.toFixed(2)} → ${c.attesoDopo.toFixed(2)} (fatturato ${c.fatturato?.toFixed(2) ?? "-"})`);
  }
  expect(esiti.length).toBeGreaterThan(0);
});
