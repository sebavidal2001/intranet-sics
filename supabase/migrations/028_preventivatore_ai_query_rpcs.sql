-- ============================================================
-- Migration 028 - Preventivatore AI query RPCs
-- ============================================================
-- Funzioni dedicate alla chat AI per risposte numeriche/aggregate.
-- Obiettivo: fare calcoli nel database e ridurre il rischio di allucinazioni.
-- ============================================================

CREATE OR REPLACE FUNCTION preventivatore.ai_statistiche_per_categoria(
  p_anno int DEFAULT NULL,
  p_stato text DEFAULT NULL,
  p_cliente text DEFAULT NULL
)
RETURNS TABLE (
  categoria text,
  preventivi_count bigint,
  valore_totale numeric,
  importo_medio numeric,
  importo_min numeric,
  importo_max numeric,
  ordinati_count bigint,
  rifiutati_count bigint,
  pending_count bigint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(NULLIF(d.categoria, ''), 'N/D') AS categoria,
    COUNT(*) AS preventivi_count,
    ROUND(COALESCE(SUM(d.importo_preventivo), 0), 2) AS valore_totale,
    ROUND(COALESCE(AVG(d.importo_preventivo), 0), 2) AS importo_medio,
    ROUND(MIN(d.importo_preventivo), 2) AS importo_min,
    ROUND(MAX(d.importo_preventivo), 2) AS importo_max,
    COUNT(*) FILTER (WHERE d.stato = 'ordinato') AS ordinati_count,
    COUNT(*) FILTER (WHERE d.stato = 'rifiutato') AS rifiutati_count,
    COUNT(*) FILTER (WHERE d.stato = 'pending') AS pending_count
  FROM preventivatore.documenti d
  WHERE (p_anno IS NULL OR d.anno = p_anno)
    AND (p_stato IS NULL OR d.stato = p_stato)
    AND (p_cliente IS NULL OR d.cliente ILIKE '%' || p_cliente || '%')
  GROUP BY COALESCE(NULLIF(d.categoria, ''), 'N/D')
  ORDER BY valore_totale DESC, preventivi_count DESC;
$$;

CREATE OR REPLACE FUNCTION preventivatore.ai_statistiche_per_cliente(
  p_anno int DEFAULT NULL,
  p_stato text DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  cliente text,
  preventivi_count bigint,
  valore_totale numeric,
  importo_medio numeric,
  ordinati_count bigint,
  rifiutati_count bigint,
  pending_count bigint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    (ARRAY_AGG(d.cliente ORDER BY d.cliente))[1] AS cliente,
    COUNT(*) AS preventivi_count,
    ROUND(COALESCE(SUM(d.importo_preventivo), 0), 2) AS valore_totale,
    ROUND(COALESCE(AVG(d.importo_preventivo), 0), 2) AS importo_medio,
    COUNT(*) FILTER (WHERE d.stato = 'ordinato') AS ordinati_count,
    COUNT(*) FILTER (WHERE d.stato = 'rifiutato') AS rifiutati_count,
    COUNT(*) FILTER (WHERE d.stato = 'pending') AS pending_count
  FROM preventivatore.documenti d
  WHERE d.cliente IS NOT NULL
    AND (p_anno IS NULL OR d.anno = p_anno)
    AND (p_stato IS NULL OR d.stato = p_stato)
    AND (p_categoria IS NULL OR d.categoria = p_categoria)
  GROUP BY LOWER(TRIM(d.cliente))
  ORDER BY valore_totale DESC, preventivi_count DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

CREATE OR REPLACE FUNCTION preventivatore.ai_statistiche_per_tipo_prodotto(
  p_anno int DEFAULT NULL,
  p_stato text DEFAULT NULL,
  p_categoria text DEFAULT NULL
)
RETURNS TABLE (
  tipo_prodotto text,
  categoria text,
  preventivi_count bigint,
  valore_totale numeric,
  importo_medio numeric,
  ordinati_count bigint,
  rifiutati_count bigint,
  pending_count bigint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(NULLIF(d.tipo_prodotto, ''), 'N/D') AS tipo_prodotto,
    COALESCE(NULLIF(d.categoria, ''), 'N/D') AS categoria,
    COUNT(*) AS preventivi_count,
    ROUND(COALESCE(SUM(d.importo_preventivo), 0), 2) AS valore_totale,
    ROUND(COALESCE(AVG(d.importo_preventivo), 0), 2) AS importo_medio,
    COUNT(*) FILTER (WHERE d.stato = 'ordinato') AS ordinati_count,
    COUNT(*) FILTER (WHERE d.stato = 'rifiutato') AS rifiutati_count,
    COUNT(*) FILTER (WHERE d.stato = 'pending') AS pending_count
  FROM preventivatore.documenti d
  WHERE (p_anno IS NULL OR d.anno = p_anno)
    AND (p_stato IS NULL OR d.stato = p_stato)
    AND (p_categoria IS NULL OR d.categoria = p_categoria)
  GROUP BY COALESCE(NULLIF(d.tipo_prodotto, ''), 'N/D'), COALESCE(NULLIF(d.categoria, ''), 'N/D')
  ORDER BY valore_totale DESC, preventivi_count DESC;
$$;

CREATE OR REPLACE FUNCTION preventivatore.ai_confronta_anni(
  p_anno_a int,
  p_anno_b int,
  p_categoria text DEFAULT NULL,
  p_tipo_prodotto text DEFAULT NULL
)
RETURNS TABLE (
  anno int,
  preventivi_count bigint,
  valore_totale numeric,
  importo_medio numeric,
  ordinati_count bigint,
  rifiutati_count bigint,
  pending_count bigint
)
LANGUAGE sql STABLE
AS $$
  SELECT
    d.anno,
    COUNT(*) AS preventivi_count,
    ROUND(COALESCE(SUM(d.importo_preventivo), 0), 2) AS valore_totale,
    ROUND(COALESCE(AVG(d.importo_preventivo), 0), 2) AS importo_medio,
    COUNT(*) FILTER (WHERE d.stato = 'ordinato') AS ordinati_count,
    COUNT(*) FILTER (WHERE d.stato = 'rifiutato') AS rifiutati_count,
    COUNT(*) FILTER (WHERE d.stato = 'pending') AS pending_count
  FROM preventivatore.documenti d
  WHERE d.anno IN (p_anno_a, p_anno_b)
    AND (p_categoria IS NULL OR d.categoria = p_categoria)
    AND (p_tipo_prodotto IS NULL OR d.tipo_prodotto = p_tipo_prodotto)
  GROUP BY d.anno
  ORDER BY d.anno;
$$;

CREATE OR REPLACE FUNCTION preventivatore.ai_top_codici_per_valore(
  p_anno int DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_cliente text DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  codice_articolo text,
  descrizione_esempio text,
  preventivi_count bigint,
  occorrenze bigint,
  quantita_totale numeric,
  valore_totale numeric,
  prezzo_unitario_medio numeric,
  prezzo_unitario_max numeric,
  ricarico_medio numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    rd.codice_articolo,
    (ARRAY_AGG(rd.descrizione ORDER BY rd.created_at DESC))[1] AS descrizione_esempio,
    COUNT(DISTINCT d.id) AS preventivi_count,
    COUNT(*) AS occorrenze,
    ROUND(COALESCE(SUM(rd.quantita), 0), 3) AS quantita_totale,
    ROUND(COALESCE(SUM(rd.totale_riga), 0), 2) AS valore_totale,
    ROUND(COALESCE(AVG(rd.prezzo_unitario), 0), 2) AS prezzo_unitario_medio,
    ROUND(MAX(rd.prezzo_unitario), 2) AS prezzo_unitario_max,
    ROUND(AVG(rd.ricarico_pct), 4) AS ricarico_medio
  FROM preventivatore.righe_distinta rd
  JOIN preventivatore.documenti d ON d.id = rd.documento_id
  WHERE rd.codice_articolo IS NOT NULL
    AND rd.codice_articolo <> ''
    AND (p_anno IS NULL OR d.anno = p_anno)
    AND (p_categoria IS NULL OR d.categoria = p_categoria)
    AND (p_cliente IS NULL OR d.cliente ILIKE '%' || p_cliente || '%')
  GROUP BY rd.codice_articolo
  ORDER BY valore_totale DESC, occorrenze DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

CREATE OR REPLACE FUNCTION preventivatore.ai_top_codici_per_frequenza(
  p_anno int DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_cliente text DEFAULT NULL,
  p_limit int DEFAULT 20
)
RETURNS TABLE (
  codice_articolo text,
  descrizione_esempio text,
  preventivi_count bigint,
  occorrenze bigint,
  valore_totale numeric,
  ricarico_medio numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    rd.codice_articolo,
    (ARRAY_AGG(rd.descrizione ORDER BY rd.created_at DESC))[1] AS descrizione_esempio,
    COUNT(DISTINCT d.id) AS preventivi_count,
    COUNT(*) AS occorrenze,
    ROUND(COALESCE(SUM(rd.totale_riga), 0), 2) AS valore_totale,
    ROUND(AVG(rd.ricarico_pct), 4) AS ricarico_medio
  FROM preventivatore.righe_distinta rd
  JOIN preventivatore.documenti d ON d.id = rd.documento_id
  WHERE rd.codice_articolo IS NOT NULL
    AND rd.codice_articolo <> ''
    AND (p_anno IS NULL OR d.anno = p_anno)
    AND (p_categoria IS NULL OR d.categoria = p_categoria)
    AND (p_cliente IS NULL OR d.cliente ILIKE '%' || p_cliente || '%')
  GROUP BY rd.codice_articolo
  ORDER BY preventivi_count DESC, occorrenze DESC, valore_totale DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

DROP FUNCTION IF EXISTS preventivatore.ai_analisi_ricarichi(text, int, text, text, int);

CREATE OR REPLACE FUNCTION preventivatore.ai_analisi_ricarichi(
  p_group_by text DEFAULT 'categoria',
  p_anno int DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_cliente text DEFAULT NULL,
  p_limit int DEFAULT 50
)
RETURNS TABLE (
  gruppo text,
  righe_count bigint,
  preventivi_count bigint,
  ricarico_medio numeric,
  ricarico_medio_senza_outlier numeric,
  ricarico_min numeric,
  ricarico_max numeric,
  outlier_count bigint,
  valore_totale numeric
)
LANGUAGE sql STABLE
AS $$
  WITH base AS (
    SELECT
      CASE
        WHEN p_group_by = 'cliente' THEN COALESCE(d.cliente, 'N/D')
        WHEN p_group_by = 'tipo_prodotto' THEN COALESCE(d.tipo_prodotto, 'N/D')
        WHEN p_group_by = 'codice_articolo' THEN COALESCE(rd.codice_articolo, 'N/D')
        ELSE COALESCE(d.categoria, 'N/D')
      END AS gruppo,
      d.id AS documento_id,
      rd.ricarico_pct,
      rd.totale_riga
    FROM preventivatore.righe_distinta rd
    JOIN preventivatore.documenti d ON d.id = rd.documento_id
    WHERE rd.ricarico_pct IS NOT NULL
      AND (p_anno IS NULL OR d.anno = p_anno)
      AND (p_categoria IS NULL OR d.categoria = p_categoria)
      AND (p_cliente IS NULL OR d.cliente ILIKE '%' || p_cliente || '%')
  )
  SELECT
    gruppo,
    COUNT(*) AS righe_count,
    COUNT(DISTINCT documento_id) AS preventivi_count,
    ROUND(AVG(ricarico_pct), 4) AS ricarico_medio,
    ROUND(AVG(ricarico_pct) FILTER (WHERE ricarico_pct BETWEEN 0 AND 5), 4) AS ricarico_medio_senza_outlier,
    ROUND(MIN(ricarico_pct), 4) AS ricarico_min,
    ROUND(MAX(ricarico_pct), 4) AS ricarico_max,
    COUNT(*) FILTER (WHERE ricarico_pct < 0 OR ricarico_pct > 5) AS outlier_count,
    ROUND(COALESCE(SUM(totale_riga), 0), 2) AS valore_totale
  FROM base
  GROUP BY gruppo
  ORDER BY valore_totale DESC, righe_count DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

CREATE OR REPLACE FUNCTION preventivatore.ai_analisi_lavorazioni_ore_tariffe(
  p_anno int DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_tipo_prodotto text DEFAULT NULL,
  p_cliente text DEFAULT NULL
)
RETURNS TABLE (
  voce text,
  righe_count bigint,
  preventivi_count bigint,
  ore_totali numeric,
  ore_medie numeric,
  tariffa_media numeric,
  costo_totale numeric,
  costo_medio numeric
)
LANGUAGE sql STABLE
AS $$
  WITH first_chunk AS (
    SELECT DISTINCT ON (c.documento_id)
      c.documento_id,
      c.metadata
    FROM preventivatore.chunks c
    ORDER BY c.documento_id, c.created_at
  ),
  lav AS (
    SELECT
      d.id AS documento_id,
      elem->>'voce' AS voce,
      NULLIF(elem->>'ore', '')::numeric AS ore,
      NULLIF(elem->>'tariffa_oraria', '')::numeric AS tariffa_oraria,
      COALESCE(NULLIF(elem->>'totale_ceil_2', '')::numeric, NULLIF(elem->>'totale_raw', '')::numeric) AS totale
    FROM first_chunk c
    JOIN preventivatore.documenti d ON d.id = c.documento_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.metadata->'lavorazioni', '[]'::jsonb)) elem
    WHERE (p_anno IS NULL OR d.anno = p_anno)
      AND (p_categoria IS NULL OR d.categoria = p_categoria)
      AND (p_tipo_prodotto IS NULL OR d.tipo_prodotto = p_tipo_prodotto)
      AND (p_cliente IS NULL OR d.cliente ILIKE '%' || p_cliente || '%')
  )
  SELECT
    COALESCE(NULLIF(voce, ''), 'N/D') AS voce,
    COUNT(*) AS righe_count,
    COUNT(DISTINCT documento_id) AS preventivi_count,
    ROUND(COALESCE(SUM(ore), 0), 2) AS ore_totali,
    ROUND(COALESCE(AVG(ore), 0), 2) AS ore_medie,
    ROUND(COALESCE(AVG(tariffa_oraria), 0), 2) AS tariffa_media,
    ROUND(COALESCE(SUM(totale), 0), 2) AS costo_totale,
    ROUND(COALESCE(AVG(totale), 0), 2) AS costo_medio
  FROM lav
  GROUP BY COALESCE(NULLIF(voce, ''), 'N/D')
  ORDER BY costo_totale DESC, ore_totali DESC;
$$;

CREATE OR REPLACE FUNCTION preventivatore.ai_controllo_qualita_dati(
  p_anno int DEFAULT NULL
)
RETURNS TABLE (
  metrica text,
  valore bigint
)
LANGUAGE sql STABLE
AS $$
  WITH docs AS (
    SELECT *
    FROM preventivatore.documenti d
    WHERE p_anno IS NULL OR d.anno = p_anno
  )
  SELECT 'documenti_totali', COUNT(*) FROM docs
  UNION ALL SELECT 'senza_importo_preventivo', COUNT(*) FROM docs WHERE importo_preventivo IS NULL
  UNION ALL SELECT 'senza_numero_offerta', COUNT(*) FROM docs WHERE numero_offerta IS NULL OR numero_offerta = ''
  UNION ALL SELECT 'senza_data_offerta', COUNT(*) FROM docs WHERE data_offerta IS NULL OR data_offerta = ''
  UNION ALL SELECT 'categoria_altro', COUNT(*) FROM docs WHERE categoria IS NULL OR categoria = 'altro'
  UNION ALL SELECT 'tipo_prodotto_altro', COUNT(*) FROM docs WHERE tipo_prodotto IS NULL OR tipo_prodotto = 'altro'
  UNION ALL SELECT 'stato_pending', COUNT(*) FROM docs WHERE stato = 'pending'
  UNION ALL SELECT 'stato_ordinato', COUNT(*) FROM docs WHERE stato = 'ordinato'
  UNION ALL SELECT 'stato_rifiutato', COUNT(*) FROM docs WHERE stato = 'rifiutato'
  UNION ALL
  SELECT 'righe_con_ricarico_fuori_range', COUNT(*)
  FROM preventivatore.righe_distinta rd
  JOIN docs d ON d.id = rd.documento_id
  WHERE rd.ricarico_pct IS NOT NULL
    AND (rd.ricarico_pct < 0 OR rd.ricarico_pct > 5);
$$;

CREATE OR REPLACE FUNCTION preventivatore.ai_preventivi_da_completare(
  p_anno int DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  codice text,
  cliente text,
  anno int,
  categoria text,
  tipo_prodotto text,
  importo_preventivo numeric,
  numero_offerta text,
  data_offerta text,
  motivi text[]
)
LANGUAGE sql STABLE
AS $$
  SELECT
    d.codice,
    d.cliente,
    d.anno,
    d.categoria,
    d.tipo_prodotto,
    d.importo_preventivo,
    d.numero_offerta,
    d.data_offerta,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN d.importo_preventivo IS NULL THEN 'senza_importo_preventivo' END,
      CASE WHEN d.numero_offerta IS NULL OR d.numero_offerta = '' THEN 'senza_numero_offerta' END,
      CASE WHEN d.data_offerta IS NULL OR d.data_offerta = '' THEN 'senza_data_offerta' END,
      CASE WHEN d.categoria IS NULL OR d.categoria = 'altro' THEN 'categoria_altro' END,
      CASE WHEN d.tipo_prodotto IS NULL OR d.tipo_prodotto = 'altro' THEN 'tipo_prodotto_altro' END
    ], NULL) AS motivi
  FROM preventivatore.documenti d
  WHERE (p_anno IS NULL OR d.anno = p_anno)
    AND (
      d.importo_preventivo IS NULL
      OR d.numero_offerta IS NULL OR d.numero_offerta = ''
      OR d.data_offerta IS NULL OR d.data_offerta = ''
      OR d.categoria IS NULL OR d.categoria = 'altro'
      OR d.tipo_prodotto IS NULL OR d.tipo_prodotto = 'altro'
    )
  ORDER BY d.anno DESC NULLS LAST, d.codice
  LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$;

GRANT EXECUTE ON FUNCTION preventivatore.ai_statistiche_per_categoria(int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.ai_statistiche_per_cliente(int, text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.ai_statistiche_per_tipo_prodotto(int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.ai_confronta_anni(int, int, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.ai_top_codici_per_valore(int, text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.ai_top_codici_per_frequenza(int, text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.ai_analisi_ricarichi(text, int, text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.ai_analisi_lavorazioni_ore_tariffe(int, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.ai_controllo_qualita_dati(int) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.ai_preventivi_da_completare(int, int) TO authenticated;
