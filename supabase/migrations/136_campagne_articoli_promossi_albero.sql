-- 136_campagne_articoli_promossi_albero.sql
--
-- PORTALE CAMPAGNE MARKETING — gli articoli promossi si scelgono su un ALBERO.
--
-- PRIMA: `articoli_promossi` era un elenco di codici da scrivere a mano (con
-- l'asterisco per un prefisso). Con 25.000 articoli e 500 fornitori e' un lavoro
-- da pazzi. ORA si scende dall'anagrafica: FORNITORE > GRUPPO > CATEGORIA >
-- ARTICOLO, e si puo' scegliere un nodo a qualsiasi livello («tutto AIGNEP»,
-- «AIGNEP, solo componenti», «AIGNEP, componenti, automazione pneumatica»,
-- «questo articolo»).
--
-- COME SI MEMORIZZA: `campagne.promossi_albero` e' un array JSON di SELETTORI, ognuno
-- un PERCORSO dell'albero: {"f": fornitore, "g": gruppo, "c": categoria, "a": codice}
-- con solo i livelli scelti. Un selettore prende tutti gli articoli che stanno sotto
-- quel percorso; la selezione e' l'UNIONE dei selettori. `articoli_promossi` (codici e
-- prefissi con l'asterisco) resta, per i codici che nell'albero non ci sono: i due si
-- sommano.
--
-- FONTE: `preventivatore.prodotti`, l'anagrafica articoli (25.586 righe, 503 fornitori,
-- 4 gruppi, 12 categorie), che copre il 99% dei codici venduti nel fatturato.
--
-- Additiva: una colonna con default e funzioni. `analisi_clienti` e' riscritta con la
-- stessa firma: considera promosso un articolo se corrisponde a un codice/prefisso
-- OPPURE a un selettore dell'albero.
--
-- Rollback: ALTER TABLE campagne.campagne DROP COLUMN promossi_albero;
--           e ripristinare analisi_clienti dalla 134.

DO $$
BEGIN
  IF to_regclass('campagne.campagne') IS NULL THEN
    RAISE EXCEPTION 'Manca campagne.campagne: applicare prima la migration 131.';
  END IF;
  IF to_regclass('preventivatore.prodotti') IS NULL THEN
    RAISE EXCEPTION 'Manca preventivatore.prodotti (anagrafica articoli).';
  END IF;
END $$;

ALTER TABLE campagne.campagne
  ADD COLUMN IF NOT EXISTS promossi_albero jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campagne_promossi_albero_array') THEN
    ALTER TABLE campagne.campagne
      ADD CONSTRAINT campagne_promossi_albero_array CHECK (jsonb_typeof(promossi_albero) = 'array');
  END IF;
END $$;

COMMENT ON COLUMN campagne.campagne.promossi_albero IS
  'Articoli promossi scelti sull''albero fornitore > gruppo > categoria > articolo: array di selettori {f,g,c,a} (percorsi). Si somma a articoli_promossi (codici/prefissi).';

