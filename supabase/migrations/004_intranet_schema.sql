-- ============================================================
-- Migration 004: Schema intranet multi-portale
-- ============================================================

-- 1. Aggiunge campo username e ruolo superadmin alla tabella utenti
-- ============================================================

-- Aggiunge campo username univoco
ALTER TABLE utenti ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

-- Aggiorna il vincolo sul ruolo per aggiungere superadmin
-- Prima rimuoviamo il vecchio constraint (se esiste), poi lo riaggiungiamo
DO $$
BEGIN
  -- Rimuove constraint precedente se esiste
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'utenti_ruolo_check'
    AND table_name = 'utenti'
  ) THEN
    ALTER TABLE utenti DROP CONSTRAINT utenti_ruolo_check;
  END IF;
END$$;

ALTER TABLE utenti ADD CONSTRAINT utenti_ruolo_check
  CHECK (ruolo IN ('superadmin', 'admin', 'direttore', 'addetto'));

-- 2. Tabella portali
-- ============================================================
CREATE TABLE IF NOT EXISTS portali (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  descrizione TEXT,
  icona       TEXT,           -- nome icona Lucide (es. "ClipboardList")
  colore      TEXT,           -- hex colore (es. "#00a1be")
  ordine      INT NOT NULL DEFAULT 0,
  is_attivo   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Permessi per ruolo su ogni portale
-- ============================================================
CREATE TABLE IF NOT EXISTS permessi_portale (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portale_id  UUID NOT NULL REFERENCES portali(id) ON DELETE CASCADE,
  ruolo       TEXT NOT NULL,  -- admin, direttore, addetto
  can_access  BOOLEAN NOT NULL DEFAULT false,
  can_export  BOOLEAN NOT NULL DEFAULT false,
  can_approve BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (portale_id, ruolo)
);

-- 4. Override permessi per singolo utente
-- ============================================================
CREATE TABLE IF NOT EXISTS permessi_utente (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portale_id      UUID NOT NULL REFERENCES portali(id) ON DELETE CASCADE,
  utente_id       UUID NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  override_access BOOLEAN,    -- NULL = usa permesso ruolo, true/false = forza
  override_export BOOLEAN,
  UNIQUE (portale_id, utente_id)
);

-- 5. Blocchi homepage (news + link rapidi)
-- ============================================================
CREATE TABLE IF NOT EXISTS homepage_blocks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo       TEXT NOT NULL CHECK (tipo IN ('news', 'link')),
  titolo     TEXT NOT NULL,
  testo      TEXT,
  url        TEXT,
  icona      TEXT,
  ordine     INT NOT NULL DEFAULT 0,
  is_attivo  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Portale valutazioni — inserimento di default
-- ============================================================
INSERT INTO portali (nome, slug, descrizione, icona, colore, ordine)
VALUES (
  'Valutazione Personale',
  'valutazioni',
  'Gestione valutazioni, radar competenze e analisi del personale',
  'ClipboardList',
  '#00a1be',
  1
) ON CONFLICT (slug) DO NOTHING;

-- Permessi di default per il portale valutazioni
WITH p AS (SELECT id FROM portali WHERE slug = 'valutazioni')
INSERT INTO permessi_portale (portale_id, ruolo, can_access, can_export, can_approve)
SELECT p.id, r.ruolo, r.can_access, r.can_export, r.can_approve
FROM p, (VALUES
  ('admin',     true, true,  true),
  ('direttore', true, true,  false),
  ('addetto',   true, false, false)
) AS r(ruolo, can_access, can_export, can_approve)
ON CONFLICT (portale_id, ruolo) DO NOTHING;

-- 7. RLS
-- ============================================================
ALTER TABLE portali ENABLE ROW LEVEL SECURITY;
ALTER TABLE permessi_portale ENABLE ROW LEVEL SECURITY;
ALTER TABLE permessi_utente ENABLE ROW LEVEL SECURITY;
ALTER TABLE homepage_blocks ENABLE ROW LEVEL SECURITY;

-- Portali: tutti gli autenticati possono leggere quelli attivi
CREATE POLICY "portali_select" ON portali
  FOR SELECT TO authenticated USING (is_attivo = true);

-- Portali: solo superadmin può modificare
CREATE POLICY "portali_superadmin" ON portali
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM utenti WHERE id = auth.uid() AND ruolo = 'superadmin')
  );

-- Permessi portale: tutti autenticati leggono
CREATE POLICY "permessi_portale_select" ON permessi_portale
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "permessi_portale_superadmin" ON permessi_portale
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM utenti WHERE id = auth.uid() AND ruolo = 'superadmin')
  );

-- Permessi utente: utente vede i propri, superadmin vede tutto
CREATE POLICY "permessi_utente_select" ON permessi_utente
  FOR SELECT TO authenticated
  USING (
    utente_id = auth.uid() OR
    EXISTS (SELECT 1 FROM utenti WHERE id = auth.uid() AND ruolo = 'superadmin')
  );

CREATE POLICY "permessi_utente_superadmin" ON permessi_utente
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM utenti WHERE id = auth.uid() AND ruolo = 'superadmin')
  );

-- Homepage blocks: tutti autenticati leggono i blocchi attivi
CREATE POLICY "homepage_blocks_select" ON homepage_blocks
  FOR SELECT TO authenticated USING (is_attivo = true);

CREATE POLICY "homepage_blocks_superadmin" ON homepage_blocks
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM utenti WHERE id = auth.uid() AND ruolo = 'superadmin')
  );
