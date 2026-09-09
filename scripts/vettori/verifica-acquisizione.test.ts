// Collaudo esplicito, in sola lettura: npx vitest run --include ... non necessario;
// eseguito con la configurazione dedicata scripts/vettori/vitest.config.ts.
import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { leggiFattura, quadra } from "../../src/lib/portali/vettori/fatture";
import { preparaAcquisizione } from "../../src/lib/portali/vettori/acquisizione";
process.loadEnvFile(".env.local");
it("anteprima reale senza salvare fatture", async () => {
  const nomi = process.env.VETTORI_SOLO_TRADING ? ["tp1260-002218-07-26.txt", "tp1260-002498-08-26.txt"] : ["ft-gls-07-26.txt", "ft-gls-08-26.txt", "ft-tnt-07-26.txt", "tp1260-002218-07-26.txt", "tp1260-002498-08-26.txt"];
  for (const nome of nomi) {
    const fattura = leggiFattura(readFileSync(`src/tests/fixtures/fatture/${nome}`, "utf8"));
    const { riepilogo, payload } = await preparaAcquisizione({ fattura, quadraturaOk: quadra(fattura).ok, quadraturaNote: null, nomeFile: nome, hashFile: null, utenteId: null });
    console.log(nome, riepilogo, "motivi", [...new Set(payload.righe.filter((r) => r.controllo?.esito === "non_valutabile").flatMap((r) => r.controllo?.avvertenze ?? []))]);
    expect(riepilogo.totaleAtteso).toBeGreaterThan(0);
    // TNT luglio include due spedizioni di giugno, prima del primo fuel registrato.
    // Trading luglio include Rovigo, fuori dalla copertura configurata: serve una tariffa concordata.
    expect(riepilogo.nonValutabili).toBe(nome === "ft-tnt-07-26.txt" ? 2 : nome === "tp1260-002218-07-26.txt" ? 1 : 0);
  }
}, 120000);
