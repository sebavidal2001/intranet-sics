-- 088_vettori_listini_2026.sql
--
-- PORTALE CONTROLLO VETTORI — dati di partenza: i quattro vettori e i loro
-- listini 2026, come risultano dai contratti e verificati contro le fatture.
--
-- Ogni numero qui dentro ha una fonte, indicata nel commento accanto. Dove la
-- fonte contrattuale e la fattura non coincidono ha vinto la fattura, che è il
-- documento con cui si paga, e la divergenza è annotata.
--
-- Le tre correzioni rispetto ai fogli di calcolo attuali:
--
--   1) TRADING POST — l'addizionale di gestione è l'11% sul nolo, non il 6%.
--      Verificato su 67 righe di fattura di luglio e agosto 2026: il rapporto
--      è 11,0% esatto su tutte, mai una eccezione. Il foglio degli arrivi usa
--      il 6% su tutte le fasce e quello delle partenze torna al 6% oltre i
--      100 kg: un aggiornamento fatto a metà tabella, che sottostima il costo
--      atteso del 4,7% su ogni spedizione.
--
--   2) TRADING POST — l'11% NON è carburante ma una voce contrattuale fissa
--      ("Addizionale di Gestione 11% sul nolo"). Sta quindi nel listino, non
--      nella tabella del carburante mensile. La distinzione conta in trattativa:
--      sul carburante non si tratta, sull'addizionale sì.
--
--   3) TNT e FEDEX — hanno gli stessi importi ma soglie di fascia diverse. Sul
--      listino FedEx del 27 febbraio 2026 la fascia 1,5-4 kg costa 7,22 €,
--      mentre sul foglio TNT una spedizione da 3,95 kg cade in 3,1-5 e costa
--      8,00 €. La fattura TNT di luglio addebita 8,00 € su 3,95 kg: per TNT
--      valgono le soglie del foglio. Sono quindi due listini distinti.
--
-- Idempotente: rieseguirla non duplica nulla.

-- ============================================================
-- 1) I VETTORI
-- ============================================================
INSERT INTO vettori.vettori
  (codice, nome, ragione_sociale, modello_tariffa, divisore_volumetrico,
   peso_minimo_tassabile, arrotondamento_kg, arrotondamento_da_kg, a_nostro_carico, note)
VALUES
  ('gls', 'GLS', 'GLS Enterprise S.r.l.', 'scaglioni', 300, 0, 0, 0, true,
   'Contratto 667, listino 667, codice cliente 90297. Unico vettore che applica adeguamento ISTAT, con arretrati.'),
  ('tnt', 'TNT', 'TNT Global Express', 'scaglioni', 250, 0, 0, 0, true,
   'Soglie di fascia dal foglio in uso, validate sulla fattura di luglio 2026. Importi identici a FedEx. Divisore 250 kg/mc verificato: 0,166 mc in fattura risultano 41,50 kg tassabili.'),
  ('fedex', 'FedEx', 'FedEx Express Italy S.r.l.', 'scaglioni', 250, 0, 0, 0, true,
   'Conto 893833692. Listino FedEx Priority zona 1 del 27 febbraio 2026. La fattura non ha testo leggibile: le righe si acquisiscono per riconoscimento ottico con conferma.'),
  ('trading_post', 'Trading Post', 'Trading Post Express Service S.r.l.', 'scaglioni', 300, 3, 100, 100, true,
   'Convenzione TP/1260. Importo fisso per fascia fino a 100 kg, poi 22,50 €/quintale. Minimo tassabile 3 kg e arrotondamento ai 100 kg oltre il quintale, entrambi visibili in fattura: 1 kg risulta tassato 3, e 170 kg risultano 200. DA CHIARIRE al collaudo: la convenzione recita «Fino a Ql. 5,0 ai 100,0 - oltre ai 100,0 Kg.», leggibile anche come "sopra i 500 kg si arrotonda al kg". Tutte le righe di fattura osservate confermano l''arrotondamento ai 100 kg, ma la più pesante è di 210 kg: sopra i 500 non c''è evidenza.')
ON CONFLICT (codice) DO NOTHING;

