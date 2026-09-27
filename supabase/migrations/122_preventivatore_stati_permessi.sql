-- Migration 122: stati definitivi del portale e salvataggio atomico permessi.

BEGIN;

DO $block$
DECLARE
  v_fuori_elenco bigint;
  v_constraint record;
BEGIN
  SELECT count(*) INTO v_fuori_elenco
  FROM preventivatore.documenti
  WHERE stato IS NULL OR stato NOT IN ('storico', 'aperta', 'completato');

  IF v_fuori_elenco > 0 THEN
    RAISE EXCEPTION
      'Impossibile restringere documenti.stato: trovate % righe fuori da storico/aperta/completato',
      v_fuori_elenco;
  END IF;

  FOR v_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'preventivatore.documenti'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%stato%'
  LOOP
    EXECUTE format(
      'ALTER TABLE preventivatore.documenti DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;
END;
$block$;

ALTER TABLE preventivatore.documenti
  ADD CONSTRAINT documenti_stato_check
  CHECK (stato IN ('storico', 'aperta', 'completato'));

DROP TABLE IF EXISTS preventivatore.query_log;

COMMENT ON COLUMN preventivatore.documenti.validazione_tecnica_il IS 'deprecata: workflow rimosso (migration 111)';
COMMENT ON COLUMN preventivatore.documenti.validazione_tecnica_da IS 'deprecata: workflow rimosso (migration 111)';
COMMENT ON COLUMN preventivatore.documenti.validazione_economica_il IS 'deprecata: workflow rimosso (migration 111)';
COMMENT ON COLUMN preventivatore.documenti.validazione_economica_da IS 'deprecata: workflow rimosso (migration 111)';
COMMENT ON COLUMN preventivatore.documenti.audit_hash IS 'deprecata: workflow rimosso (migration 111)';
COMMENT ON COLUMN preventivatore.documenti.importo_offerta IS 'deprecata: workflow rimosso (migration 111)';
COMMENT ON COLUMN preventivatore.documenti.note_offerta IS 'deprecata: workflow rimosso (migration 111)';
COMMENT ON COLUMN preventivatore.documenti.motivo_rifiuto_id IS 'deprecata: workflow rimosso (migration 111)';
COMMENT ON COLUMN preventivatore.documenti.importo_ordinato IS 'deprecata: workflow rimosso (migration 111)';
COMMENT ON COLUMN preventivatore.blocchi.incluso_offerta IS 'deprecata: workflow rimosso (migration 111)';

CREATE OR REPLACE FUNCTION preventivatore.salva_permessi_utente(
  p_utente uuid,
  p_codice_agente text,
  p_ruoli text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = preventivatore, public, pg_temp
AS $function$
DECLARE
  v_slug text;
BEGIN
  IF p_utente IS NULL THEN
    RAISE EXCEPTION 'utente_mancante';
  END IF;

  FOREACH v_slug IN ARRAY coalesce(p_ruoli, array[]::text[])
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM preventivatore.ruoli_funzionali rf
      WHERE rf.slug = v_slug AND rf.is_attivo
    ) THEN
      RAISE EXCEPTION 'ruolo_non_valido: %', v_slug;
    END IF;
  END LOOP;

  UPDATE public.utenti
  SET preventivatore_agente_codice = nullif(btrim(p_codice_agente), '')
  WHERE id = p_utente;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'utente_non_trovato';
  END IF;

  DELETE FROM preventivatore.utente_ruoli_funzionali
  WHERE utente_id = p_utente;

  INSERT INTO preventivatore.utente_ruoli_funzionali (utente_id, ruolo_id, assegnato_il)
  SELECT p_utente, rf.id, now()
  FROM preventivatore.ruoli_funzionali rf
  JOIN (
    SELECT DISTINCT unnest(coalesce(p_ruoli, array[]::text[])) AS slug
  ) richiesti ON richiesti.slug = rf.slug;
END;
$function$;

REVOKE ALL ON FUNCTION preventivatore.salva_permessi_utente(uuid, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.salva_permessi_utente(uuid, text, text[]) TO service_role;

-- La firma resta invariata per i client esistenti. I tre contatori finali ora
-- significano: definitivi, residuo sempre zero, bozze aperte.
CREATE OR REPLACE FUNCTION preventivatore.dashboard_kpi(
  window_months integer DEFAULT 12,
  p_agente_codice text DEFAULT NULL
)
RETURNS TABLE(
  tot_preventivi bigint,
  valore_totale numeric,
  importo_medio numeric,
  clienti_attivi bigint,
  tot_ordinati bigint,
  tot_rifiutati bigint,
  tot_pending bigint,
  tot_preventivi_prec bigint,
  valore_totale_prec numeric,
  importo_medio_prec numeric,
  clienti_attivi_prec bigint
)
LANGUAGE sql
STABLE
AS $function$
  WITH bounds AS (
    SELECT
      now() - make_interval(months => window_months) AS curr_start,
      now() - make_interval(months => window_months * 2) AS prev_start
  ),
  parsed AS (
    SELECT d.*, preventivatore.data_documento(d.data_offerta, d.created_at, d.tipo) AS data_parsed
    FROM preventivatore.documenti d
    LEFT JOIN preventivatore.clienti_master cm ON cm.id = d.cliente_master_id
    WHERE p_agente_codice IS NULL OR cm.agente_codice IN (p_agente_codice, 'AIRFLUID')
  ),
  curr AS (
    SELECT parsed.* FROM parsed, bounds WHERE data_parsed >= curr_start
  ),
  prev AS (
    SELECT parsed.* FROM parsed, bounds
    WHERE data_parsed >= prev_start AND data_parsed < curr_start
  )
  SELECT
    (SELECT count(*) FROM curr),
    (SELECT coalesce(sum(importo_preventivo), 0) FROM curr),
    (SELECT coalesce(avg(importo_preventivo), 0) FROM curr WHERE importo_preventivo IS NOT NULL),
    (SELECT count(DISTINCT lower(trim(cliente))) FROM curr WHERE cliente IS NOT NULL),
    (SELECT count(*) FROM curr WHERE stato = 'completato'),
    0::bigint,
    (SELECT count(*) FROM curr WHERE stato = 'aperta'),
    (SELECT count(*) FROM prev),
    (SELECT coalesce(sum(importo_preventivo), 0) FROM prev),
    (SELECT coalesce(avg(importo_preventivo), 0) FROM prev WHERE importo_preventivo IS NOT NULL),
    (SELECT count(DISTINCT lower(trim(cliente))) FROM prev WHERE cliente IS NOT NULL);
$function$;

-- CREATE OR REPLACE conserva i GRANT esistenti: nessuna modifica ai permessi.

COMMIT;

NOTIFY pgrst, 'reload schema';
