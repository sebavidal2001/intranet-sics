-- Migration 052: estensione schema template per catena/guida + seed Nastro Flexmove.
-- Il Nastro ha componenti che portano sotto-costi di CATENA e GUIDA (metri/pezzo)
-- a tariffe €/m condivise (dal listino Epicor → placeholder 0 finché non disponibile).
-- Catena/guida sono mostrate SCORPORATE come 2 righe aggregate (FSPC-5/1, FASR-25U/1):
--   qty = Σ(metri × q.tà componente), costo unit = €/m, ricarico = catena/guida_ricarico.

ALTER TABLE preventivatore.template
  ADD COLUMN IF NOT EXISTS usa_catena_guida boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS costo_catena_m numeric NOT NULL DEFAULT 0,   -- da listino (placeholder)
  ADD COLUMN IF NOT EXISTS costo_guida_m  numeric NOT NULL DEFAULT 0,   -- da listino (placeholder)
  ADD COLUMN IF NOT EXISTS catena_codice text DEFAULT 'FSPC-5/1',
  ADD COLUMN IF NOT EXISTS catena_descrizione text DEFAULT 'CATENA',
  ADD COLUMN IF NOT EXISTS catena_ricarico numeric NOT NULL DEFAULT 0.65,
  ADD COLUMN IF NOT EXISTS guida_codice text DEFAULT 'FASR-25U/1',
  ADD COLUMN IF NOT EXISTS guida_descrizione text DEFAULT 'GUIDA',
  ADD COLUMN IF NOT EXISTS guida_ricarico numeric NOT NULL DEFAULT 0.65;

ALTER TABLE preventivatore.template_righe_materiale
  ADD COLUMN IF NOT EXISTS metri_catena numeric NOT NULL DEFAULT 0,   -- metri catena per pezzo
  ADD COLUMN IF NOT EXISTS metri_guida  numeric NOT NULL DEFAULT 0;   -- metri guida per pezzo

-- ── Seed template Nastro Flexmove ───────────────────────────────────────────
DO $$
DECLARE v_tpl uuid;
BEGIN
  DELETE FROM preventivatore.template WHERE slug = 'nastro_flexmove';
  INSERT INTO preventivatore.template (nome, slug, descrizione, ordine,
    consegna_settimane_min, consegna_settimane_max,
    ricarico_materiale_default, ricarico_manodopera_default,
    usa_catena_guida, costo_catena_m, costo_guida_m,
    catena_codice, catena_descrizione, catena_ricarico,
    guida_codice, guida_descrizione, guida_ricarico)
  VALUES ('Nastro Flexmove', 'nastro_flexmove',
    'Trasportatore Flexmove serie FM (componenti con catena e guida da listino)', 5,
    6, 8, 0.65, 0.7,
    true, 0, 0,
    'FSPC-5/1', 'CATENA', 0.65,
    'FASR-25U/1', 'GUIDA', 0.65)
  RETURNING id INTO v_tpl;

  -- Componenti Flexmove: costo da LISTINO (usa_listino, placeholder 0) + metri catena/guida per pezzo
  INSERT INTO preventivatore.template_righe_materiale
    (template_id, slug, descrizione, codice_articolo, usa_listino, ricarico_default, qta_manuale, metri_catena, metri_guida, gruppo, ordine) VALUES
    (v_tpl, 'testata_folle',  'TESTATA FOLLE',                    'FMIE-A85',        true, 0.65, 0, 0.8,  0.5,  'flexmove', 1),
    (v_tpl, 'testata_motore', 'TESTATA MOTORE',                   'FMDD-A85GP/0L/R', true, 0.65, 0, 0.8,  0.5,  'flexmove', 2),
    (v_tpl, 'modulo_catena',  'MODULO INSERIMENTO CATENA',        'FMCC-160',        true, 0.65, 0, 0.32, 0.64, 'flexmove', 3),
    (v_tpl, 'curva_oriz_90',  'CURVA ORIZZONTALE 90° R=300mm',    'FMHB-90R300',     true, 0.65, 0, 1.8,  3.5,  'flexmove', 4),
    (v_tpl, 'curva_vert_5',   'CURVA VERTICALE 5° R=400mm',       'FMVB-5R400',      true, 0.65, 0, 0.4,  0.8,  'flexmove', 5),
    (v_tpl, 'staffe_unione',  'STAFFE UNIONE TRAVI',              'FACS-25×140A',    true, 0.65, 0, 0,    0,    'flexmove', 6),
    (v_tpl, 'trave',          'TRAVE + 4 GUIDE + CATENA (per m)', 'FSCB-3',          true, 0.65, 0, 2,    4,    'flexmove', 7);

  -- Accessori IMA: costo MANUALE (non listino), ricarico 0,7, niente catena/guida
  INSERT INTO preventivatore.template_righe_materiale
    (template_id, slug, descrizione, codice_articolo, costo_manuale, ricarico_default, qta_manuale, gruppo, ordine) VALUES
    (v_tpl, 'campana',        'CAMPANA MOTORIDUTTORE',            'D.5912701', 63.5, 0.7, 0, 'accessori_ima', 8),
    (v_tpl, 'motoriduttore',  'MOTORIDUTTORE LENZE 1:28,8 0,55KW','D.5912748', 413,  0.7, 0, 'accessori_ima', 9);

  INSERT INTO preventivatore.template_righe_manodopera
    (template_id, label, tariffa_default, unita_tempo, modalita, ricarico_default, ordine) VALUES
    (v_tpl, 'PROGETTAZIONE', 33.61, 'h', 'una_tantum', 0.7, 1),
    (v_tpl, 'LAVORAZIONE',   27.98, 'h', 'per_pezzo',  0.7, 2),
    (v_tpl, 'MONTAGGIO',     23.88, 'h', 'per_pezzo',  0.7, 3),
    (v_tpl, 'COLLAUDO',      27.98, 'h', 'per_pezzo',  0.7, 4),
    (v_tpl, 'MANUALE',       33.61, 'h', 'una_tantum', 0.7, 5);
END $$;

NOTIFY pgrst, 'reload schema';
