-- ============================================================
-- Migration 010: Skills diventano globali con parametro_radar
--   - Rimuove il legame con ruolo_professionale
--   - Aggiunge parametro_radar_id
-- ============================================================

-- 1. Aggiungi parametro_radar_id
ALTER TABLE skills
  ADD COLUMN IF NOT EXISTS parametro_radar_id UUID REFERENCES parametri_radar(id) ON DELETE SET NULL;

-- 2. Rimuovi ruolo_professionale_id
ALTER TABLE skills
  DROP COLUMN IF EXISTS ruolo_professionale_id;
