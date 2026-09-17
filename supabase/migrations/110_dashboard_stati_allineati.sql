-- Migration 110: la dashboard del Preventivatore smette di mentire.
--
-- ============================================================================
-- DUE DIFETTI, ENTRAMBI MISURATI SUL DB IL 17/09/2026
-- ============================================================================
--
-- 1) I PREVENTIVI DEL BUILDER NON ENTRAVANO IN DASHBOARD. Tutte le RPC della
--    dashboard datano il documento parsando `data_offerta`, che e' TESTO e
--    arriva dall'import V2. I preventivi creati dal builder hanno
--    `data_offerta IS NULL` (verificato: tutti e 3 i documenti `generato` del
--    DB di sviluppo), quindi `data_parsed` e' NULL e la WHERE sulla finestra
--    temporale li scartava tutti. La dashboard mostrava solo lo storico.
--
-- 2) GLI STATI ERANO FERMI ALLA V2. La migration 039 ha introdotto i sette
--    stati del workflow accanto ai tre legacy. Le RPC della BI (041) e dei
--    tool AI (055) sono state aggiornate a `IN ('ordinato','ordinata')`,
--    quelle della dashboard no: la 053, l'ultima a definirle, filtra ancora
--    `stato = 'ordinato'`. `dashboard_kpi(60)` rispondeva
--    `tot_preventivi 238, tot_ordinati 0, tot_rifiutati 0, tot_pending 0`,
--    e il portale mostrava due hit-rate diversi.
--
-- ============================================================================
-- COME SI RISOLVONO
-- ============================================================================
--
-- (1) Una funzione unica `preventivatore.data_documento(data_offerta, created_at, tipo)`:
--     prova a parsare `data_offerta` e, se non c'e', ripiega su `created_at`
--     **solo per i preventivi del builder** (`tipo = 'generato'`), dove
--     created_at e' davvero la data del preventivo. Per gli storici created_at
--     e' la data di import e il ripiego falserebbe tutto (vedi il commento
--     dentro la funzione). La logica di parsing era copiata a mano in cinque
--     funzioni con tre varianti diverse (solo `top_clienti` gestiva il formato
--     ISO): ora sta in un posto solo.
--
-- (2) Convenzione degli stati allineata a `src/lib/portali/preventivatore/stati.ts`:
--       ordinato    → 'ordinato'  (legacy) + 'ordinata' (workflow)
--       rifiutato   → 'rifiutato' (legacy) + 'fallita'  (workflow)
--       in lavoraz. → 'pending'   (legacy) + 'aperta' / 'presa_in_carico' /
--                     'completato' / 'inviata' (workflow)
--     `storico` resta fuori da tutti e tre: e' archivio, non pipeline.
--
-- > `tot_pending` cambia significato: prima "solo i pending legacy" (sempre 0),
-- > ora "preventivi vivi non ancora chiusi". E' il valore che la card della
-- > dashboard ha sempre inteso mostrare.

-- ── Helper condiviso ────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION preventivatore.data_documento(
  p_data_offerta text,
  p_created_at timestamptz,
  p_tipo text
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT COALESCE(
    CASE
      WHEN p_data_offerta ~ '^\d{4}-\d{2}-\d{2}'   THEN p_data_offerta::date
      WHEN p_data_offerta ~ '^\d{2}/\d{2}/\d{2}$'  THEN to_date(p_data_offerta, 'DD/MM/YY')
      WHEN p_data_offerta ~ '^\d{2}/\d{2}/\d{4}$'  THEN to_date(p_data_offerta, 'DD/MM/YYYY')
      ELSE NULL
    END::timestamptz,
    -- Il ripiego su `created_at` vale SOLO per i preventivi del builder, dove
    -- created_at e' davvero la data del preventivo. Per gli storici created_at
    -- e' la data di IMPORT: 144 documenti su 382 non hanno data_offerta e
    -- verrebbero tutti ammucchiati nel mese dell'import (verificato: il KPI a
    -- 12 mesi passava da 93 a 240 preventivi, con un picco finto ad aprile).
    -- Per loro la data resta ignota, come prima.
    CASE WHEN p_tipo = 'generato' THEN p_created_at ELSE NULL END
  );
$function$;

COMMENT ON FUNCTION preventivatore.data_documento(text, timestamptz, text) IS
  'Data di riferimento di un documento: data_offerta se parsabile (ISO, DD/MM/YY, DD/MM/YYYY), altrimenti created_at solo per tipo=generato. Vedi migration 110.';

-- La 2-arg non deve sopravvivere: senza il tipo il ripiego e' sbagliato.
DROP FUNCTION IF EXISTS preventivatore.data_documento(text, timestamptz);

