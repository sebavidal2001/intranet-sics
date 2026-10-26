-- ════════════════════════════════════════════════════════════════════════════
-- 158 — Lo split di costo diventa visibile: materia prima nella riga articolo,
--       manodopera e trattamenti esterni nelle lavorazioni «da distinta»
-- ════════════════════════════════════════════════════════════════════════════
--
-- Richiesta di Danilo (26/10/2026, riferita da Sebastiano dopo aver provato la 157):
-- inserendo un articolo, ULT.COSTO deve valere la sola materia prima e la manodopera
-- e i trattamenti esterni devono comparire da soli nelle Lavorazioni, in una sezione
-- distinta da quelle che aggiunge lui.
--
-- Come lo fa il builder (nessun calcolo nuovo a DB):
--   * l'articolo viaggia con ult_costo = materia prima e con  split: {manodopera,
--     lavorazione, lav_esterna, altro}  = costi PER UNITA' spostati nelle righe «da distinta»;
--   * ogni blocco ha fino a tre servizi con  split_componente  (manodopera | lav_esterna |
--     altro), importo = somma sugli articoli di unita x quantita x pezzi del blocco
--     (tariffa_ora = importo, ore = 1, coefficiente = media che lascia invariato il prezzo
--     di vendita).
--
-- Cosa cambia qui, e solo qui:
--   1. split_fonte accetta 'materia' (riga articolo col solo costo materiale; le altre
--      colonne sono informative, NON entrano nel costo della riga) e 'distinta' (riga
--      di lavorazione automatica: tutto il costo e' di una componente);
--   2. crea_ e aggiorna_documento_dal_builder: stesse funzioni di migration 120, con le
--      sole colonne di split in piu' negli INSERT di righe_distinta. Il trigger della 157
--      non riscrive le righe che arrivano con split_fonte gia' valorizzato;
--   3. crea_consuntivo: una riga 'materia' conta per il suo costo PIENO (materiale +
--      componenti spostate) e le righe 'distinta' vengono saltate, per non contare due volte.
--
-- I preventivi salvati con la 157 (split nel trigger, split_fonte = 'impresa') restano validi.
-- Dopo la migration: NOTIFY pgrst, 'reload schema' (nuove colonne/funzioni).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE preventivatore.righe_distinta DROP CONSTRAINT IF EXISTS righe_distinta_split_fonte_check;
ALTER TABLE preventivatore.righe_distinta
  ADD CONSTRAINT righe_distinta_split_fonte_check
  CHECK (split_fonte IS NULL OR split_fonte IN ('impresa', 'assunto', 'servizio', 'materia', 'distinta'));

COMMENT ON COLUMN preventivatore.righe_distinta.split_fonte IS
  'impresa = split dal trigger, le colonne sommano a prezzo_unitario; assunto = nessuno standard, tutto materiale; servizio = lavorazione, tutta manodopera; materia = riga articolo col SOLO costo materiale (le altre colonne, per unita, sono quelle spostate nelle righe distinta); distinta = lavorazione automatica «da distinta», tutto il costo in una componente.';

-- ─── crea_documento_dal_builder (base: definizione in produzione al 26/10/2026) ───
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
  v_tot          numeric := 0;
  v_costo_compl  numeric := 0;
  blocco         jsonb;
  art            jsonb;
  srv            jsonb;
  v_anno         int;
  v_blk_ord      bigint;
BEGIN
  v_user_id := COALESCE((p_payload->>'_user_id')::uuid, auth.uid());
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Utente non autenticato'; END IF;
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
    SELECT ragione_sociale INTO v_cliente_txt FROM preventivatore.clienti_master WHERE id = v_cliente_mid;
  END IF;
  IF v_cliente_txt IS NULL THEN v_cliente_txt := NULLIF(trim(p_payload->>'cliente_text'), ''); END IF;

  -- [CODICE COMMESSA] obbligatorio: niente più progressivo G automatico.
  v_codice := NULLIF(trim(COALESCE(p_payload->>'codice','')), '');
  IF v_codice IS NULL THEN RAISE EXCEPTION 'Codice commessa obbligatorio'; END IF;

  FOR blocco IN SELECT * FROM jsonb_array_elements(p_payload->'blocchi')
  LOOP
    DECLARE
      v_q          integer := GREATEST(1, COALESCE(NULLIF(blocco->>'quantita_pezzi','')::integer, 1));
      v_imb_pct    numeric := COALESCE(NULLIF(blocco->>'imballaggio_pct','')::numeric, 1);
      v_tempi_pct  numeric := COALESCE(NULLIF(blocco->>'tempi_accessori_pct','')::numeric, 2.8);
      v_spese_pct  numeric := COALESCE(NULLIF(blocco->>'spese_generali_pct','')::numeric, 24.2);
      v_marg_eff   numeric := COALESCE(NULLIF(blocco->>'margine_trattativa_pct','')::numeric, v_margine_glob);
      v_base_vend  numeric := 0;
      v_costo_blk  numeric := 0;
      v_scala      boolean;
      v_mult       numeric;
    BEGIN
      FOR art IN SELECT * FROM jsonb_array_elements(blocco->'articoli')
      LOOP
        IF art ? 'codice' AND length(trim(art->>'codice')) > 0 AND NOT (v_codici_art @> ARRAY[art->>'codice']) THEN
          v_codici_art := array_append(v_codici_art, art->>'codice');
        END IF;
        IF (art->>'coeff_ricarico')::numeric > 0 THEN
          v_base_vend := v_base_vend + ((art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric) * v_q;
        END IF;
        v_costo_blk := v_costo_blk + ((art->>'ult_costo')::numeric * (art->>'qty')::numeric) * v_q;
      END LOOP;
      IF blocco ? 'servizi' THEN
        FOR srv IN SELECT * FROM jsonb_array_elements(blocco->'servizi')
        LOOP
          v_scala := COALESCE((srv->>'scala_con_quantita')::boolean, true);
          v_mult  := 1;
          IF (srv->>'coeff_ricarico')::numeric > 0 THEN
            v_base_vend := v_base_vend + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric) * v_mult;
          END IF;
          v_costo_blk := v_costo_blk + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric) * v_mult;
        END LOOP;
      END IF;
      v_tot := v_tot + ((v_base_vend + v_base_vend*(v_imb_pct/100) + v_costo_blk*(v_tempi_pct/100) + v_costo_blk*(v_spese_pct/100)) * (1 + v_marg_eff/100));
      v_costo_compl := v_costo_compl + v_costo_blk;
    END;
  END LOOP;

  INSERT INTO preventivatore.documenti
    (codice, tipo, tipo_cartella, stato, cliente, cliente_master_id, anno,
     tipo_prodotto, codici_articolo, importo_preventivo, importo_finale_raw,
     importo_source, versione_ingest, numero_preventivo, data_consegna_richiesta,
     consegna_settimane_min, consegna_settimane_max, margine_trattativa_pct,
     note, creato_da)
  VALUES
    (v_codice, 'generato', 'G', 'aperta', v_cliente_txt, v_cliente_mid, v_anno,
     v_titolo, v_codici_art, v_tot, v_tot,
     'builder', 'builder_v3', v_num_prev, v_data_cons,
     v_sett_min, v_sett_max, v_margine_glob,
     NULLIF(trim(COALESCE(p_payload->>'note','')), ''), v_user_id)
  RETURNING id INTO v_doc_id;

  FOR blocco, v_blk_ord IN
    SELECT value, ordinality FROM jsonb_array_elements(p_payload->'blocchi') WITH ORDINALITY
  LOOP
    DECLARE
      cod_block    text := COALESCE(NULLIF(trim(blocco->>'nome'),''), NULLIF(trim(blocco->>'tipo'),''));
      v_q          integer := GREATEST(1, COALESCE(NULLIF(blocco->>'quantita_pezzi','')::integer, 1));
      v_imb_pct    numeric := COALESCE(NULLIF(blocco->>'imballaggio_pct','')::numeric, 1);
      v_tempi_pct  numeric := COALESCE(NULLIF(blocco->>'tempi_accessori_pct','')::numeric, 2.8);
      v_spese_pct  numeric := COALESCE(NULLIF(blocco->>'spese_generali_pct','')::numeric, 24.2);
      v_marg_ovr   numeric := NULLIF(blocco->>'margine_trattativa_pct','')::numeric;
      v_marg_eff   numeric;
      v_base_vend  numeric := 0;
      v_costo_blk  numeric := 0;
      v_scala      boolean;
      v_mult       numeric;
      v_prezzo_fin numeric;
      v_riga_ord   int := 0;
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
          v_mult  := 1;
          IF (srv->>'coeff_ricarico')::numeric > 0 THEN
            v_base_vend := v_base_vend + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric) * v_mult;
          END IF;
          v_costo_blk := v_costo_blk + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric) * v_mult;
        END LOOP;
      END IF;
      v_prezzo_fin := (v_base_vend + v_base_vend*(v_imb_pct/100) + v_costo_blk*(v_tempi_pct/100) + v_costo_blk*(v_spese_pct/100)) * (1 + v_marg_eff/100);

      INSERT INTO preventivatore.blocchi
        (documento_id, codice_blocco, sheet_name, totale_raw, totale_ceil_2, incluso_offerta,
         quantita_pezzi, imballaggio_pct, tempi_accessori_pct, spese_generali_pct, margine_trattativa_pct, costo_complessivo, ordine, note)
      VALUES
        (v_doc_id, cod_block, 'builder', v_prezzo_fin, ceil(v_prezzo_fin * 100) / 100, true,
         v_q, v_imb_pct, v_tempi_pct, v_spese_pct, v_marg_ovr, v_costo_blk, v_blk_ord,
         NULLIF(trim(COALESCE(blocco->>'note','')), ''));

      FOR art IN SELECT * FROM jsonb_array_elements(blocco->'articoli')
      LOOP
        v_riga_ord := v_riga_ord + 1;
        INSERT INTO preventivatore.righe_distinta
          (documento_id, sheet_name, codice_blocco, codice_articolo, descrizione,
           quantita, prezzo_unitario, ricarico_pct, ricarico_coefficiente,
           totale_riga, totale_riga_ceil_2, tipo_riga, scala_con_quantita, ordine,
           costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro, split_fonte)
        VALUES
          (v_doc_id, 'builder', cod_block, art->>'codice', art->>'descrizione',
           (art->>'qty')::numeric, (art->>'ult_costo')::numeric,
           (art->>'coeff_ricarico')::numeric, (art->>'coeff_ricarico')::numeric,
           CASE WHEN (art->>'coeff_ricarico')::numeric > 0 THEN (art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric ELSE 0 END,
           CASE WHEN (art->>'coeff_ricarico')::numeric > 0 THEN ceil((art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric * 100) / 100 ELSE 0 END,
           'materiale', true, v_riga_ord,
           -- Split (migration 158): se il builder ha spostato manodopera e trattamenti nelle righe
           -- «da distinta», prezzo_unitario e' la sola materia prima e le altre componenti
           -- (per unita) restano qui, per riaprire la bozza e per la consuntivazione.
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN (art->>'ult_costo')::numeric END,
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN COALESCE((art->'split'->>'manodopera')::numeric, 0) END,
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN COALESCE((art->'split'->>'lavorazione')::numeric, 0) END,
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN COALESCE((art->'split'->>'lav_esterna')::numeric, 0) END,
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN COALESCE((art->'split'->>'altro')::numeric, 0) END,
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN 'materia' END);
      END LOOP;
      IF blocco ? 'servizi' THEN
        FOR srv IN SELECT * FROM jsonb_array_elements(blocco->'servizi')
        LOOP
          v_riga_ord := v_riga_ord + 1;
          INSERT INTO preventivatore.righe_distinta
            (documento_id, sheet_name, codice_blocco, codice_articolo, descrizione,
             quantita, prezzo_unitario, ricarico_pct, ricarico_coefficiente,
             totale_riga, totale_riga_ceil_2, tipo_riga, scala_con_quantita, ordine,
           costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro, split_fonte)
          VALUES
            (v_doc_id, 'builder', cod_block, NULL, srv->>'nome',
             (srv->>'ore')::numeric, (srv->>'tariffa_ora')::numeric,
             (srv->>'coeff_ricarico')::numeric, (srv->>'coeff_ricarico')::numeric,
             CASE WHEN (srv->>'coeff_ricarico')::numeric > 0 THEN (srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric ELSE 0 END,
             CASE WHEN (srv->>'coeff_ricarico')::numeric > 0 THEN ceil((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric * 100) / 100 ELSE 0 END,
             'manodopera', COALESCE((srv->>'scala_con_quantita')::boolean, true), v_riga_ord,
             -- Riga «da distinta» (migration 158): tutto il costo e' di UNA componente.
             CASE WHEN srv->>'split_componente' IN ('manodopera', 'lav_esterna', 'altro') THEN 0 END,
             CASE WHEN srv->>'split_componente' = 'manodopera' THEN (srv->>'tariffa_ora')::numeric
                  WHEN srv->>'split_componente' IN ('lav_esterna', 'altro') THEN 0 END,
             CASE WHEN srv->>'split_componente' IN ('manodopera', 'lav_esterna', 'altro') THEN 0 END,
             CASE WHEN srv->>'split_componente' = 'lav_esterna' THEN (srv->>'tariffa_ora')::numeric
                  WHEN srv->>'split_componente' IN ('manodopera', 'altro') THEN 0 END,
             CASE WHEN srv->>'split_componente' = 'altro' THEN (srv->>'tariffa_ora')::numeric
                  WHEN srv->>'split_componente' IN ('manodopera', 'lav_esterna') THEN 0 END,
             CASE WHEN srv->>'split_componente' IN ('manodopera', 'lav_esterna', 'altro') THEN 'distinta' END);
        END LOOP;
      END IF;
    END;
  END LOOP;

  -- Tempo di preventivazione (prima era un secondo UPDATE best-effort della route)
  -- e testi ricercabili: un chunk documento + uno per blocco (migration 120).
  IF COALESCE(NULLIF(p_payload->>'tempo_preventivazione_sec','')::integer, 0) > 0 THEN
    UPDATE preventivatore.documenti SET tempo_preventivazione_sec = NULLIF(p_payload->>'tempo_preventivazione_sec','')::integer WHERE id = v_doc_id;
  END IF;
  PERFORM preventivatore.rigenera_chunks_documento(v_doc_id);

  RETURN jsonb_build_object('id', v_doc_id, 'codice', v_codice);
END;
$function$;

-- ─── aggiorna_documento_dal_builder (base: definizione in produzione al 26/10/2026) ───
CREATE OR REPLACE FUNCTION preventivatore.aggiorna_documento_dal_builder(p_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_codice       text;
  v_tipo         text;
  v_cliente_mid  uuid;
  v_cliente_txt  text;
  v_titolo       text;
  v_num_prev     text;
  v_data_cons    date;
  v_sett_min     smallint;
  v_sett_max     smallint;
  v_margine_glob numeric := COALESCE(NULLIF(p_payload->>'margine_trattativa_pct','')::numeric, 0);
  v_codici_art   text[] := ARRAY[]::text[];
  v_tot          numeric := 0;
  v_costo_compl  numeric := 0;
  blocco         jsonb;
  art            jsonb;
  srv            jsonb;
  v_updated_at   timestamptz;
  v_blk_ord      bigint;
BEGIN
  SELECT codice, tipo, updated_at INTO v_codice, v_tipo, v_updated_at
  FROM preventivatore.documenti WHERE id = p_id
  FOR UPDATE;
  IF v_codice IS NULL THEN RAISE EXCEPTION 'Documento inesistente'; END IF;
  -- Blocco ottimistico: il builder manda l'updated_at letto all'apertura. Se nel
  -- frattempo qualcun altro ha salvato, non si sovrascrive il suo lavoro.
  IF NULLIF(p_payload->>'_versione_attesa', '') IS NOT NULL AND v_updated_at IS NOT NULL
     AND v_updated_at <> (p_payload->>'_versione_attesa')::timestamptz THEN
    -- PT409: PostgREST risponde direttamente HTTP 409. Con 40001 (errore di
    -- serializzazione) la richiesta veniva ritentata e restava appesa ~2 minuti.
    RAISE EXCEPTION 'versione_obsoleta' USING ERRCODE = 'PT409';
  END IF;
  IF v_tipo <> 'generato' THEN
    RAISE EXCEPTION 'Solo i preventivi generati dal builder sono modificabili (tipo=%).', v_tipo;
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

  IF v_cliente_mid IS NOT NULL THEN
    SELECT ragione_sociale INTO v_cliente_txt FROM preventivatore.clienti_master WHERE id = v_cliente_mid;
  END IF;
  IF v_cliente_txt IS NULL THEN v_cliente_txt := NULLIF(trim(p_payload->>'cliente_text'), ''); END IF;

  FOR blocco IN SELECT * FROM jsonb_array_elements(p_payload->'blocchi')
  LOOP
    DECLARE
      v_q          integer := GREATEST(1, COALESCE(NULLIF(blocco->>'quantita_pezzi','')::integer, 1));
      v_imb_pct    numeric := COALESCE(NULLIF(blocco->>'imballaggio_pct','')::numeric, 1);
      v_tempi_pct  numeric := COALESCE(NULLIF(blocco->>'tempi_accessori_pct','')::numeric, 2.8);
      v_spese_pct  numeric := COALESCE(NULLIF(blocco->>'spese_generali_pct','')::numeric, 24.2);
      v_marg_eff   numeric := COALESCE(NULLIF(blocco->>'margine_trattativa_pct','')::numeric, v_margine_glob);
      v_base_vend  numeric := 0;
      v_costo_blk  numeric := 0;
      v_scala      boolean;
      v_mult       numeric;
    BEGIN
      FOR art IN SELECT * FROM jsonb_array_elements(blocco->'articoli')
      LOOP
        IF art ? 'codice' AND length(trim(art->>'codice')) > 0 AND NOT (v_codici_art @> ARRAY[art->>'codice']) THEN
          v_codici_art := array_append(v_codici_art, art->>'codice');
        END IF;
        IF (art->>'coeff_ricarico')::numeric > 0 THEN
          v_base_vend := v_base_vend + ((art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric) * v_q;
        END IF;
        v_costo_blk := v_costo_blk + ((art->>'ult_costo')::numeric * (art->>'qty')::numeric) * v_q;
      END LOOP;
      IF blocco ? 'servizi' THEN
        FOR srv IN SELECT * FROM jsonb_array_elements(blocco->'servizi')
        LOOP
          v_scala := COALESCE((srv->>'scala_con_quantita')::boolean, true);
          v_mult  := 1;
          IF (srv->>'coeff_ricarico')::numeric > 0 THEN
            v_base_vend := v_base_vend + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric) * v_mult;
          END IF;
          v_costo_blk := v_costo_blk + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric) * v_mult;
        END LOOP;
      END IF;
      v_tot := v_tot + ((v_base_vend + v_base_vend*(v_imb_pct/100) + v_costo_blk*(v_tempi_pct/100) + v_costo_blk*(v_spese_pct/100)) * (1 + v_marg_eff/100));
      v_costo_compl := v_costo_compl + v_costo_blk;
    END;
  END LOOP;

  UPDATE preventivatore.documenti SET
    cliente                 = v_cliente_txt,
    cliente_master_id       = v_cliente_mid,
    tipo_prodotto           = v_titolo,
    codici_articolo         = v_codici_art,
    importo_preventivo      = v_tot,
    importo_finale_raw      = v_tot,
    importo_source          = 'builder',
    numero_preventivo       = v_num_prev,
    data_consegna_richiesta = v_data_cons,
    consegna_settimane_min  = v_sett_min,
    consegna_settimane_max  = v_sett_max,
    margine_trattativa_pct  = v_margine_glob,
    note                    = NULLIF(trim(COALESCE(p_payload->>'note','')), ''),
    updated_at              = now(),
    tempo_preventivazione_sec = CASE WHEN COALESCE(NULLIF(p_payload->>'tempo_preventivazione_sec','')::integer, 0) > 0
                                     THEN NULLIF(p_payload->>'tempo_preventivazione_sec','')::integer ELSE tempo_preventivazione_sec END
  WHERE id = p_id;

  DELETE FROM preventivatore.righe_distinta WHERE documento_id = p_id;
  DELETE FROM preventivatore.blocchi        WHERE documento_id = p_id;
  -- I chunk NON si cancellano qui: rigenera_chunks_documento conserva gli
  -- embedding dei testi rimasti identici.

  FOR blocco, v_blk_ord IN
    SELECT value, ordinality FROM jsonb_array_elements(p_payload->'blocchi') WITH ORDINALITY
  LOOP
    DECLARE
      cod_block    text := COALESCE(NULLIF(trim(blocco->>'nome'),''), NULLIF(trim(blocco->>'tipo'),''));
      v_q          integer := GREATEST(1, COALESCE(NULLIF(blocco->>'quantita_pezzi','')::integer, 1));
      v_imb_pct    numeric := COALESCE(NULLIF(blocco->>'imballaggio_pct','')::numeric, 1);
      v_tempi_pct  numeric := COALESCE(NULLIF(blocco->>'tempi_accessori_pct','')::numeric, 2.8);
      v_spese_pct  numeric := COALESCE(NULLIF(blocco->>'spese_generali_pct','')::numeric, 24.2);
      v_marg_ovr   numeric := NULLIF(blocco->>'margine_trattativa_pct','')::numeric;
      v_marg_eff   numeric;
      v_base_vend  numeric := 0;
      v_costo_blk  numeric := 0;
      v_scala      boolean;
      v_mult       numeric;
      v_prezzo_fin numeric;
      v_riga_ord   int := 0;
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
          v_mult  := 1;
          IF (srv->>'coeff_ricarico')::numeric > 0 THEN
            v_base_vend := v_base_vend + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric) * v_mult;
          END IF;
          v_costo_blk := v_costo_blk + ((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric) * v_mult;
        END LOOP;
      END IF;
      v_prezzo_fin := (v_base_vend + v_base_vend*(v_imb_pct/100) + v_costo_blk*(v_tempi_pct/100) + v_costo_blk*(v_spese_pct/100)) * (1 + v_marg_eff/100);

      INSERT INTO preventivatore.blocchi
        (documento_id, codice_blocco, sheet_name, totale_raw, totale_ceil_2, incluso_offerta,
         quantita_pezzi, imballaggio_pct, tempi_accessori_pct, spese_generali_pct, margine_trattativa_pct, costo_complessivo, ordine, note)
      VALUES
        (p_id, cod_block, 'builder', v_prezzo_fin, ceil(v_prezzo_fin * 100) / 100, true,
         v_q, v_imb_pct, v_tempi_pct, v_spese_pct, v_marg_ovr, v_costo_blk, v_blk_ord,
         NULLIF(trim(COALESCE(blocco->>'note','')), ''));

      FOR art IN SELECT * FROM jsonb_array_elements(blocco->'articoli')
      LOOP
        v_riga_ord := v_riga_ord + 1;
        INSERT INTO preventivatore.righe_distinta
          (documento_id, sheet_name, codice_blocco, codice_articolo, descrizione,
           quantita, prezzo_unitario, ricarico_pct, ricarico_coefficiente,
           totale_riga, totale_riga_ceil_2, tipo_riga, scala_con_quantita, ordine,
           costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro, split_fonte)
        VALUES
          (p_id, 'builder', cod_block, art->>'codice', art->>'descrizione',
           (art->>'qty')::numeric, (art->>'ult_costo')::numeric,
           (art->>'coeff_ricarico')::numeric, (art->>'coeff_ricarico')::numeric,
           CASE WHEN (art->>'coeff_ricarico')::numeric > 0 THEN (art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric ELSE 0 END,
           CASE WHEN (art->>'coeff_ricarico')::numeric > 0 THEN ceil((art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric * 100) / 100 ELSE 0 END,
           'materiale', true, v_riga_ord,
           -- Split (migration 158): se il builder ha spostato manodopera e trattamenti nelle righe
           -- «da distinta», prezzo_unitario e' la sola materia prima e le altre componenti
           -- (per unita) restano qui, per riaprire la bozza e per la consuntivazione.
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN (art->>'ult_costo')::numeric END,
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN COALESCE((art->'split'->>'manodopera')::numeric, 0) END,
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN COALESCE((art->'split'->>'lavorazione')::numeric, 0) END,
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN COALESCE((art->'split'->>'lav_esterna')::numeric, 0) END,
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN COALESCE((art->'split'->>'altro')::numeric, 0) END,
           CASE WHEN jsonb_typeof(art->'split') = 'object' THEN 'materia' END);
      END LOOP;
      IF blocco ? 'servizi' THEN
        FOR srv IN SELECT * FROM jsonb_array_elements(blocco->'servizi')
        LOOP
          v_riga_ord := v_riga_ord + 1;
          INSERT INTO preventivatore.righe_distinta
            (documento_id, sheet_name, codice_blocco, codice_articolo, descrizione,
             quantita, prezzo_unitario, ricarico_pct, ricarico_coefficiente,
             totale_riga, totale_riga_ceil_2, tipo_riga, scala_con_quantita, ordine,
           costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro, split_fonte)
          VALUES
            (p_id, 'builder', cod_block, NULL, srv->>'nome',
             (srv->>'ore')::numeric, (srv->>'tariffa_ora')::numeric,
             (srv->>'coeff_ricarico')::numeric, (srv->>'coeff_ricarico')::numeric,
             CASE WHEN (srv->>'coeff_ricarico')::numeric > 0 THEN (srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric ELSE 0 END,
             CASE WHEN (srv->>'coeff_ricarico')::numeric > 0 THEN ceil((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric * 100) / 100 ELSE 0 END,
             'manodopera', COALESCE((srv->>'scala_con_quantita')::boolean, true), v_riga_ord,
             -- Riga «da distinta» (migration 158): tutto il costo e' di UNA componente.
             CASE WHEN srv->>'split_componente' IN ('manodopera', 'lav_esterna', 'altro') THEN 0 END,
             CASE WHEN srv->>'split_componente' = 'manodopera' THEN (srv->>'tariffa_ora')::numeric
                  WHEN srv->>'split_componente' IN ('lav_esterna', 'altro') THEN 0 END,
             CASE WHEN srv->>'split_componente' IN ('manodopera', 'lav_esterna', 'altro') THEN 0 END,
             CASE WHEN srv->>'split_componente' = 'lav_esterna' THEN (srv->>'tariffa_ora')::numeric
                  WHEN srv->>'split_componente' IN ('manodopera', 'altro') THEN 0 END,
             CASE WHEN srv->>'split_componente' = 'altro' THEN (srv->>'tariffa_ora')::numeric
                  WHEN srv->>'split_componente' IN ('manodopera', 'lav_esterna') THEN 0 END,
             CASE WHEN srv->>'split_componente' IN ('manodopera', 'lav_esterna', 'altro') THEN 'distinta' END);
        END LOOP;
      END IF;
    END;
  END LOOP;

  PERFORM preventivatore.rigenera_chunks_documento(p_id);

  RETURN jsonb_build_object('id', p_id, 'codice', v_codice);
END;
$function$;

-- ─── crea_consuntivo: righe 'materia' a costo pieno, righe 'distinta' saltate ──
CREATE OR REPLACE FUNCTION preventivatore.crea_consuntivo(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = preventivatore, pg_temp
AS $fn$
DECLARE
  v_id       uuid;
  v_codice   text := NULLIF(btrim(COALESCE(p_payload->>'codice_articolo', '')), '');
  v_doc      uuid := NULLIF(p_payload->>'documento_id', '')::uuid;
  v_ambito   text := COALESCE(p_payload->>'ambito', 'preventivo');
  v_doc_cod  text;
  v_qta      numeric;
  v_n        int;
  v_blocchi  text[];
  v_righe    uuid[];
  rif        articoli_costi_split%ROWTYPE;
BEGIN
  IF v_codice IS NULL THEN RAISE EXCEPTION 'Codice articolo obbligatorio'; END IF;
  IF v_doc IS NULL THEN RAISE EXCEPTION 'Preventivo obbligatorio'; END IF;
  IF v_ambito NOT IN ('preventivo', 'blocchi', 'righe') THEN RAISE EXCEPTION 'Ambito non valido: %', v_ambito; END IF;

  SELECT codice INTO v_doc_cod FROM documenti WHERE id = v_doc;
  IF NOT FOUND THEN RAISE EXCEPTION 'Preventivo inesistente'; END IF;

  IF v_ambito = 'blocchi' THEN
    SELECT array_agg(value) INTO v_blocchi FROM jsonb_array_elements_text(COALESCE(p_payload->'blocchi', '[]'::jsonb));
    IF v_blocchi IS NULL OR cardinality(v_blocchi) = 0 THEN RAISE EXCEPTION 'Nessun blocco selezionato'; END IF;
  ELSIF v_ambito = 'righe' THEN
    SELECT array_agg(value::uuid) INTO v_righe FROM jsonb_array_elements_text(COALESCE(p_payload->'righe', '[]'::jsonb));
    IF v_righe IS NULL OR cardinality(v_righe) = 0 THEN RAISE EXCEPTION 'Nessuna riga selezionata'; END IF;
  END IF;

  v_qta := NULLIF(p_payload->>'quantita_articolo', '')::numeric;
  IF v_qta IS NULL THEN
    SELECT CASE WHEN count(DISTINCT r.codice_blocco) = 1 THEN max(COALESCE(b.quantita_pezzi, 1)) ELSE 1 END
      INTO v_qta
      FROM righe_distinta r
      LEFT JOIN blocchi b ON b.documento_id = r.documento_id AND b.codice_blocco = r.codice_blocco
     WHERE r.documento_id = v_doc
       AND r.split_fonte IS DISTINCT FROM 'distinta'
       AND (v_ambito = 'preventivo'
            OR (v_ambito = 'blocchi' AND r.codice_blocco = ANY (v_blocchi))
            OR (v_ambito = 'righe'   AND r.id = ANY (v_righe)));
  END IF;
  v_qta := GREATEST(COALESCE(v_qta, 1), 1);

  INSERT INTO consuntivi (codice_articolo, descrizione, documento_id, documento_codice, ambito,
                          quantita_articolo, note, creato_da)
  VALUES (v_codice, NULLIF(btrim(COALESCE(p_payload->>'descrizione', '')), ''), v_doc, v_doc_cod, v_ambito,
          v_qta, NULLIF(btrim(COALESCE(p_payload->>'note', '')), ''),
          NULLIF(p_payload->>'_user_id', '')::uuid)
  RETURNING id INTO v_id;

  -- Snapshot. Materiali x pezzi del blocco, manodopera x 1 (stessa regola di costo_complessivo).
  --   * 'materia'  : costo pieno = prezzo_unitario (materia prima) + componenti spostate (per unita)
  --   * 'distinta' : saltata, e' gia' contata nelle righe 'materia' da cui deriva
  --   * altre      : come nella migration 157
  INSERT INTO consuntivo_righe
    (consuntivo_id, ordine, codice_blocco, tipo_riga, codice_articolo, descrizione, quantita,
     quantita_pezzi_blocco, costo_unitario, split_fonte,
     costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro, costo_totale)
  SELECT v_id, r.ordine, r.codice_blocco, r.tipo_riga, r.codice_articolo, r.descrizione, r.quantita,
         m.pezzi,
         CASE WHEN r.split_fonte = 'materia'
              THEN COALESCE(r.prezzo_unitario, 0) + COALESCE(r.costo_manodopera, 0) + COALESCE(r.costo_lavorazione, 0)
                   + COALESCE(r.costo_lav_esterna, 0) + COALESCE(r.costo_altro, 0)
              ELSE r.prezzo_unitario END,
         r.split_fonte,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte IS NOT NULL THEN COALESCE(r.costo_materiale, 0)   WHEN r.tipo_riga = 'materiale'  THEN COALESCE(r.prezzo_unitario, 0) ELSE 0 END,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte IS NOT NULL THEN COALESCE(r.costo_manodopera, 0)  WHEN r.tipo_riga = 'manodopera' THEN COALESCE(r.prezzo_unitario, 0) ELSE 0 END,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte IS NOT NULL THEN COALESCE(r.costo_lavorazione, 0) ELSE 0 END,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte IS NOT NULL THEN COALESCE(r.costo_lav_esterna, 0) ELSE 0 END,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte IS NOT NULL THEN COALESCE(r.costo_altro, 0)       ELSE 0 END,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte = 'materia'
              THEN COALESCE(r.prezzo_unitario, 0) + COALESCE(r.costo_manodopera, 0) + COALESCE(r.costo_lavorazione, 0)
                   + COALESCE(r.costo_lav_esterna, 0) + COALESCE(r.costo_altro, 0)
              ELSE COALESCE(r.prezzo_unitario, 0) END
    FROM righe_distinta r
    LEFT JOIN LATERAL (
      SELECT COALESCE(b.quantita_pezzi, 1) AS pezzi,
             CASE WHEN r.tipo_riga = 'materiale' THEN COALESCE(b.quantita_pezzi, 1) ELSE 1 END AS mult
        FROM (SELECT 1) x
        LEFT JOIN LATERAL (SELECT quantita_pezzi FROM blocchi
                            WHERE documento_id = r.documento_id AND codice_blocco = r.codice_blocco
                            ORDER BY ordine NULLS LAST LIMIT 1) b ON true
    ) m ON true
   WHERE r.documento_id = v_doc
     AND r.split_fonte IS DISTINCT FROM 'distinta'
     AND (v_ambito = 'preventivo'
          OR (v_ambito = 'blocchi' AND r.codice_blocco = ANY (v_blocchi))
          OR (v_ambito = 'righe'   AND r.id = ANY (v_righe)))
   ORDER BY r.ordine NULLS LAST, r.created_at;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'La selezione non contiene righe'; END IF;

  UPDATE consuntivi c SET
    prev_materiale   = t.mat, prev_manodopera = t.mdo, prev_lavorazione = t.lav,
    prev_lav_esterna = t.est, prev_altro      = t.alt, prev_totale      = t.tot
    FROM (SELECT sum(costo_materiale) mat, sum(costo_manodopera) mdo, sum(costo_lavorazione) lav,
                 sum(costo_lav_esterna) est, sum(costo_altro) alt, sum(costo_totale) tot
            FROM consuntivo_righe WHERE consuntivo_id = v_id) t
   WHERE c.id = v_id;

  rif := _consuntivo_riferimento(v_codice);
  IF rif.codice_norm IS NOT NULL THEN
    UPDATE consuntivi SET
      descrizione = COALESCE(descrizione, rif.descrizione),
      rif_tipo = rif.tipo_costo, rif_data = rif.data_elaborazione,
      rif_materiale = rif.costo_materiale, rif_manodopera = rif.costo_manodopera,
      rif_lavorazione = rif.costo_lavorazione, rif_lav_esterna = rif.costo_lav_esterna,
      rif_altro = rif.costo_altro, rif_totale = rif.costo_totale
     WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'righe', v_n, 'riferimento_trovato', rif.codice_norm IS NOT NULL);
END;
$fn$;
