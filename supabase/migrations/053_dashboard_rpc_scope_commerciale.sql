-- Migration 053: scoping commerciale completo sulle RPC dashboard.
-- Aggiunge p_agente_codice (DEFAULT NULL) a kpi/serie_mensile/serie_categoria/
-- top_articoli/attivita_recente. Quando valorizzato, filtra ai clienti dell'agente
-- (+ AIRFLUID); quando NULL → comportamento globale invariato (admin/back_office).
-- (dashboard_top_clienti ha già il parametro dalla migr. precedente.)

DROP FUNCTION IF EXISTS preventivatore.dashboard_kpi(integer);
CREATE OR REPLACE FUNCTION preventivatore.dashboard_kpi(window_months integer DEFAULT 12, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(tot_preventivi bigint, valore_totale numeric, importo_medio numeric, clienti_attivi bigint, tot_ordinati bigint, tot_rifiutati bigint, tot_pending bigint, tot_preventivi_prec bigint, valore_totale_prec numeric, importo_medio_prec numeric, clienti_attivi_prec bigint)
 LANGUAGE sql STABLE
AS $function$
  WITH bounds AS (
    SELECT
      (NOW() - (window_months || ' months')::interval)::timestamptz AS curr_start,
      (NOW() - ((window_months * 2) || ' months')::interval)::timestamptz AS prev_start,
      (NOW() - (window_months || ' months')::interval)::timestamptz AS prev_end
  ),
  parsed AS (
    SELECT d.*,
      CASE
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(d.data_offerta, 'DD/MM/YY')
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(d.data_offerta, 'DD/MM/YYYY')
        ELSE NULL END::timestamptz AS data_parsed
    FROM preventivatore.documenti d
    LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
    WHERE (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  ),
  curr AS (SELECT * FROM parsed, bounds WHERE data_parsed >= bounds.curr_start),
  prev AS (SELECT * FROM parsed, bounds WHERE data_parsed >= bounds.prev_start AND data_parsed < bounds.prev_end)
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
$function$;

DROP FUNCTION IF EXISTS preventivatore.dashboard_serie_mensile(integer);
CREATE OR REPLACE FUNCTION preventivatore.dashboard_serie_mensile(months integer DEFAULT 12, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(mese date, preventivi bigint, valore numeric, ordinati bigint)
 LANGUAGE sql STABLE
AS $function$
  WITH parsed AS (
    SELECT d.importo_preventivo, d.stato,
      CASE
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(d.data_offerta, 'DD/MM/YY')
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(d.data_offerta, 'DD/MM/YYYY')
        ELSE NULL END::timestamptz AS data_parsed
    FROM preventivatore.documenti d
    LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
    WHERE (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  ),
  serie AS (
    SELECT generate_series(
      date_trunc('month', NOW() - ((months - 1) || ' months')::interval),
      date_trunc('month', NOW()), '1 month'::interval)::date AS mese
  )
  SELECT s.mese, COUNT(p.data_parsed), COALESCE(SUM(p.importo_preventivo), 0),
         COUNT(*) FILTER (WHERE p.stato = 'ordinato')
  FROM serie s
  LEFT JOIN parsed p ON date_trunc('month', p.data_parsed)::date = s.mese
  GROUP BY s.mese ORDER BY s.mese ASC;
$function$;

DROP FUNCTION IF EXISTS preventivatore.dashboard_serie_mensile_categoria(integer);
CREATE OR REPLACE FUNCTION preventivatore.dashboard_serie_mensile_categoria(months integer DEFAULT 12, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(mese date, categoria text, preventivi bigint, valore numeric)
 LANGUAGE sql STABLE
AS $function$
  WITH parsed AS (
    SELECT COALESCE(NULLIF(d.categoria, ''), 'altro') AS categoria, d.importo_preventivo,
      CASE
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{2}$' THEN to_date(d.data_offerta, 'DD/MM/YY')
        WHEN d.data_offerta ~ '^\d{2}/\d{2}/\d{4}$' THEN to_date(d.data_offerta, 'DD/MM/YYYY')
        ELSE NULL END::timestamptz AS data_parsed
    FROM preventivatore.documenti d
    LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
    WHERE (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  )
  SELECT date_trunc('month', p.data_parsed)::date AS mese, p.categoria, COUNT(*),
         COALESCE(SUM(p.importo_preventivo), 0)
  FROM parsed p
  WHERE p.data_parsed >= date_trunc('month', NOW() - ((months - 1) || ' months')::interval)
    AND p.data_parsed < date_trunc('month', NOW() + '1 month'::interval)
  GROUP BY date_trunc('month', p.data_parsed)::date, p.categoria
  ORDER BY 1 ASC, 3 DESC, 2 ASC;
$function$;

DROP FUNCTION IF EXISTS preventivatore.dashboard_top_articoli(integer);
CREATE OR REPLACE FUNCTION preventivatore.dashboard_top_articoli(limit_n integer DEFAULT 5, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(codice_articolo text, descrizione text, occorrenze bigint, qta_totale numeric, valore_totale numeric)
 LANGUAGE sql STABLE
AS $function$
  SELECT rd.codice_articolo,
    (array_agg(rd.descrizione ORDER BY rd.created_at DESC))[1] AS descrizione,
    COUNT(*) AS occorrenze, COALESCE(SUM(rd.quantita), 0), COALESCE(SUM(rd.totale_riga), 0)
  FROM preventivatore.righe_distinta rd
  JOIN preventivatore.documenti d ON d.id = rd.documento_id
  LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
  WHERE rd.codice_articolo IS NOT NULL AND rd.codice_articolo <> ''
    AND (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  GROUP BY rd.codice_articolo
  ORDER BY occorrenze DESC, valore_totale DESC
  LIMIT limit_n;
$function$;

DROP FUNCTION IF EXISTS preventivatore.dashboard_attivita_recente(integer);
CREATE OR REPLACE FUNCTION preventivatore.dashboard_attivita_recente(limit_n integer DEFAULT 6, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(id uuid, codice text, cliente text, stato text, tipo text, importo numeric, data_offerta text, created_at timestamp with time zone)
 LANGUAGE sql STABLE
AS $function$
  SELECT d.id, d.codice, d.cliente, d.stato, d.tipo, d.importo_preventivo, d.data_offerta, d.created_at
  FROM preventivatore.documenti d
  LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
  WHERE (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  ORDER BY d.created_at DESC
  LIMIT limit_n;
$function$;
