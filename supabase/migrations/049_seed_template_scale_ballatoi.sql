-- Migration 049: seed del template pilota "Scale & Ballatoi".
-- Estratto dall'Excel SCALE & BALLATOI.xlsx (parametri + BOM + manodopera).
-- Idempotente: rimuove e reinserisce il template con slug 'scale_ballatoi'.

DO $$
DECLARE v_tpl uuid;
BEGIN
  DELETE FROM preventivatore.template WHERE slug = 'scale_ballatoi';

  INSERT INTO preventivatore.template (nome, slug, descrizione, ordine,
    consegna_settimane_min, consegna_settimane_max,
    imballaggio_pct, tempi_accessori_pct, spese_generali_pct, margine_default_pct,
    ricarico_materiale_default, ricarico_manodopera_default)
  VALUES ('Scale & Ballatoi', 'scale_ballatoi', 'Scale e ballatoi con balaustra', 10,
    4, 6, 1, 2.8, 24.2, 5, 0.65, 0.7)
  RETURNING id INTO v_tpl;

  INSERT INTO preventivatore.template_parametri (template_id, slug, label, tipo, unita, valore_default, ordine) VALUES
    (v_tpl, 'larghezza', 'Larghezza scala/pianerottolo', 'number', 'mm', '0', 1),
    (v_tpl, 'altezza',   'Altezza pianerottolo',          'number', 'mm', '0', 2),
    (v_tpl, 'lunghezza', 'Lunghezza pianerottolo',        'number', 'mm', '0', 3),
    (v_tpl, 'n_gradini', 'N° gradini scala',              'number', '',   '0', 4),
    (v_tpl, 'n_pali',    'N° pali',                       'number', '',   '0', 5);

  INSERT INTO preventivatore.template_righe_materiale (template_id, slug, descrizione, codice_articolo, costo_manuale, ricarico_default, qta_formula, qta_manuale, gruppo, ordine) VALUES
    (v_tpl, 'fiancate',      'FIANCATE',                       'PRA.08.045.500.A', 24.2, 0.65, NULL, 0, 'materie_prime', 1),
    (v_tpl, 'angolo_ball',   'ANGOLO x BALLATOIO',             'AFD.00.3.25179.0', 1.8,  0.65, NULL, 0, 'materie_prime', 2),
    (v_tpl, 'piatto_inf',    'PIATTO FISSAGGIO INFERIORE',     'AFD.00.3.23124.0', 9.6,  0.65, NULL, 0, 'materie_prime', 3),
    (v_tpl, 'flangia',       'FLANGIA FISSAGGIO TELAI',        'AFD.00.3.24918.0', 11.6, 0.65, NULL, 0, 'materie_prime', 4),
    (v_tpl, 'flangia_700',   'FLANGIA FISSAGGIO TELAI L=700',  'AFD.00.3.24872.0', 41.5, 0.65, NULL, 0, 'materie_prime', 5),
    (v_tpl, 'gradino',       'GRADINO',                        '4525000',          37.5, 0.65, '(larghezza/1000)*n_gradini', 0, 'materie_prime', 6),
    (v_tpl, 'piatto_gradino','PIATTO GRADINO',                 'AFD.00.3.07045.0', 0.6,  0.65, 'n_gradini*2', 0, 'materie_prime', 7),
    (v_tpl, 'piano_calp',    'PIANO CALPESTIO',                'PRA.00.010.011.N', 10.32,0.65, '(larghezza*lunghezza/165)/1000', 0, 'materie_prime', 8),
    (v_tpl, 'palo_balaustra','PALO BALAUSTRA RINFORZATO',      'AFD.00.2.34276.0', 13.9, 0.65, 'n_pali', 0, 'materie_prime', 9),
    (v_tpl, 'tubo_curv',     'TUBO BALAUSTRA (x CURV.)',       'PRA040.-.3TT.TNA', 6.8,  0.65, NULL, 0, 'materie_prime', 10),
    (v_tpl, 'tubo_balaustra','TUBO BALUSTRA',                  'PRA040.-.3TT.T6A', 5.4,  0.65, 'fiancate*2', 0, 'materie_prime', 11),
    (v_tpl, 'giunto45',      'GIUNTO 45° ANGOLO',              '11404521025',      17.81,0.65, NULL, 0, 'materie_prime', 12),
    (v_tpl, 'gomito45',      'GOMITO 45°',                     '11404526025',      16.02,0.65, NULL, 0, 'materie_prime', 13),
    (v_tpl, 'giunto_dritto', 'GIUNTO DRITTO',                  '14403410025',      16.2, 0.65, NULL, 0, 'materie_prime', 14),
    (v_tpl, 'giunto90',      'GIUNTO 90°',                     '11403421025',      11.7, 0.65, NULL, 0, 'materie_prime', 15),
    (v_tpl, 'cancello',      'CANCELLO',                       'AFD.00.2.34289.0', 50.9, 0.65, NULL, 0, 'materie_prime', 16),
    (v_tpl, 'palo_rem',      'PALO REMOVIBILE',                'AFD.00.2.33456.0', 8.6,  0.65, NULL, 0, 'materie_prime', 17),
    (v_tpl, 'piastra45',     'PIASTRA 45°',                    'AFD.00.2.32212.0', 20,   0.65, NULL, 0, 'materie_prime', 18),
    (v_tpl, 'piastra_2liv',  'PIASTRA FISS. BALLATOI SU 2 LIVELLI', 'AFD.00.3.28121.0', 40, 0.65, NULL, 0, 'materie_prime', 19),
    (v_tpl, 'fissaggio_piede','FISSAGGIO PIEDE',               'AFD.00.3.20951.0', 1.5,  0.65, NULL, 0, 'materie_prime', 20),
    (v_tpl, 'piede',         'PIEDE D.80 M16 H 142',           '25/7090',          2.2,  0.65, NULL, 0, 'materie_prime', 21),
    (v_tpl, 'guarnizione',   'GUARNIZIONE',                    'COM.029.041.0004', 0.53, 0.65, 'fiancate', 0, 'materie_prime', 22);

  INSERT INTO preventivatore.template_righe_manodopera (template_id, label, tariffa_default, unita_tempo, tempo_default, modalita, ricarico_default, ordine) VALUES
    (v_tpl, 'PROGETTAZIONE',        33.61, 'h', 0, 'una_tantum', 0.7, 1),
    (v_tpl, 'TAGLIO & LAVORAZIONI', 27.98, 'h', 0, 'per_pezzo',  0.7, 2),
    (v_tpl, 'MONTAGGIO',            23.88, 'h', 0, 'per_pezzo',  0.7, 3);
END $$;
