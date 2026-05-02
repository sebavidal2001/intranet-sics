-- ============================================================
-- Migration 008: Fix RLS policies dopo DROP FUNCTION CASCADE
-- Ricrea tutte le policy che dipendono da is_valutazioni_admin
-- e quelle sulle nuove tabelle di migration 007
-- ============================================================

-- Ricrea funzione con nome parametro aggiornato (idempotente)
DROP FUNCTION IF EXISTS is_valutazioni_admin(UUID) CASCADE;

CREATE OR REPLACE FUNCTION is_valutazioni_admin(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM permessi_utente pu
    JOIN portali p ON p.id = pu.portale_id
    WHERE pu.utente_id = p_user_id
      AND pu.is_portal_admin = true
      AND p.slug = 'valutazioni'
  ) OR EXISTS (
    SELECT 1 FROM utenti
    WHERE id = p_user_id
      AND ruolo IN ('superadmin', 'amministratore', 'admin')
  );
$$;

-- ── ruoli_config ──────────────────────────────────────────────
ALTER TABLE ruoli_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ruoli_config_select" ON ruoli_config;
DROP POLICY IF EXISTS "ruoli_config_admin" ON ruoli_config;

CREATE POLICY "ruoli_config_select" ON ruoli_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ruoli_config_admin" ON ruoli_config
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- ── reparti ───────────────────────────────────────────────────
ALTER TABLE reparti ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reparti_select" ON reparti;
DROP POLICY IF EXISTS "reparti_admin" ON reparti;

CREATE POLICY "reparti_select" ON reparti
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "reparti_admin" ON reparti
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- ── skills ────────────────────────────────────────────────────
ALTER TABLE skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "skills_select" ON skills;
DROP POLICY IF EXISTS "skills_admin" ON skills;

CREATE POLICY "skills_select" ON skills
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "skills_admin" ON skills
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- ── sessione_skills ───────────────────────────────────────────
ALTER TABLE sessione_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sessione_skills_select" ON sessione_skills;
DROP POLICY IF EXISTS "sessione_skills_admin" ON sessione_skills;

CREATE POLICY "sessione_skills_select" ON sessione_skills
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sessioni_utente su
      WHERE su.id = sessione_id
        AND (su.utente_id = auth.uid() OR su.responsabile_id = auth.uid())
    )
    OR is_valutazioni_admin(auth.uid())
  );
CREATE POLICY "sessione_skills_admin" ON sessione_skills
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- ── storico_punteggi ──────────────────────────────────────────
ALTER TABLE storico_punteggi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "storico_select" ON storico_punteggi;
DROP POLICY IF EXISTS "storico_admin" ON storico_punteggi;

CREATE POLICY "storico_select" ON storico_punteggi
  FOR SELECT TO authenticated
  USING (utente_id = auth.uid() OR is_valutazioni_admin(auth.uid()));
CREATE POLICY "storico_admin" ON storico_punteggi
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- ── Ricrea policy su tabelle esistenti (eliminate dal CASCADE) ─
-- ruoli_professionali
DROP POLICY IF EXISTS "ruoli_prof_select" ON ruoli_professionali;
DROP POLICY IF EXISTS "ruoli_prof_admin" ON ruoli_professionali;
CREATE POLICY "ruoli_prof_select" ON ruoli_professionali
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ruoli_prof_admin" ON ruoli_professionali
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- mansioni
DROP POLICY IF EXISTS "mansioni_select" ON mansioni;
DROP POLICY IF EXISTS "mansioni_admin" ON mansioni;
CREATE POLICY "mansioni_select" ON mansioni
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "mansioni_admin" ON mansioni
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- utente_profili
DROP POLICY IF EXISTS "utente_profili_select" ON utente_profili;
DROP POLICY IF EXISTS "utente_profili_admin" ON utente_profili;
CREATE POLICY "utente_profili_select" ON utente_profili
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "utente_profili_admin" ON utente_profili
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- utente_mansioni
DROP POLICY IF EXISTS "utente_mansioni_select" ON utente_mansioni;
DROP POLICY IF EXISTS "utente_mansioni_admin" ON utente_mansioni;
CREATE POLICY "utente_mansioni_select" ON utente_mansioni
  FOR SELECT TO authenticated
  USING (utente_id = auth.uid() OR is_valutazioni_admin(auth.uid()));
CREATE POLICY "utente_mansioni_admin" ON utente_mansioni
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- sessioni_utente
DROP POLICY IF EXISTS "sessioni_utente_select" ON sessioni_utente;
DROP POLICY IF EXISTS "sessioni_utente_admin_write" ON sessioni_utente;
CREATE POLICY "sessioni_utente_select" ON sessioni_utente
  FOR SELECT TO authenticated
  USING (
    utente_id = auth.uid()
    OR responsabile_id = auth.uid()
    OR is_valutazioni_admin(auth.uid())
  );
CREATE POLICY "sessioni_utente_admin_write" ON sessioni_utente
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- risposte_valutazione
DROP POLICY IF EXISTS "risposte_val_select" ON risposte_valutazione;
CREATE POLICY "risposte_val_select" ON risposte_valutazione
  FOR SELECT TO authenticated
  USING (
    valutatore_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM sessioni_utente su
      WHERE su.id = sessione_utente_id
        AND (su.utente_id = auth.uid() OR su.responsabile_id = auth.uid())
    )
    OR is_valutazioni_admin(auth.uid())
  );

-- utenti (solo la policy valutazioni admin select)
DROP POLICY IF EXISTS "utenti_valutazioni_admin_select" ON utenti;
CREATE POLICY "utenti_valutazioni_admin_select" ON utenti
  FOR SELECT TO authenticated
  USING (is_valutazioni_admin(auth.uid()));
