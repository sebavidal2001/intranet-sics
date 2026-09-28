-- 124_vettori_trading_post_addizionale_6.sql
--
-- Trading Post: a gennaio e febbraio 2026 l'addizionale di gestione era il 6%,
-- non l'11%.
--
-- La 123 ha anticipato al 1/1 il listino dell'11/05 perche' l'amministrazione
-- conferma che le TARIFFE sono le stesse. Ricalcolando, le 45 righe di
-- gennaio e febbraio sono risultate tutte circa il 4,5% sotto l'atteso: e'
-- l'addizionale. Sulle fatture l'addizionale sta al 6,0% del nolo su ogni riga
-- di gennaio e febbraio e all'11,0% da marzo in poi (unica eccezione: righe con
-- provvigione assegno, che la sommano). Il 6% e' anche il valore che usa ancora
-- il foglio arrivi dell'amministrazione.
--
-- Quindi due versioni dello stesso listino: 01/01-28/02 con il 6%, dal 01/03
-- con l'11%. Fasce e altri supplementi identici, copiati.

DO $$
DECLARE
  v_vettore uuid;
  v_attuale uuid;
  v_nuovo   uuid;
BEGIN
  SELECT id INTO v_vettore FROM vettori.vettori WHERE codice = 'trading_post';
  SELECT id INTO v_attuale FROM vettori.listini
   WHERE vettore_id = v_vettore AND valido_al IS NULL;

  IF EXISTS (SELECT 1 FROM vettori.listini
              WHERE vettore_id = v_vettore AND valido_dal = DATE '2026-01-01' AND valido_al = DATE '2026-02-28') THEN
    RAISE NOTICE 'Versione gennaio-febbraio gia'' presente: niente da fare.';
    RETURN;
  END IF;

  INSERT INTO vettori.listini (vettore_id, etichetta, valido_dal, valido_al, origine, note)
  SELECT vettore_id, etichetta || ' (addizionale 6%)', DATE '2026-01-01', DATE '2026-02-28', origine,
         'Stesse tariffe del listino 11/05/2026, confermato dall''amministrazione (28/09/2026). Addizionale di gestione al 6%, letta su tutte le righe delle fatture di gennaio e febbraio 2026.'
    FROM vettori.listini WHERE id = v_attuale
  RETURNING id INTO v_nuovo;

  INSERT INTO vettori.listini_fasce (listino_id, zona_id, peso_da, peso_a, importo, tipo, scatto_kg, scatto_importo, ordine)
  SELECT v_nuovo, zona_id, peso_da, peso_a, importo, tipo, scatto_kg, scatto_importo, ordine
    FROM vettori.listini_fasce WHERE listino_id = v_attuale;

  INSERT INTO vettori.listini_supplementi (listino_id, codice, nome, tipo_calcolo, valore, base_nolo, condizione,
                                           importo_minimo, importo_massimo, soglia_kg_da, soglia_kg_a, ordine)
  SELECT v_nuovo, codice, nome, tipo_calcolo,
         CASE WHEN codice = 'addizionale_gestione' THEN 0.06 ELSE valore END,
         base_nolo, condizione, importo_minimo, importo_massimo, soglia_kg_da, soglia_kg_a, ordine
    FROM vettori.listini_supplementi WHERE listino_id = v_attuale;

  UPDATE vettori.listini
     SET valido_dal = DATE '2026-03-01',
         note = concat_ws(E'\n', nullif(note, ''), 'Dal 01/03/2026: prima vale la versione con addizionale al 6% (migration 124).')
   WHERE id = v_attuale;
END $$;
