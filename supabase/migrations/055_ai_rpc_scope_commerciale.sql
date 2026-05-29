-- Migration 055: scoping commerciale sulle RPC analisi della chat AI.
-- Aggiunge p_agente_codice (DEFAULT NULL) a info_cliente, analisi_margini, hit_rate,
-- articoli_associati, storia_prezzi_articolo. NULL = globale; valorizzato = solo
-- clienti dell'agente (+ AIRFLUID). Chiude il residuo dell'audit beta per i tool AI
-- a livello cliente. (analisi_preventivi_sql viene gated lato dispatcher per i ristretti.)

-- ── info_cliente ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS preventivatore.info_cliente(text, integer);
CREATE OR REPLACE FUNCTION preventivatore.info_cliente(p_ragione text, p_limit_preventivi integer DEFAULT 8, p_agente_codice text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql STABLE
AS $function$
DECLARE master jsonb; ultimi jsonb; stats jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'codice_cliente', cm.codice_cliente, 'ragione_sociale', cm.ragione_sociale,
    'destinazione', cm.destinazione, 'localita', cm.localita, 'cat_zona', cm.cat_zona,
    'agente_nome', cm.agente_nome, 'agente_codice', cm.agente_codice, 'cat_commerciale', cm.cat_commerciale
  ) ORDER BY (cm.ragione_sociale = cm.destinazione) DESC, cm.id_destinazione)
  INTO master
  FROM preventivatore.clienti_master cm
  WHERE cm.ragione_sociale ILIKE '%' || p_ragione || '%' AND cm.attivo
    AND (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  LIMIT 20;

  SELECT jsonb_agg(jsonb_build_object(
    'codice', d.codice, 'cliente_doc', d.cliente, 'anno', d.anno, 'categoria', d.categoria,
    'stato', d.stato, 'importo_preventivo', d.importo_preventivo, 'importo_ordinato', d.importo_ordinato,
    'data_offerta', d.data_offerta, 'numero_offerta', d.numero_offerta
  ) ORDER BY d.anno DESC NULLS LAST, d.codice DESC)
  INTO ultimi
  FROM (
    SELECT d.* FROM preventivatore.documenti d
    LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
    WHERE COALESCE(cm.ragione_sociale, d.cliente) ILIKE '%' || p_ragione || '%'
      AND (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
    ORDER BY d.anno DESC NULLS LAST, d.codice DESC LIMIT p_limit_preventivi
  ) d;

  SELECT jsonb_build_object(
    'n_preventivi_totali', COUNT(*),
    'n_ordinati', COUNT(*) FILTER (WHERE d.stato IN ('ordinato','ordinata')),
    'n_falliti', COUNT(*) FILTER (WHERE d.stato IN ('rifiutato','fallita')),
    'valore_totale', ROUND(COALESCE(SUM(d.importo_preventivo), 0), 2),
    'importo_medio', ROUND(COALESCE(AVG(d.importo_preventivo), 0), 2),
    'hit_rate_pct', CASE WHEN COUNT(*) FILTER (WHERE d.stato IN ('ordinato','ordinata','rifiutato','fallita')) > 0
      THEN ROUND(100.0 * COUNT(*) FILTER (WHERE d.stato IN ('ordinato','ordinata'))
        / NULLIF(COUNT(*) FILTER (WHERE d.stato IN ('ordinato','ordinata','rifiutato','fallita')), 0), 1) ELSE NULL END
  ) INTO stats
  FROM preventivatore.documenti d
  LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
  WHERE COALESCE(cm.ragione_sociale, d.cliente) ILIKE '%' || p_ragione || '%'
    AND (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'));

  RETURN jsonb_build_object('master', COALESCE(master,'[]'::jsonb),
    'ultimi_preventivi', COALESCE(ultimi,'[]'::jsonb), 'stats', COALESCE(stats,'{}'::jsonb));
END;
$function$;

-- ── analisi_margini ─────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS preventivatore.analisi_margini(text, text, integer, integer);
CREATE OR REPLACE FUNCTION preventivatore.analisi_margini(p_cliente text DEFAULT NULL, p_categoria text DEFAULT NULL, p_anno integer DEFAULT NULL, p_limit integer DEFAULT 50, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(cliente text, categoria text, n_preventivi bigint, n_ordinati bigint, importo_prev_medio numeric, importo_ord_medio numeric, scostamento_pct numeric, ricarico_medio_distinta numeric)
 LANGUAGE sql STABLE
AS $function$
  SELECT COALESCE(cm.ragione_sociale, d.cliente), COALESCE(d.categoria, '(senza categoria)'),
    COUNT(*), COUNT(*) FILTER (WHERE d.stato IN ('ordinato','ordinata')),
    ROUND(AVG(d.importo_preventivo), 2), ROUND(AVG(d.importo_ordinato), 2),
    ROUND(AVG(CASE WHEN d.importo_preventivo > 0 AND d.importo_ordinato > 0
      THEN ((d.importo_ordinato - d.importo_preventivo) / d.importo_preventivo) * 100 ELSE NULL END), 2),
    ROUND((SELECT AVG(r.ricarico_coefficiente) FROM preventivatore.righe_distinta r
           WHERE r.documento_id = ANY(array_agg(d.id)) AND r.tipo_riga='materiale' AND r.ricarico_coefficiente > 0), 3)
  FROM preventivatore.documenti d
  LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
  WHERE (p_cliente IS NULL OR COALESCE(cm.ragione_sociale, d.cliente) ILIKE '%' || p_cliente || '%')
    AND (p_categoria IS NULL OR d.categoria ILIKE '%' || p_categoria || '%')
    AND (p_anno IS NULL OR d.anno = p_anno)
    AND (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  GROUP BY 1, 2 HAVING COUNT(*) > 0
  ORDER BY 7 DESC NULLS LAST, 3 DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$function$;

-- ── hit_rate ────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS preventivatore.hit_rate(text, text, integer, integer);
CREATE OR REPLACE FUNCTION preventivatore.hit_rate(p_cliente text DEFAULT NULL, p_categoria text DEFAULT NULL, p_mesi integer DEFAULT 24, p_limit integer DEFAULT 30, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(cliente text, categoria text, n_preventivi bigint, n_ordinati bigint, n_falliti bigint, n_pending bigint, hit_rate_pct numeric, valore_ordinato numeric)
 LANGUAGE sql STABLE
AS $function$
  WITH base AS (
    SELECT d.id, d.stato, d.importo_ordinato,
      COALESCE(cm.ragione_sociale, d.cliente) AS cliente, COALESCE(d.categoria, '(senza categoria)') AS categoria,
      CASE WHEN d.data_offerta ~ '^\d{4}-\d{2}-\d{2}' THEN d.data_offerta::date
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(d.data_offerta, 'DD/MM/YY')
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(d.data_offerta, 'DD/MM/YYYY') ELSE NULL END AS data_p
    FROM preventivatore.documenti d
    LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
    WHERE (p_cliente IS NULL OR COALESCE(cm.ragione_sociale, d.cliente) ILIKE '%' || p_cliente || '%')
      AND (p_categoria IS NULL OR d.categoria ILIKE '%' || p_categoria || '%')
      AND (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  )
  SELECT cliente, categoria, COUNT(*),
    COUNT(*) FILTER (WHERE stato IN ('ordinato','ordinata')),
    COUNT(*) FILTER (WHERE stato IN ('rifiutato','fallita')),
    COUNT(*) FILTER (WHERE stato NOT IN ('ordinato','ordinata','rifiutato','fallita')),
    CASE WHEN COUNT(*) FILTER (WHERE stato IN ('ordinato','ordinata','rifiutato','fallita')) > 0
      THEN ROUND(100.0 * COUNT(*) FILTER (WHERE stato IN ('ordinato','ordinata'))
        / NULLIF(COUNT(*) FILTER (WHERE stato IN ('ordinato','ordinata','rifiutato','fallita')), 0), 1) ELSE NULL END,
    ROUND(COALESCE(SUM(importo_ordinato) FILTER (WHERE stato IN ('ordinato','ordinata')), 0), 2)
  FROM base
  WHERE data_p IS NULL OR data_p >= (NOW() - (p_mesi || ' months')::interval)::date
  GROUP BY cliente, categoria ORDER BY 3 DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$function$;

-- ── articoli_associati ──────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS preventivatore.articoli_associati(text, integer, integer);
CREATE OR REPLACE FUNCTION preventivatore.articoli_associati(p_codice text, p_min_freq integer DEFAULT 2, p_limit integer DEFAULT 20, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(codice_articolo text, descrizione_tipica text, frequenza bigint, documenti_target bigint, pct_associazione numeric)
 LANGUAGE sql STABLE
AS $function$
  WITH doc_target AS (
    SELECT DISTINCT r.documento_id
    FROM preventivatore.righe_distinta r
    JOIN preventivatore.documenti d ON d.id = r.documento_id
    LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
    WHERE r.codice_articolo = p_codice AND r.tipo_riga = 'materiale'
      AND (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  ),
  n_target AS (SELECT COUNT(*) AS n FROM doc_target)
  SELECT r.codice_articolo,
    (array_agg(r.descrizione ORDER BY length(r.descrizione) DESC))[1],
    COUNT(DISTINCT r.documento_id), (SELECT n FROM n_target),
    ROUND(100.0 * COUNT(DISTINCT r.documento_id) / NULLIF((SELECT n FROM n_target), 0), 1)
  FROM preventivatore.righe_distinta r
  JOIN doc_target dt ON dt.documento_id = r.documento_id
  WHERE r.codice_articolo IS NOT NULL AND r.codice_articolo <> p_codice AND r.tipo_riga = 'materiale'
  GROUP BY r.codice_articolo HAVING COUNT(DISTINCT r.documento_id) >= p_min_freq
  ORDER BY 3 DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$function$;

-- ── storia_prezzi_articolo ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS preventivatore.storia_prezzi_articolo(text, integer);
CREATE OR REPLACE FUNCTION preventivatore.storia_prezzi_articolo(p_codice text, p_anni integer DEFAULT 5, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(fonte text, anno integer, data_riferimento date, documento_codice text, cliente text, prezzo_unitario numeric, quantita numeric, totale_riga numeric, ricarico_coeff numeric)
 LANGUAGE sql STABLE
AS $function$
  SELECT 'anagrafica'::text, EXTRACT(YEAR FROM data_ult_costo)::int, data_ult_costo,
    NULL::text, NULL::text, ult_costo, NULL::numeric, NULL::numeric, NULL::numeric
  FROM preventivatore.prodotti
  WHERE codice = p_codice AND ult_costo IS NOT NULL
  UNION ALL
  SELECT 'distinta'::text, d.anno, NULLIF(d.data_offerta, '')::date, d.codice,
    COALESCE(cm.ragione_sociale, d.cliente), r.prezzo_unitario, r.quantita, r.totale_riga, r.ricarico_coefficiente
  FROM preventivatore.righe_distinta r
  JOIN preventivatore.documenti d ON d.id = r.documento_id
  LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
  WHERE r.codice_articolo = p_codice AND r.tipo_riga = 'materiale'
    AND d.anno >= EXTRACT(YEAR FROM NOW())::int - p_anni
    AND (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  ORDER BY 2 DESC NULLS LAST, 3 DESC NULLS LAST
  LIMIT 100;
$function$;
