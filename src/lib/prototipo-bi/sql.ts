import { createAdminClient } from "@/lib/supabase/admin";

export const SCHEMA_SQL_BI = `Viste SQL autorizzate (sola lettura).

COMMERCIALE — schema public, colonne con nomi tra virgolette:
- bi_ordinato, bi_fatturato, bi_consegnato, bi_portafoglio, bi_controllo_banco,
  bi_consegnato_futuro_per_mese: "Data Documento", "Importo", "Gruppo Descrizione",
  "Categoria Descrizione", "Agente", "Codice Agente", "Nome Cliente",
  "Codice Cliente", "Numero Doc.", "Codice Articolo", "Descrizione articolo", "Quantità".
- bi_preventivi_backoffice: le colonne precedenti più "Importo Inevaso",
  "Valore Totale Riga", "Convertito In Ordine", "Creato da", "Data Creazione",
  "Data Richiesta Cliente", "Giorni Risposta", "Riga evasa".

ARTICOLI E ACQUISTI — schema powerbi:
- bi_cruscotto_articoli_corrente: "Codice Articolo", "Descrizione", "UC", "Categoria",
  "Gruppo", "Reparto", "Fornitore", "Ultimo Costo", "Data Ultimo Costo",
  "Costo Mancante", "Magazzino", "Esistenza", "Disponibilita",
  "Qta Ord Clienti", "Qta Ord Fornitori", "Qta Imp Produzione", "Qta Ord Produzione",
  "Aggiornato Il", "Run".
- bi_ultimo_costo_storico: "Codice Articolo", "Descrizione", "Costo", "Valido Da",
  "Valido A", "Corrente", "Costo Mancante".
- bi_variazioni_ultimo_costo: "Codice Articolo", "Descrizione", "Data Variazione",
  "Costo Precedente", "Costo Nuovo", "Delta", "Delta %".
- bi_variazioni_giacenze: "Codice Articolo", "Descrizione", "Magazzino", "Campo",
  "Valore Precedente", "Valore", "Delta", "Data Variazione", "Corrente".
- bi_marginalita_documenti: "Tipo Documento", "Data", "Numero Doc.", "Codice Articolo",
  "Nome Cliente", "Agente", "Gruppo Descrizione", "Categoria Descrizione", "Quantita",
  "Ricavo", "Costo Unitario", "Costo Totale", "Margine", "Margine %", "Costo Mancante".
- bi_copertura_costi: "Tipo Documento", "Mese", "Righe", "Righe Con Costo",
  "Righe Senza Costo", "Copertura %", "Ricavo Totale", "Ricavo Con Costo".

ORDINI DI ACQUISTO A FORNITORE — schema public, colonne SENZA virgolette:
- bi_acquisti: una riga per riga d'ordine a fornitore (profilo OF/OFT/OFR) dal 2024.
  id_riga, profilo, numero_ordine, data_ordine, creato_il, codice_fornitore, fornitore,
  buyer_utente, buyer (chi ha creato l'ordine; "acquisti" è un utente condiviso),
  codice_articolo, descrizione, gruppo_articoli, quantita, qta_evasa, prezzo_netto,
  valore, data_prevista, data_confermata (promessa del fornitore), data_richiesta,
  riga_evasa, chiusa_forzata (boolean), primo_arrivo, ultimo_arrivo (DDT del
  fornitore collegati), qta_arrivata.
  Puntuale = primo_arrivo <= coalesce(data_confermata, data_prevista).
  Scaduta = not riga_evasa and not chiusa_forzata and qta_arrivata < quantita
  and coalesce(data_confermata, data_prevista) < current_date.

COSA È CONSENTITO
SELECT e WITH, inclusi CTE, join, subquery, CASE, HAVING, funzioni finestra,
ranking, aggregazioni e condizioni fra parentesi.

FUNZIONI DISPONIBILI
- aggregati: sum, avg, count, min, max, stddev, variance, percentile_cont,
  percentile_disc, string_agg, array_agg, corr
- finestra: row_number, rank, dense_rank, lag, lead, ntile, first_value,
  last_value, percent_rank, cume_dist
- numeriche: abs, round, trunc, floor, ceil, greatest, least, power, sqrt,
  mod, sign, width_bucket
- testo: lower, upper, initcap, trim, btrim, ltrim, rtrim, length, char_length,
  left, right, substring, split_part, strpos, position, replace, regexp_replace,
  concat, concat_ws
- date: date_trunc, date_part, to_char, to_date, make_date, age, now
- null: coalesce, nullif

REGOLE DI SCRITTURA
- Usa sempre schema.vista, senza virgolette: from public.bi_fatturato.
- Le colonne restano fra virgolette: "Data Documento".
- Per il mese usa date_part('month', "Data Documento") o date_trunc('month', ...),
  NON extract(month from "Data Documento").
- Niente commenti, niente punto e virgola, una sola istruzione.
- Non usare SELECT * se bastano poche colonne.

COSA NON C'È QUI
Budget e BEP non sono leggibili in SQL: stanno in bi_direzionale.serie_budget,
una riga per anno con il dettaglio dentro una colonna jsonb. Per confrontare
contro budget o pareggio usa le metriche certificate \`budget\` e \`bep\`.`;

