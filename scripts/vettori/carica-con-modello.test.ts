/**
 * Carica una fattura facendola leggere al modello, come fa il portale.
 *
 * Stessa strada della route: lettura, aggancio alle bolle, calcolo, e la
 * quadratura come gate. Serve per rileggere in blocco documenti gia' in
 * archivio quando il lettore migliora — passare dal browser una per una
 * funziona, ma su piu' fatture e' tempo buttato.
 */
import { it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { quadra } from "../../src/lib/portali/vettori/fatture";
import { leggiFatturaConModello } from "../../src/lib/portali/vettori/fatture/llm";
import {
  preparaAcquisizione, erroreEstremiMancanti, risolviEstremiFattura, salvaAcquisizione,
} from "../../src/lib/portali/vettori/acquisizione";

process.loadEnvFile(".env.local");
const DIR = process.env.VETTORI_FATTURE_DIR!;
const SOLO = process.env.VETTORI_FATTURE_SOLO;
const SCRIVI = process.env.VETTORI_CARICA === "1";

it("legge con il modello e acquisisce", async () => {
  const nomi = readdirSync(DIR)
    .filter((n) => /\.pdf$/i.test(n))
    .filter((n) => !SOLO || SOLO.split(",").some((p) => n.includes(p.trim())))
    .sort();
  console.log(`${nomi.length} file${SCRIVI ? "" : " — anteprima, non scrive"}`);

  for (const nome of nomi) {
    const bytes = new Uint8Array(readFileSync(join(DIR, nome)));
    const hash = createHash("sha256").update(bytes).digest("hex");
    const lettura = await leggiFatturaConModello(bytes);
    const f = lettura.fattura;
    if (!f) { console.log(`${nome}: NON LETTA — ${lettura.spiegazioni.join(" ")}`); continue; }

    const q = quadra(f);
    const costo = lettura.tentativi.reduce((a, t) => a + (t.costo ?? 0), 0);
    const modelli = lettura.tentativi.map((t) => `${t.modello}${t.quadra ? "" : " (non quadra)"}`).join(" → ");
    console.log(`\n${nome}: ${f.vettore} ${f.numero ?? "—"} del ${f.data ?? "—"}, ` +
      `${f.righe.length} righe, quadra=${q.ok ? "sì" : "NO"} — ${modelli}, ${costo.toFixed(5)} $`);

    for (const r of f.righe) {
      console.log(`    GREZZA ${r.numeroSpedizione}: data=${r.data} colli=${r.colli} ` +
        `peso=${r.peso} pesoVol=${r.pesoVolumetrico} pesoTassato=${r.pesoTassato} ` +
        `nolo=${r.nolo} carb=${r.carburante} tot=${r.totale}`);
    }
    const estremi = risolviEstremiFattura(f, {});
    const err = erroreEstremiMancanti(f.vettore, estremi);
    if (err) { console.log(`  SALTATA: ${err}`); continue; }
    if (!q.ok) { console.log(`  SALTATA: ${q.note.join(" ")}`); continue; }

    const { payload, riepilogo } = await preparaAcquisizione({
      fattura: f, quadraturaOk: true,
      quadraturaNote: [...q.note, ...f.avvertenze].join(" ") || null,
      nomeFile: nome, hashFile: hash, utenteId: null, metodoLettura: "modello",
    });
    console.log(`  fatturato ${riepilogo.totaleFatturato} / atteso ${riepilogo.totaleAtteso} — ` +
      `${riepilogo.inLinea} in linea, ${riepilogo.anomalie} anomalie, ` +
      `${riepilogo.nonValutabili} non valutabili, ${riepilogo.senzaCandidati} senza bolla`);
    for (const r of payload.righe) {
      console.log(`    ${r.numero_spedizione ?? "—"} ${r.data} peso=${r.peso} tassato=${r.peso_tassato} ` +
        `nolo=${r.nolo} carb=${r.carburante} tot=${r.totale} | atteso=${r.controllo?.atteso_totale ?? "—"} ` +
        `tassabile=${r.controllo?.peso_tassabile ?? "—"} esito=${r.controllo?.esito ?? "—"} ` +
        `abbin=${r.abbinamento} | ${(r.controllo?.avvertenze ?? []).slice(0, 2).join("; ")}`);
    }
    if (!SCRIVI) continue;
    try {
      await salvaAcquisizione(payload);
      console.log("  ACQUISITA");
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      console.log(`  NON ACQUISITA: ${/hash_file|uq_fatture/.test(m) ? "già in archivio" : m}`);
    }
  }
  expect(nomi.length).toBeGreaterThan(0);
}, 1_800_000);