-- ============================================================
-- 2) ZONE E COPERTURA
-- ============================================================
INSERT INTO vettori.zone (vettore_id, codice, nome, is_default, ordine)
SELECT v.id, z.codice, z.nome, z.is_default, z.ordine
FROM vettori.vettori v
JOIN (VALUES
  ('gls',          'IT',          'Italia',                        true,  10),
  ('gls',          'CAL_SIC',     'Calabria e Sicilia',            false, 20),
  ('gls',          'SARD',        'Sardegna',                      false, 30),
  ('tnt',          'IT',          'Italia',                        true,  10),
  ('fedex',        'Z1',          'Italia zona 1',                 true,  10),
  ('trading_post', 'ER_LOM_PIE',  'Emilia, Lombardia, Piemonte',   false, 10)
) AS z(vettore, codice, nome, is_default, ordine) ON z.vettore = v.codice
ON CONFLICT (vettore_id, codice) DO NOTHING;

-- Trading Post non ha zona di ripiego: fuori da queste province non ci arriva,
-- e il simulatore deve dirlo invece di calcolare un prezzo che non esiste.
INSERT INTO vettori.zone_province (zona_id, provincia)
SELECT z.id, p.provincia
FROM vettori.zone z
JOIN vettori.vettori v ON v.id = z.vettore_id
JOIN (VALUES
  -- GLS Calabria e Sicilia
  ('gls','CAL_SIC','CS'),('gls','CAL_SIC','CZ'),('gls','CAL_SIC','KR'),
  ('gls','CAL_SIC','RC'),('gls','CAL_SIC','VV'),('gls','CAL_SIC','AG'),
  ('gls','CAL_SIC','CL'),('gls','CAL_SIC','CT'),('gls','CAL_SIC','EN'),
  ('gls','CAL_SIC','ME'),('gls','CAL_SIC','PA'),('gls','CAL_SIC','RG'),
  ('gls','CAL_SIC','SR'),('gls','CAL_SIC','TP'),
  -- GLS Sardegna
  ('gls','SARD','CA'),('gls','SARD','NU'),('gls','SARD','OR'),
  ('gls','SARD','SS'),('gls','SARD','SU'),
  -- Trading Post: Emilia-Romagna
  ('trading_post','ER_LOM_PIE','BO'),('trading_post','ER_LOM_PIE','FE'),
  ('trading_post','ER_LOM_PIE','FC'),('trading_post','ER_LOM_PIE','MO'),
  ('trading_post','ER_LOM_PIE','PR'),('trading_post','ER_LOM_PIE','PC'),
  ('trading_post','ER_LOM_PIE','RA'),('trading_post','ER_LOM_PIE','RE'),
  ('trading_post','ER_LOM_PIE','RN'),
  -- Trading Post: Lombardia
  ('trading_post','ER_LOM_PIE','BG'),('trading_post','ER_LOM_PIE','BS'),
  ('trading_post','ER_LOM_PIE','CO'),('trading_post','ER_LOM_PIE','CR'),
  ('trading_post','ER_LOM_PIE','LC'),('trading_post','ER_LOM_PIE','LO'),
  ('trading_post','ER_LOM_PIE','MN'),('trading_post','ER_LOM_PIE','MI'),
  ('trading_post','ER_LOM_PIE','MB'),('trading_post','ER_LOM_PIE','PV'),
  ('trading_post','ER_LOM_PIE','SO'),('trading_post','ER_LOM_PIE','VA'),
  -- Trading Post: Piemonte
  ('trading_post','ER_LOM_PIE','AL'),('trading_post','ER_LOM_PIE','AT'),
  ('trading_post','ER_LOM_PIE','BI'),('trading_post','ER_LOM_PIE','CN'),
  ('trading_post','ER_LOM_PIE','NO'),('trading_post','ER_LOM_PIE','TO'),
  ('trading_post','ER_LOM_PIE','VB'),('trading_post','ER_LOM_PIE','VC')
) AS p(vettore, zona, provincia)
  ON p.vettore = v.codice AND p.zona = z.codice
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3) LISTINI 2026
-- ============================================================
INSERT INTO vettori.listini (vettore_id, etichetta, valido_dal, origine, note)
SELECT v.id, l.etichetta, l.valido_dal::date, l.origine, l.note
FROM vettori.vettori v
JOIN (VALUES
  ('gls', 'Tariffe nazionali 2026', '2026-01-19',
   'Politiche Commerciali GLS 2026 del 15/12/2025 + listino contratto 667',
   'Adeguamento nolo +1,8%, introduzione supplemento Handling 0,03 €/kg, Oversized a 9,00 €/collo.'),
  ('tnt', 'Tariffe nazionali 2026', '2026-01-01',
   'Foglio tariffe in uso, validato sulla fattura di luglio 2026',
   'Soglie di fascia diverse da FedEx pur avendo gli stessi importi: su 3,95 kg la fattura addebita 8,00 €, coerente con la fascia 3,1-5.'),
  ('fedex', 'FedEx Priority zona 1', '2026-02-27',
   'Listini prezzi FedEx, conto 893833692, validi dal 27-FEB-2026',
   'Addebito minimo 5,78 €. Zona 2 non caricata: da inserire se emergono spedizioni fuori zona 1.'),
  ('trading_post', 'Convenzione tariffe preferenziali 2026', '2026-05-11',
   'Convenzione TP/1260 dell''11 maggio 2026',
   'Addizionale di gestione 11% sul nolo, verificata su 67 righe di fattura di luglio e agosto: 11,0% esatto su tutte.')
) AS l(vettore, etichetta, valido_dal, origine, note) ON l.vettore = v.codice
WHERE NOT EXISTS (
  SELECT 1 FROM vettori.listini x WHERE x.vettore_id = v.id AND x.valido_al IS NULL
);

