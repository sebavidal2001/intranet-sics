-- Versione atomica: le tariffe precedenti e i controlli salvati restano intatti.
CREATE OR REPLACE FUNCTION vettori.versiona_listino(p_payload jsonb, p_utente uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, vettori AS $$
DECLARE
  precedente vettori.listini;
  nuovo uuid;
  decorrenza date := (p_payload->>'valido_dal')::date;
BEGIN
  SELECT * INTO precedente FROM vettori.listini WHERE id = (p_payload->>'listino_id')::uuid FOR UPDATE;
  IF precedente.id IS NULL OR precedente.valido_al IS NOT NULL THEN
    RAISE EXCEPTION 'Il listino è stato aggiornato: ricaricare la pagina.';
  END IF;
  IF decorrenza IS NULL OR decorrenza <= precedente.valido_dal THEN
    RAISE EXCEPTION 'La decorrenza deve essere successiva al listino precedente.';
  END IF;
  IF coalesce(jsonb_array_length(p_payload->'fasce'), 0) = 0 THEN RAISE EXCEPTION 'Inserire le fasce.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_payload->'fasce') AS f(zona_id uuid, peso_da numeric, peso_a numeric, importo numeric)
    LEFT JOIN vettori.zone z ON z.id = f.zona_id AND z.vettore_id = precedente.vettore_id
    WHERE z.id IS NULL OR f.importo IS NULL OR f.importo < 0 OR f.peso_da IS NULL OR f.peso_da < 0 OR f.peso_a <= f.peso_da
  ) THEN RAISE EXCEPTION 'Zona o fascia non valida.'; END IF;
  IF EXISTS (
    SELECT 1 FROM vettori.listini_fasce f WHERE f.listino_id = precedente.id
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_payload->'fasce') x WHERE (x->>'zona_id')::uuid = f.zona_id)
  ) THEN RAISE EXCEPTION 'Mancano le fasce di una zona del listino.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_payload->'supplementi') AS s(codice text, valore numeric)
    WHERE s.valore IS NULL OR s.valore < 0 OR NOT EXISTS (
      SELECT 1 FROM vettori.listini_supplementi t WHERE t.listino_id = precedente.id AND t.codice = s.codice
    )
  ) THEN RAISE EXCEPTION 'Supplemento non valido.'; END IF;
  UPDATE vettori.listini SET valido_al = decorrenza - 1 WHERE id = precedente.id;
  INSERT INTO vettori.listini(vettore_id, etichetta, valido_dal, origine, creato_da)
  VALUES (precedente.vettore_id, p_payload->>'etichetta', decorrenza, 'Configurazione da portale', p_utente)
  RETURNING id INTO nuovo;
  INSERT INTO vettori.listini_fasce(listino_id, zona_id, peso_da, peso_a, importo, tipo, scatto_kg, scatto_importo)
  SELECT nuovo, zona_id, peso_da, peso_a, importo, tipo, scatto_kg, scatto_importo
  FROM jsonb_to_recordset(p_payload->'fasce') AS f(zona_id uuid, peso_da numeric, peso_a numeric, importo numeric, tipo text, scatto_kg numeric, scatto_importo numeric);
  INSERT INTO vettori.listini_supplementi(listino_id, codice, nome, tipo_calcolo, valore, base_nolo, condizione, importo_minimo, importo_massimo, soglia_kg_da, soglia_kg_a, ordine)
  SELECT nuovo, s.codice, s.nome, s.tipo_calcolo, coalesce(v.valore, s.valore), s.base_nolo, s.condizione,
    s.importo_minimo, s.importo_massimo, s.soglia_kg_da, s.soglia_kg_a, s.ordine
  FROM vettori.listini_supplementi s
  LEFT JOIN jsonb_to_recordset(p_payload->'supplementi') AS v(codice text, valore numeric) ON v.codice = s.codice
  WHERE s.listino_id = precedente.id;
  RETURN nuovo;
END;
$$;
REVOKE ALL ON FUNCTION vettori.versiona_listino(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.versiona_listino(jsonb, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
