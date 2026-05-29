-- Migration 050: seed template Protezioni (parametrico), Telai & Protezioni (BOM manuale),
-- Pezzi di Lavorazione (manodopera in minuti). Estratti dagli Excel SICS.
-- Nastro Flexmove escluso (richiede listino). Idempotente per slug.

DO $$
DECLARE v_tpl uuid;
BEGIN
  -- ========================= PROTEZIONI (parametrico) =========================
  DELETE FROM preventivatore.template WHERE slug = 'protezioni';
  INSERT INTO preventivatore.template (nome, slug, descrizione, ordine,
    consegna_settimane_min, consegna_settimane_max, ricarico_materiale_default, ricarico_manodopera_default)
  VALUES ('Protezioni', 'protezioni', 'Protezioni a pannelli parametriche', 20, 4, 6, 0.5, 0.7)
  RETURNING id INTO v_tpl;

  INSERT INTO preventivatore.template_parametri (template_id, slug, label, tipo, unita, valore_default, ordine) VALUES
    (v_tpl, 'larghezza',  'Larghezza pannello',  'number', 'mm', '0', 1),
    (v_tpl, 'altezza',    'Altezza pannello',    'number', 'mm', '0', 2),
    (v_tpl, 'profondita', 'Profondità pannello', 'number', 'mm', '0', 3),
    (v_tpl, 'cerniere',   'Cerniere',            'bool',   '',   'no', 4),
    (v_tpl, 'calamite',   'Calamite',            'bool',   '',   'no', 5),
    (v_tpl, 'maniglie',   'Maniglie',            'bool',   '',   'no', 6),
    (v_tpl, 'molle',      'Molle a gas',         'bool',   '',   'no', 7);

  INSERT INTO preventivatore.template_righe_materiale (template_id, slug, descrizione, codice_articolo, costo_manuale, ricarico_default, qta_formula, gruppo, ordine) VALUES
    (v_tpl, 'profilo_30',     'PROFILO 30×30 Sp.5',      '013.030.004',                   5.92, 0.5, '(larghezza*2+altezza*2+profondita*2)/1000', 'materie_prime', 1),
    (v_tpl, 'pannello_front', 'PANNELLO FRONTALE',       'POLCA/LYX/TRA/5',               18.61,0.5, '(larghezza*altezza)/1000000', 'materie_prime', 2),
    (v_tpl, 'pannello_lat',   'PANNELLO LATERALE',       'POLCA/LYX/TRA/5',               18.61,0.5, '(altezza*profondita)/1000000', 'materie_prime', 3),
    (v_tpl, 'profilo_90',     'PROFILO 30×30 90° Sp.5',  '013.030.010',                   7.72, 0.5, 'IF(profondita>0, altezza/1000, 0)', 'materie_prime', 4),
    (v_tpl, 'profilo_2vie',   'PROFILO 30×30 2 VIE Sp.5','013.030.005',                   7.75, 0.5, 'IF(larghezza>800, altezza/1000, 0)', 'materie_prime', 5),
    (v_tpl, 'giunti_angolo',  'GIUNTI AD ANGOLO',        '013.030.121',                   2.46, 0.5, 'IF(AND(larghezza>0,altezza>0),4,0)', 'materie_prime', 6),
    (v_tpl, 'giunti_3vie',    'GIUNTI A 3 VIE',          '013.030.101',                   1.57, 0.5, 'IF(profilo_90>0,2,0)', 'materie_prime', 7),
    (v_tpl, 'giunto_dritto',  'GIUNTO DRITTO Sp.5',      '013.030.132',                   1.05, 0.5, 'IF(profilo_2vie>0,2,0)', 'materie_prime', 8),
    (v_tpl, 'cerniere_r',     'CERNIERE',                '013.100.027',                   8.37, 0.5, 'IF(cerniere, IF(altezza<=600,2,3), 0)', 'materie_prime', 9),
    (v_tpl, 'maniglie_r',     'MANIGLIE',                '013.506.009 + 013.506.010G',    1.58, 0.5, 'IF(maniglie,1,0)', 'materie_prime', 10),
    (v_tpl, 'calamite_r',     'CALAMITE',                '084.523.001 + 084.522.003',     4.5,  0.5, 'IF(calamite,2,0)', 'materie_prime', 11),
    (v_tpl, 'molle_r',        'MOLLE A GAS',             'COM.045.808.0015',              21,   0.5, 'IF(molle,2,0)', 'materie_prime', 12),
    (v_tpl, 'supporti_molle', 'SUPPORTI MOLLE',          '084.528.001',                   1.06, 0.5, 'IF(molle,4,0)', 'materie_prime', 13),
    (v_tpl, 'rinforzi_angoli','RINFORZI ANGOLI',         '013.100.022',                   8.62, 0.5, 'IF(profilo_90>0,2,0)', 'materie_prime', 14);

  INSERT INTO preventivatore.template_righe_manodopera (template_id, label, tariffa_default, unita_tempo, modalita, ricarico_default, ordine) VALUES
    (v_tpl, 'PROGETTAZIONE',        33.61, 'h', 'una_tantum', 0.7, 1),
    (v_tpl, 'TAGLIO & LAVORAZIONI', 27.98, 'h', 'per_pezzo',  0.7, 2),
    (v_tpl, 'MONTAGGIO',            23.88, 'h', 'per_pezzo',  0.7, 3);

  -- ===================== TELAI & PROTEZIONI (BOM manuale) =====================
  DELETE FROM preventivatore.template WHERE slug = 'telai_protezioni';
  INSERT INTO preventivatore.template (nome, slug, descrizione, ordine,
    consegna_settimane_min, consegna_settimane_max, ricarico_materiale_default, ricarico_manodopera_default)
  VALUES ('Telai & Protezioni', 'telai_protezioni', 'Telai/protezioni con distinta manuale (ricarico per riga)', 30, 4, 6, 0.6, 0.7)
  RETURNING id INTO v_tpl;

  INSERT INTO preventivatore.template_righe_materiale (template_id, slug, descrizione, codice_articolo, costo_manuale, ricarico_default, gruppo, ordine) VALUES
    (v_tpl, 'profilo_30',     'PROFILO 30×30',       '013.030.001',                NULL, 0.6, 'materie_prime', 1),
    (v_tpl, 'giunto_90a',     'GIUNTO 90°',          '013.030.102',                NULL, 0.6, 'materie_prime', 2),
    (v_tpl, 'giunto_dritto',  'GIUNTO DRITTO',       '013.030.104',                NULL, 0.6, 'materie_prime', 3),
    (v_tpl, 'profilo_30_sp4', 'PROFILO 30×30 SP.4',  '013.030.002',                NULL, 0.6, 'materie_prime', 4),
    (v_tpl, 'giunto_90b',     'GIUNTO 90°',          '013.030.101',                NULL, 0.6, 'materie_prime', 5),
    (v_tpl, 'giunto_3vie',    'GIUNTO 3 VIE',        '013.030.121',                NULL, 0.6, 'materie_prime', 6),
    (v_tpl, 'profilo_30_90',  'PROFILO 30×30 90°',   '013.030.009',                NULL, 0.6, 'materie_prime', 7),
    (v_tpl, 'profilo_2cave',  'PROFILO 30×30 2 CAVE','013.030.005',                NULL, 0.6, 'materie_prime', 8),
    (v_tpl, 'giunto_2cave',   'GIUNTO x 2 CAVE',     '013.030.132',                NULL, 0.6, 'materie_prime', 9),
    (v_tpl, 'perni',          'PERNI FISSAGGIO',     '013.100.072',                NULL, 0.6, 'materie_prime', 10),
    (v_tpl, 'nerve',          'NERVE SPORTELLI',     'AFD.00.3.24587.0',           12,   0.6, 'materie_prime', 11),
    (v_tpl, 'maniglie',       'MANIGLIE',            '013.506.009 + 013.506.010G', 2,    0.6, 'materie_prime', 12),
    (v_tpl, 'cerniere',       'CERNIERE',            '013.100.027',                8.5,  0.6, 'materie_prime', 13),
    (v_tpl, 'molle',          'MOLLE A GAS',         'COM.045.808.0013',           22.5, 0.6, 'materie_prime', 14),
    (v_tpl, 'dibond',         'DIBOND',              'APABOND/BI/GR/3',            12,   0.6, 'materie_prime', 15),
    (v_tpl, 'fonoassorbente', 'FONOASSORBENTE',      'STRATOCELL/20',              16,   0.6, 'materie_prime', 16);

  INSERT INTO preventivatore.template_righe_manodopera (template_id, label, tariffa_default, unita_tempo, modalita, ricarico_default, ordine) VALUES
    (v_tpl, 'PROGETTAZIONE',        33.61, 'h', 'una_tantum', 0.7, 1),
    (v_tpl, 'TAGLIO & LAVORAZIONI', 27.98, 'h', 'per_pezzo',  0.7, 2),
    (v_tpl, 'MONTAGGIO',            23.88, 'h', 'per_pezzo',  0.7, 3);

  -- ===================== PEZZI DI LAVORAZIONE (minuti) ========================
  DELETE FROM preventivatore.template WHERE slug = 'pezzi_lavorazione';
  INSERT INTO preventivatore.template (nome, slug, descrizione, ordine,
    consegna_settimane_min, consegna_settimane_max, ricarico_materiale_default, ricarico_manodopera_default)
  VALUES ('Pezzi di Lavorazione', 'pezzi_lavorazione', 'Pezzi meccanici: materie prime + manodopera per fasi (minuti)', 40, 2, 4, 0.5, 0.7)
  RETURNING id INTO v_tpl;

  -- materiale: nessuna riga predefinita (si aggiungono dal builder via ricerca articolo)

  INSERT INTO preventivatore.template_righe_manodopera (template_id, label, tariffa_default, unita_tempo, modalita, ricarico_default, ordine) VALUES
    (v_tpl, 'PROGETTAZIONE',                       33.61, 'min', 'una_tantum', 0.7, 1),
    (v_tpl, 'PRELIEVO MATERIALE',                  27.98, 'min', 'una_tantum', 0.7, 2),
    (v_tpl, 'TAGLIO',                              27.98, 'min', 'una_tantum', 0.7, 3),
    (v_tpl, 'PROGRAMMAZIONE (Pulizia disegno/CAM)',27.98, 'min', 'una_tantum', 0.7, 4),
    (v_tpl, 'PIAZZAMENTO 1',                       27.98, 'min', 'una_tantum', 0.7, 5),
    (v_tpl, 'FASE 1',                              27.98, 'min', 'per_pezzo',  0.7, 6),
    (v_tpl, 'PIAZZAMENTO 2',                       27.98, 'min', 'una_tantum', 0.7, 7),
    (v_tpl, 'FASE 2',                              27.98, 'min', 'per_pezzo',  0.7, 8),
    (v_tpl, 'PIAZZAMENTO 3',                       27.98, 'min', 'una_tantum', 0.7, 9),
    (v_tpl, 'FASE 3',                              27.98, 'min', 'per_pezzo',  0.7, 10),
    (v_tpl, 'PIAZZAMENTO 4',                       27.98, 'min', 'una_tantum', 0.7, 11),
    (v_tpl, 'FASE 4',                              27.98, 'min', 'per_pezzo',  0.7, 12),
    (v_tpl, 'FINITURA',                            27.98, 'min', 'per_pezzo',  0.7, 13),
    (v_tpl, 'COLLAUDO',                            27.98, 'min', 'per_pezzo',  0.7, 14);
END $$;