-- ============================================================
-- 4) FASCE DI PESO
-- ============================================================
INSERT INTO vettori.listini_fasce
  (listino_id, zona_id, peso_da, peso_a, importo, tipo, scatto_kg, scatto_importo, ordine)
SELECT li.id, z.id, f.peso_da, f.peso_a, f.importo, 'fisso', f.scatto_kg, f.scatto_importo, f.ordine
FROM vettori.vettori v
JOIN vettori.listini li ON li.vettore_id = v.id AND li.valido_al IS NULL
JOIN vettori.zone    z  ON z.vettore_id  = v.id
JOIN (VALUES
  -- GLS Italia — listino contratto 667, zona AIRFLUID
  ('gls','IT',      0.000,   3.000,   8.04, NULL::numeric, NULL::numeric, 10),
  ('gls','IT',      3.000,   5.000,   8.68, NULL, NULL, 20),
  ('gls','IT',      5.000,  10.000,   9.63, NULL, NULL, 30),
  ('gls','IT',     10.000,  20.000,  12.00, NULL, NULL, 40),
  ('gls','IT',     20.000,  30.000,  15.24, NULL, NULL, 50),
  ('gls','IT',     30.000,  50.000,  23.91, NULL, NULL, 60),
  ('gls','IT',     50.000, 100.000,  36.91, NULL, NULL, 70),
  ('gls','IT',    100.000,    NULL,  36.91, 50.0, 18.10, 80),
  -- GLS Calabria e Sicilia — zona JH
  ('gls','CAL_SIC', 0.000,   3.000,  12.00, NULL, NULL, 10),
  ('gls','CAL_SIC', 3.000,   5.000,  12.90, NULL, NULL, 20),
  ('gls','CAL_SIC', 5.000,  10.000,  13.64, NULL, NULL, 30),
  ('gls','CAL_SIC',10.000,  20.000,  16.03, NULL, NULL, 40),
  ('gls','CAL_SIC',20.000,  30.000,  19.26, NULL, NULL, 50),
  ('gls','CAL_SIC',30.000,  50.000,  27.92, NULL, NULL, 60),
  ('gls','CAL_SIC',50.000, 100.000,  41.74, NULL, NULL, 70),
  ('gls','CAL_SIC',100.000,   NULL,  41.74, 50.0, 20.46, 80),
  -- GLS Sardegna — zona ZZ
  ('gls','SARD',    0.000,   3.000,  13.64, NULL, NULL, 10),
  ('gls','SARD',    3.000,   5.000,  15.82, NULL, NULL, 20),
  ('gls','SARD',    5.000,  10.000,  17.65, NULL, NULL, 30),
  ('gls','SARD',   10.000,  20.000,  20.06, NULL, NULL, 40),
  ('gls','SARD',   20.000,  30.000,  25.51, NULL, NULL, 50),
  ('gls','SARD',   30.000,  50.000,  35.30, NULL, NULL, 60),
  ('gls','SARD',   50.000, 100.000,  57.78, NULL, NULL, 70),
  ('gls','SARD',  100.000,    NULL,  57.78, 50.0, 28.32, 80),
  -- TNT Italia — soglie dal foglio, validate sulla fattura
  ('tnt','IT',      0.000,   1.000,   6.18, NULL, NULL, 10),
  ('tnt','IT',      1.000,   3.000,   7.22, NULL, NULL, 20),
  ('tnt','IT',      3.000,   5.000,   8.00, NULL, NULL, 30),
  ('tnt','IT',      5.000,  10.000,   8.92, NULL, NULL, 40),
  ('tnt','IT',     10.000,  20.000,  10.12, NULL, NULL, 50),
  ('tnt','IT',     20.000,  30.000,  11.33, NULL, NULL, 60),
  ('tnt','IT',     30.000,  40.000,  13.38, NULL, NULL, 70),
  ('tnt','IT',     40.000,  50.000,  15.37, NULL, NULL, 80),
  ('tnt','IT',     50.000,  70.000,  20.09, NULL, NULL, 90),
  ('tnt','IT',     70.000, 100.000,  28.31, NULL, NULL, 100),
  ('tnt','IT',    100.000,    NULL,  28.31, 50.0, 16.06, 110),
  -- FedEx Priority zona 1 — soglie dal listino ufficiale del 27/02/2026
  ('fedex','Z1',    0.000,   0.500,   6.18, NULL, NULL, 10),
  ('fedex','Z1',    0.500,   1.500,   6.18, NULL, NULL, 20),
  ('fedex','Z1',    1.500,   4.000,   7.22, NULL, NULL, 30),
  ('fedex','Z1',    4.000,   6.000,   8.00, NULL, NULL, 40),
  ('fedex','Z1',    6.000,  11.000,   8.92, NULL, NULL, 50),
  ('fedex','Z1',   11.000,  21.000,  10.12, NULL, NULL, 60),
  ('fedex','Z1',   21.000,  31.000,  11.33, NULL, NULL, 70),
  ('fedex','Z1',   31.000,  41.000,  13.38, NULL, NULL, 80),
  ('fedex','Z1',   41.000,  51.000,  15.37, NULL, NULL, 90),
  ('fedex','Z1',   51.000,  71.000,  20.09, NULL, NULL, 100),
  ('fedex','Z1',   71.000, 100.000,  28.31, NULL, NULL, 110),
  ('fedex','Z1',  100.000,    NULL,  28.31, 50.0, 16.06, 120),
  -- Trading Post — importo fisso fino a 100 kg, poi 22,50 €/quintale
  ('trading_post','ER_LOM_PIE',   0.000,   3.000,   8.90, NULL, NULL, 10),
  ('trading_post','ER_LOM_PIE',   3.000,   5.000,   9.20, NULL, NULL, 20),
  ('trading_post','ER_LOM_PIE',   5.000,  10.000,   9.50, NULL, NULL, 30),
  ('trading_post','ER_LOM_PIE',  10.000,  20.000,   9.90, NULL, NULL, 40),
  ('trading_post','ER_LOM_PIE',  20.000,  30.000,  11.50, NULL, NULL, 50),
  ('trading_post','ER_LOM_PIE',  30.000,  40.000,  12.90, NULL, NULL, 60),
  ('trading_post','ER_LOM_PIE',  40.000,  50.000,  16.30, NULL, NULL, 70),
  ('trading_post','ER_LOM_PIE',  50.000, 100.000,  22.50, NULL, NULL, 80)
) AS f(vettore, zona, peso_da, peso_a, importo, scatto_kg, scatto_importo, ordine)
  ON f.vettore = v.codice AND f.zona = z.codice
