
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

Sono consentiti SELECT e WITH, inclusi CTE, join, subquery, CASE, HAVING, funzioni finestra,
ranking e aggregazioni. Usa sempre il nome schema. Non usare mai SELECT * se bastano poche colonne.`;

const PAROLE_VIETATE = /\b(insert|update|delete|merge|upsert|drop|alter|truncate|create|replace|grant|revoke|comment|copy|call|do|execute|prepare|deallocate|set|reset|listen|notify|vacuum|analyze|refresh|reindex|cluster|lock|into)\b/i;
const OGGETTI_VIETATI = /\b(pg_catalog|information_schema|auth\.|storage\.|vault\.|realtime\.|net\.|extensions\.|pg_sleep|generate_series|dblink|lo_import|lo_export)\b/i;

const VISTE_AUTORIZZATE = new Set([
  "public.bi_ordinato",
  "public.bi_fatturato",
  "public.bi_consegnato",
  "public.bi_portafoglio",
  "public.bi_preventivi_backoffice",
  "public.bi_controllo_banco",
  "public.bi_consegnato_futuro_per_mese",
  "powerbi.bi_cruscotto_articoli_corrente",
  "powerbi.bi_ultimo_costo_storico",
  "powerbi.bi_variazioni_ultimo_costo",
  "powerbi.bi_variazioni_giacenze",
  "powerbi.bi_marginalita_documenti",
  "powerbi.bi_copertura_costi",
]);

// Funzioni sufficienti per analisi direzionali, ranking e serie temporali.
// Qualunque altra chiamata viene respinta: evita che una SELECT invochi una
// funzione applicativa SECURITY DEFINER con effetti collaterali.
const FUNZIONI_AUTORIZZATE = new Set([
  "abs", "as", "avg", "cast", "ceil", "ceiling", "coalesce", "concat", "concat_ws",
  "count", "cume_dist", "date_trunc", "dense_rank", "exists", "extract", "filter",
  "first_value", "floor", "greatest", "in", "initcap", "lag", "last_value", "lead",
  "least", "length", "lower", "max", "min", "mod", "nth_value", "ntile", "nullif",
  "over", "percent_rank", "power", "rank", "round", "row_number", "sqrt", "substring",
  "sum", "to_char", "trim", "upper",
]);

function validaSorgenti(sql: string) {
  if (/\b(?:from|join)\s+"/i.test(sql)) {
    throw new Error("Usa i nomi schema.vista senza virgolette; le colonne possono restare tra virgolette.");
  }

  const cte = new Set<string>();
  for (const m of sql.matchAll(/(?:\bwith|,)\s*(?:recursive\s+)?([a-z_][\w$]*)\s*(?:\([^)]*\))?\s+as\s*(?:not\s+materialized\s*)?\(/gi)) {
    cte.add(m[1].toLowerCase());
  }
  for (const m of sql.matchAll(/\b(?:from|join)\s+(?!lateral\b)([a-z_][\w$]*(?:\.[a-z_][\w$]*)?)/gi)) {
    const sorgente = m[1].toLowerCase();
    if (!VISTE_AUTORIZZATE.has(sorgente) && !cte.has(sorgente)) {
      throw new Error(`Sorgente SQL non autorizzata: ${m[1]}. Usa soltanto le viste BI dichiarate.`);
    }
  }
}

function validaFunzioni(sql: string) {
  for (const m of sql.matchAll(/\b([a-z_][\w$]*(?:\.[a-z_][\w$]*)?)\s*\(/gi)) {
    const funzione = m[1].toLowerCase();
    if (!FUNZIONI_AUTORIZZATE.has(funzione)) {
      throw new Error(`Funzione SQL non autorizzata: ${m[1]}.`);
    }
  }
}

export function validaSqlSolaLettura(sqlGrezzo: unknown): string {
  if (typeof sqlGrezzo !== "string") throw new Error("SQL assente.");
  let sql = sqlGrezzo.trim();
  if (sql.endsWith(";")) sql = sql.slice(0, -1).trim();
  if (!sql) throw new Error("SQL assente.");
  if (sql.length > 20_000) throw new Error("SQL troppo lungo (massimo 20.000 caratteri).");
  if (!/^(select|with)\b/i.test(sql)) throw new Error("Sono consentiti solo SELECT o WITH.");
  if (sql.includes(";") || sql.includes("--") || sql.includes("/*")) {
    throw new Error("La query deve contenere una sola istruzione e non può includere commenti.");
  }
  if (PAROLE_VIETATE.test(sql)) throw new Error("La query contiene un comando non consentito in sola lettura.");
  if (OGGETTI_VIETATI.test(sql)) throw new Error("La query usa uno schema o una funzione non autorizzati.");
  validaSorgenti(sql);
  validaFunzioni(sql);
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
      throw new Error("Motore SQL del BI non installato: applicare la migration 104_bi_motore_sql_e_analisi.sql.");
    }
    throw new Error(`SQL non eseguibile: ${error.message}`);
  }
  const tutte = Array.isArray(data) ? data : [];
  const troncato = tutte.length > limite;
  const righe = tutte.slice(0, limite) as Record<string, unknown>[];
  return { sql, righe, colonne: Object.keys(righe[0] ?? {}), troncato, limite };
}
