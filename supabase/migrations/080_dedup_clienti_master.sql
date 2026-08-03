-- Migration 080: deduplica anagrafica clienti_master
--
-- Il Cruscotto Dinamico esporta una riga per ogni `Id Destinazione` del
-- gestionale, e per la stessa sede fisica ne esistono più d'uno creati negli
-- anni: ALPHAMAC srl (05006264) compare 4 volte con destinazione, CAP e località
-- identici e id_destinazione 2702/2884/2984/9921. In totale 487 gruppi per 604
-- righe in eccesso su 5.699. Effetti: autocomplete clienti con voci ripetute e
-- preventivi dello stesso cliente agganciati a righe master diverse (IMA usa 6
-- righe, WALVOIL 4).
--
-- Strategia: NON si cancella nulla (documenti.cliente_master_id ha ON DELETE SET
-- NULL: una DELETE scollegherebbe i preventivi). Si elegge una riga canonica per
-- gruppo e le altre restano in tabella marcate come alias via `duplicato_di`.
-- I consumer (autocomplete, scope commerciale) filtrano `duplicato_di IS NULL`.

-- ── A. Colonna alias ────────────────────────────────────────────────────────
ALTER TABLE preventivatore.clienti_master
  ADD COLUMN IF NOT EXISTS duplicato_di UUID REFERENCES preventivatore.clienti_master(id) ON DELETE SET NULL;

COMMENT ON COLUMN preventivatore.clienti_master.duplicato_di IS
  'NULL = riga canonica. Valorizzata = alias della riga canonica indicata (stesso codice_cliente, destinazione, CAP e località, id_destinazione diverso).';

CREATE INDEX IF NOT EXISTS clienti_master_duplicato_di ON preventivatore.clienti_master(duplicato_di);

-- ── B. RPC di deduplica, idempotente ────────────────────────────────────────
-- Rieseguibile: la chiama scripts/import-clienti-cruscotto.cjs in coda a ogni
-- import, altrimenti il cron settimanale ripristinerebbe i doppioni dal file.
CREATE OR REPLACE FUNCTION preventivatore.dedup_clienti_master()
RETURNS TABLE(alias_marcati integer, canonici integer, documenti_ripuntati integer)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_alias   integer := 0;
  v_canon   integer := 0;
  v_doc     integer := 0;
BEGIN
  -- Riga canonica per gruppo (codice_cliente + destinazione + CAP + località,
  -- normalizzati). Preferisce quella già usata dai preventivi, poi
  -- l'id_destinazione numerico più basso (il più vecchio del gestionale).
  DROP TABLE IF EXISTS _dedup;  -- tollera due chiamate nella stessa transazione
  CREATE TEMP TABLE _dedup ON COMMIT DROP AS
  WITH base AS (
    SELECT
      cm.id,
      cm.codice_cliente,
      upper(regexp_replace(coalesce(cm.destinazione, ''), '\s+', ' ', 'g')) AS dest_norm,
      coalesce(cm.cap, '')                                                  AS cap_norm,
      upper(coalesce(cm.localita, ''))                                      AS loc_norm,
      cm.id_destinazione,
      (SELECT count(*) FROM preventivatore.documenti d WHERE d.cliente_master_id = cm.id) AS n_doc
    FROM preventivatore.clienti_master cm
  )
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY codice_cliente, dest_norm, cap_norm, loc_norm
      ORDER BY
        n_doc DESC,
        (id_destinazione ~ '^\d+$') DESC,
        nullif(regexp_replace(coalesce(id_destinazione, ''), '\D', '', 'g'), '')::numeric ASC NULLS LAST,
        id_destinazione ASC NULLS LAST,
        id ASC
    ) AS canonical_id
  FROM base;

  -- Alias → puntano alla canonica
  UPDATE preventivatore.clienti_master cm
  SET duplicato_di = d.canonical_id
  FROM _dedup d
  WHERE cm.id = d.id
    AND d.canonical_id <> d.id
    AND cm.duplicato_di IS DISTINCT FROM d.canonical_id;
  GET DIAGNOSTICS v_alias = ROW_COUNT;

  -- Canoniche → duplicato_di sempre NULL (ripulisce stati vecchi se il gruppo cambia)
  UPDATE preventivatore.clienti_master cm
  SET duplicato_di = NULL
  FROM _dedup d
  WHERE cm.id = d.id
    AND d.canonical_id = d.id
    AND cm.duplicato_di IS NOT NULL;
  GET DIAGNOSTICS v_canon = ROW_COUNT;

  -- Preventivi agganciati a un alias → spostati sulla canonica
  UPDATE preventivatore.documenti doc
  SET cliente_master_id = d.canonical_id
  FROM _dedup d
  WHERE doc.cliente_master_id = d.id
    AND d.canonical_id <> d.id;
  GET DIAGNOSTICS v_doc = ROW_COUNT;

  RETURN QUERY SELECT v_alias, v_canon, v_doc;
END;
$function$;

COMMENT ON FUNCTION preventivatore.dedup_clienti_master() IS
  'Elegge una riga canonica per ogni gruppo di destinazioni identiche, marca le altre come alias (duplicato_di) e sposta i preventivi sulla canonica. Idempotente: da chiamare dopo ogni import del Cruscotto.';

-- ── C. Prima esecuzione ─────────────────────────────────────────────────────
SELECT * FROM preventivatore.dedup_clienti_master();

NOTIFY pgrst, 'reload schema';
