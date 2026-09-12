import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/100_vettori_bolle_manuali.sql",
  "utf8"
);

describe("migration 100: bolle manuali e congelamento", () => {
  it("sposta le misure sulla spedizione senza cancellare righe non migrabili", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS spedizione_id uuid/i);
    expect(sql).toMatch(/UPDATE vettori\.bolla_misure[\s\S]*vettori\.spedizioni_documenti/i);
    expect(sql).toMatch(/IF EXISTS \([\s\S]*spedizione_id IS NULL[\s\S]*RAISE EXCEPTION/i);
    expect(sql).toMatch(/FOREIGN KEY \(spedizione_id\)[\s\S]*REFERENCES vettori\.spedizioni\(id\)[\s\S]*ON DELETE RESTRICT/i);
  });

  it("rende obbligatorio il valore precedente dei campi forzati", () => {
    expect(sql).toMatch(/campi_forzati jsonb NOT NULL DEFAULT '\{\}'::jsonb/i);
    expect(sql).toMatch(/NOT \(dettaglio \? 'valore_precedente'\)/i);
    expect(sql).toMatch(/forzato_da[\s\S]*forzato_il/i);
  });

  it("materializza il congelamento, ne registra gli eventi e blocca testata e misure", () => {
    expect(sql).toMatch(/congelata boolean NOT NULL DEFAULT false/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS vettori\.spedizioni_congelamenti/i);
    expect(sql).toMatch(/trg_controlli_congela_spedizione/i);
    expect(sql).toMatch(/trg_spedizioni_blocca_congelate/i);
    expect(sql).toMatch(/trg_bolla_misure_blocca_congelate/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION vettori\.scongela_spedizione/i);
    expect(sql).toMatch(/p_motivo text[\s\S]*btrim\(p_motivo\)/i);
  });

  it("conserva lo scostamento del documento arrivato dopo la fattura", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS vettori\.spedizioni_scostamenti/i);
    expect(sql).toMatch(/gestionale_su_congelata/i);
    expect(sql).toMatch(/differenze\s+jsonb NOT NULL/i);
  });

  it("mantiene le nuove tabelle private e chiude con il reload PostgREST", () => {
    expect(sql).toMatch(/ALTER TABLE vettori\.spedizioni_congelamenti ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/ALTER TABLE vettori\.spedizioni_scostamenti ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA vettori TO service_role/i);
    expect(sql.trimEnd()).toMatch(/NOTIFY pgrst, 'reload schema';$/);
  });
});