/**
 * Errore del motore SQL che porta con se' un suggerimento utilizzabile.
 *
 * Serve all'analista. Prima il modello riceveva «Funzione SQL non autorizzata:
 * where», che non e' un'indicazione su cui possa correggersi: bruciava passi a
 * riprovare e finiva per ripiegare su una metrica piu' debole. Un rifiuto che
 * dice COSA usare al posto di cosa vale quanto un rifiuto in meno.
 */
export class ErroreSqlBi extends Error {
  readonly suggerimento: string | null;
  constructor(messaggio: string, suggerimento: string | null = null) {
    super(messaggio);
    this.name = "ErroreSqlBi";
    this.suggerimento = suggerimento;
  }
}

const PAROLE_VIETATE =
  /\b(insert|update|delete|merge|upsert|drop|alter|truncate|create|grant|revoke|comment|copy|call|do|execute|prepare|deallocate|set|reset|listen|notify|vacuum|analyze|refresh|reindex|cluster|lock|into)\b/i;
const OGGETTI_VIETATI =
  /\b(pg_catalog|information_schema|auth\.|storage\.|vault\.|realtime\.|net\.|extensions\.|pg_sleep|generate_series|dblink|lo_import|lo_export)\b/i;

const VISTE_AUTORIZZATE = new Set([
  "public.bi_ordinato",
  "public.bi_fatturato",
  "public.bi_consegnato",
  "public.bi_portafoglio",
  "public.bi_preventivi_backoffice",
  "public.bi_controllo_banco",
  "public.bi_consegnato_futuro_per_mese",
  "public.bi_acquisti",
  "powerbi.bi_cruscotto_articoli_corrente",
  "powerbi.bi_ultimo_costo_storico",
  "powerbi.bi_variazioni_ultimo_costo",
  "powerbi.bi_variazioni_giacenze",
  "powerbi.bi_marginalita_documenti",
  "powerbi.bi_copertura_costi",
]);

/**
 * Parole chiave che NON sono chiamate di funzione, anche quando sono seguite
 * da una parentesi.
 *
 * `validaFunzioni` riconosce una funzione come «identificatore seguito da (».
 * Con quella regola `where ("Importo" > 0)` veniva respinto con «Funzione SQL
 * non autorizzata: where», e lo stesso valeva per `and (`, `or (`, `having (`.
 * Le voci `as`, `cast`, `in`, `exists`, `filter`, `over` stavano nell'elenco
 * delle funzioni autorizzate proprio per questo: erano cicatrici, aggiunte una
 * alla volta da chi ci sbatteva contro.
 *
 * Saltarle non apre una falla: in PostgreSQL una parola riservata non puo'
 * essere il nome di una funzione se non messa fra virgolette, e le virgolette
 * qui sono gia' mascherate prima dei controlli. E la difesa vera non e'
 * comunque questa: sono i GRANT di `powerbi_reader` e la funzione
 * `bi_direzionale.query_sola_lettura`.
 */
