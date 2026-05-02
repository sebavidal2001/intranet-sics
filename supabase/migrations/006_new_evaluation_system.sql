-- ============================================================
-- Migration 006: Nuovo sistema valutazioni + ruoli aggiornati
-- ============================================================

-- 1. Aggiorna constraint ruolo su utenti
--    Nuovi ruoli: superadmin, admin, responsabile, collaboratore
--    (direttore → responsabile, addetto → collaboratore)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'utenti_ruolo_check' AND table_name = 'utenti'
  ) THEN
    ALTER TABLE utenti DROP CONSTRAINT utenti_ruolo_check;
  END IF;
END$$;

-- Migra dati esistenti
UPDATE utenti SET ruolo = 'responsabile' WHERE ruolo = 'direttore';
UPDATE utenti SET ruolo = 'collaboratore' WHERE ruolo = 'addetto';

ALTER TABLE utenti ADD CONSTRAINT utenti_ruolo_check
  CHECK (ruolo IN ('superadmin', 'admin', 'responsabile', 'collaboratore'));

-- 2. Supporto multi-ruolo: ruoli aggiuntivi per utente
-- ============================================================
ALTER TABLE utenti ADD COLUMN IF NOT EXISTS ruoli_aggiuntivi TEXT[] DEFAULT '{}';

-- 3. is_portal_admin su permessi_utente
-- ============================================================
ALTER TABLE permessi_utente ADD COLUMN IF NOT EXISTS is_portal_admin BOOLEAN NOT NULL DEFAULT false;

-- Aggiorna permessi_portale con nuovi nomi ruolo
UPDATE permessi_portale SET ruolo = 'responsabile' WHERE ruolo = 'direttore';
UPDATE permessi_portale SET ruolo = 'collaboratore' WHERE ruolo = 'addetto';

-- Reinserisce permessi con i nuovi nomi (in caso di righe già corrette rimangono)
WITH p AS (SELECT id FROM portali WHERE slug = 'valutazioni')
INSERT INTO permessi_portale (portale_id, ruolo, can_access, can_export, can_approve)
SELECT p.id, r.ruolo, r.can_access, r.can_export, r.can_approve
FROM p, (VALUES
  ('admin',          true, true,  true),
  ('responsabile',   true, true,  false),
  ('collaboratore',  true, false, false)
) AS r(ruolo, can_access, can_export, can_approve)
ON CONFLICT (portale_id, ruolo) DO NOTHING;

