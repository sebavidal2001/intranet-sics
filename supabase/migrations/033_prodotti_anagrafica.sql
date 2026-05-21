-- ============================================================
-- Migration 033 — Anagrafica articoli (cruscotto) + giacenze multi-magazzino
-- ============================================================
-- Schema normalizzato per gestire l'anagrafica articoli aziendale
-- importata dal "Cruscotto articoli" (oggi Excel, domani CSV via cron VM).
--
-- Modello:
--   - preventivatore.prodotti          → 1 riga per codice (anagrafica, prezzo, descrizione)
--   - preventivatore.prodotti_giacenze → 1 riga per (codice, magazzino) SOLO se registrato
--                                          (assenza riga = non registrato; esistenza=0 = registrato a 0)
--   - preventivatore.prodotti_import_log → audit di ogni import
--   - preventivatore.v_prodotti_completo → vista comoda per UI/builder
-- ============================================================

-- Trigram per ricerca fuzzy descrizione
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- TABELLA: prodotti (anagrafica)
-- ============================================================
CREATE TABLE IF NOT EXISTS preventivatore.prodotti (
  codice            text PRIMARY KEY,
  codice_norm       text NOT NULL,
  descrizione       text,
  uc                text,
  categoria         text,
  gruppo            text,
  cat_merc          text,
  reparto_codice    text,
  reparto_desc      text,
  ult_costo         numeric(14,4),
  data_ult_costo    date,
  attivo            boolean NOT NULL DEFAULT true,
  hash_riga         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  aggiornato_il     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prodotti_codice_norm ON preventivatore.prodotti (codice_norm);
CREATE INDEX IF NOT EXISTS idx_prodotti_categoria   ON preventivatore.prodotti (categoria);
CREATE INDEX IF NOT EXISTS idx_prodotti_gruppo      ON preventivatore.prodotti (gruppo);
CREATE INDEX IF NOT EXISTS idx_prodotti_attivo      ON preventivatore.prodotti (attivo) WHERE attivo;
CREATE INDEX IF NOT EXISTS idx_prodotti_descr_trgm  ON preventivatore.prodotti USING gin (descrizione gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_prodotti_codice_trgm ON preventivatore.prodotti USING gin (codice gin_trgm_ops);

COMMENT ON TABLE preventivatore.prodotti IS 'Anagrafica articoli dal Cruscotto. 1 riga per codice (campi indipendenti dal magazzino).';
COMMENT ON COLUMN preventivatore.prodotti.codice_norm IS 'UPPER(codice) senza spazi/punteggiatura, per match fuzzy lato builder.';
COMMENT ON COLUMN preventivatore.prodotti.attivo IS 'false = codice sparito dal cruscotto (soft delete). Non cancellare per integrità con righe_distinta storiche.';
COMMENT ON COLUMN preventivatore.prodotti.hash_riga IS 'MD5 dei campi anagrafici per skip rapido upsert quando nulla è cambiato.';

-- ============================================================
-- TABELLA: prodotti_giacenze (giacenze per magazzino)
-- ============================================================
CREATE TABLE IF NOT EXISTS preventivatore.prodotti_giacenze (
  codice         text NOT NULL REFERENCES preventivatore.prodotti(codice) ON DELETE CASCADE,
  magazzino      text NOT NULL,
  esistenza      numeric(14,3) NOT NULL DEFAULT 0,
  disponibilita  numeric(14,3) NOT NULL DEFAULT 0,
  aggiornato_il  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (codice, magazzino)
);

CREATE INDEX IF NOT EXISTS idx_prodotti_giacenze_mag    ON preventivatore.prodotti_giacenze (magazzino);
CREATE INDEX IF NOT EXISTS idx_prodotti_giacenze_codice ON preventivatore.prodotti_giacenze (codice);

COMMENT ON TABLE preventivatore.prodotti_giacenze IS 'Giacenze per magazzino. ASSENZA riga = non registrato in quel magazzino. esistenza=0 con riga presente = registrato a zero.';

-- ============================================================
-- TABELLA: prodotti_import_log (audit)
-- ============================================================
CREATE TABLE IF NOT EXISTS preventivatore.prodotti_import_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iniziato_il           timestamptz NOT NULL DEFAULT now(),
  finito_il             timestamptz,
  file_path             text,
  file_md5              text,
  righe_lette           int,
  prodotti_nuovi        int DEFAULT 0,
  prodotti_aggiornati   int DEFAULT 0,
  prodotti_disattivati  int DEFAULT 0,
  giacenze_inserite     int DEFAULT 0,
  giacenze_aggiornate   int DEFAULT 0,
  giacenze_eliminate    int DEFAULT 0,
  esito                 text NOT NULL DEFAULT 'in_corso',     -- in_corso | ok | errore | skip_hash_uguale
  errore                text,
  durata_ms             int
);

CREATE INDEX IF NOT EXISTS idx_prodotti_import_log_iniziato ON preventivatore.prodotti_import_log (iniziato_il DESC);

-- ============================================================
-- VIEW: v_prodotti_completo (anagrafica + aggregati giacenze)
-- ============================================================
CREATE OR REPLACE VIEW preventivatore.v_prodotti_completo AS
SELECT
  p.codice,
  p.codice_norm,
  p.descrizione,
  p.uc,
  p.categoria,
  p.gruppo,
  p.cat_merc,
  p.reparto_codice,
  p.reparto_desc,
  p.ult_costo,
  p.data_ult_costo,
  p.attivo,
  p.aggiornato_il,
  COALESCE(g.esistenza_totale, 0)     AS esistenza_totale,
  COALESCE(g.disponibilita_totale, 0) AS disponibilita_totale,
  COALESCE(g.n_magazzini, 0)          AS n_magazzini,
  g.magazzini
FROM preventivatore.prodotti p
LEFT JOIN LATERAL (
  SELECT
    SUM(esistenza)::numeric(14,3)     AS esistenza_totale,
    SUM(disponibilita)::numeric(14,3) AS disponibilita_totale,
    COUNT(*)::int                     AS n_magazzini,
    array_agg(magazzino ORDER BY magazzino) AS magazzini
  FROM preventivatore.prodotti_giacenze gg
  WHERE gg.codice = p.codice
) g ON true;

COMMENT ON VIEW preventivatore.v_prodotti_completo IS 'Anagrafica + aggregati giacenze in 1 riga per UI/builder. La struttura fisica resta normalizzata.';

-- ============================================================
-- RPC: search_prodotti (autocomplete builder)
-- ============================================================
CREATE OR REPLACE FUNCTION preventivatore.search_prodotti(
  q       text,
  limite  int DEFAULT 20
)
RETURNS TABLE (
  codice               text,
  descrizione          text,
  uc                   text,
  categoria            text,
  ult_costo            numeric,
  esistenza_totale     numeric,
  disponibilita_totale numeric,
  n_magazzini          int,
  prezzo_stale         boolean,
  score                real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = preventivatore, public
AS $$
  WITH q_norm AS (
    SELECT
      btrim(q) AS raw,
      upper(regexp_replace(btrim(q), '[\s\.\-_/\\\*\?]+', '', 'g')) AS norm
  )
  SELECT
    v.codice,
    v.descrizione,
    v.uc,
    v.categoria,
    v.ult_costo,
    v.esistenza_totale,
    v.disponibilita_totale,
    v.n_magazzini,
    (v.data_ult_costo IS NULL OR v.data_ult_costo < (current_date - interval '1 year'))::boolean AS prezzo_stale,
    GREATEST(
      similarity(v.codice, (SELECT raw FROM q_norm)),
      similarity(v.codice_norm, (SELECT norm FROM q_norm)),
      similarity(COALESCE(v.descrizione, ''), (SELECT raw FROM q_norm)) * 0.7
    )::real AS score
  FROM preventivatore.v_prodotti_completo v
  WHERE v.attivo
    AND (
      v.codice_norm LIKE (SELECT norm FROM q_norm) || '%'
      OR v.codice ILIKE '%' || (SELECT raw FROM q_norm) || '%'
      OR v.descrizione ILIKE '%' || (SELECT raw FROM q_norm) || '%'
    )
  ORDER BY score DESC, v.codice
  LIMIT GREATEST(1, LEAST(limite, 100));
$$;

COMMENT ON FUNCTION preventivatore.search_prodotti IS 'Ricerca multi-criterio (codice, codice_norm, descrizione) per autocomplete builder. Score basato su trigram similarity.';

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE preventivatore.prodotti              ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.prodotti_giacenze     ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.prodotti_import_log   ENABLE ROW LEVEL SECURITY;

-- Lettura: qualsiasi utente autenticato (stesso pattern di righe_distinta).
-- L'autorizzazione fine sul portale preventivatore è gestita lato app.
DROP POLICY IF EXISTS prodotti_select ON preventivatore.prodotti;
CREATE POLICY prodotti_select ON preventivatore.prodotti
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS prodotti_giacenze_select ON preventivatore.prodotti_giacenze;
CREATE POLICY prodotti_giacenze_select ON preventivatore.prodotti_giacenze
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS prodotti_import_log_select ON preventivatore.prodotti_import_log;
CREATE POLICY prodotti_import_log_select ON preventivatore.prodotti_import_log
  FOR SELECT USING (auth.role() = 'authenticated');

-- Scrittura: solo service_role (script import su VM)
-- (le policy implicite con RLS abilitato bloccano tutto tranne service_role che bypassa)

-- ============================================================
-- GRANT
-- ============================================================
GRANT SELECT ON preventivatore.prodotti              TO authenticated;
GRANT SELECT ON preventivatore.prodotti_giacenze     TO authenticated;
GRANT SELECT ON preventivatore.prodotti_import_log   TO authenticated;
GRANT SELECT ON preventivatore.v_prodotti_completo   TO authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.search_prodotti(text, int) TO authenticated;
