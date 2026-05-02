-- ============================================================
-- Migration 019: Report Builder
-- Aggiunge report_config e report_blocchi per il builder admin
-- ============================================================

-- 1. Tabella principale report
CREATE TABLE IF NOT EXISTS report_config (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT NOT NULL,
  descrizione      TEXT,
  visibilita_ruoli TEXT[] NOT NULL DEFAULT '{}',
  created_by       UUID REFERENCES utenti(id) ON DELETE SET NULL,
  is_attivo        BOOLEAN NOT NULL DEFAULT true,
  ordine           INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger updated_at (idempotente)
CREATE OR REPLACE FUNCTION update_report_config_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE trigger_name = 'report_config_updated_at'
      AND event_object_table = 'report_config'
  ) THEN
    CREATE TRIGGER report_config_updated_at
      BEFORE UPDATE ON report_config
      FOR EACH ROW EXECUTE FUNCTION update_report_config_updated_at();
  END IF;
END$$;

-- 2. Tabella blocchi
CREATE TABLE IF NOT EXISTS report_blocchi (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id      UUID NOT NULL REFERENCES report_config(id) ON DELETE CASCADE,
  ordine         INT NOT NULL DEFAULT 0,
  tipo           TEXT NOT NULL
                   CHECK (tipo IN ('radar','bar','line','pie','donut','table','kpi_card')),
  titolo         TEXT,
  configurazione JSONB NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Indici
CREATE INDEX IF NOT EXISTS idx_report_config_attivo  ON report_config(is_attivo);
CREATE INDEX IF NOT EXISTS idx_report_config_ordine  ON report_config(ordine);
CREATE INDEX IF NOT EXISTS idx_report_blocchi_report ON report_blocchi(report_id, ordine);

-- 4. RLS
ALTER TABLE report_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_blocchi ENABLE ROW LEVEL SECURITY;

-- Admin vede e modifica tutto
CREATE POLICY "admin_all_report_config"
  ON report_config FOR ALL
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- Utenti vedono report attivi dove il loro ruolo è in visibilita_ruoli
CREATE POLICY "utenti_select_report_config"
  ON report_config FOR SELECT
  USING (
    is_attivo = true
    AND EXISTS (
      SELECT 1 FROM utenti u
      WHERE u.id = auth.uid()
        AND (
          u.ruolo = ANY(visibilita_ruoli)
          OR u.ruoli_aggiuntivi && visibilita_ruoli
        )
    )
  );

-- Admin vede e modifica tutti i blocchi
CREATE POLICY "admin_all_report_blocchi"
  ON report_blocchi FOR ALL
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- Utenti vedono blocchi dei report accessibili
CREATE POLICY "utenti_select_report_blocchi"
  ON report_blocchi FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM report_config rc
      WHERE rc.id = report_id
        AND rc.is_attivo = true
        AND EXISTS (
          SELECT 1 FROM utenti u
          WHERE u.id = auth.uid()
            AND (
              u.ruolo = ANY(rc.visibilita_ruoli)
              OR u.ruoli_aggiuntivi && rc.visibilita_ruoli
            )
        )
    )
  );
