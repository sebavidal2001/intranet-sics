-- Migration 037: assicura titoli_scheda su certificato_config e ricarica PostgREST

ALTER TABLE certificato_config
  ADD COLUMN IF NOT EXISTS titoli_scheda jsonb NOT NULL DEFAULT '[
    {"titolo": "Scheda di valutazione della prestazione del Personale", "ruoli": ["collaboratore"]},
    {"titolo": "Scheda di valutazione della prestazione dei Coordinatori", "ruoli": ["responsabile_intermedio"]},
    {"titolo": "Scheda di valutazione della prestazione dei Responsabili", "ruoli": ["responsabile"]}
  ]'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'certificato_config'
      AND column_name = 'titolo_personale'
  ) THEN
    EXECUTE $sql$
      UPDATE certificato_config
      SET titoli_scheda = jsonb_build_array(
        jsonb_build_object('titolo', titolo_personale, 'ruoli', '["collaboratore"]'::jsonb),
        jsonb_build_object('titolo', titolo_coordinatori, 'ruoli', '["responsabile_intermedio"]'::jsonb),
        jsonb_build_object('titolo', titolo_responsabili, 'ruoli', '["responsabile"]'::jsonb)
      )
      WHERE titoli_scheda IS NULL
         OR titoli_scheda = '[]'::jsonb
    $sql$;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
