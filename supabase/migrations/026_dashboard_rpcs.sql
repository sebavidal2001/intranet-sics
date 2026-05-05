-- Dashboard preventivatore RPCs.
-- Tutte parsano data_offerta (text dd/mm/yy o dd/mm/yyyy) via to_date.
-- Quando arriverà master_data.clienti potremo sostituire il GROUP BY su
-- cliente (text normalizzato) con un JOIN su cliente_id mantenendo le firme.

-- ─── KPI globali con confronto periodo precedente ────────────────────────────
CREATE OR REPLACE FUNCTION preventivatore.dashboard_kpi(window_months int DEFAULT 12)
RETURNS TABLE (
  tot_preventivi      bigint,
  valore_totale       numeric,
  importo_medio       numeric,
  clienti_attivi      bigint,
  tot_ordinati        bigint,
  tot_rifiutati       bigint,
  tot_pending         bigint,
  tot_preventivi_prec bigint,
  valore_totale_prec  numeric,
  importo_medio_prec  numeric,
  clienti_attivi_prec bigint
)
LANGUAGE sql STABLE
AS $$
  WITH bounds AS (
    SELECT
      (NOW() - (window_months || ' months')::interval)::timestamptz AS curr_start,
      (NOW() - ((window_months * 2) || ' months')::interval)::timestamptz AS prev_start,
      (NOW() - (window_months || ' months')::interval)::timestamptz AS prev_end
  ),
  parsed AS (
    SELECT
      d.*,
      CASE
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(d.data_offerta, 'DD/MM/YY')
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(d.data_offerta, 'DD/MM/YYYY')
        ELSE NULL
      END::timestamptz AS data_parsed
    FROM preventivatore.documenti d
  ),
  curr AS (
    SELECT *
    FROM parsed, bounds
    WHERE data_parsed >= bounds.curr_start
  ),
  prev AS (
    SELECT *
    FROM parsed, bounds
    WHERE data_parsed >= bounds.prev_start AND data_parsed < bounds.prev_end
  )
  SELECT
    (SELECT COUNT(*) FROM curr),
    (SELECT COALESCE(SUM(importo_preventivo), 0) FROM curr),
    (SELECT COALESCE(AVG(importo_preventivo), 0) FROM curr WHERE importo_preventivo IS NOT NULL),
    (SELECT COUNT(DISTINCT lower(trim(cliente))) FROM curr WHERE cliente IS NOT NULL),
    (SELECT COUNT(*) FROM curr WHERE stato = 'ordinato'),
    (SELECT COUNT(*) FROM curr WHERE stato = 'rifiutato'),
    (SELECT COUNT(*) FROM curr WHERE stato = 'pending'),
    (SELECT COUNT(*) FROM prev),
    (SELECT COALESCE(SUM(importo_preventivo), 0) FROM prev),
    (SELECT COALESCE(AVG(importo_preventivo), 0) FROM prev WHERE importo_preventivo IS NOT NULL),
    (SELECT COUNT(DISTINCT lower(trim(cliente))) FROM prev WHERE cliente IS NOT NULL);
$$;

-- ─── Top clienti per valore + count ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION preventivatore.dashboard_top_clienti(
  limit_n        int DEFAULT 5,
  window_months  int DEFAULT 12
)
RETURNS TABLE (
  cliente            text,
  preventivi_count   bigint,
  valore_totale      numeric,
  ordinati_count     bigint
)
LANGUAGE sql STABLE
AS $$
  WITH parsed AS (
    SELECT
      d.cliente,
      d.importo_preventivo,
      d.stato,
      CASE
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(d.data_offerta, 'DD/MM/YY')
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(d.data_offerta, 'DD/MM/YYYY')
        ELSE NULL
      END::timestamptz AS data_parsed
    FROM preventivatore.documenti d
    WHERE d.cliente IS NOT NULL
  )
  SELECT
    (array_agg(cliente ORDER BY cliente))[1] AS cliente,
    COUNT(*) AS preventivi_count,
    COALESCE(SUM(importo_preventivo), 0) AS valore_totale,
    COUNT(*) FILTER (WHERE stato = 'ordinato') AS ordinati_count
  FROM parsed
  WHERE data_parsed >= (NOW() - (window_months || ' months')::interval)::timestamptz
  GROUP BY lower(trim(cliente))
  ORDER BY valore_totale DESC, preventivi_count DESC
  LIMIT limit_n;
$$;

-- ─── Serie mensile per bar chart e sparkline ─────────────────────────────────
CREATE OR REPLACE FUNCTION preventivatore.dashboard_serie_mensile(months int DEFAULT 12)
RETURNS TABLE (
  mese          date,
  preventivi    bigint,
  valore        numeric,
  ordinati      bigint
)
LANGUAGE sql STABLE
AS $$
  WITH parsed AS (
    SELECT
      d.importo_preventivo,
      d.stato,
      CASE
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(d.data_offerta, 'DD/MM/YY')
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(d.data_offerta, 'DD/MM/YYYY')
        ELSE NULL
      END::timestamptz AS data_parsed
    FROM preventivatore.documenti d
  ),
  serie AS (
    SELECT generate_series(
      date_trunc('month', NOW() - ((months - 1) || ' months')::interval),
      date_trunc('month', NOW()),
      '1 month'::interval
    )::date AS mese
  )
  SELECT
    s.mese,
    COUNT(p.data_parsed) AS preventivi,
    COALESCE(SUM(p.importo_preventivo), 0) AS valore,
    COUNT(*) FILTER (WHERE p.stato = 'ordinato') AS ordinati
  FROM serie s
  LEFT JOIN parsed p
    ON date_trunc('month', p.data_parsed)::date = s.mese
  GROUP BY s.mese
  ORDER BY s.mese ASC;
$$;

-- ─── Top articoli (codice) per occorrenze in distinta ────────────────────────
CREATE OR REPLACE FUNCTION preventivatore.dashboard_top_articoli(limit_n int DEFAULT 5)
RETURNS TABLE (
  codice_articolo  text,
  descrizione      text,
  occorrenze       bigint,
  qta_totale       numeric,
  valore_totale    numeric
)
LANGUAGE sql STABLE
AS $$
  SELECT
    rd.codice_articolo,
    (array_agg(rd.descrizione ORDER BY rd.created_at DESC))[1] AS descrizione,
    COUNT(*) AS occorrenze,
    COALESCE(SUM(rd.quantita), 0) AS qta_totale,
    COALESCE(SUM(rd.totale_riga), 0) AS valore_totale
  FROM preventivatore.righe_distinta rd
  WHERE rd.codice_articolo IS NOT NULL AND rd.codice_articolo <> ''
  GROUP BY rd.codice_articolo
  ORDER BY occorrenze DESC, valore_totale DESC
  LIMIT limit_n;
$$;

-- ─── Attività recente ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION preventivatore.dashboard_attivita_recente(limit_n int DEFAULT 6)
RETURNS TABLE (
  id            uuid,
  codice        text,
  cliente       text,
  stato         text,
  tipo          text,
  importo       numeric,
  data_offerta  text,
  created_at    timestamptz
)
LANGUAGE sql STABLE
AS $$
  SELECT id, codice, cliente, stato, tipo, importo_preventivo, data_offerta, created_at
  FROM preventivatore.documenti
  ORDER BY created_at DESC
  LIMIT limit_n;
$$;

GRANT EXECUTE ON FUNCTION preventivatore.dashboard_kpi(int) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.dashboard_top_clienti(int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.dashboard_serie_mensile(int) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.dashboard_top_articoli(int) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.dashboard_attivita_recente(int) TO authenticated;