const PAROLE_CHIAVE_NON_FUNZIONI = new Set([
  "all", "and", "any", "as", "asc", "between", "by", "case", "cast", "cross",
  "cube", "current", "desc", "distinct", "else", "end", "except", "exists",
  "fetch", "filter", "first", "following", "for", "from", "full", "group",
  "grouping", "having", "ilike", "in", "inner", "intersect", "is", "join",
  "last", "lateral", "like", "limit", "natural", "not", "nulls", "offset",
  "on", "or", "order", "outer", "over", "partition", "preceding", "range",
  "recursive", "returning", "row", "rows", "select", "similar", "some",
  "then", "unbounded", "union", "using", "values", "when", "where", "window",
  "with", "within",
]);

/**
 * Funzioni ammesse.
 *
 * L'elenco precedente bastava a contare e sommare, non a fare analisi: niente
 * mediane, niente deviazione standard, niente manipolazione di stringhe. Un
 * analista senza `percentile_cont` non puo' rispondere a «qual e' l'ordine
 * mediano», e senza `split_part` non puo' raggruppare i codici articolo per
 * famiglia. Sono tutte funzioni pure di lettura, senza effetti collaterali.
 */
const FUNZIONI_AUTORIZZATE = new Set([
  // aggregati
  "array_agg", "avg", "corr", "count", "every", "max", "min", "percentile_cont",
  "percentile_disc", "stddev", "stddev_pop", "stddev_samp", "string_agg", "sum",
  "var_pop", "var_samp", "variance",
  // finestra
  "cume_dist", "dense_rank", "first_value", "lag", "last_value", "lead",
  "nth_value", "ntile", "percent_rank", "rank", "row_number",
  // numeriche
  "abs", "ceil", "ceiling", "floor", "greatest", "least", "mod", "power",
  "round", "sign", "sqrt", "trunc", "width_bucket",
  // testo
  "btrim", "char_length", "concat", "concat_ws", "initcap", "left", "length",
  "lower", "ltrim", "position", "regexp_replace", "replace", "right", "rtrim",
  "split_part", "strpos", "substring", "trim", "upper",
  // date e null
  "age", "coalesce", "date_part", "date_trunc", "extract", "make_date", "now",
  "nullif", "to_char", "to_date",
]);

function distanzaEdit(a: string, b: string): number {
  const righe: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i += 1) righe[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) righe[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      righe[i][j] = Math.min(
        righe[i - 1][j] + 1,
        righe[i][j - 1] + 1,
        righe[i - 1][j - 1] + costo
      );
    }
  }
  return righe[a.length][b.length];
}

/** Quando un nome non e' autorizzato, propone quello ammesso piu' somigliante. */
function piuVicino(nome: string, candidati: Iterable<string>): string | null {
  const n = nome.toLowerCase();
  let migliore: string | null = null;
  let distanza = Infinity;
  for (const c of candidati) {
    // Prefisso in comune: "percentile" -> "percentile_cont" senza calcolare nulla.
    if (c.startsWith(n) || n.startsWith(c)) return c;
    const d = distanzaEdit(n, c);
    if (d < distanza) {
      distanza = d;
      migliore = c;
    }
  }
  // Oltre un terzo di caratteri diversi non e' piu' un suggerimento, e' rumore.
  return distanza <= Math.max(2, Math.floor(n.length / 3)) ? migliore : null;
}

/**
 * Maschera i testi fra apici e i nomi di colonna fra virgolette, e rifiuta
 * commenti e stringhe non chiuse. Una passata sola, perche' per sapere se un
 * `--` e' un commento bisogna sapere se si e' dentro una stringa, e viceversa.
 *
 * Senza questa maschera i controlli a parole leggevano dentro i testi:
 * `where "Nome Cliente" = 'COPY SRL'` veniva respinto come comando di scrittura
 * perche' `copy` e' fra le parole vietate. Mascherare non allenta il controllo,
 * lo rende preciso: un comando vero sta fuori dagli apici.
 */
