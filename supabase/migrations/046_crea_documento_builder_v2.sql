-- Migration 046: crea_documento_dal_builder v2.
-- Recepisce quantità pezzi per blocco, flag manodopera ×quantità, imballaggio,
-- spese generali, margine trattativa (globale + override blocco), settimane.
--
-- Le righe_distinta salvano i valori per SINGOLA UNITÀ (prezzo_unitario, totale_riga
-- per 1 pezzo); la quantità vive sul blocco (quantita_pezzi) e il ×Q è applicato qui
-- nel calcolo del prezzo finale e nel costo_complessivo.

CREATE OR REPLACE FUNCTION preventivatore.crea_documento_dal_builder(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_user_id      uuid;
  v_codice       text;
  v_doc_id       uuid;
  v_cliente_mid  uuid;
  v_cliente_txt  text;
  v_titolo       text;
  v_num_prev     text;
  v_data_cons    date;
  v_sett_min     smallint;
  v_sett_max     smallint;
  v_margine_glob numeric := COALESCE(NULLIF(p_payload->>'margine_trattativa_pct','')::numeric, 0);
  v_codici_art   text[] := ARRAY[]::text[];
  v_tot          numeric := 0;   -- prezzo finale complessivo (Σ blocchi)
  v_costo_compl  numeric := 0;   -- costo vergine complessivo
  blocco         jsonb;
  art            jsonb;
  srv            jsonb;
  riassunto      text;
  v_anno         int;
BEGIN
  v_user_id := COALESCE((p_payload->>'_user_id')::uuid, auth.uid());
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Utente non autenticato';
  END IF;

  IF NOT (p_payload ? 'blocchi') OR jsonb_array_length(p_payload->'blocchi') = 0 THEN
    RAISE EXCEPTION 'Almeno un blocco è richiesto';
  END IF;
  IF NOT (p_payload ? 'cliente_master_id' OR (p_payload ? 'cliente_text' AND length(trim(p_payload->>'cliente_text')) > 0)) THEN
    RAISE EXCEPTION 'Cliente mancante';
  END IF;

  v_cliente_mid := NULLIF(p_payload->>'cliente_master_id', '')::uuid;
  v_titolo      := NULLIF(trim(COALESCE(p_payload->>'titolo','')), '');
  v_num_prev    := NULLIF(trim(COALESCE(p_payload->>'numero_preventivo','')), '');
  v_data_cons   := NULLIF(p_payload->>'data_consegna','')::date;
  v_sett_min    := NULLIF(p_payload->>'consegna_settimane_min','')::smallint;
  v_sett_max    := NULLIF(p_payload->>'consegna_settimane_max','')::smallint;
  v_anno        := EXTRACT(YEAR FROM NOW())::int;

  IF v_cliente_mid IS NOT NULL THEN
    SELECT ragione_sociale INTO v_cliente_txt
    FROM preventivatore.clienti_master WHERE id = v_cliente_mid;
  END IF;
  IF v_cliente_txt IS NULL THEN
    v_cliente_txt := NULLIF(trim(p_payload->>'cliente_text'), '');
  END IF;

  v_codice := NULLIF(trim(COALESCE(p_payload->>'codice','')), '');
  IF v_codice IS NULL THEN
    v_codice := preventivatore.next_codice_generato(v_anno);
  END IF;

  -- Aggrega codici articolo (per ricerca) e calcola totali complessivi
  FOR blocco IN SELECT * FROM jsonb_array_elements(p_payload->'blocchi')
  LOOP
    DECLARE
      v_q          integer := GREATEST(1, COALESCE(NULLIF(blocco->>'quantita_pezzi','')::integer, 1));
      v_imb_pct    numeric := COALESCE(NULLIF(blocco->>'imballaggio_pct','')::numeric, 1);
      v_spese_pct  numeric := COALESCE(NULLIF(blocco->>'spese_generali_pct','')::numeric, 24.2);
      v_marg_eff   numeric := COALESCE(NULLIF(blocco->>'margine_trattativa_pct','')::numeric, v_margine_glob);
      v_base_vend  numeric := 0;   -- vendita complessiva (×Q dove serve)
      v_costo_blk  numeric := 0;   -- costo vergine complessivo del blocco
      v_scala      boolean;
      v_mult       numeric;
    BEGIN
      FOR art IN SELECT * FROM jsonb_array_elements(blocco->'articoli')
      LOOP
        IF art ? 'codice' AND length(trim(art->>'codice')) > 0 AND NOT (v_codici_art @> ARRAY[art->>'codice']) THEN
          v_codici_art := array_append(v_codici_art, art->>'codice');
        END IF;
        -- Materiali: scalano SEMPRE × Q
        IF (art->>'coeff_ricarico')::numeric > 0 THEN
          v_base_vend := v_base_vend + ((art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric) * v_q;
        END IF;
        v_costo_blk := v_costo_blk + ((art->>'ult_costo')::numeric * (art->>'qty')::numeric) * v_q;
      END LOOP;
      IF blocco ? 'servizi' THEN
        FOR srv IN SELECT * FROM jsonb_array_elements(blocco->'servizi')
        LOOP
          v_scala := COALESCE((srv->>'scala_con_quantita')::boolean, true);
          v_mult  := CASE WHEN v_scala THEN v_q ELSE 1 END;
          IF (srv->>'coeff_ricarico')::numeric > 0 THEN
            v_base_vend := v_base_vend + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric) * v_mult;
          END IF;
          v_costo_blk := v_costo_blk + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric) * v_mult;
        END LOOP;
      END IF;

      -- imballaggio + spese + margine
      DECLARE
        v_tot_spese numeric := v_base_vend * (1 + v_imb_pct/100 + v_spese_pct/100);
        v_prezzo_fin numeric := v_base_vend * (1 + v_imb_pct/100 + v_spese_pct/100) * (1 + v_marg_eff/100);
      BEGIN
        v_tot := v_tot + v_prezzo_fin;
        v_costo_compl := v_costo_compl + v_costo_blk;
      END;
    END;
  END LOOP;

  -- INSERT documento
  INSERT INTO preventivatore.documenti
    (codice, tipo, tipo_cartella, stato, cliente, cliente_master_id, anno,
     tipo_prodotto, codici_articolo, importo_preventivo, importo_finale_raw,
     importo_source, versione_ingest, numero_preventivo, data_consegna_richiesta,
     consegna_settimane_min, consegna_settimane_max, margine_trattativa_pct,
     note, creato_da)
  VALUES
    (v_codice, 'generato', 'G', 'aperta', v_cliente_txt, v_cliente_mid, v_anno,
     v_titolo, v_codici_art, v_tot, v_tot,
     'builder', 'builder_v2', v_num_prev, v_data_cons,
     v_sett_min, v_sett_max, v_margine_glob,
     NULLIF(trim(COALESCE(p_payload->>'note','')), ''), v_user_id)
  RETURNING id INTO v_doc_id;

  -- INSERT blocchi + righe
  FOR blocco IN SELECT * FROM jsonb_array_elements(p_payload->'blocchi')
  LOOP
    DECLARE
      cod_block    text := COALESCE(NULLIF(trim(blocco->>'nome'),''), NULLIF(trim(blocco->>'tipo'),''));
      v_q          integer := GREATEST(1, COALESCE(NULLIF(blocco->>'quantita_pezzi','')::integer, 1));
      v_imb_pct    numeric := COALESCE(NULLIF(blocco->>'imballaggio_pct','')::numeric, 1);
      v_spese_pct  numeric := COALESCE(NULLIF(blocco->>'spese_generali_pct','')::numeric, 24.2);
      v_marg_ovr   numeric := NULLIF(blocco->>'margine_trattativa_pct','')::numeric;
      v_marg_eff   numeric;
      v_base_vend  numeric := 0;
      v_costo_blk  numeric := 0;
      v_scala      boolean;
      v_mult       numeric;
      v_prezzo_fin numeric;
    BEGIN
      v_marg_eff := COALESCE(v_marg_ovr, v_margine_glob);
      FOR art IN SELECT * FROM jsonb_array_elements(blocco->'articoli')
      LOOP
        IF (art->>'coeff_ricarico')::numeric > 0 THEN
          v_base_vend := v_base_vend + ((art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric) * v_q;
        END IF;
        v_costo_blk := v_costo_blk + ((art->>'ult_costo')::numeric * (art->>'qty')::numeric) * v_q;
      END LOOP;
      IF blocco ? 'servizi' THEN
        FOR srv IN SELECT * FROM jsonb_array_elements(blocco->'servizi')
        LOOP
          v_scala := COALESCE((srv->>'scala_con_quantita')::boolean, true);
          v_mult  := CASE WHEN v_scala THEN v_q ELSE 1 END;
          IF (srv->>'coeff_ricarico')::numeric > 0 THEN
            v_base_vend := v_base_vend + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric) * v_mult;
          END IF;
          v_costo_blk := v_costo_blk + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric) * v_mult;
        END LOOP;
      END IF;
      v_prezzo_fin := v_base_vend * (1 + v_imb_pct/100 + v_spese_pct/100) * (1 + v_marg_eff/100);

      INSERT INTO preventivatore.blocchi
        (documento_id, codice_blocco, sheet_name, totale_raw, totale_ceil_2, incluso_offerta,
         quantita_pezzi, imballaggio_pct, spese_generali_pct, margine_trattativa_pct, costo_complessivo)
      VALUES
        (v_doc_id, cod_block, 'builder', v_prezzo_fin, ceil(v_prezzo_fin * 100) / 100, true,
         v_q, v_imb_pct, v_spese_pct, v_marg_ovr, v_costo_blk);

      -- Righe materiali (valori per SINGOLA unità)
      FOR art IN SELECT * FROM jsonb_array_elements(blocco->'articoli')
      LOOP
        INSERT INTO preventivatore.righe_distinta
          (documento_id, sheet_name, codice_blocco, codice_articolo, descrizione,
           quantita, prezzo_unitario, ricarico_pct, ricarico_coefficiente,
           totale_riga, totale_riga_ceil_2, tipo_riga, scala_con_quantita)
        VALUES
          (v_doc_id, 'builder', cod_block, art->>'codice', art->>'descrizione',
           (art->>'qty')::numeric, (art->>'ult_costo')::numeric,
           (art->>'coeff_ricarico')::numeric, (art->>'coeff_ricarico')::numeric,
           CASE WHEN (art->>'coeff_ricarico')::numeric > 0
                THEN (art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric
                ELSE 0 END,
           CASE WHEN (art->>'coeff_ricarico')::numeric > 0
                THEN ceil((art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric * 100) / 100
                ELSE 0 END,
           'materiale', true);
      END LOOP;
      -- Righe manodopera
      IF blocco ? 'servizi' THEN
        FOR srv IN SELECT * FROM jsonb_array_elements(blocco->'servizi')
        LOOP
          INSERT INTO preventivatore.righe_distinta
            (documento_id, sheet_name, codice_blocco, codice_articolo, descrizione,
             quantita, prezzo_unitario, ricarico_pct, ricarico_coefficiente,
             totale_riga, totale_riga_ceil_2, tipo_riga, scala_con_quantita)
          VALUES
            (v_doc_id, 'builder', cod_block, NULL, srv->>'nome',
             (srv->>'ore')::numeric, (srv->>'tariffa_ora')::numeric,
             (srv->>'coeff_ricarico')::numeric, (srv->>'coeff_ricarico')::numeric,
             CASE WHEN (srv->>'coeff_ricarico')::numeric > 0
                  THEN (srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric
                  ELSE 0 END,
             CASE WHEN (srv->>'coeff_ricarico')::numeric > 0
                  THEN ceil((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric * 100) / 100
                  ELSE 0 END,
             'manodopera', COALESCE((srv->>'scala_con_quantita')::boolean, true));
        END LOOP;
      END IF;
    END;
  END LOOP;

  -- Chunk riassuntivo
  riassunto := format('Preventivo %s. Cliente: %s. Prezzo %s EUR (costo %s). %s blocchi.',
                      v_codice, COALESCE(v_cliente_txt,'-'),
                      to_char(v_tot, 'FM999G999G990D00'),
                      to_char(v_costo_compl, 'FM999G999G990D00'),
                      jsonb_array_length(p_payload->'blocchi'));
  INSERT INTO preventivatore.chunks
    (documento_id, chunk_index, contenuto, metadata)
  VALUES
    (v_doc_id, 0, riassunto,
     jsonb_build_object(
       'tipo', 'preventivo_generato',
       'builder_state', jsonb_build_object(
         'totali', jsonb_build_object(
           'prezzo_finale', v_tot,
           'costo_complessivo', v_costo_compl,
           'margine_trattativa_pct', v_margine_glob,
           'n_blocchi', jsonb_array_length(p_payload->'blocchi')
         )
       )
     ));

  RETURN jsonb_build_object('id', v_doc_id, 'codice', v_codice);
END;
$function$;
