-- ============================================================
-- Migration 012: Permission system refactor
--
-- Obiettivi:
-- 1. Aggiunge is_portal_admin a permessi_utente (se non esiste)
-- 2. Aggiorna permessi_portale con i ruoli correnti del sistema
-- 3. Crea get_portale_livello() → 'superadmin'|'admin'|'exporter'|'viewer'|null
-- 4. Aggiorna is_valutazioni_admin() per usare la nuova funzione
-- 5. Aggiunge RLS write su risposte_valutazione e sessioni_utente
-- ============================================================

-- 1. Aggiunge is_portal_admin se mancante
-- ============================================================
ALTER TABLE permessi_utente
  ADD COLUMN IF NOT EXISTS is_portal_admin BOOLEAN NOT NULL DEFAULT false;

-- 2. Aggiorna permessi_portale con i ruoli correnti
-- ============================================================
-- Rimuove le righe con vecchi nomi di ruolo non più usati
DELETE FROM permessi_portale pp
USING portali p
WHERE pp.portale_id = p.id
  AND p.slug = 'valutazioni'
  AND pp.ruolo IN ('direttore', 'addetto');

-- Inserisce/aggiorna con i nomi di ruolo correnti
-- can_access  = può vedere il portale
-- can_export  = può scaricare PDF/CSV
-- can_approve = admin del portale (pieno controllo)
WITH p AS (SELECT id FROM portali WHERE slug = 'valutazioni')
INSERT INTO permessi_portale (portale_id, ruolo, can_access, can_export, can_approve)
SELECT p.id, r.ruolo, r.can_access, r.can_export, r.can_approve
FROM p, (VALUES
  ('superadmin',             true, true,  true),
  ('admin',                  true, true,  true),
  ('amministratore',         true, true,  true),
  ('responsabile',           true, true,  false),
  ('responsabile_intermedio',true, true,  false),
  ('collaboratore',          true, false, false)
) AS r(ruolo, can_access, can_export, can_approve)
ON CONFLICT (portale_id, ruolo) DO UPDATE SET
  can_access  = EXCLUDED.can_access,
  can_export  = EXCLUDED.can_export,
  can_approve = EXCLUDED.can_approve;

-- 3. Funzione get_portale_livello
-- Gerarchia: superadmin > admin > exporter > viewer > null
-- ============================================================
CREATE OR REPLACE FUNCTION get_portale_livello(p_user_id UUID, p_slug TEXT)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT CASE
    -- Superadmin di piattaforma: accesso illimitato sempre
    WHEN EXISTS (
      SELECT 1 FROM utenti
      WHERE id = p_user_id AND ruolo = 'superadmin'
    ) THEN 'superadmin'

    -- Admin di portale tramite override utente
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND pu.is_portal_admin = true
    ) THEN 'admin'

    -- Export tramite override utente
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND pu.override_export = true
    ) THEN 'exporter'

    -- Access tramite override utente
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND pu.override_access = true
    ) THEN 'viewer'

    -- Admin di portale tramite ruolo (can_approve)
    WHEN EXISTS (
      SELECT 1 FROM utenti u
      JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id
        AND p.slug = p_slug
        AND pp.can_approve = true
        AND p.is_attivo = true
    ) THEN 'admin'

    -- Exporter tramite ruolo (can_export)
    WHEN EXISTS (
      SELECT 1 FROM utenti u
      JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id
        AND p.slug = p_slug
        AND pp.can_export = true
        AND p.is_attivo = true
    ) THEN 'exporter'

    -- Viewer tramite ruolo (can_access)
    WHEN EXISTS (
      SELECT 1 FROM utenti u
      JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id
        AND p.slug = p_slug
        AND pp.can_access = true
        AND p.is_attivo = true
    ) THEN 'viewer'

    ELSE NULL
  END;
$$;

-- 4. Aggiorna is_valutazioni_admin() per delegare a get_portale_livello
-- ============================================================
DROP FUNCTION IF EXISTS is_valutazioni_admin(UUID) CASCADE;

