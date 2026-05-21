-- ============================================================
-- Migration 035 — Fix RLS write tabelle valutazioni legacy
-- ============================================================
-- Le tabelle "legacy" del portale valutazioni (create nella 001) avevano
-- policy di scrittura che controllavano `utenti.ruolo = 'admin'`, un ruolo
-- che non esiste più nel sistema (ora: superadmin/amministratore/...).
--
-- Conseguenza: ogni write via client utente (RLS attivo) falliva in silenzio
-- → "Errore aggiornamento sessione" sull'endpoint sblocca.
--
-- Questa migration uniforma tutte le policy a `is_valutazioni_admin(auth.uid())`,
-- la stessa funzione SECURITY DEFINER già usata (e funzionante) sulle tabelle
-- del "new evaluation system" (migration 006).
--
-- Tabelle interessate: sessioni_valutazione, scale_valutazione, parametri_radar,
--                      domande, kpi_config, mansionari, risposte
-- Idempotente: DROP POLICY IF EXISTS prima di ogni CREATE.
-- ============================================================

-- ─── sessioni_valutazione ─────────────────────────────────────
DROP POLICY IF EXISTS "Admin modifica sessioni" ON sessioni_valutazione;
DROP POLICY IF EXISTS "Tutti leggono sessioni"  ON sessioni_valutazione;  -- duplicato di sessioni_val_select
DROP POLICY IF EXISTS "sessioni_val_select"     ON sessioni_valutazione;
DROP POLICY IF EXISTS "sessioni_val_admin"      ON sessioni_valutazione;

CREATE POLICY "sessioni_val_select" ON sessioni_valutazione
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sessioni_val_admin" ON sessioni_valutazione
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- ─── scale_valutazione ────────────────────────────────────────
DROP POLICY IF EXISTS "Admin modifica scale" ON scale_valutazione;
DROP POLICY IF EXISTS "Tutti leggono scale"  ON scale_valutazione;        -- duplicato di scale_select
DROP POLICY IF EXISTS "scale_select"         ON scale_valutazione;
DROP POLICY IF EXISTS "scale_admin"          ON scale_valutazione;

CREATE POLICY "scale_select" ON scale_valutazione
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "scale_admin" ON scale_valutazione
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- ─── parametri_radar ──────────────────────────────────────────
DROP POLICY IF EXISTS "Admin modifica parametri" ON parametri_radar;
DROP POLICY IF EXISTS "Tutti leggono parametri"  ON parametri_radar;      -- duplicato di parametri_radar_select
DROP POLICY IF EXISTS "parametri_radar_select"   ON parametri_radar;
DROP POLICY IF EXISTS "parametri_radar_admin"    ON parametri_radar;

CREATE POLICY "parametri_radar_select" ON parametri_radar
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "parametri_radar_admin" ON parametri_radar
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- ─── domande (legacy) ─────────────────────────────────────────
DROP POLICY IF EXISTS "Admin modifica domande" ON domande;
DROP POLICY IF EXISTS "Tutti leggono domande"  ON domande;                -- duplicato di domande_select
DROP POLICY IF EXISTS "domande_select"         ON domande;
DROP POLICY IF EXISTS "domande_admin"          ON domande;

CREATE POLICY "domande_select" ON domande
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "domande_admin" ON domande
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- ─── kpi_config ───────────────────────────────────────────────
DROP POLICY IF EXISTS "Admin modifica KPI" ON kpi_config;
DROP POLICY IF EXISTS "kpi_select"         ON kpi_config;
DROP POLICY IF EXISTS "kpi_admin"          ON kpi_config;

CREATE POLICY "kpi_select" ON kpi_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "kpi_admin" ON kpi_config
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- ─── mansionari ───────────────────────────────────────────────
-- La SELECT usava ruolo IN ('admin','direttore') — entrambi obsoleti.
DROP POLICY IF EXISTS "Admin gestisce mansionari"       ON mansionari;
DROP POLICY IF EXISTS "Utenti vedono propri mansionari" ON mansionari;
DROP POLICY IF EXISTS "mansionari_select"               ON mansionari;
DROP POLICY IF EXISTS "mansionari_admin"                ON mansionari;

CREATE POLICY "mansionari_select" ON mansionari
  FOR SELECT TO authenticated
  USING (utente_id = auth.uid() OR is_valutazioni_admin(auth.uid()));
CREATE POLICY "mansionari_admin" ON mansionari
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- ─── risposte (legacy) ────────────────────────────────────────
-- La SELECT usava ruolo='admin'. Le INSERT policy esistenti restano invariate.
DROP POLICY IF EXISTS "Utenti vedono proprie risposte" ON risposte;
DROP POLICY IF EXISTS "risposte_select"                ON risposte;

CREATE POLICY "risposte_select" ON risposte
  FOR SELECT TO authenticated
  USING (
    utente_id = auth.uid()
    OR valutatore_id = auth.uid()
    OR is_valutazioni_admin(auth.uid())
  );
