-- ============================================================
-- Migration 029 - Dashboard serie mensile per categoria
-- ============================================================
-- Dati per il grafico a colonne impilate della dashboard preventivatore.
-- ============================================================

CREATE OR REPLACE FUNCTION preventivatore.dashboard_serie_mensile_categoria(months int DEFAULT 12)
RETURNS TABLE (
  mese        date,
  categoria   text,
  preventivi  bigint,
  valore      numeric
)
LANGUAGE sql STABLE
AS $$
  WITH parsed AS (
    SELECT
      COALESCE(NULLIF(d.categoria, ''), 'altro') AS categoria,
      d.importo_preventivo,
      CASE
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(d.data_offerta, 'DD/MM/YY')
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(d.data_offerta, 'DD/MM/YYYY')
        ELSE NULL
      END::timestamptz AS data_parsed
    FROM preventivatore.documenti d
  )
  SELECT
    date_trunc('month', p.data_parsed)::date AS mese,
    p.categoria,
    COUNT(*) AS preventivi,
    COALESCE(SUM(p.importo_preventivo), 0) AS valore
  FROM parsed p
  WHERE p.data_parsed >= date_trunc('month', NOW() - ((months - 1) || ' months')::interval)
    AND p.data_parsed < date_trunc('month', NOW() + '1 month'::interval)
  GROUP BY date_trunc('month', p.data_parsed)::date, p.categoria
  ORDER BY mese ASC, preventivi DESC, categoria ASC;
$$;

GRANT EXECUTE ON FUNCTION preventivatore.dashboard_serie_mensile_categoria(int) TO authenticated;
