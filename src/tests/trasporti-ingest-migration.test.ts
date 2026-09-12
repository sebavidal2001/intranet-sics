import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLONNE_TRASPORTI } from "../../scripts/lib/trasporti-parser.mjs";

const sql = readFileSync(
  "supabase/migrations/099_trasporti_ingest_atomico.sql",
  "utf8",
);

describe("migration 099: ingest atomico Trasporti", () => {
  it("replica nello staging le 68 colonne nello stesso ordine", () => {
    const definizione = sql.match(
      /create unlogged table if not exists bi\.trasporti_documenti_staging \([\s\S]*?primary key \(run_id, riga_num\)/i,
    )?.[0];
    expect(definizione).toBeDefined();

    const nomi = [...(definizione ?? "").matchAll(
      /^\s{2}([a-z][a-z0-9_]*)\s+(?:text|integer|date|timestamp|numeric)/gm,
    )]
      .map((match) => match[1])
      .filter((nome) => !["run_id", "riga_num"].includes(nome));
    expect(nomi).toEqual(COLONNE_TRASPORTI);
  });

  it("mantiene i timestamp gestionali senza fuso", () => {
    expect(sql).toMatch(/data_creazione\s+timestamp,/i);
    expect(sql).toMatch(/data_modifica\s+timestamp,/i);
    expect(sql).not.toMatch(/data_(?:creazione|modifica)\s+timestamptz/i);
  });

  it("usa upsert su id_documento e non cancella mai dalla destinazione", () => {
    expect(sql).toMatch(/insert into bi\.trasporti_documenti \([\s\S]*on conflict \(id_documento\) do update set/i);
    expect(sql).not.toMatch(/delete\s+from\s+bi\.trasporti_documenti(?:\s|;)/i);
  });

  it("isola la marcatura delle assenze nel solo ramo riconciliazione", () => {
    const inizioRamo = sql.indexOf("if p_profilo = 'riconciliazione' then", sql.indexOf("on conflict"));
    const fineRamo = sql.indexOf("end if;", inizioRamo);
    expect(inizioRamo).toBeGreaterThan(0);
    expect(fineRamo).toBeGreaterThan(inizioRamo);

    const primaDelRamo = sql.slice(sql.indexOf("insert into bi.trasporti_documenti ("), inizioRamo);
    const ramo = sql.slice(inizioRamo, fineRamo);
    expect(primaDelRamo).not.toMatch(/assente_dal_gestionale\s*=/i);
    expect(ramo).toMatch(/assente_dal_gestionale\s*=\s*false/i);
    expect(ramo).toMatch(/assente_dal_gestionale\s*=\s*true/i);
    expect(ramo).toMatch(/data_registrazione\s*>=\s*v_finestra_dal/i);
    expect(ramo).toMatch(/data_modifica::date\s*>=\s*v_finestra_dal/i);
  });

  it("serializza gli ingest con una chiave dedicata", () => {
    expect(sql).toContain("pg_advisory_xact_lock(9900990001)");
    expect(sql).not.toMatch(/perform\s+pg_advisory_xact_lock\(hashtext\('bi\.ingest_cruscotto'\)\)/i);
  });

  it("espone le cinque RPC ai soli service_role e ricarica PostgREST", () => {
    const rpc = ["run_start", "staging_load", "valida", "ingest", "run_fail"];
    for (const nome of rpc) {
      expect(sql).toMatch(new RegExp(
        `revoke all on function public\\.bi_trasporti_${nome}\\([\\s\\S]*?from public, anon, authenticated;`,
        "i",
      ));
      expect(sql).toMatch(new RegExp(
        `grant execute on function public\\.bi_trasporti_${nome}\\([\\s\\S]*?to service_role;`,
        "i",
      ));
    }
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
  });
});
