/**
 * Proposte di aggancio fattura -> bolla con un modello, per le righe di
 * fattura che non hanno una bolla (vedi `aggancio-ai.ts`).
 *
 * Scrive SOLO `vettori.agganci_proposti`: controlli, bolle e anomalie non
 * cambiano. Le righe che hanno gia' una proposta viva si saltano, quindi
 * rilanciarlo non ripaga niente.
 *
 *   npx vitest run --config scripts/vettori/vitest-aggancia.config.ts
 *
 * Variabili:
 *   VETTORI_AGGANCI_LIMITE=5      quante righe trattare (prova del costo)
 *   VETTORI_AGGANCI_TETTO_USD=1   si ferma oltre questa spesa
 *   VETTORI_AGGANCI_MODELLO=...   default openai/gpt-6-luna
 *   VETTORI_AGGANCI_CSV=/tmp/x.csv  dove scrivere il riepilogo leggibile
 */
import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { createAdminClient } from "../../src/lib/supabase/admin";
import {
  candidatePer,
  MODELLO_AGGANCIO_PREDEFINITO,
  proponiAggancio,
  righeConProposta,
  righeDaAgganciare,
  salvaProposta,
  type PropostaAggancio,
  type RigaDaAgganciare,
} from "../../src/lib/portali/vettori/aggancio-ai";

process.loadEnvFile(".env.local");

const LIMITE = Number(process.env.VETTORI_AGGANCI_LIMITE ?? "0") || Infinity;
const TETTO = Number(process.env.VETTORI_AGGANCI_TETTO_USD ?? "1");
const MODELLO = process.env.VETTORI_AGGANCI_MODELLO ?? MODELLO_AGGANCIO_PREDEFINITO;
const CSV = process.env.VETTORI_AGGANCI_CSV ?? "/tmp/agganci_proposti.csv";
const PARALLELE = 4;

it("propone gli agganci mancanti", async () => {
  const { data: vettori } = await createAdminClient().schema("vettori").from("vettori").select("id, codice");
  const codici = new Map(((vettori ?? []) as Array<{ id: string; codice: string }>).map((v) => [v.id, v.codice]));

  const gia = await righeConProposta();
  const tutte = await righeDaAgganciare();
  const daFare = tutte.filter((r) => !gia.has(r.rigaId)).slice(0, LIMITE);
  console.log(`Righe senza bolla: ${tutte.length}; con proposta gia' pagata: ${gia.size}; da proporre ora: ${daFare.length} (modello ${MODELLO}, tetto ${TETTO} $)`);

  let spesa = 0;
  let fermato = false;
  const fatte: Array<{ riga: RigaDaAgganciare; p: PropostaAggancio }> = [];
  const coda = [...daFare];
  async function lavoratore() {
    while (coda.length && !fermato) {
      const riga = coda.shift()!;
      const candidate = await candidatePer(riga, codici);
      const p = await proponiAggancio(riga, candidate, MODELLO);
      await salvaProposta(riga.rigaId, p);
      spesa += p.costo ?? 0;
      fatte.push({ riga, p });
      if (spesa > TETTO) fermato = true;
    }
  }
  await Promise.all(Array.from({ length: PARALLELE }, lavoratore));

  const conta = (f: (x: (typeof fatte)[number]) => boolean) => fatte.filter(f).length;
  console.log(`\nFatte: ${fatte.length}${fermato ? " (FERMATO: tetto di spesa)" : ""}. Spesa: ${spesa.toFixed(4)} $ (${fatte.length ? (spesa / fatte.length).toFixed(5) : 0} $/riga)`);
  console.log(`  scelta alta: ${conta((x) => x.p.esito === "scelta" && x.p.sicurezza === "alta")}`);
  console.log(`  scelta media: ${conta((x) => x.p.esito === "scelta" && x.p.sicurezza === "media")}`);
  console.log(`  scelta bassa: ${conta((x) => x.p.esito === "scelta" && x.p.sicurezza === "bassa")}`);
  console.log(`  nessuna: ${conta((x) => x.p.esito === "nessuna")}, senza candidate: ${conta((x) => x.p.esito === "senza_candidati")}, errori: ${conta((x) => x.p.esito === "errore")}`);

  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const righeCsv = fatte
    .sort((a, b) => a.riga.vettore.localeCompare(b.riga.vettore) || (a.riga.data ?? "").localeCompare(b.riga.data ?? ""))
    .map(({ riga, p }) => {
      const c = p.candidati.find((x) => x.spedizioneId === p.spedizioneId);
      return [riga.vettore, riga.fattura, riga.rigaNumero, riga.data, riga.direzione, riga.riferimento, riga.controparte, riga.peso,
        p.esito, p.sicurezza, c?.numero, c?.data, c?.controparte, c?.peso, p.candidati.length, p.motivo, p.costo].map(q).join(";");
    });
  writeFileSync(CSV, "﻿" + ["vettore;fattura;riga;data;verso;numero in fattura;nome in fattura;peso fattura;esito;sicurezza;bolla scelta;data bolla;cliente/fornitore bolla;peso bolla;candidate;motivo;costo $", ...righeCsv].join("\n"));
  console.log(`\nRiepilogo: ${CSV}`);
  for (const { riga, p } of fatte.slice(0, 12)) {
    console.log(`- ${riga.vettore} ${riga.fattura} r${riga.rigaNumero} ${riga.riferimento} «${riga.controparte}» -> ${p.esito}${p.sicurezza ? `/${p.sicurezza}` : ""}: ${p.motivo}`);
  }
  expect(fatte.length).toBeGreaterThanOrEqual(0);
});