function mascheraTesti(sql: string): string {
  let fuori = "";
  let i = 0;

  while (i < sql.length) {
    const c = sql[i];

    if (c === "'" || c === '"') {
      const chiusura = c;
      let j = i + 1;
      let chiuso = false;
      while (j < sql.length) {
        if (sql[j] !== chiusura) {
          j += 1;
          continue;
        }
        // Un apice raddoppiato dentro la stringa e' un carattere, non la fine.
        if (sql[j + 1] === chiusura) {
          j += 2;
          continue;
        }
        chiuso = true;
        break;
      }
      if (!chiuso) {
        throw new ErroreSqlBi(
          chiusura === "'"
            ? "Apice non chiuso nella query."
            : "Virgolette non chiuse nella query.",
          "Chiudi ogni testo fra apici e ogni nome di colonna fra virgolette prima di rieseguire."
        );
      }
      fuori += chiusura + chiusura;
      i = j + 1;
      continue;
    }

    if (c === "-" && sql[i + 1] === "-") {
      throw new ErroreSqlBi(
        "La query non puo' contenere commenti.",
        "Togli il commento che inizia con `--`: serve una sola istruzione, senza commenti."
      );
    }
    if (c === "/" && sql[i + 1] === "*") {
      throw new ErroreSqlBi(
        "La query non puo' contenere commenti.",
        "Togli il blocco `/* ... */`: serve una sola istruzione, senza commenti."
      );
    }
    if (c === "$" && sql[i + 1] === "$") {
      throw new ErroreSqlBi(
        "Le stringhe delimitate da dollari non sono ammesse.",
        "Usa gli apici semplici per i testi: 'esempio'."
      );
    }

    fuori += c;
    i += 1;
  }

  return fuori;
}

function validaSorgenti(sql: string) {
  if (/\b(?:from|join)\s+"/i.test(sql)) {
    throw new ErroreSqlBi(
      "I nomi di vista vanno scritti schema.vista, senza virgolette.",
      'Le colonne restano fra virgolette, le viste no: `from public.bi_fatturato`. ' +
        'Se stavi scrivendo `extract(month from "Data Documento")`, qui si usa ' +
        "`date_part('month', \"Data Documento\")`."
    );
  }

  const cte = new Set<string>();
  for (const m of sql.matchAll(
    /(?:\bwith|,)\s*(?:recursive\s+)?([a-z_][\w$]*)\s*(?:\([^)]*\))?\s+as\s*(?:not\s+materialized\s*)?\(/gi
  )) {
    cte.add(m[1].toLowerCase());
  }
  for (const m of sql.matchAll(
    /\b(?:from|join)\s+(?!lateral\b)([a-z_][\w$]*(?:\.[a-z_][\w$]*)?)/gi
  )) {
    const sorgente = m[1].toLowerCase();
    if (VISTE_AUTORIZZATE.has(sorgente) || cte.has(sorgente)) continue;

    const vicina = piuVicino(sorgente, VISTE_AUTORIZZATE);
    throw new ErroreSqlBi(
      `Sorgente SQL non autorizzata: ${m[1]}.`,
      vicina
        ? `Intendevi ${vicina}? Le viste leggibili sono: ${[...VISTE_AUTORIZZATE].join(", ")}.`
        : `Le viste leggibili sono: ${[...VISTE_AUTORIZZATE].join(", ")}. ` +
            "Budget e BEP non si leggono in SQL: usa le metriche certificate `budget` e `bep`."
    );
  }
}

