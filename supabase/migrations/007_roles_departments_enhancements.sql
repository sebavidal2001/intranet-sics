-- ============================================================
-- Migration 007: Ruoli configurabili, reparti, stato utente,
--               sessioni con orario/tipo, skills, storico punteggi
-- ============================================================

-- 1. Tabella ruoli_config (ruoli dinamici, configurabili da superadmin)
-- ============================================================
CREATE TABLE IF NOT EXISTS ruoli_config (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  colore     TEXT NOT NULL DEFAULT '#747373',
  ordine     INT  NOT NULL DEFAULT 0,
  is_system  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ruoli_config (nome, slug, colore, ordine, is_system) VALUES
  ('Superadmin',             'superadmin',             '#c82381', 0, true),
  ('Amministratore',         'amministratore',          '#00a1be', 1, false),
  ('Responsabile',           'responsabile',            '#ee7326', 2, false),
  ('Responsabile Intermedio','responsabile_intermedio', '#f59e0b', 3, false),
  ('Collaboratore',          'collaboratore',           '#95c11f', 4, false)
ON CONFLICT (slug) DO NOTHING;

-- 2. Rinomina ruolo 'admin' -> 'amministratore'
-- ============================================================
DO $$
BEGIN
  -- Rimuovi vecchio constraint se presente
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'utenti_ruolo_check' AND table_name = 'utenti'
  ) THEN
    ALTER TABLE utenti DROP CONSTRAINT utenti_ruolo_check;
  END IF;
END$$;

UPDATE utenti SET ruolo = 'amministratore' WHERE ruolo = 'admin';
UPDATE permessi_portale SET ruolo = 'amministratore' WHERE ruolo = 'admin';

-- Nessun constraint rigido: il ruolo è ora un testo libero validato da ruoli_config

-- 3. Tabella reparti (configurabili da superadmin)
-- ============================================================
CREATE TABLE IF NOT EXISTS reparti (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL UNIQUE,
  descrizione TEXT,
  ordine      INT  NOT NULL DEFAULT 0,
  attivo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: importa reparti esistenti dagli utenti
INSERT INTO reparti (nome)
SELECT DISTINCT TRIM(reparto)
FROM utenti
WHERE reparto IS NOT NULL AND TRIM(reparto) != ''
ON CONFLICT (nome) DO NOTHING;

-- 4. Stato dipendente su utenti (attivo / inattivo)
-- ============================================================
ALTER TABLE utenti ADD COLUMN IF NOT EXISTS stato TEXT NOT NULL DEFAULT 'attivo'
  CHECK (stato IN ('attivo', 'inattivo'));

-- 5. Aggiunte su sessioni_utente: orario + tipo_valutazione
-- ============================================================
ALTER TABLE sessioni_utente ADD COLUMN IF NOT EXISTS orario TIME;

ALTER TABLE sessioni_utente ADD COLUMN IF NOT EXISTS tipo_valutazione TEXT NOT NULL DEFAULT 'annuale';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sessioni_utente_tipo_check' AND table_name = 'sessioni_utente'
  ) THEN
    ALTER TABLE sessioni_utente ADD CONSTRAINT sessioni_utente_tipo_check
      CHECK (tipo_valutazione IN ('mensile','trimestrale','quadrimestrale','semestrale','annuale','straordinaria'));
  END IF;
END$$;

-- 6. Skills (competenze trasversali, distinte dalle mansioni operative)
-- ============================================================
CREATE TABLE IF NOT EXISTS skills (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruolo_professionale_id UUID REFERENCES ruoli_professionali(id) ON DELETE CASCADE,
  nome                   TEXT NOT NULL,
  descrizione            TEXT,
  ordine                 INT  NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Skills associate a una sessione utente
CREATE TABLE IF NOT EXISTS sessione_skills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessione_id UUID NOT NULL REFERENCES sessioni_utente(id) ON DELETE CASCADE,
  skill_id    UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE (sessione_id, skill_id)
);