WHERE NOT EXISTS (
  SELECT 1 FROM vettori.listini_fasce x
   WHERE x.listino_id = li.id AND x.zona_id = z.id AND x.peso_da = f.peso_da
);

-- La fascia oltre i 100 kg di Trading Post è al quintale, non fissa: va inserita
-- a parte perché `tipo` cambia. 22,50 €/quintale, cioè 45,00 su 200 kg — che è
-- esattamente quello che la fattura di luglio addebita su una spedizione da 170 kg.
INSERT INTO vettori.listini_fasce
  (listino_id, zona_id, peso_da, peso_a, importo, tipo, ordine)
SELECT li.id, z.id, 100.000, NULL, 22.50, 'quintale', 90
FROM vettori.vettori v
JOIN vettori.listini li ON li.vettore_id = v.id AND li.valido_al IS NULL
JOIN vettori.zone    z  ON z.vettore_id  = v.id AND z.codice = 'ER_LOM_PIE'
WHERE v.codice = 'trading_post'
  AND NOT EXISTS (
    SELECT 1 FROM vettori.listini_fasce x
     WHERE x.listino_id = li.id AND x.zona_id = z.id AND x.peso_da = 100.000
  );

-- ============================================================
-- 5) SUPPLEMENTI
-- ============================================================
-- Sono la ragione principale per cui il costo atteso dei fogli non torna: il
-- foglio calcola nolo e assicurazione, la fattura contiene anche handling,
-- autostrade, safety & energy, oversized, ZTL ed etichettatura manuale.
-- La colonna `base_nolo` dice se il supplemento entra nella base su cui si
-- calcolano adeguamento e carburante. Sulla fattura GLS di luglio la voce
-- "Nolo 1.013,22" comprende già handling, autostrade, oversized, safety &
-- energy e bollettazione; l'assicurazione (11,00) è esposta a parte e resta
-- fuori. Il conto torna al centesimo: (1.013,22 + 73,03 di ISTAT) x 13% =
-- 141,21, che è l'importo stampato in fattura.
INSERT INTO vettori.listini_supplementi
  (listino_id, codice, nome, tipo_calcolo, valore, base_nolo, condizione,
   importo_minimo, soglia_kg_da, ordine)
