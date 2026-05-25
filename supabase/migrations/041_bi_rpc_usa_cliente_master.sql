-- Migration 041: le RPC BI/Dashboard usano clienti_master.ragione_sociale invece
-- del testo legacy documenti.cliente. Risolve il problema dei doppi/varianti
-- (es. IMA SAFE / IMA-SAFE / IMA spa-div.SAFE sono ora la stessa entry "IMA spa").

-- ── dashboard_top_clienti ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION preventivatore.dashboard_top_clienti(
  limit_n integer DEFAULT 5,
  window_months integer DEFAULT 12
)
RETURNS TABLE(cliente text, preventivi_count bigint, valore_totale numeric, ordinati_count bigint)
LANGUAGE sql
STABLE
AS $function$
  WITH parsed AS (
    SELECT
      COALESCE(cm.ragione_sociale, d.cliente) AS cliente,
      d.importo_preventivo,
      d.stato,
      CASE
        WHEN d.data_offerta ~ '^\d{4}-\d{2}-\d{2}' THEN d.data_offerta::date
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(d.data_offerta, 'DD/MM/YY')
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(d.data_offerta, 'DD/MM/YYYY')
        ELSE NULL
      END::timestamptz AS data_parsed
    FROM preventivatore.documenti d
    LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
    WHERE COALESCE(cm.ragione_sociale, d.cliente) IS NOT NULL
  )
  SELECT
    cliente,
    COUNT(*) AS preventivi_count,
    COALESCE(SUM(importo_preventivo), 0) AS valore_totale,
    COUNT(*) FILTER (WHERE stato IN ('ordinato','ordinata')) AS ordinati_count
  FROM parsed
  WHERE data_parsed >= (NOW() - (window_months || ' months')::interval)::timestamptz
  GROUP BY cliente
  ORDER BY valore_totale DESC, preventivi_count DESC
  LIMIT limit_n;
$function$;

-- ── ai_statistiche_per_cliente ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION preventivatore.ai_statistiche_per_cliente(
  p_anno integer DEFAULT NULL,
  p_stato text DEFAULT NULL,
  p_categoria text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE(
  cliente text,
  preventivi_count bigint,
  valore_totale numeric,
  importo_medio numeric,
  ordinati_count bigint,
  rifiutati_count bigint,
  pending_count bigint
)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    COALESCE(cm.ragione_sociale, d.cliente) AS cliente,
    COUNT(*) AS preventivi_count,
    ROUND(COALESCE(SUM(d.importo_preventivo), 0), 2) AS valore_totale,
    ROUND(COALESCE(AVG(d.importo_preventivo), 0), 2) AS importo_medio,
    COUNT(*) FILTER (WHERE d.stato IN ('ordinato','ordinata')) AS ordinati_count,
    COUNT(*) FILTER (WHERE d.stato IN ('rifiutato','fallita')) AS rifiutati_count,
    COUNT(*) FILTER (WHERE d.stato IN ('pending','storico','aperta','presa_in_carico','completato','inviata')) AS pending_count
  FROM preventivatore.documenti d
  LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
  WHERE COALESCE(cm.ragione_sociale, d.cliente) IS NOT NULL
    AND (p_anno IS NULL OR d.anno = p_anno)
    AND (p_stato IS NULL OR d.stato = p_stato)
    AND (p_categoria IS NULL OR d.categoria = p_categoria)
  GROUP BY COALESCE(cm.ragione_sociale, d.cliente)
  ORDER BY valore_totale DESC, preventivi_count DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$function$;

NOTIFY pgrst, 'reload schema';
