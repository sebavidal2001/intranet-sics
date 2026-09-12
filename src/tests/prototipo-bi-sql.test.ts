import { describe, expect, it } from "vitest";
import { validaSqlSolaLettura } from "@/lib/prototipo-bi/sql";

describe("prototipo BI — SQL di sola lettura", () => {
  it("accetta CTE, aggregazioni e funzioni finestra", () => {
    const sql = `WITH acquisti AS (
      SELECT "Fornitore", SUM("Qta Ord Fornitori" * "Ultimo Costo") AS valore
      FROM powerbi.bi_cruscotto_articoli_corrente
      WHERE "Costo Mancante" = false
      GROUP BY "Fornitore"
      HAVING SUM("Qta Ord Fornitori") > 0
    )
    SELECT "Fornitore", valore, DENSE_RANK() OVER (ORDER BY valore DESC) AS posizione
    FROM acquisti`;

    expect(validaSqlSolaLettura(sql)).toBe(sql);
  });

  it.each([
    "UPDATE public.bi_ordinato SET x = 1",
    "WITH eliminati AS (DELETE FROM public.bi_ordinato RETURNING *) SELECT * FROM eliminati",
    "SELECT * FROM auth.users",
    "SELECT pg_sleep(10)",
    "SELECT 1; SELECT 2",
    "SELECT * FROM public.bi_ordinato -- tutto",
  ])("rifiuta SQL fuori perimetro: %s", (sql) => {
    expect(() => validaSqlSolaLettura(sql)).toThrow();
  });

  it("tollera un solo punto e virgola finale", () => {
    expect(validaSqlSolaLettura("SELECT 1;")).toBe("SELECT 1");
  });

  it("rifiuta tabelle fuori allowlist e funzioni applicative", () => {
    expect(() => validaSqlSolaLettura("SELECT * FROM public.bi_documenti_raw")).toThrow(/Sorgente/);
    expect(() => validaSqlSolaLettura("SELECT public.funzione_pericolosa()"))
      .toThrow(/Funzione/);
  });

  it("accetta join, HAVING, CASE e funzioni temporali sicure", () => {
    const sql = `WITH vendite AS (
      SELECT "Codice Articolo", DATE_TRUNC('month', "Data Documento") AS mese,
             SUM("Importo") AS ricavo
      FROM public.bi_fatturato
      GROUP BY "Codice Articolo", DATE_TRUNC('month', "Data Documento")
      HAVING SUM("Importo") > 0
    )
    SELECT v.mese, CASE WHEN a."Costo Mancante" THEN 'da verificare' ELSE 'coperto' END AS stato,
           RANK() OVER (PARTITION BY v.mese ORDER BY v.ricavo DESC) AS posizione
    FROM vendite v
    JOIN powerbi.bi_cruscotto_articoli_corrente a
      ON a."Codice Articolo" = v."Codice Articolo"`;

    expect(validaSqlSolaLettura(sql)).toBe(sql);
  });

  it("rifiuta SELECT INTO", () => {
    expect(() => validaSqlSolaLettura("SELECT * INTO copia FROM public.bi_ordinato")).toThrow();
  });
});