-- ── dashboard_kpi ───────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS preventivatore.dashboard_kpi(integer, text);
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
    SELECT d.*, preventivatore.data_documento(d.data_offerta, d.created_at, d.tipo) AS data_parsed
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
    (SELECT COUNT(*) FROM curr WHERE stato IN ('ordinato', 'ordinata')),
    (SELECT COUNT(*) FROM curr WHERE stato IN ('rifiutato', 'fallita')),
    (SELECT COUNT(*) FROM curr WHERE stato IN ('pending', 'aperta', 'presa_in_carico', 'completato', 'inviata')),
    (SELECT COUNT(*) FROM prev),
    (SELECT COALESCE(SUM(importo_preventivo), 0) FROM prev),
    (SELECT COALESCE(AVG(importo_preventivo), 0) FROM prev WHERE importo_preventivo IS NOT NULL),
    (SELECT COUNT(DISTINCT lower(trim(cliente))) FROM prev WHERE cliente IS NOT NULL);
$function$;

COMMENT ON FUNCTION preventivatore.dashboard_kpi(integer, text) IS
  'KPI dashboard Preventivatore. Data da `data_documento` (include i preventivi del builder); stati su entrambe le generazioni. Vedi migration 110.';

-- ── dashboard_serie_mensile ─────────────────────────────────────────────────

DROP FUNCTION IF EXISTS preventivatore.dashboard_serie_mensile(integer, text);
CREATE OR REPLACE FUNCTION preventivatore.dashboard_serie_mensile(months integer DEFAULT 12, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(mese date, preventivi bigint, valore numeric, ordinati bigint)
 LANGUAGE sql STABLE
AS $function$
  WITH parsed AS (
    SELECT d.importo_preventivo, d.stato,
           preventivatore.data_documento(d.data_offerta, d.created_at, d.tipo) AS data_parsed
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
         COUNT(*) FILTER (WHERE p.stato IN ('ordinato', 'ordinata'))
  FROM serie s
  LEFT JOIN parsed p ON date_trunc('month', p.data_parsed)::date = s.mese
  GROUP BY s.mese ORDER BY s.mese ASC;
$function$;

-- ── dashboard_serie_mensile_categoria ───────────────────────────────────────

DROP FUNCTION IF EXISTS preventivatore.dashboard_serie_mensile_categoria(integer, text);
CREATE OR REPLACE FUNCTION preventivatore.dashboard_serie_mensile_categoria(months integer DEFAULT 12, p_agente_codice text DEFAULT NULL)
 RETURNS TABLE(mese date, categoria text, preventivi bigint, valore numeric)
 LANGUAGE sql STABLE
AS $function$
  WITH parsed AS (
    SELECT COALESCE(NULLIF(d.categoria, ''), 'altro') AS categoria, d.importo_preventivo,
           preventivatore.data_documento(d.data_offerta, d.created_at, d.tipo) AS data_parsed
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

-- ── dashboard_top_clienti ───────────────────────────────────────────────────
-- Nota: nel DB esistono DUE overload, quello a 2 argomenti della migration 041
-- e quello a 3 della 053. L'app chiama sempre il secondo (argomenti nominati,
-- `p_agente_codice` incluso). Non li unifico qui — togliere un overload e' una
-- rimozione che non posso verificare rispetto a eventuali consumatori esterni —
-- ma li allineo entrambi, cosi' non restano due comportamenti diversi in giro.
-- La deduplicazione, se la si vuole, e' una decisione a se'.

CREATE OR REPLACE FUNCTION preventivatore.dashboard_top_clienti(
  limit_n integer DEFAULT 5,
  window_months integer DEFAULT 12,
  p_agente_codice text DEFAULT NULL
)
RETURNS TABLE(cliente text, preventivi_count bigint, valore_totale numeric, ordinati_count bigint)
LANGUAGE sql STABLE
AS $function$
  WITH parsed AS (
    SELECT
      COALESCE(cm.ragione_sociale, d.cliente) AS cliente,
      d.importo_preventivo,
      d.stato,
      preventivatore.data_documento(d.data_offerta, d.created_at, d.tipo) AS data_parsed
    FROM preventivatore.documenti d
    LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
    WHERE COALESCE(cm.ragione_sociale, d.cliente) IS NOT NULL
      AND (p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID'))
  )
  SELECT cliente, COUNT(*) AS preventivi_count, COALESCE(SUM(importo_preventivo), 0),
         COUNT(*) FILTER (WHERE stato IN ('ordinato', 'ordinata'))
  FROM parsed
  WHERE data_parsed >= (NOW() - (window_months || ' months')::interval)::timestamptz
  GROUP BY cliente
  ORDER BY 3 DESC, 2 DESC
  LIMIT limit_n;
$function$;

-- L'overload a 2 argomenti (migration 041), allineato alla stessa convenzione.
CREATE OR REPLACE FUNCTION preventivatore.dashboard_top_clienti(
  limit_n integer DEFAULT 5,
  window_months integer DEFAULT 12
)
RETURNS TABLE(cliente text, preventivi_count bigint, valore_totale numeric, ordinati_count bigint)
LANGUAGE sql STABLE
AS $function$
  SELECT * FROM preventivatore.dashboard_top_clienti(limit_n, window_months, NULL::text);
$function$;

GRANT EXECUTE ON FUNCTION preventivatore.data_documento(text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.dashboard_top_clienti(integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.dashboard_top_clienti(integer, integer) TO authenticated;