-- Un attributo dell'anagrafica come lo vede l'albero: vuoto = «-».
CREATE OR REPLACE FUNCTION campagne.attr_articolo(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(nullif(btrim(p), ''), '-');
$$;

-- ============================================================
-- GLI ARTICOLI CHE CORRISPONDONO A UNA SELEZIONE
-- ============================================================
-- Codici (maiuscoli, senza spazi ai bordi) di tutti gli articoli che stanno sotto
-- almeno uno dei selettori. Un selettore senza nessun livello non prende niente
-- (non «tutto»): e' piu' sicuro che un errore di forma selezioni l'intera anagrafica.
CREATE OR REPLACE FUNCTION campagne.articoli_da_selettori(p_sel jsonb)
RETURNS TABLE (codice text)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT upper(btrim(p.codice))
    FROM preventivatore.prodotti p
    JOIN jsonb_array_elements(CASE WHEN jsonb_typeof(p_sel) = 'array' THEN p_sel ELSE '[]'::jsonb END) s
      ON (s ->> 'f' IS NOT NULL OR s ->> 'g' IS NOT NULL OR s ->> 'c' IS NOT NULL OR s ->> 'a' IS NOT NULL)
     AND (s ->> 'f' IS NULL OR campagne.attr_articolo(p.fornitore) = s ->> 'f')
     AND (s ->> 'g' IS NULL OR campagne.attr_articolo(p.gruppo) = s ->> 'g')
     AND (s ->> 'c' IS NULL OR campagne.attr_articolo(p.categoria) = s ->> 'c')
     AND (s ->> 'a' IS NULL OR upper(btrim(p.codice)) = upper(btrim(s ->> 'a')));
$$;

-- Quanti articoli prende la selezione, e quanti di questi compaiono nel fatturato
-- (sono stati davvero venduti dal 13/01/2025): se la selezione non ne ha nemmeno uno
-- venduto, l'Analisi non avra' niente da dire.
CREATE OR REPLACE FUNCTION campagne.promossi_conteggio(p_sel jsonb)
RETURNS TABLE (articoli integer, venduti integer)
LANGUAGE sql
STABLE
AS $$
  WITH sel AS (SELECT codice FROM campagne.articoli_da_selettori(p_sel))
  SELECT (SELECT count(*)::int FROM sel),
         (SELECT count(DISTINCT sel.codice)::int
            FROM sel
            JOIN public.bi_fatturato f ON upper(btrim(f."Codice Articolo")) = sel.codice AND f."Importo" <> 0);
$$;

-- ============================================================
-- L'ALBERO, UN LIVELLO ALLA VOLTA
-- ============================================================
-- Il livello dipende da quanti parametri sono dati:
--   nessuno           -> fornitori
--   f                 -> gruppi di quel fornitore
--   f, g              -> categorie
--   f, g, c           -> articoli
-- `n` = quanti articoli stanno sotto il nodo. p_q restringe agli articoli che
-- contengono il testo (codice o descrizione): i conteggi e i nodi mostrati sono solo
-- quelli che hanno almeno un articolo che corrisponde (codice, descrizione o NOME DEL
-- FORNITORE: cercando «AIGNEP» si vedono tutti i listini AIGNEP). `totale` = quanti nodi in tutto
-- a questo livello (per «mostra altri»).
CREATE OR REPLACE FUNCTION campagne.albero_articoli(
  p_f      text    DEFAULT NULL,
  p_g      text    DEFAULT NULL,
  p_c      text    DEFAULT NULL,
  p_q      text    DEFAULT NULL,
  p_limit  integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (livello text, valore text, descrizione text, n integer, totale integer)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_q text := lower(btrim(coalesce(p_q, '')));
  v_lim integer := greatest(least(coalesce(p_limit, 100), 500), 1);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF p_f IS NULL THEN
    RETURN QUERY
      SELECT 'fornitore'::text, campagne.attr_articolo(p.fornitore), NULL::text, count(*)::int,
             (count(*) OVER ())::int
        FROM preventivatore.prodotti p
       WHERE v_q = '' OR position(v_q IN lower(p.codice)) > 0 OR position(v_q IN lower(coalesce(p.descrizione, ''))) > 0
              OR position(v_q IN lower(coalesce(p.fornitore, ''))) > 0
       GROUP BY campagne.attr_articolo(p.fornitore)
       ORDER BY lower(campagne.attr_articolo(p.fornitore))
       LIMIT v_lim OFFSET v_off;
  ELSIF p_g IS NULL THEN
    RETURN QUERY
      SELECT 'gruppo'::text, campagne.attr_articolo(p.gruppo), NULL::text, count(*)::int, (count(*) OVER ())::int
        FROM preventivatore.prodotti p
       WHERE campagne.attr_articolo(p.fornitore) = p_f
         AND (v_q = '' OR position(v_q IN lower(p.codice)) > 0 OR position(v_q IN lower(coalesce(p.descrizione, ''))) > 0
              OR position(v_q IN lower(coalesce(p.fornitore, ''))) > 0)
       GROUP BY campagne.attr_articolo(p.gruppo)
       ORDER BY lower(campagne.attr_articolo(p.gruppo))
       LIMIT v_lim OFFSET v_off;
  ELSIF p_c IS NULL THEN
    RETURN QUERY
      SELECT 'categoria'::text, campagne.attr_articolo(p.categoria), NULL::text, count(*)::int, (count(*) OVER ())::int
        FROM preventivatore.prodotti p
       WHERE campagne.attr_articolo(p.fornitore) = p_f
         AND campagne.attr_articolo(p.gruppo) = p_g
         AND (v_q = '' OR position(v_q IN lower(p.codice)) > 0 OR position(v_q IN lower(coalesce(p.descrizione, ''))) > 0
              OR position(v_q IN lower(coalesce(p.fornitore, ''))) > 0)
       GROUP BY campagne.attr_articolo(p.categoria)
       ORDER BY lower(campagne.attr_articolo(p.categoria))
       LIMIT v_lim OFFSET v_off;
  ELSE
    RETURN QUERY
      SELECT 'articolo'::text, btrim(p.codice), p.descrizione, 1, (count(*) OVER ())::int
        FROM preventivatore.prodotti p
       WHERE campagne.attr_articolo(p.fornitore) = p_f
         AND campagne.attr_articolo(p.gruppo) = p_g
         AND campagne.attr_articolo(p.categoria) = p_c
         AND (v_q = '' OR position(v_q IN lower(p.codice)) > 0 OR position(v_q IN lower(coalesce(p.descrizione, ''))) > 0
              OR position(v_q IN lower(coalesce(p.fornitore, ''))) > 0)
       ORDER BY btrim(p.codice)
       LIMIT v_lim OFFSET v_off;
  END IF;
END;
$$;

-- La ricerca libera: un articolo per codice o descrizione, con il suo percorso, per
-- sceglierlo senza scendere l'albero.
CREATE OR REPLACE FUNCTION campagne.cerca_articoli(p_q text, p_limit integer DEFAULT 40)
RETURNS TABLE (codice text, descrizione text, fornitore text, gruppo text, categoria text, totale integer)
LANGUAGE sql
STABLE
AS $$
  SELECT btrim(p.codice), p.descrizione, campagne.attr_articolo(p.fornitore), campagne.attr_articolo(p.gruppo),
         campagne.attr_articolo(p.categoria), (count(*) OVER ())::int
    FROM preventivatore.prodotti p
   WHERE length(btrim(coalesce(p_q, ''))) >= 2
     AND (position(lower(btrim(p_q)) IN lower(p.codice)) > 0
          OR position(lower(btrim(p_q)) IN lower(coalesce(p.descrizione, ''))) > 0)
   ORDER BY (lower(btrim(p.codice)) = lower(btrim(p_q))) DESC, btrim(p.codice)
   LIMIT greatest(least(coalesce(p_limit, 40), 200), 1);
$$;

-- ============================================================
-- L'ANALISI: PROMOSSO = CODICE/PREFISSO O ALBERO
-- ============================================================
CREATE OR REPLACE FUNCTION campagne.analisi_clienti(
  p_campagna uuid,
  p_mesi     integer DEFAULT 6
)
RETURNS TABLE (
  codice_cliente  text,
  ragione_sociale text,
  agente_nome     text,
  data_invio      date,
  prima_tot       numeric,
  dopo_tot        numeric,
  prima_prom      numeric,
  dopo_prom       numeric,
  mai_prima_prom  boolean,
  prima_completa  boolean,
  dopo_completa   boolean
)
LANGUAGE sql
STABLE
SET search_path = public, campagne, pg_temp
AS $$
  WITH par AS (
    SELECT greatest(least(coalesce(p_mesi, 6), 24), 1) AS mesi,
           coalesce((SELECT array_agg(upper(replace(a, '*', '%')))
                       FROM unnest(c.articoli_promossi) a), '{}'::text[]) AS pat,
           c.promossi_albero AS sel,
           (cardinality(c.articoli_promossi) > 0 OR jsonb_array_length(c.promossi_albero) > 0) AS ha_prom
      FROM campagne.campagne c
     WHERE c.id = p_campagna
  ),
  sel_cod AS (
    SELECT s.codice FROM par p, campagne.articoli_da_selettori(p.sel) s WHERE p.ha_prom
  ),
  estremi AS (SELECT dal, al FROM campagne.fatturato_estremi()),
  ricevuti AS (
    SELECT i.codice_cliente, i.data_consegna AS data_invio
      FROM campagne.invii i
     WHERE i.campagna_id = p_campagna
       AND i.stato IN ('consegnata', 'consegnata_banco')
       AND i.data_consegna IS NOT NULL
  ),
  righe AS (
    SELECT r.codice_cliente, r.data_invio, p.mesi, p.ha_prom,
           f."Data Documento"::date AS data_doc,
           f."Importo" AS importo,
           (p.ha_prom AND (upper(f."Codice Articolo") LIKE ANY (p.pat)
                           OR upper(btrim(f."Codice Articolo")) IN (SELECT codice FROM sel_cod))) AS promosso
      FROM ricevuti r
      CROSS JOIN par p
      JOIN public.bi_fatturato f ON f."Codice Cliente" = r.codice_cliente
  ),
  somme AS (
    SELECT g.codice_cliente,
           sum(g.importo) FILTER (WHERE g.data_doc >= (g.data_invio - make_interval(months => g.mesi))::date
                                    AND g.data_doc <  g.data_invio)                             AS prima_tot,
           sum(g.importo) FILTER (WHERE g.data_doc >= g.data_invio
                                    AND g.data_doc <  (g.data_invio + make_interval(months => g.mesi))::date) AS dopo_tot,
           sum(g.importo) FILTER (WHERE g.promosso
                                    AND g.data_doc >= (g.data_invio - make_interval(months => g.mesi))::date
                                    AND g.data_doc <  g.data_invio)                             AS prima_prom,
           sum(g.importo) FILTER (WHERE g.promosso
                                    AND g.data_doc >= g.data_invio
                                    AND g.data_doc <  (g.data_invio + make_interval(months => g.mesi))::date) AS dopo_prom,
           bool_or(g.promosso AND g.data_doc < g.data_invio AND g.importo > 0)                 AS prom_prima_mai
      FROM righe g
     GROUP BY g.codice_cliente
  )
  SELECT r.codice_cliente,
         v.ragione_sociale,
         v.agente_nome,
         r.data_invio,
         coalesce(s.prima_tot, 0),
         coalesce(s.dopo_tot, 0),
         CASE WHEN p.ha_prom THEN coalesce(s.prima_prom, 0) END,
         CASE WHEN p.ha_prom THEN coalesce(s.dopo_prom, 0) END,
         CASE WHEN p.ha_prom THEN NOT coalesce(s.prom_prima_mai, false) END,
         (r.data_invio - make_interval(months => p.mesi))::date >= e.dal,
         (r.data_invio + make_interval(months => p.mesi))::date <= e.al + 1
    FROM ricevuti r
    CROSS JOIN par p
    CROSS JOIN estremi e
    LEFT JOIN somme s ON s.codice_cliente = r.codice_cliente
    LEFT JOIN campagne.v_clienti v ON v.codice_cliente = r.codice_cliente
   ORDER BY v.ragione_sociale NULLS LAST, r.codice_cliente;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA campagne TO service_role;
NOTIFY pgrst, 'reload schema';
