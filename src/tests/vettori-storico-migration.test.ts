import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  "supabase/migrations/098_vettori_storico_include_spedizioni.sql",
  "utf8"
);

describe("migration 098: storico spedizioni unificato", () => {
  it("unisce le righe fattura alle spedizioni senza alcun controllo", () => {
    expect(sql).toMatch(/righe_fattura\s+AS[\s\S]*spedizioni_non_fatturate\s+AS/i);
    expect(sql).toMatch(/SELECT \* FROM righe_fattura\s+UNION ALL\s+SELECT \* FROM spedizioni_non_fatturate/i);
    expect(sql).toMatch(/WHERE NOT EXISTS\s*\([\s\S]*c\.spedizione_id\s*=\s*s\.id[\s\S]*\)/i);
  });

  it("espone origine e lo stato non_fatturata lasciando vuoti i dati economici", () => {
    expect(sql).toMatch(/'non_fatturata'::text\s+AS stato_fatturazione/i);
    expect(sql).toMatch(/s\.origine/i);
    for (const campo of ["fatturato", "atteso", "scostamento"]) {
      expect(sql).toMatch(new RegExp(`NULL::numeric\\s+AS ${campo}`, "i"));
    }
    expect(sql).toMatch(/NULL::text\s+AS stato_fattura/i);
    expect(sql).toMatch(/NULL::text\s+AS esito/i);
  });

  it("conta le spedizioni ma somma gli importi soltanto sulle fatture valide", () => {
    expect(sql).toMatch(/count\(\*\)\s+AS righe/i);
    expect(sql).toMatch(/count\(\*\) FILTER \(WHERE stato_fatturazione = 'non_fatturata'\)\s+AS spedizioni_non_fatturate/i);
    expect(sql).toMatch(/sum\(fatturato\) FILTER \(\s*WHERE stato_fatturazione = 'fatturata'\s*\)/i);
    expect(sql).toMatch(/sum\(atteso\) FILTER \(\s*WHERE stato_fatturazione = 'fatturata'\s*\)/i);
    expect(sql).toMatch(/sum\(colli\) FILTER \(\s*WHERE stato_fatturazione <> 'bozza'\s*\)/i);
  });

  it("applica il periodo alla data spedizione nel ramo senza fattura e lo propone nei filtri", () => {
    expect(sql).toMatch(/coalesce\(\s*r\.anno,\s*extract\(year FROM r\.data_spedizione\)::int\s*\) = p_anno/i);
    expect(sql).toMatch(/coalesce\(\s*r\.mese,\s*extract\(month FROM r\.data_spedizione\)::int\s*\) = p_mese/i);
    expect(sql).toMatch(/WITH periodi AS \([\s\S]*extract\(year FROM s\.data_documento\)::int[\s\S]*WHERE NOT EXISTS/i);
  });

  it("mantiene la funzione privata e ricarica lo schema PostgREST", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION vettori\.elenco_spedizioni[\s\S]*FROM public, anon, authenticated;/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION vettori\.elenco_spedizioni[\s\S]*TO service_role;/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
