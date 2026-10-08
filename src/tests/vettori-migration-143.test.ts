import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/143_vettori_revisione_ottobre.sql", "utf8");

describe("migration 143: revisione vettori", () => {
  it("esclude le spedizioni ignorate da entrambi i rami dello storico", () => {
    const funzione = sql.match(/CREATE OR REPLACE FUNCTION vettori\.elenco_spedizioni\b[\s\S]*?\$function\$;/i)?.[0];
    expect(funzione).toBeDefined();
    const fatturate = funzione?.match(/righe_fattura AS \([\s\S]*?\),\s*spedizioni_non_fatturate AS/i)?.[0];
    const nonFatturate = funzione?.match(/spedizioni_non_fatturate AS \([\s\S]*?\),\s*righe_base AS/i)?.[0];
    expect(fatturate).toMatch(/WHERE s\.id IS NULL OR s\.stato <> 'ignorata'/i);
    expect(nonFatturate).toMatch(/AND s\.stato <> 'ignorata'/i);
    expect(funzione).toMatch(/SELECT \* FROM righe_fattura\s+UNION ALL\s+SELECT \* FROM spedizioni_non_fatturate/i);
  });

  it("revoca get_vettori_context ad authenticated", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.get_vettori_context\(uuid\) FROM PUBLIC, anon, authenticated;/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_vettori_context\(uuid\) TO service_role;/i);
  });

  it("blocca la spedizione prima di sganciare e contare gli altri controlli", () => {
    const funzione = sql.match(/CREATE OR REPLACE FUNCTION vettori\.sgancia_aggancio\b[\s\S]*?\$\$;/i)?.[0];
    expect(funzione).toMatch(/SELECT \* INTO v_spedizione FROM vettori\.spedizioni\s+WHERE id = v_controllo\.spedizione_id FOR UPDATE;[\s\S]*?UPDATE vettori\.controlli[\s\S]*?SELECT count\(\*\) INTO v_altre/i);
  });
});
