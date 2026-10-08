import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/144_vettori_documento_una_sola_spedizione.sql", "utf8");

describe("migration 144: un documento, una sola spedizione", () => {
  it("si ferma se esistono gia' doppi collegamenti, invece di scegliere a caso", () => {
    expect(sql).toMatch(/HAVING count\(\*\) > 1/i);
    expect(sql).toMatch(/RAISE EXCEPTION '% documenti sono legati/i);
  });

  it("crea l'indice unico sull'id del documento", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS spedizioni_documenti_id_documento_uq\s+ON vettori\.spedizioni_documenti \(id_documento\)/i);
  });

  it("l'acquisizione che perde la corsa usa la spedizione vincente e non fallisce", () => {
    const funzione = sql.match(/CREATE OR REPLACE FUNCTION vettori\.acquisisci_fattura\b[\s\S]*?\$\$;/i)?.[0] ?? "";
    expect(funzione).toMatch(/EXCEPTION WHEN unique_violation THEN/i);
    // il conflitto ammesso e' solo quello della chiave primaria (stesso documento ripetuto nel payload)
    expect(funzione).toMatch(/ON CONFLICT \(spedizione_id, id_documento\) DO NOTHING/i);
    expect(funzione).not.toMatch(/ON CONFLICT DO NOTHING/i);
    // se non e' la corsa sui documenti l'errore non si nasconde
    expect(funzione).toMatch(/IF v_spedizione_id IS NULL THEN\s+RAISE;/i);
  });

  it("mantiene i privilegi: solo service_role", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION vettori\.acquisisci_fattura\(jsonb\) FROM PUBLIC, anon, authenticated;/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION vettori\.acquisisci_fattura\(jsonb\) TO service_role;/i);
  });
});
