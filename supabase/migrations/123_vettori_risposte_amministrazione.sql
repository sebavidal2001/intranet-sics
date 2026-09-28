-- 123_vettori_risposte_amministrazione.sql
--
-- Le risposte dell'amministrazione (mail di Francesca Odorici, 28/09/2026) alle
-- domande sui dati mancanti. Solo dati, nessuna struttura.
--
-- 1. Listino GLS: le tariffe dei primi 18 giorni di gennaio "sono le medesime
--    indicate nel tariffario con data 19/01/26". Il listino parte dal 1/1.
--
-- 2. Listino Trading Post: gennaio-aprile "le tariffe sono le medesime indicate
--    nel tariffario con data 11/05/26". Il listino parte dal 1/1. Sblocca le 83
--    righe che restavano senza confronto.
--
--    In entrambi i casi si sposta l'inizio di validita' della versione esistente
--    invece di crearne una copia datata prima: e' la stessa tariffa, e due
--    versioni identiche farebbero credere a un cambio di prezzo il 19/01 e l'11/05.
--
-- 3. Carburante TNT gennaio-marzo: l'amministrazione non ce l'ha (il sito TNT
--    sovrascrive la percentuale ogni mese, senza storico). La fattura TNT pero'
--    espone il carburante riga per riga, arrotondato al centesimo: ogni riga
--    restringe la percentuale a un intervallo, e l'intersezione degli intervalli
--    del mese la individua. Il metodo e' collaudato sui mesi di cui la
--    percentuale ufficiale e' nota: aprile [17,608-17,638] contiene 17,62,
--    giugno [25,211-25,224] contiene 25,22, agosto [23,812-23,864] contiene
--    23,84. Per gennaio l'intervallo e' [17,382-17,395] -> 17,39; febbraio e
--    marzo [17,154-17,167] -> 17,16.
--    Cosa verifica e cosa no: con la percentuale dichiarata dal vettore il
--    controllo accerta tariffa, fascia e peso, non la percentuale stessa.
--    E' lo stesso criterio gia' usato per aprile e maggio (fonte
--    'letto_da_fattura').

UPDATE vettori.listini l
   SET valido_dal = DATE '2026-01-01',
       note = concat_ws(E'\n', nullif(l.note, ''),
         'Validita'' anticipata dal 19/01/2026 al 01/01/2026: l''amministrazione conferma (28/09/2026) che le tariffe dei primi 18 giorni di gennaio sono le stesse.')
  FROM vettori.vettori v
 WHERE v.id = l.vettore_id
   AND v.codice = 'gls'
   AND l.valido_dal = DATE '2026-01-19';

UPDATE vettori.listini l
   SET valido_dal = DATE '2026-01-01',
       note = concat_ws(E'\n', nullif(l.note, ''),
         'Validita'' anticipata dall''11/05/2026 al 01/01/2026: l''amministrazione conferma (28/09/2026) che le tariffe di gennaio-aprile sono le stesse.')
  FROM vettori.vettori v
 WHERE v.id = l.vettore_id
   AND v.codice = 'trading_post'
   AND l.valido_dal = DATE '2026-05-11';

INSERT INTO vettori.carburante (vettore_id, anno, mese, percentuale, fonte, note)
SELECT v.id, 2026, x.mese, x.percentuale, 'letto_da_fattura', x.note
  FROM vettori.vettori v
 CROSS JOIN (VALUES
   (1, 0.17390, 'Ricavata dalle righe della fattura TNT 01/2026: intersezione degli intervalli di arrotondamento, [17,382%-17,395%]. L''amministrazione non ha lo storico (28/09/2026).'),
   (2, 0.17160, 'Ricavata dalle righe della fattura TNT 02/2026: intersezione degli intervalli di arrotondamento, [17,154%-17,167%]. L''amministrazione non ha lo storico (28/09/2026).'),
   (3, 0.17160, 'Ricavata dalle righe della fattura TNT 03/2026: intersezione degli intervalli di arrotondamento, [17,152%-17,167%]. L''amministrazione non ha lo storico (28/09/2026).')
 ) AS x(mese, percentuale, note)
 WHERE v.codice = 'tnt'
   AND NOT EXISTS (
     SELECT 1 FROM vettori.carburante c
      WHERE c.vettore_id = v.id AND c.anno = 2026 AND c.mese = x.mese
   );