-- 4. Ruoli professionali (es. Magazziniere, Back Office)
-- ============================================================
CREATE TABLE IF NOT EXISTS ruoli_professionali (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  descrizione TEXT,
  portale_id  UUID REFERENCES portali(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Mansioni per ruolo professionale
--    Ogni mansione agganciata a un parametro radar
-- ============================================================
CREATE TABLE IF NOT EXISTS mansioni (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruolo_professionale_id  UUID NOT NULL REFERENCES ruoli_professionali(id) ON DELETE CASCADE,
  testo                   TEXT NOT NULL,
  parametro_radar_id      UUID REFERENCES parametri_radar(id) ON DELETE SET NULL,
  ordine                  INT NOT NULL DEFAULT 0,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Profili professionali assegnati a ogni utente (N:N)
-- ============================================================
CREATE TABLE IF NOT EXISTS utente_profili (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  utente_id               UUID NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  ruolo_professionale_id  UUID NOT NULL REFERENCES ruoli_professionali(id) ON DELETE CASCADE,
  UNIQUE (utente_id, ruolo_professionale_id)
);

-- 7. Mansioni attive per utente (subset selezionato dall'admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS utente_mansioni (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  utente_id   UUID NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  mansione_id UUID NOT NULL REFERENCES mansioni(id) ON DELETE CASCADE,
  UNIQUE (utente_id, mansione_id)
);

-- 8. Sessioni di valutazione per singolo utente
-- ============================================================
CREATE TABLE IF NOT EXISTS sessioni_utente (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  utente_id        UUID NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  responsabile_id  UUID REFERENCES utenti(id) ON DELETE SET NULL,
  scala_id         UUID REFERENCES scale_valutazione(id) ON DELETE SET NULL,
  anno             INT NOT NULL,
  data_programmata DATE,
  stato            TEXT NOT NULL DEFAULT 'programmata'
    CHECK (stato IN (
      'programmata',
      'resp_in_corso',
      'resp_completata',
      'collab_in_corso',
      'completata',
      'certificata'
    )),
  note_admin       TEXT,
  certificato_url  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Risposte valutazione (nuovo sistema)
-- ============================================================
CREATE TABLE IF NOT EXISTS risposte_valutazione (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sessione_utente_id  UUID NOT NULL REFERENCES sessioni_utente(id) ON DELETE CASCADE,
  mansione_id         UUID NOT NULL REFERENCES mansioni(id) ON DELETE CASCADE,
  valutatore_id       UUID NOT NULL REFERENCES utenti(id) ON DELETE CASCADE,
  punteggio           NUMERIC NOT NULL,
  tipo                TEXT NOT NULL CHECK (tipo IN ('responsabile', 'autovalutazione')),
  note                TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sessione_utente_id, mansione_id, tipo)
);

-- 10. RLS per tutte le nuove tabelle
-- ============================================================
ALTER TABLE ruoli_professionali  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mansioni             ENABLE ROW LEVEL SECURITY;
ALTER TABLE utente_profili       ENABLE ROW LEVEL SECURITY;
ALTER TABLE utente_mansioni      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessioni_utente      ENABLE ROW LEVEL SECURITY;
ALTER TABLE risposte_valutazione ENABLE ROW LEVEL SECURITY;

-- Helper: verifica admin del portale valutazioni
CREATE OR REPLACE FUNCTION is_valutazioni_admin(user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1
    FROM permessi_utente pu
    JOIN portali p ON p.id = pu.portale_id
    WHERE pu.utente_id = user_id
      AND pu.is_portal_admin = true
      AND p.slug = 'valutazioni'
  ) OR EXISTS (
    SELECT 1 FROM utenti WHERE id = user_id AND ruolo = 'superadmin'
  );
$$;

-- Ruoli professionali: admin valutazioni + superadmin gestiscono, tutti autenticati leggono
CREATE POLICY "ruoli_prof_select" ON ruoli_professionali
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "ruoli_prof_admin" ON ruoli_professionali
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()));

-- Mansioni: stessa logica
CREATE POLICY "mansioni_select" ON mansioni
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "mansioni_admin" ON mansioni
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()));

-- Utente profili: admin vede tutto, utente vede i propri
CREATE POLICY "utente_profili_select" ON utente_profili
  FOR SELECT TO authenticated
  USING (utente_id = auth.uid() OR is_valutazioni_admin(auth.uid()));

CREATE POLICY "utente_profili_admin" ON utente_profili
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()));

-- Utente mansioni: stessa logica
CREATE POLICY "utente_mansioni_select" ON utente_mansioni
  FOR SELECT TO authenticated
  USING (utente_id = auth.uid() OR is_valutazioni_admin(auth.uid()));

CREATE POLICY "utente_mansioni_admin" ON utente_mansioni
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()));

-- Sessioni utente: admin vede tutto, responsabile vede le proprie, utente vede la propria
CREATE POLICY "sessioni_utente_select" ON sessioni_utente
  FOR SELECT TO authenticated
  USING (
    utente_id = auth.uid()
    OR responsabile_id = auth.uid()
    OR is_valutazioni_admin(auth.uid())
  );

CREATE POLICY "sessioni_utente_admin_write" ON sessioni_utente
  FOR ALL TO authenticated
  USING (is_valutazioni_admin(auth.uid()));

-- Risposte valutazione
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

CREATE POLICY "risposte_val_insert" ON risposte_valutazione
  FOR INSERT TO authenticated
  WITH CHECK (valutatore_id = auth.uid());

CREATE POLICY "risposte_val_update" ON risposte_valutazione
  FOR UPDATE TO authenticated
  USING (valutatore_id = auth.uid());

-- 11. Aggiorna RLS esistenti su utenti per includere is_valutazioni_admin
-- ============================================================
-- Permetti admin valutazioni di leggere tutti gli utenti
CREATE POLICY "utenti_valutazioni_admin_select" ON utenti
  FOR SELECT TO authenticated
  USING (is_valutazioni_admin(auth.uid()));

-- 12. Trigger updated_at su sessioni_utente
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sessioni_utente_updated_at
  BEFORE UPDATE ON sessioni_utente
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER ruoli_prof_updated_at
  BEFORE UPDATE ON ruoli_professionali
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
