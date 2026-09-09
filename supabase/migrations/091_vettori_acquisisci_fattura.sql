-- 091_vettori_acquisisci_fattura.sql
--
-- Acquisizione di una fattura vettore: **una sola transazione**.
--
-- La lettura del PDF, l'aggancio alle bolle e il calcolo del costo atteso
-- avvengono nell'applicazione, che ha già la logica e i test. Qui arriva il
-- risultato completo e viene scritto tutto insieme: fattura, righe, spedizioni
-- agganciate, controlli e anomalie.
--
-- Perché una RPC e non sei insert dall'applicazione: senza transazione una
-- fattura può restare a metà — le righe salvate e i controlli no — e a schermo
-- sembra acquisita. È lo stesso motivo per cui la quadratura è un gate: uno
-- stato parziale che si presenta come completo costa più di un errore.
--
-- Idempotenza: `hash_file` ha un indice unico (migration 089). Ricaricare lo
-- stesso file solleva un errore parlante invece di duplicare il mese.

CREATE OR REPLACE FUNCTION vettori.acquisisci_fattura(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_vettore_id   uuid;
  v_fattura_id   uuid;
  v_utente       uuid;
  v_sped         jsonb;
  v_riga         jsonb;
  v_anomalia     jsonb;
  v_spedizione_id uuid;
  v_riga_id      uuid;
  v_controllo_id uuid;
  v_id_doc       integer;
  v_chiave       text;
  -- chiave della spedizione nel payload -> id in tabella
  v_mappa        jsonb := '{}'::jsonb;
  v_n_righe      int := 0;
  v_n_sped       int := 0;
  v_n_controlli  int := 0;
  v_n_anomalie   int := 0;
BEGIN
  SELECT id INTO v_vettore_id
    FROM vettori.vettori
   WHERE codice = p_payload->>'vettore_codice';
  IF v_vettore_id IS NULL THEN
    RAISE EXCEPTION 'Vettore % non configurato', p_payload->>'vettore_codice'
      USING ERRCODE = 'no_data_found';
  END IF;

  v_utente := nullif(p_payload->>'utente_id', '')::uuid;

  -- Il mese chiuso non si tocca. Riaprirlo è un'operazione esplicita, non un
  -- effetto collaterale di un caricamento.
  IF EXISTS (
    SELECT 1 FROM vettori.chiusure
     WHERE vettore_id = v_vettore_id
       AND anno = (p_payload->>'anno')::int
       AND mese = (p_payload->>'mese')::int
  ) THEN
    RAISE EXCEPTION 'Il mese %/% di questo vettore è già chiuso: va riaperto prima di caricare altro.',
      p_payload->>'mese', p_payload->>'anno'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO vettori.fatture (
    vettore_id, numero, data_fattura, anno, mese,
    tot_nolo, tot_supplementi, tot_adeguamento, tot_carburante, tot_documento,
    perc_carburante, nome_file, hash_file, metodo_lettura, righe_lette,
    quadratura_ok, quadratura_note, stato, caricata_da
  ) VALUES (
    v_vettore_id,
    coalesce(nullif(p_payload->>'numero', ''), 'senza numero'),
    (p_payload->>'data_fattura')::date,
    (p_payload->>'anno')::int,
    (p_payload->>'mese')::int,
    (p_payload#>>'{totali,nolo}')::numeric,
    (p_payload#>>'{totali,supplementi}')::numeric,
    (p_payload#>>'{totali,adeguamento}')::numeric,
    (p_payload#>>'{totali,carburante}')::numeric,
    (p_payload#>>'{totali,totaleDocumento}')::numeric,
    (p_payload#>>'{totali,percentualeCarburante}')::numeric,
    p_payload->>'nome_file',
    p_payload->>'hash_file',
    coalesce(p_payload->>'metodo_lettura', 'testo'),
    jsonb_array_length(coalesce(p_payload->'righe', '[]'::jsonb)),
    (p_payload->>'quadratura_ok')::boolean,
    p_payload->>'quadratura_note',
    'confermata',
    v_utente
  )
  RETURNING id INTO v_fattura_id;

  -- ============================================================
  -- Spedizioni: si riusa quella che già contiene uno dei documenti
  -- ============================================================
  -- Cercare per numero e data non basterebbe: una bolla del fornitore può
  -- corrispondere a più carichi, e la stessa spedizione può essere già stata
  -- creata da un caricamento precedente con un raggruppamento diverso.
  -- L'identità certa è il documento del gestionale.
  FOR v_sped IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'spedizioni', '[]'::jsonb))
  LOOP
    v_chiave := v_sped->>'chiave';
    v_spedizione_id := NULL;

    SELECT sd.spedizione_id INTO v_spedizione_id
      FROM vettori.spedizioni_documenti sd
     WHERE sd.id_documento IN (
             SELECT (x)::int FROM jsonb_array_elements_text(v_sped->'idDocumenti') AS x
           )
     LIMIT 1;

    IF v_spedizione_id IS NULL THEN
      INSERT INTO vettori.spedizioni (
        direzione, vettore_id, numero_riferimento, numero_riferimento_norm,
        data_documento, controparte_codice, controparte_nome,
        zona_cap, zona_provincia, porto_codice, porto_descrizione,
        a_nostro_carico, colli_bolla, peso_bolla, origine, stato
      ) VALUES (
        v_sped->>'direzione',
        v_vettore_id,
        v_sped->>'riferimento',
        v_sped->>'riferimentoNorm',
        (v_sped->>'dataDocumento')::date,
        v_sped->>'codiceControparte',
        v_sped->>'controparte',
        v_sped->>'zonaCap',
        v_sped->>'zonaProvincia',
        v_sped->>'portoCodice',
        v_sped->>'porto',
        (v_sped->>'aNostroCarico')::boolean,
        (v_sped->>'colli')::numeric::int,
        (v_sped->>'peso')::numeric,
        'gestionale',
        'abbinata'
      )
      RETURNING id INTO v_spedizione_id;

      FOR v_id_doc IN
        SELECT (x)::int FROM jsonb_array_elements_text(v_sped->'idDocumenti') AS x
      LOOP
        INSERT INTO vettori.spedizioni_documenti (spedizione_id, id_documento)
        VALUES (v_spedizione_id, v_id_doc)
        ON CONFLICT DO NOTHING;
      END LOOP;

      v_n_sped := v_n_sped + 1;
    ELSE
      UPDATE vettori.spedizioni
         SET stato = 'abbinata', vettore_id = coalesce(vettore_id, v_vettore_id),
             aggiornata_il = now()
       WHERE id = v_spedizione_id;
    END IF;

    v_mappa := v_mappa || jsonb_build_object(v_chiave, v_spedizione_id::text);
  END LOOP;

  -- ============================================================
  -- Righe, controlli, anomalie
  -- ============================================================
  FOR v_riga IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'righe', '[]'::jsonb))
  LOOP
    INSERT INTO vettori.fatture_righe (
      fattura_id, riga_numero, data_spedizione, numero_spedizione,
      numero_riferimento, numero_riferimento_norm, controparte_testo, direzione,
      colli, peso, peso_volumetrico, peso_tassato,
      nolo, supplementi, adeguamento, carburante, totale, dettaglio, confermata
    ) VALUES (
      v_fattura_id,
      (v_riga->>'riga_numero')::int,
      (v_riga->>'data')::date,
      v_riga->>'numero_spedizione',
      v_riga->>'riferimento',
      v_riga->>'riferimento_norm',
      v_riga->>'controparte',
      v_riga->>'direzione',
      (v_riga->>'colli')::numeric::int,
      (v_riga->>'peso')::numeric,
      (v_riga->>'peso_volumetrico')::numeric,
      (v_riga->>'peso_tassato')::numeric,
      (v_riga->>'nolo')::numeric,
      coalesce((v_riga->>'supplementi')::numeric, 0),
      coalesce((v_riga->>'adeguamento')::numeric, 0),
      coalesce((v_riga->>'carburante')::numeric, 0),
      (v_riga->>'totale')::numeric,
      coalesce(v_riga->'dettaglio', '{}'::jsonb),
      coalesce((v_riga->>'confermata')::boolean, true)
    )
    RETURNING id INTO v_riga_id;
    v_n_righe := v_n_righe + 1;

    v_spedizione_id := nullif(v_mappa->>(v_riga->>'spedizione_chiave'), '')::uuid;

    INSERT INTO vettori.controlli (
      fattura_riga_id, spedizione_id, abbinamento, abbinato_da,
      listino_id, listino_etichetta, zona_codice,
      perc_adeguamento, perc_carburante,
      peso_reale, peso_volumetrico, peso_tassabile, peso_applicato,
      atteso_nolo, atteso_imponibile, atteso_adeguamento, atteso_carburante,
      atteso_fuori_base, atteso_totale, atteso_dettaglio,
      fatturato_totale, scostamento, esito, avvertenze
    ) VALUES (
      v_riga_id,
      v_spedizione_id,
      coalesce(v_riga->>'abbinamento', 'nessuno'),
      v_utente,
      nullif(v_riga#>>'{controllo,listino_id}', '')::uuid,
      v_riga#>>'{controllo,listino_etichetta}',
      v_riga#>>'{controllo,zona_codice}',
      (v_riga#>>'{controllo,perc_adeguamento}')::numeric,
      (v_riga#>>'{controllo,perc_carburante}')::numeric,
      (v_riga#>>'{controllo,peso_reale}')::numeric,
      (v_riga#>>'{controllo,peso_volumetrico}')::numeric,
      (v_riga#>>'{controllo,peso_tassabile}')::numeric,
      v_riga#>>'{controllo,peso_applicato}',
      coalesce((v_riga#>>'{controllo,atteso_nolo}')::numeric, 0),
      coalesce((v_riga#>>'{controllo,atteso_imponibile}')::numeric, 0),
      coalesce((v_riga#>>'{controllo,atteso_adeguamento}')::numeric, 0),
      coalesce((v_riga#>>'{controllo,atteso_carburante}')::numeric, 0),
      coalesce((v_riga#>>'{controllo,atteso_fuori_base}')::numeric, 0),
      coalesce((v_riga#>>'{controllo,atteso_totale}')::numeric, 0),
      coalesce(v_riga#>'{controllo,atteso_dettaglio}', '[]'::jsonb),
      (v_riga->>'totale')::numeric,
      (v_riga#>>'{controllo,scostamento}')::numeric,
      coalesce(v_riga#>>'{controllo,esito}', 'non_valutabile'),
      coalesce(
        ARRAY(SELECT jsonb_array_elements_text(coalesce(v_riga#>'{controllo,avvertenze}', '[]'::jsonb))),
        ARRAY[]::text[]
      )
    )
    RETURNING id INTO v_controllo_id;
    v_n_controlli := v_n_controlli + 1;

    FOR v_anomalia IN SELECT * FROM jsonb_array_elements(coalesce(v_riga->'anomalie', '[]'::jsonb))
    LOOP
      INSERT INTO vettori.anomalie (
        controllo_id, spedizione_id, tipo, gravita, descrizione, importo_contestato
      ) VALUES (
        v_controllo_id,
        v_spedizione_id,
        v_anomalia->>'tipo',
        coalesce(v_anomalia->>'gravita', 'da_verificare'),
        v_anomalia->>'descrizione',
        (v_anomalia->>'importo')::numeric
      );
      v_n_anomalie := v_n_anomalie + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'fattura_id', v_fattura_id,
    'righe', v_n_righe,
    'spedizioni_nuove', v_n_sped,
    'controlli', v_n_controlli,
    'anomalie', v_n_anomalie
  );
END;
$$;

COMMENT ON FUNCTION vettori.acquisisci_fattura(jsonb) IS
  'Acquisisce una fattura vettore in una sola transazione: fattura, righe, spedizioni agganciate, controlli e anomalie. Rifiuta i mesi già chiusi e i file già caricati.';

REVOKE ALL ON FUNCTION vettori.acquisisci_fattura(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.acquisisci_fattura(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
