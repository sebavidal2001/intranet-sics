-- Migration 016: Sostituisce i tre titoli hardcoded con array dinamico titoli_scheda

-- Aggiunge la colonna JSONB (con default che rispecchia i tre titoli precedenti)
ALTER TABLE certificato_config
  ADD COLUMN IF NOT EXISTS titoli_scheda jsonb NOT NULL DEFAULT '[
    {"titolo": "Scheda di valutazione della prestazione del Personale", "ruoli": ["collaboratore"]},
    {"titolo": "Scheda di valutazione della prestazione dei Coordinatori", "ruoli": ["responsabile_intermedio"]},
    {"titolo": "Scheda di valutazione della prestazione dei Responsabili", "ruoli": ["responsabile"]}
  ]'::jsonb;

-- Migra i dati esistenti (se le colonne vecchie esistono ancora)
UPDATE certificato_config
SET titoli_scheda = jsonb_build_array(
  jsonb_build_object('titolo', titolo_personale, 'ruoli', '["collaboratore"]'::jsonb),
  jsonb_build_object('titolo', titolo_coordinatori, 'ruoli', '["responsabile_intermedio"]'::jsonb),
  jsonb_build_object('titolo', titolo_responsabili, 'ruoli', '["responsabile"]'::jsonb)
)
WHERE
  titolo_personale IS NOT NULL
  AND titoli_scheda = '[
    {"titolo": "Scheda di valutazione della prestazione del Personale", "ruoli": ["collaboratore"]},
    {"titolo": "Scheda di valutazione della prestazione dei Coordinatori", "ruoli": ["responsabile_intermedio"]},
    {"titolo": "Scheda di valutazione della prestazione dei Responsabili", "ruoli": ["responsabile"]}
  ]'::jsonb;

-- Rimuove le vecchie colonne
ALTER TABLE certificato_config
  DROP COLUMN IF EXISTS titolo_personale,
  DROP COLUMN IF EXISTS titolo_coordinatori,
  DROP COLUMN IF EXISTS titolo_responsabili;
