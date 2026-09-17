/**
 * Il guardiano SQL dell'analista.
 *
 * Misurato il 17/09/2026: il guardiano rifiutava SQL del tutto ordinario.
 * `validaFunzioni` riconosce una funzione come «identificatore seguito da una
 * parentesi», quindi `where ("Importo" > 0)` usciva con «Funzione SQL non
 * autorizzata: where». I controlli a parole leggevano anche dentro i testi,
 * quindi un cliente che si chiama 'COPY SRL' diventava un comando di scrittura.
 *
 * Il modello non poteva correggersi su messaggi del genere: bruciava passi a
 * riprovare e ripiegava su una metrica piu' debole. Da qui il «l'analista e'
 * limitato».
 *
 * La difesa vera resta altrove — i GRANT di `powerbi_reader` e la funzione
 * `bi_direzionale.query_sola_lettura` — quindi questi test verificano due cose
 * insieme: che l'SQL legittimo passi, e che quello di scrittura continui a non
 * passare.
 */
import { describe, expect, it } from "vitest";
import { ErroreSqlBi, validaSqlSolaLettura } from "@/lib/prototipo-bi/sql";

/** Restituisce l'errore, o null se la query e' stata accettata. */
function rifiuto(sql: string): ErroreSqlBi | null {
  try {
    validaSqlSolaLettura(sql);
    return null;
  } catch (e) {
    if (e instanceof ErroreSqlBi) return e;
    throw e;
  }
}

describe("SQL legittimo che prima veniva respinto", () => {
  const AMMESSE: [string, string][] = [
    [
      "condizione fra parentesi dopo WHERE",
      'select "Agente" from public.bi_fatturato where ("Importo" > 0 and "Agente" is not null)',
    ],
    [
      "condizione fra parentesi dopo AND",
      'select "Agente" from public.bi_fatturato where "Importo" > 0 and ("Agente" = \'X\' or "Agente" = \'Y\')',
    ],
    [
      "HAVING fra parentesi",
      'select "Agente", sum("Importo") from public.bi_fatturato group by "Agente" having (sum("Importo") > 1000)',
    ],
    [
      "mediana",
      'select percentile_cont(0.5) within group (order by "Importo") from public.bi_fatturato',
    ],
    ["deviazione standard", 'select stddev("Importo") from public.bi_fatturato'],
    ["string_agg", `select string_agg("Agente", ', ') from public.bi_fatturato`],
    [
      "famiglia dal codice articolo",
      `select split_part("Codice Articolo", '.', 1) fam, sum("Importo") from public.bi_fatturato group by 1`,
    ],
    ["left()", 'select left("Codice Articolo", 3) from public.bi_fatturato'],
    [
      "mese con date_part",
      `select date_part('month', "Data Documento") m, sum("Importo") from public.bi_fatturato group by 1`,
    ],
    [
      "nome cliente che contiene una parola chiave",
      `select "Nome Cliente" from public.bi_fatturato where "Nome Cliente" = 'COPY SRL'`,
    ],
    [
      "filtro LIKE che contiene DO",
      `select "Nome Cliente" from public.bi_fatturato where "Nome Cliente" like '%DO%'`,
    ],
    [
      "apice raddoppiato dentro il testo",
      `select "Nome Cliente" from public.bi_fatturato where "Nome Cliente" = 'L''ANCORA'`,
    ],
    [
      "CTE con funzione finestra (controllo: passava anche prima)",
      'with x as (select "Agente", sum("Importo") t from public.bi_fatturato group by "Agente") ' +
        'select "Agente", rank() over (order by t desc) from x',
    ],
  ];

  for (const [nome, sql] of AMMESSE) {
    it(`accetta: ${nome}`, () => {
      expect(rifiuto(sql)).toBeNull();
    });
  }
});

describe("La scrittura resta chiusa", () => {
  const RESPINTE: [string, string][] = [
    ["update", `update public.bi_fatturato set "Importo" = 0`],
    ["delete", "delete from public.bi_fatturato"],
    ["select into", 'select "Importo" into copia from public.bi_fatturato'],
    ["due istruzioni", "select 1 from public.bi_fatturato; drop table public.bi_fatturato"],
    ["commento di riga", 'select "Importo" from public.bi_fatturato -- e poi?'],
    ["commento a blocco", 'select /* nascosto */ "Importo" from public.bi_fatturato'],
    ["catalogo di sistema", "select tablename from pg_catalog.pg_tables"],
    ["vista non autorizzata", "select * from public.utenti"],
    ["schema della configurazione", "select * from bi_direzionale.serie_budget"],
    ["funzione non autorizzata", "select pg_sleep(10) from public.bi_fatturato"],
    ["stringa non chiusa", `select "Importo" from public.bi_fatturato where "Agente" = 'X`],
    ["stringa col dollaro", "select $$ciao$$ from public.bi_fatturato"],
  ];

  for (const [nome, sql] of RESPINTE) {
    it(`respinge: ${nome}`, () => {
      expect(rifiuto(sql)).not.toBeNull();
    });
  }

  it("un comando nascosto dentro un apice resta un dato, non un comando", () => {
    // La maschera non deve diventare una via d'uscita: il testo e' un testo, e
    // la query intorno resta una SELECT legittima.
    const sql = `select "Nome Cliente" from public.bi_fatturato where "Nome Cliente" = 'drop table x'`;
    expect(rifiuto(sql)).toBeNull();
  });
});

describe("I rifiuti dicono cosa fare", () => {
  it("propone la funzione giusta al posto di quella negata", () => {
    const e = rifiuto("select median(\"Importo\") from public.bi_fatturato");
    expect(e).not.toBeNull();
    expect(e?.suggerimento).toContain("descrivi_schema_sql");
  });

  it("propone la vista somigliante quando il nome e' quasi giusto", () => {
    const e = rifiuto('select "Importo" from public.bi_fatturati');
    expect(e?.suggerimento).toContain("public.bi_fatturato");
  });

  it("dice dove stanno budget e BEP invece di lasciare il vuoto", () => {
    const e = rifiuto("select anno from bi_direzionale.serie_budget");
    expect(e?.suggerimento).toMatch(/budget/i);
  });

  it("indirizza da extract() a date_part()", () => {
    const e = rifiuto('select extract(month from "Data Documento") from public.bi_fatturato');
    expect(e?.suggerimento).toContain("date_part");
  });
});