-- 7. Storico punteggi (import anni precedenti + aggancio sessioni)
-- ============================================================
CREATE TABLE IF NOT EXISTS storico_punteggi (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  utente_id        UUID NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  data_valutazione DATE NOT NULL,
  anno             INT  NOT NULL,
  punteggio        NUMERIC(5,2) NOT NULL,
  note             TEXT,
  tipo_fonte       TEXT NOT NULL DEFAULT 'import'
    CHECK (tipo_fonte IN ('import', 'sessione')),
  sessione_id      UUID REFERENCES sessioni_utente(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Aggiorna is_valutazioni_admin: usa p_user_id (fix collision) + supporta 'amministratore'
-- ============================================================
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
      AND ruolo IN ('superadmin', 'amministratore')
  );
$$;

-- 9. Permessi portale per dipendente (estensione permessi_utente)
-- ============================================================
-- permessi_utente già esiste con is_portal_admin.
-- Aggiungiamo can_access esplicito per gestire accordion per-dipendente
ALTER TABLE permessi_utente ADD COLUMN IF NOT EXISTS can_access BOOLEAN NOT NULL DEFAULT true;

-- 10. RLS per nuove tabelle
-- ============================================================
ALTER TABLE ruoli_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reparti           ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessione_skills   ENABLE ROW LEVEL SECURITY;
ALTER TABLE storico_punteggi  ENABLE ROW LEVEL SECURITY;

-- ruoli_config: tutti leggono, solo admin scrive
CREATE POLICY "ruoli_config_select" ON ruoli_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ruoli_config_admin" ON ruoli_config
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- reparti: tutti leggono, solo admin scrive
CREATE POLICY "reparti_select" ON reparti
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "reparti_admin" ON reparti
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- skills
CREATE POLICY "skills_select" ON skills
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "skills_admin" ON skills
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- sessione_skills
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

-- storico_punteggi
CREATE POLICY "storico_select" ON storico_punteggi
  FOR SELECT TO authenticated
  USING (utente_id = auth.uid() OR is_valutazioni_admin(auth.uid()));
CREATE POLICY "storico_admin" ON storico_punteggi
  FOR ALL TO authenticated USING (is_valutazioni_admin(auth.uid()));

-- 11. Trigger updated_at su nuove tabelle
-- ============================================================
CREATE TRIGGER ruoli_config_updated_at
  BEFORE UPDATE ON ruoli_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 12. Funzione helper per aggiungere punteggio da sessione completata
-- ============================================================
-- Quando una sessione diventa 'completata', inserisce automaticamente
-- il punteggio medio responsabile in storico_punteggi (solo tipo 'annuale')
CREATE OR REPLACE FUNCTION sync_storico_punteggio()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_media NUMERIC;
BEGIN
  -- Solo per valutazioni annuali che passano a 'completata'
  IF NEW.stato = 'completata'
    AND OLD.stato != 'completata'
    AND NEW.tipo_valutazione = 'annuale'
  THEN
    SELECT AVG(rv.punteggio)
    INTO v_media
    FROM risposte_valutazione rv
    WHERE rv.sessione_utente_id = NEW.id
      AND rv.tipo = 'responsabile';

    IF v_media IS NOT NULL THEN
      INSERT INTO storico_punteggi
        (utente_id, data_valutazione, anno, punteggio, tipo_fonte, sessione_id)
      VALUES
        (NEW.utente_id,
         COALESCE(NEW.data_programmata, CURRENT_DATE),
         NEW.anno,
         ROUND(v_media, 2),
         'sessione',
         NEW.id)
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessioni_sync_storico
  AFTER UPDATE ON sessioni_utente
  FOR EACH ROW EXECUTE FUNCTION sync_storico_punteggio();
ALTER TABLE utenti ADD COLUMN IF NOT EXISTS data_assunzione DATE;