SELECT li.id, s.codice, s.nome, s.tipo_calcolo, s.valore, s.base_nolo, s.condizione,
       s.importo_minimo, s.soglia_kg_da, s.ordine
FROM vettori.vettori v
JOIN vettori.listini li ON li.vettore_id = v.id AND li.valido_al IS NULL
JOIN (VALUES
  -- GLS — fonti: listino contratto 667, politiche commerciali 2026, fattura 07/2026
  ('gls','handling',        'Handling',                    'per_kg',           0.0300, true,  'sempre',            NULL::numeric, NULL::numeric, 10),
  ('gls','autostrade',      'Adeguamento autostrade e traghetti','fisso_spedizione', 0.2000, true, 'sempre',      NULL, NULL, 20),
  ('gls','safety_energy',   'Safety & Energy Surcharge',   'fisso_spedizione', 0.2000, true,  'sempre',            NULL, NULL, 30),
  ('gls','inoltro_prov',    'Inoltro fuori provincia',     'fisso_spedizione', 0.6000, true,  'fuori_provincia',   NULL, NULL, 40),
  ('gls','oversized',       'Oversized',                   'per_collo',        9.0000, true,  'oversized',         NULL, NULL, 50),
  ('gls','ztl',             'ZTL',                         'fisso_spedizione', 1.5000, true,  'ztl',               NULL, NULL, 60),
  ('gls','etichetta_man',   'Bollettazione manuale',       'fisso_spedizione', 5.0000, true,  'etichetta_manuale', NULL, NULL, 70),
  ('gls','triangolazione',  'Fermo deposito / triangolazione','fisso_spedizione', 7.2500, true,'triangolazione',   NULL, NULL, 80),
  ('gls','giacenza',        'Riconsegna da giacenza',      'fisso_spedizione', 3.1000, true,  'giacenza',          NULL, NULL, 90),
  -- Fuori dalla base: la fattura la espone nella colonna Dir/Ass, e né l'ISTAT
  -- né il carburante la toccano.
  ('gls','assicurazione',   'Assicurazione 10/10',         'fisso_spedizione', 0.5000, false, 'sempre',            NULL, 10.001, 100),
  -- TNT — fonte: foglio in uso + surcharge riepilogati nella fattura di luglio
  ('tnt','pallet',          'Pallet 80x60',                'fisso_spedizione', 10.0000, false,'bancale',           NULL, NULL, 10),
  ('tnt','non_sovrapp',     'Merce non sovrapponibile',    'fisso_spedizione', 30.0000, false,'non_sovrapponibile',NULL, NULL, 20),
  ('tnt','manual_handling', 'Movimentazione manuale',      'fisso_spedizione', 10.0000, false,'movimentazione_manuale', NULL, NULL, 30),
  -- FedEx — stessi supplementi operativi di TNT
  ('fedex','pallet',        'Pallet 80x60',                'fisso_spedizione', 10.0000, false,'bancale',           NULL, NULL, 10),
  ('fedex','non_sovrapp',   'Merce non sovrapponibile',    'fisso_spedizione', 30.0000, false,'non_sovrapponibile',NULL, NULL, 20),
  -- Trading Post — fonte: convenzione TP/1260, verificata su 67 righe di fattura
  ('trading_post','addizionale_gestione','Addizionale di gestione','percentuale_nolo', 0.1100, false, 'sempre',    NULL, NULL, 10),
  ('trading_post','provvigione_assegno', 'Provvigione assegno',    'percentuale_nolo', 0.0200, false, 'assegno',   5.0000, NULL, 20)
) AS s(vettore, codice, nome, tipo_calcolo, valore, base_nolo, condizione, importo_minimo, soglia_kg_da, ordine)
  ON s.vettore = v.codice
