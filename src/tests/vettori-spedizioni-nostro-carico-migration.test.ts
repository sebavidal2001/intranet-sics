import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/125_vettori_spedizioni_solo_a_nostro_carico.sql",
  "utf8"
);

describe("migration 125: spedizioni solo a nostro carico", () => {
  it("cambia la firma eliminando la vecchia, cosi' PostgREST non trova due funzioni", () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS vettori\.elenco_spedizioni\(/i);
    expect(sql).toMatch(/p_per_pagina integer DEFAULT 100, p_tutte boolean DEFAULT false\)/i);
  });

  it("nasconde solo le spedizioni senza fattura con porto non a nostro carico, come la pagina Bolle", () => {
    expect(sql).toMatch(/righe_base AS \(\s*SELECT \* FROM righe_fattura\s+UNION ALL\s+SELECT \* FROM spedizioni_non_fatturate\s*\)/i);
    expect(sql).toMatch(
      /WHERE p_tutte\s+OR r\.stato_fatturazione <> 'non_fatturata'\s+OR r\.a_nostro_carico IS NOT FALSE\s+OR coalesce\(r\.origine, ''\) IN \('manuale', 'simulazione'\)/i
    );
  });

  it("dice quante ne nasconde e non ne nasconde nessuna con «mostra tutte»", () => {
    expect(sql).toMatch(/'non_a_nostro_carico', CASE WHEN p_tutte THEN 0 ELSE \(/i);
  });

  it("tiene la funzione privata: solo service_role, con la nuova firma", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION vettori\.elenco_spedizioni\([^)]*, boolean\)\s+FROM public, anon, authenticated;/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION vettori\.elenco_spedizioni\([^)]*, boolean\)\s+TO service_role;/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
