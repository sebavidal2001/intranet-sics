-- ============================================================
-- Migration 011: Aggiunge RLS policies alle tabelle create
--   in migration 001 senza politiche esplicite.
--   Tabelle: parametri_radar, scale_valutazione,
--            sessioni_valutazione, domande, kpi_config
-- ============================================================

-- ─── Abilita RLS (idempotente) ────────────────────────────────
ALTER TABLE parametri_radar    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scale_valutazione  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessioni_valutazione ENABLE ROW LEVEL SECURITY;
ALTER TABLE domande            ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_config         ENABLE ROW LEVEL SECURITY;

-- ─── parametri_radar ─────────────────────────────────────────
DROP POLICY IF EXISTS "parametri_radar_select" ON parametri_radar;
DROP POLICY IF EXISTS "parametri_radar_admin"  ON parametri_radar;

CREATE POLICY "parametri_radar_select" ON parametri_radar
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "parametri_radar_admin" ON parametri_radar
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- ─── scale_valutazione ───────────────────────────────────────
DROP POLICY IF EXISTS "scale_select" ON scale_valutazione;
DROP POLICY IF EXISTS "scale_admin"  ON scale_valutazione;

CREATE POLICY "scale_select" ON scale_valutazione
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "scale_admin" ON scale_valutazione
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- ─── sessioni_valutazione ─────────────────────────────────────
DROP POLICY IF EXISTS "sessioni_val_select" ON sessioni_valutazione;
DROP POLICY IF EXISTS "sessioni_val_admin"  ON sessioni_valutazione;

CREATE POLICY "sessioni_val_select" ON sessioni_valutazione
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "sessioni_val_admin" ON sessioni_valutazione
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- ─── domande ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "domande_select" ON domande;
DROP POLICY IF EXISTS "domande_admin"  ON domande;

CREATE POLICY "domande_select" ON domande
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "domande_admin" ON domande
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- ─── kpi_config ──────────────────────────────────────────────
DROP POLICY IF EXISTS "kpi_select" ON kpi_config;
DROP POLICY IF EXISTS "kpi_admin"  ON kpi_config;

CREATE POLICY "kpi_select" ON kpi_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "kpi_admin" ON kpi_config
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));