ON CONFLICT (listino_id, codice) DO NOTHING;

COMMENT ON COLUMN vettori.listini_supplementi.soglia_kg_da IS
  'Peso minimo oltre il quale il supplemento si applica. GLS addebita l''assicurazione 10/10 solo sopra i 10 kg: senza questa soglia il costo atteso sarebbe più alto del reale su ogni collo leggero.';

-- ============================================================
-- 6) ADEGUAMENTO ISTAT — SOLO GLS
-- ============================================================
-- Sulla fattura di luglio 2026: 13,97 € per l'anno in corso (1,50%) e 59,06 €
-- di arretrati degli anni precedenti, su un nolo di 1.013,22 €. In totale il
-- 7,21%, che da solo vale più dello scarto mediano che i fogli attuali
-- considerano "anomalia". Gli arretrati ricorrono ogni mese e non risulta siano
-- mai stati messi in discussione.
INSERT INTO vettori.adeguamenti (vettore_id, valido_dal, percentuale, descrizione)
SELECT v.id, '2026-01-01'::date, 0.07210,
       'Adeguamento ISTAT anno corrente 1,50% più arretrati anni precedenti. Percentuale complessiva ricavata dalla fattura di luglio 2026: 73,03 € su 1.013,22 € di nolo.'
FROM vettori.vettori v
WHERE v.codice = 'gls'
  AND NOT EXISTS (
    SELECT 1 FROM vettori.adeguamenti a WHERE a.vettore_id = v.id AND a.valido_al IS NULL
  );

-- ============================================================
-- 7) CARBURANTE — LUGLIO 2026
-- ============================================================
-- Trading Post non compare: la sua maggiorazione dell'11% è una voce di listino
-- fissa a contratto, non un carburante mensile. Metterla qui la farebbe
-- sembrare variabile, e in trattativa è la differenza fra una voce su cui non
-- si tratta e una su cui si tratta.
INSERT INTO vettori.carburante (vettore_id, anno, mese, percentuale, fonte, note)
SELECT v.id, c.anno, c.mese, c.percentuale, c.fonte, c.note
FROM vettori.vettori v
JOIN (VALUES
  ('gls',   2026, 7, 0.13000, 'letto_da_fattura', 'Fattura GLS 07/2026: 141,21 € su 1.086,25 € di nolo incluso ISTAT.'),
  ('tnt',   2026, 7, 0.24300, 'comunicazione',    'Dato riportato sul foglio in uso.'),
  ('fedex', 2026, 7, 0.24300, 'letto_da_fattura', 'Fattura FedEx: supplemento carburante dichiarato 24,30%; su una seconda spedizione 23,84%.')
) AS c(vettore, anno, mese, percentuale, fonte, note) ON c.vettore = v.codice
ON CONFLICT (vettore_id, anno, mese) DO NOTHING;

-- ============================================================
-- 8) RIADDEBITO AL CLIENTE
-- ============================================================
-- Tabella a scaglioni in uso. Va detto che è applicata alla lettera in meno
-- della metà dei casi: sui 233 addebiti del 2026, 69 spedizioni sono state
-- addebitate a 16,00 € contro 53 a 16,50, e 25 a 22,00 contro 21 a 22,50.
-- Chi addebita arrotonda. Il controllo espone lo scostamento come informazione,
-- non come anomalia: l'anomalia vera è il riaddebito che manca del tutto.
INSERT INTO vettori.riaddebito_scaglioni (valido_dal, peso_da, peso_a, importo, nota)
SELECT '2026-01-01'::date, r.peso_da, r.peso_a, r.importo, r.nota
FROM (VALUES
  (  0.000,  10.000, 16.5000, NULL::text),
  ( 10.000,  30.000, 22.5000, NULL),
  ( 30.000,  50.000, 31.0000, NULL),
  ( 50.000, 100.000, 49.0000, NULL),
  (100.000,    NULL,    NULL, 'Oltre i 100 kg il foglio prevede di chiedere offerta: nessun importo automatico.')
) AS r(peso_da, peso_a, importo, nota)
WHERE NOT EXISTS (
  SELECT 1 FROM vettori.riaddebito_scaglioni x
   WHERE x.valido_dal = '2026-01-01'::date AND x.peso_da = r.peso_da
);

NOTIFY pgrst, 'reload schema';
