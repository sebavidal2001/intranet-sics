-- ============================================================
-- Migration 027 — Preventivatore V2: metadata documento-level + blocchi
-- ============================================================
-- Additiva. Nessuna colonna esistente modificata o droppata.
-- Permette all'ingestion V2 di popolare campi che i tool AI già si aspettano
-- (importo_preventivo, categoria) e nuove dimensioni di filtro (anno, tipo_prodotto).
-- ============================================================

-- ─── documenti: nuove colonne diagnostiche/dimensionali ─────────────────────
ALTER TABLE preventivatore.documenti
  ADD COLUMN IF NOT EXISTS anno                INT,
  ADD COLUMN IF NOT EXISTS tipo_prodotto       TEXT,
  ADD COLUMN IF NOT EXISTS importo_finale_raw  NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS importo_source      TEXT, -- 'prezzo_finale' | 'totale' | 'blocks_sum' | 'word_only' | 'manuale'
  ADD COLUMN IF NOT EXISTS versione_ingest     TEXT,
  ADD COLUMN IF NOT EXISTS audit_hash          TEXT;

CREATE INDEX IF NOT EXISTS idx_documenti_anno          ON preventivatore.documenti(anno);
CREATE INDEX IF NOT EXISTS idx_documenti_categoria     ON preventivatore.documenti(categoria);
CREATE INDEX IF NOT EXISTS idx_documenti_tipo_prodotto ON preventivatore.documenti(tipo_prodotto);

-- ─── chunks: GIN su metadata per filtri JSONB veloci ────────────────────────
CREATE INDEX IF NOT EXISTS idx_chunks_meta_gin
  ON preventivatore.chunks USING GIN (metadata);

-- ─── righe_distinta: campi diagnostici aggiuntivi ───────────────────────────
ALTER TABLE preventivatore.righe_distinta
  ADD COLUMN IF NOT EXISTS totale_riga_ceil_2    NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS ricarico_coefficiente NUMERIC(6,3),
  ADD COLUMN IF NOT EXISTS codice_blocco         TEXT;

CREATE INDEX IF NOT EXISTS idx_righe_codice_blocco ON preventivatore.righe_distinta(codice_blocco);

-- ─── blocchi: per ingestion `blocks_total_only` ─────────────────────────────
-- Quando un Excel ha solo totali/codici per blocco senza distinta analitica,
-- salviamo i blocchi qui invece di "fingerli" come righe.
CREATE TABLE IF NOT EXISTS preventivatore.blocchi (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id  UUID NOT NULL REFERENCES preventivatore.documenti(id) ON DELETE CASCADE,
  codice_blocco TEXT,
  sheet_name    TEXT,
  totale_raw    NUMERIC(14,4),
  totale_ceil_2 NUMERIC(12,2),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocchi_doc ON preventivatore.blocchi(documento_id);

ALTER TABLE preventivatore.blocchi ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "auth_read" ON preventivatore.blocchi
    FOR SELECT USING (auth.role() = 'authenticated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Helper: backfill anno per documenti già esistenti (V1) ─────────────────
-- L'estrazione viene dal codice S_YY_NNN → 20YY.
UPDATE preventivatore.documenti
SET anno = ('20' || substring(codice from 'S_(\d{2})_'))::INT
WHERE anno IS NULL AND codice ~ 'S_\d{2}_\d+';
