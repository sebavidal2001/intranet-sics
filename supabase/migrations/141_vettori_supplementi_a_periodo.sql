-- ============================================================
-- Portale Vettori - supplementi a periodo
--
-- Perche': i vettori comunicano supplementi temporanei (FedEx: 0,85 EUR a
-- spedizione dal 01/11 al 31/12/2026, «Diritto fisso» in fattura). Fino a oggi
-- un supplemento viveva quanto il listino che lo contiene e dalla pagina si
-- potevano cambiare solo i valori di quelli esistenti: una voce nuova voleva
-- una migration.
--
-- Cosa cambia:
--   1) listini_supplementi.valido_dal / valido_al (NULL = nessun limite): il
--      motore risolve il listino alla data della spedizione e scarta i
--      supplementi fuori periodo, quindi i mesi chiusi non si muovono.
--   2) vettori.aggiungi_supplemento: aggiunge una voce al listino in vigore.
--   3) vettori.rimuovi_supplemento: toglie una voce a periodo (le voci
--      permanenti del listino non si cancellano da qui).
--   4) versiona_listino copia anche le date e lascia indietro i supplementi
--      gia' scaduti alla decorrenza della nuova versione.
-- ============================================================

ALTER TABLE vettori.listini_supplementi
  ADD COLUMN IF NOT EXISTS valido_dal date,
  ADD COLUMN IF NOT EXISTS valido_al  date;

ALTER TABLE vettori.listini_supplementi
  DROP CONSTRAINT IF EXISTS listini_supplementi_periodo_chk;
ALTER TABLE vettori.listini_supplementi
  ADD CONSTRAINT listini_supplementi_periodo_chk
  CHECK (valido_al IS NULL OR valido_dal IS NULL OR valido_al >= valido_dal);

COMMENT ON COLUMN vettori.listini_supplementi.valido_dal IS
  'Primo giorno (data di spedizione) in cui il supplemento si applica. NULL = dall''inizio del listino.';
COMMENT ON COLUMN vettori.listini_supplementi.valido_al IS
  'Ultimo giorno (data di spedizione) in cui il supplemento si applica. NULL = fino alla fine del listino.';

CREATE OR REPLACE FUNCTION vettori.aggiungi_supplemento(p_payload jsonb, p_utente uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, vettori AS $$
DECLARE
  listino vettori.listini;
  dal date := (p_payload->>'valido_dal')::date;
  al  date := nullif(p_payload->>'valido_al', '')::date;
  nuovo uuid;
BEGIN
  SELECT * INTO listino FROM vettori.listini WHERE id = (p_payload->>'listino_id')::uuid FOR UPDATE;
  IF listino.id IS NULL OR listino.valido_al IS NOT NULL THEN
    RAISE EXCEPTION 'Il listino è stato aggiornato: ricaricare la pagina.';
  END IF;
  IF dal IS NULL THEN RAISE EXCEPTION 'Indicare da quando vale il supplemento.'; END IF;
  IF al IS NOT NULL AND al < dal THEN RAISE EXCEPTION 'La data finale precede quella iniziale.'; END IF;
  IF coalesce(btrim(p_payload->>'codice'), '') = '' OR coalesce(btrim(p_payload->>'nome'), '') = '' THEN
    RAISE EXCEPTION 'Indicare nome e codice del supplemento.';
  END IF;
  IF (p_payload->>'valore')::numeric IS NULL OR (p_payload->>'valore')::numeric < 0 THEN
    RAISE EXCEPTION 'Il valore non può essere negativo.';
  END IF;
  IF (p_payload->>'tipo_calcolo') NOT IN ('fisso_spedizione', 'per_kg', 'per_collo', 'percentuale_nolo') THEN
    RAISE EXCEPTION 'Tipo di calcolo non valido.';
  END IF;
  IF EXISTS (SELECT 1 FROM vettori.listini_supplementi WHERE listino_id = listino.id AND codice = p_payload->>'codice') THEN
    RAISE EXCEPTION 'Esiste già un supplemento con questo codice.';
  END IF;

  INSERT INTO vettori.listini_supplementi(
    listino_id, codice, nome, tipo_calcolo, valore, base_nolo, condizione, valido_dal, valido_al, ordine
  )
  SELECT listino.id, p_payload->>'codice', p_payload->>'nome', p_payload->>'tipo_calcolo',
         (p_payload->>'valore')::numeric,
         coalesce((p_payload->>'base_nolo')::boolean, false),
         coalesce(nullif(p_payload->>'condizione', ''), 'sempre'),
         dal, al,
         coalesce((SELECT max(ordine) FROM vettori.listini_supplementi WHERE listino_id = listino.id), 0) + 10
  RETURNING id INTO nuovo;
  RETURN nuovo;
END;
$$;

CREATE OR REPLACE FUNCTION vettori.rimuovi_supplemento(p_listino uuid, p_codice text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, vettori AS $$
BEGIN
  DELETE FROM vettori.listini_supplementi
   WHERE listino_id = p_listino AND codice = p_codice AND valido_dal IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Si possono togliere solo i supplementi a periodo.';
  END IF;
END;
$$;

-- Come 093, ma copia anche il periodo e non porta avanti i supplementi scaduti.
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
  INSERT INTO vettori.listini_supplementi(listino_id, codice, nome, tipo_calcolo, valore, base_nolo, condizione, importo_minimo, importo_massimo, soglia_kg_da, soglia_kg_a, valido_dal, valido_al, ordine)
  SELECT nuovo, s.codice, s.nome, s.tipo_calcolo, coalesce(v.valore, s.valore), s.base_nolo, s.condizione,
    s.importo_minimo, s.importo_massimo, s.soglia_kg_da, s.soglia_kg_a, s.valido_dal, s.valido_al, s.ordine
  FROM vettori.listini_supplementi s
  LEFT JOIN jsonb_to_recordset(p_payload->'supplementi') AS v(codice text, valore numeric) ON v.codice = s.codice
  WHERE s.listino_id = precedente.id
    AND (s.valido_al IS NULL OR s.valido_al >= decorrenza);
  RETURN nuovo;
END;
$$;

REVOKE ALL ON FUNCTION vettori.aggiungi_supplemento(jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vettori.rimuovi_supplemento(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vettori.versiona_listino(jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.aggiungi_supplemento(jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION vettori.rimuovi_supplemento(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION vettori.versiona_listino(jsonb, uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