CREATE OR REPLACE FUNCTION is_valutazioni_admin(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT get_portale_livello(p_user_id, 'valutazioni') IN ('superadmin', 'admin');
$$;

-- 5. RLS su risposte_valutazione — aggiunge write policies
-- ============================================================
-- Il collaboratore e il responsabile possono scrivere le proprie risposte
DROP POLICY IF EXISTS "risposte_val_insert" ON risposte_valutazione;
DROP POLICY IF EXISTS "risposte_val_update" ON risposte_valutazione;
DROP POLICY IF EXISTS "risposte_val_delete" ON risposte_valutazione;

CREATE POLICY "risposte_val_insert" ON risposte_valutazione
  FOR INSERT TO authenticated
  WITH CHECK (
    valutatore_id = auth.uid()
    OR is_valutazioni_admin(auth.uid())
  );

CREATE POLICY "risposte_val_update" ON risposte_valutazione
  FOR UPDATE TO authenticated
  USING (
    valutatore_id = auth.uid()
    OR is_valutazioni_admin(auth.uid())
  );

CREATE POLICY "risposte_val_delete" ON risposte_valutazione
  FOR DELETE TO authenticated
  USING (
    valutatore_id = auth.uid()
    OR is_valutazioni_admin(auth.uid())
  );

-- 6. RLS su sessioni_utente — aggiunge UPDATE per collaboratore e responsabile
-- ============================================================
DROP POLICY IF EXISTS "sessioni_utente_collab_update" ON sessioni_utente;

CREATE POLICY "sessioni_utente_collab_update" ON sessioni_utente
  FOR UPDATE TO authenticated
  USING (
    utente_id = auth.uid()           -- collaboratore aggiorna il proprio stato
    OR responsabile_id = auth.uid()  -- responsabile aggiorna lo stato
    OR is_valutazioni_admin(auth.uid())
  );

-- 7. Ricrea le policy eliminate dal CASCADE su is_valutazioni_admin
-- ============================================================
-- ruoli_config
DROP POLICY IF EXISTS "ruoli_config_admin" ON ruoli_config;
CREATE POLICY "ruoli_config_admin" ON ruoli_config
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- reparti
DROP POLICY IF EXISTS "reparti_admin" ON reparti;
CREATE POLICY "reparti_admin" ON reparti
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- skills
DROP POLICY IF EXISTS "skills_admin" ON skills;
CREATE POLICY "skills_admin" ON skills
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- sessione_skills
DROP POLICY IF EXISTS "sessione_skills_admin" ON sessione_skills;
CREATE POLICY "sessione_skills_admin" ON sessione_skills
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- storico_punteggi
DROP POLICY IF EXISTS "storico_admin" ON storico_punteggi;
CREATE POLICY "storico_admin" ON storico_punteggi
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- ruoli_professionali
DROP POLICY IF EXISTS "ruoli_prof_admin" ON ruoli_professionali;
CREATE POLICY "ruoli_prof_admin" ON ruoli_professionali
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- mansioni
DROP POLICY IF EXISTS "mansioni_admin" ON mansioni;
CREATE POLICY "mansioni_admin" ON mansioni
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- utente_profili
DROP POLICY IF EXISTS "utente_profili_admin" ON utente_profili;
CREATE POLICY "utente_profili_admin" ON utente_profili
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- utente_mansioni
DROP POLICY IF EXISTS "utente_mansioni_admin" ON utente_mansioni;
CREATE POLICY "utente_mansioni_admin" ON utente_mansioni
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- sessioni_utente write
DROP POLICY IF EXISTS "sessioni_utente_admin_write" ON sessioni_utente;
CREATE POLICY "sessioni_utente_admin_write" ON sessioni_utente
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- utenti admin select
DROP POLICY IF EXISTS "utenti_valutazioni_admin_select" ON utenti;
CREATE POLICY "utenti_valutazioni_admin_select" ON utenti
  FOR SELECT TO authenticated
  USING (is_valutazioni_admin(auth.uid()));
