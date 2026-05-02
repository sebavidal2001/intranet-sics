-- ============================================================
-- Migration 014: Permission architecture improvements
--
-- Obiettivi:
-- 1. Fix is_attivo mancante nei CASE override utente di get_portale_livello
-- 2. Nuova funzione get_portali_utente() per query batch (elimina loop N+1)
-- 3. Campo labels_livelli su portali per label personalizzate per portale
-- 4. Campo labels_livelli in portale valutazioni
-- ============================================================

-- 1. Campo labels_livelli su portali
-- Permette di personalizzare le label dei livelli nell'UI per ogni portale.
-- Es. portale "Sicurezza" può chiamare admin → "RSPP" invece di "Amministratore portale".
-- ============================================================
ALTER TABLE portali
  ADD COLUMN IF NOT EXISTS labels_livelli jsonb DEFAULT '{
    "admin":    "Amministratore portale",
    "exporter": "Può esportare dati",
    "viewer":   "Solo lettura"
  }'::jsonb;

-- 2. Fix get_portale_livello: aggiunge AND p.is_attivo = true
--    nei CASE degli override utente (erano assenti nella migration 012,
--    mentre i CASE da ruolo avevano già il check).
-- ============================================================
CREATE OR REPLACE FUNCTION get_portale_livello(p_user_id UUID, p_slug TEXT)
RETURNS TEXT LANGUAGE sql SECURITY DEFINER AS $$
  SELECT CASE
    -- Superadmin di piattaforma: accesso illimitato sempre
    WHEN EXISTS (
      SELECT 1 FROM utenti
      WHERE id = p_user_id AND ruolo = 'superadmin'
    ) THEN 'superadmin'

    -- Admin di portale tramite override utente (+ is_attivo FIX)
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND p.is_attivo = true
        AND pu.is_portal_admin = true
    ) THEN 'admin'

    -- Export tramite override utente (+ is_attivo FIX)
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND p.is_attivo = true
        AND pu.override_export = true
        AND pu.is_portal_admin = false  -- evita doppio match con il caso admin
    ) THEN 'exporter'

    -- Accesso tramite override utente (+ is_attivo FIX)
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND p.is_attivo = true
        AND pu.override_access = true
        AND pu.override_export = false  -- evita doppio match con exporter
        AND pu.is_portal_admin = false  -- evita doppio match con admin
    ) THEN 'viewer'

    -- Blocco esplicito (override_access = false): nessun accesso anche se il ruolo lo prevede
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND p.is_attivo = true
        AND pu.override_access = false
        AND pu.is_portal_admin = false
    ) THEN NULL

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

-- 3. Nuova funzione get_portali_utente(): batch query
--    Restituisce tutti i portali attivi accessibili all'utente con il livello effettivo.
--    Sostituisce il loop sequenziale N+1 nella homepage e in admin/utenti/[id]/permessi.
-- ============================================================
CREATE OR REPLACE FUNCTION get_portali_utente(p_user_id UUID)
RETURNS TABLE(
  portale_id UUID,
  slug       TEXT,
  nome       TEXT,
  icona      TEXT,
  colore     TEXT,
  ordine     INT,
  livello    TEXT
) LANGUAGE sql SECURITY DEFINER AS $$
  SELECT
    p.id        AS portale_id,
    p.slug,
    p.nome,
    p.icona,
    p.colore,
    p.ordine,
    get_portale_livello(p_user_id, p.slug) AS livello
  FROM portali p
  WHERE p.is_attivo = true
    AND get_portale_livello(p_user_id, p.slug) IS NOT NULL
  ORDER BY p.ordine;
$$;
