DO $$
DECLARE
  prima vettori.listini;
  payload jsonb;
  nuovo uuid;
  vecchio_importo numeric;
  n integer;
BEGIN
  SELECT l.* INTO prima FROM vettori.listini l JOIN vettori.vettori v ON v.id=l.vettore_id WHERE v.codice='gls' AND l.valido_al IS NULL;
  SELECT count(*) INTO n FROM vettori.listini;
  SELECT importo INTO vecchio_importo FROM vettori.listini_fasce WHERE listino_id=prima.id ORDER BY zona_id,peso_da LIMIT 1;
  SELECT jsonb_build_object('listino_id', prima.id, 'etichetta', 'Collaudo da annullare', 'valido_dal', prima.valido_dal + 300,
    'fasce', (SELECT jsonb_agg(to_jsonb(f) || jsonb_build_object('importo', f.importo+1)) FROM vettori.listini_fasce f WHERE listino_id=prima.id),
    'supplementi', (SELECT jsonb_agg(jsonb_build_object('codice',s.codice,'valore',s.valore+0.01)) FROM vettori.listini_supplementi s WHERE listino_id=prima.id)) INTO payload;
  -- Una zona inesistente non deve chiudere il vecchio listino.
  BEGIN
    PERFORM vettori.versiona_listino(jsonb_set(payload,'{fasce,0,zona_id}','"00000000-0000-4000-8000-000000000001"'),NULL);
    RAISE EXCEPTION 'TEST: zona inesistente accettata' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF (SELECT valido_al IS NOT NULL FROM vettori.listini WHERE id=prima.id) THEN RAISE EXCEPTION 'TEST: modifica parziale'; END IF;
  nuovo := vettori.versiona_listino(payload,NULL);
  IF (SELECT count(*) FROM vettori.listini) <> n+1 THEN RAISE EXCEPTION 'TEST: versione assente'; END IF;
  IF (SELECT importo FROM vettori.listini_fasce WHERE listino_id=prima.id ORDER BY zona_id,peso_da LIMIT 1) <> vecchio_importo THEN RAISE EXCEPTION 'TEST: tariffa storica modificata'; END IF;
  IF (SELECT importo FROM vettori.listini_fasce WHERE listino_id=nuovo ORDER BY zona_id,peso_da LIMIT 1) <> vecchio_importo+1 THEN RAISE EXCEPTION 'TEST: nuova tariffa errata'; END IF;
  IF (SELECT count(*) FROM vettori.listini_supplementi WHERE listino_id=nuovo) <> (SELECT count(*) FROM vettori.listini_supplementi WHERE listino_id=prima.id) THEN RAISE EXCEPTION 'TEST: supplementi persi'; END IF;
  BEGIN
    PERFORM vettori.versiona_listino(payload,NULL);
    RAISE EXCEPTION 'TEST: scrittura concorrente accettata' USING ERRCODE='XX000';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  IF has_function_privilege('authenticated','vettori.versiona_listino(jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'TEST: permesso aperto'; END IF;
END $$;
