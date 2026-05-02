-- ============================================================
-- Migration 009: Aggiungi skill_id a risposte_valutazione
-- ============================================================

-- 1. Aggiungi colonna skill_id (nullable)
ALTER TABLE risposte_valutazione
  ADD COLUMN IF NOT EXISTS skill_id UUID REFERENCES skills(id) ON DELETE CASCADE;

-- 2. Rendi mansione_id nullable
ALTER TABLE risposte_valutazione
  ALTER COLUMN mansione_id DROP NOT NULL;

-- 3. Rimuovi vecchio unique constraint (copertura solo mansioni)
ALTER TABLE risposte_valutazione
  DROP CONSTRAINT IF EXISTS risposte_valutazione_sessione_utente_id_mansione_id_tipo_key;

-- 4. Vincolo: esattamente uno tra mansione_id e skill_id deve essere non null
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'risposte_valutazione_item_check'
      AND table_name = 'risposte_valutazione'
  ) THEN
    ALTER TABLE risposte_valutazione
      ADD CONSTRAINT risposte_valutazione_item_check
      CHECK (
        (mansione_id IS NOT NULL AND skill_id IS NULL) OR
        (mansione_id IS NULL AND skill_id IS NOT NULL)
      );
  END IF;
END$$;

-- 5. Nuovi indici unique parziali
CREATE UNIQUE INDEX IF NOT EXISTS risposte_val_mansione_uniq
  ON risposte_valutazione (sessione_utente_id, mansione_id, tipo)
  WHERE mansione_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS risposte_val_skill_uniq
  ON risposte_valutazione (sessione_utente_id, skill_id, tipo)
  WHERE skill_id IS NOT NULL;

-- 6. RLS: aggiorna policy per includere skill_id
-- Le policy esistenti (008) coprono la tabella, non serve ricrearle.
-- Il controllo RLS usa valutatore_id e sessione_utente_id, non mansione_id.