function validaFunzioni(sql: string) {
  for (const m of sql.matchAll(/\b([a-z_][\w$]*(?:\.[a-z_][\w$]*)?)\s*\(/gi)) {
    const nome = m[1].toLowerCase();
    if (PAROLE_CHIAVE_NON_FUNZIONI.has(nome)) continue;
    if (FUNZIONI_AUTORIZZATE.has(nome)) continue;

    const vicina = piuVicino(nome, FUNZIONI_AUTORIZZATE);
    throw new ErroreSqlBi(
      `Funzione SQL non autorizzata: ${m[1]}.`,
      vicina
        ? `Usa ${vicina} al suo posto. L'elenco completo e' in descrivi_schema_sql.`
        : "L'elenco delle funzioni ammesse e' in descrivi_schema_sql."
    );
  }
}

export function validaSqlSolaLettura(sqlGrezzo: unknown): string {
  if (typeof sqlGrezzo !== "string") throw new ErroreSqlBi("SQL assente.");
  let sql = sqlGrezzo.trim();
  if (sql.endsWith(";")) sql = sql.slice(0, -1).trim();
  if (!sql) throw new ErroreSqlBi("SQL assente.");
  if (sql.length > 20_000) {
    throw new ErroreSqlBi("SQL troppo lungo (massimo 20.000 caratteri).");
  }
  if (!/^(select|with)\b/i.test(sql)) {
    throw new ErroreSqlBi(
      "Sono consentiti solo SELECT o WITH.",
      "Il motore e' in sola lettura: riscrivi la richiesta come interrogazione."
    );
  }

  // Da qui in poi si ragiona sul testo mascherato: cio' che sta fra apici o
  // virgolette e' un dato, non un comando, e non deve far scattare i controlli.
  const setacciato = mascheraTesti(sql);

  if (setacciato.includes(";")) {
    throw new ErroreSqlBi(
      "La query deve contenere una sola istruzione.",
      "Togli il punto e virgola e tutto cio' che lo segue."
    );
  }
  const vietata = setacciato.match(PAROLE_VIETATE);
  if (vietata) {
    throw new ErroreSqlBi(
      `La query contiene un comando non consentito in sola lettura: ${vietata[0]}.`,
      "Il motore esegue solo letture. Se ti serviva quella parola come dato, mettila fra apici."
    );
  }
  const oggetto = setacciato.match(OGGETTI_VIETATI);
  if (oggetto) {
    throw new ErroreSqlBi(
      `La query usa uno schema o una funzione non autorizzati: ${oggetto[0]}.`,
      "Si leggono soltanto le viste BI dichiarate da descrivi_schema_sql."
    );
  }
  validaSorgenti(setacciato);
  validaFunzioni(setacciato);
  return sql;
}

export interface RisultatoSqlBi {
  sql: string;
  righe: Record<string, unknown>[];
  colonne: string[];
  troncato: boolean;
  limite: number;
}

export async function eseguiSqlBi(sqlGrezzo: unknown, limiteGrezzo = 200): Promise<RisultatoSqlBi> {
  const sql = validaSqlSolaLettura(sqlGrezzo);
  const limite = Math.max(1, Math.min(500, Math.floor(Number(limiteGrezzo) || 200)));
  // La funzione vive in `bi_direzionale` e non in `public`: per cederne la
  // proprieta' a `powerbi_reader` — che e' cio' su cui poggia tutta la difesa —
  // il nuovo proprietario deve avere CREATE sullo schema, e su `public` non ce
  // l'ha ne' puo' averlo (su Supabase `public` e' di `pg_database_owner`).
  const { data, error } = await createAdminClient()
    .schema("bi_direzionale")
    .rpc("query_sola_lettura", {
      p_sql: sql,
      p_limite: limite + 1,
    });
  if (error) {
    if (/function .* does not exist|schema cache|schema must be one of/i.test(error.message)) {
      throw new ErroreSqlBi(
        "Motore SQL del BI non installato: applicare la migration 104_bi_motore_sql_e_analisi.sql."
      );
    }
    throw new ErroreSqlBi(
      `SQL non eseguibile: ${error.message}`,
      "Il database ha rifiutato la query: controlla nomi di colonna e tipi, poi riprova."
    );
  }
  const tutte = Array.isArray(data) ? data : [];
  const troncato = tutte.length > limite;
  const righe = tutte.slice(0, limite) as Record<string, unknown>[];
  return { sql, righe, colonne: Object.keys(righe[0] ?? {}), troncato, limite };
}
