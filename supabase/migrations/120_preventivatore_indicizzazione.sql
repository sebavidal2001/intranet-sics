-- 120_preventivatore_indicizzazione.sql
--
-- I preventivi del builder diventano ricercabili dalla chat (ricognizione del 27/09/2026).
--
-- Prima di questa migration:
--   * il builder scriveva UN chunk con embedding NULL, e nulla lo riempiva
--     (solo lo script manuale scripts/genera-embeddings-mancanti.cjs);
--   * ogni modifica cancellava il chunk (anche se già indicizzato) e lo ricreava vuoto;
--   * il testo era «Preventivo X. Cliente Y. Prezzo Z EUR (costo W). N blocchi.»:
--     nessun contenuto tecnico, quindi introvabile anche con il vettore;
--   * i filtri (portfolio, cliente) si applicavano dopo la top-K globale.
--
-- Dopo:
--   * `rigenera_chunks_documento(id)` costruisce un chunk documento + un chunk per
--     blocco (articoli con codice e descrizione, lavorazioni con ore, note) dallo
--     stato salvato, e CONSERVA l'embedding dei testi rimasti identici;
--   * le RPC del builder la chiamano al posto del vecchio riassunto, salvano le note
--     di blocco, scrivono `tempo_preventivazione_sec` e (in modifica) applicano il
--     blocco ottimistico `_versione_attesa`;
--   * l'embedding lo calcola l'app subito dopo il salvataggio (indicizzazione.ts) e,
--     come rete di sicurezza, lo script di backfill su timer;
--   * `match_chunks_scoped` applica scope e filtri PRIMA di ORDER BY/LIMIT;
--   * versionati indice e `match_chunks` in halfvec, come già sono in produzione
--     (HNSW non accetta `vector` oltre 2000 dimensioni: la 021 non era riproducibile).

-- ── 1) Tracciabilità degli embedding ──────────────────────────────────────────
ALTER TABLE preventivatore.chunks
  ADD COLUMN IF NOT EXISTS embedding_modello text,
  ADD COLUMN IF NOT EXISTS embedded_at       timestamptz,
  ADD COLUMN IF NOT EXISTS contenuto_hash    text;

COMMENT ON COLUMN preventivatore.chunks.embedding_modello IS 'Modello che ha calcolato l''embedding (es. gemini-embedding-2).';
COMMENT ON COLUMN preventivatore.chunks.embedded_at       IS 'Quando è stato calcolato l''embedding.';
COMMENT ON COLUMN preventivatore.chunks.contenuto_hash    IS 'md5(contenuto): permette di riusare l''embedding se il testo non cambia.';

-- ── 2) Indice vettoriale: lo stato reale (halfvec) ────────────────────────────
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT indexdef INTO v_def
  FROM pg_indexes
  WHERE schemaname = 'preventivatore' AND indexname = 'idx_chunks_embedding';

  IF v_def IS NOT NULL AND v_def NOT ILIKE '%halfvec%' THEN
    EXECUTE 'DROP INDEX preventivatore.idx_chunks_embedding';
    v_def := NULL;
  END IF;

  IF v_def IS NULL THEN
    EXECUTE 'CREATE INDEX idx_chunks_embedding ON preventivatore.chunks '
            'USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops) WITH (m = 16, ef_construction = 64)';
  END IF;
END $$;

-- ── 3) match_chunks: la definizione in produzione, versionata ─────────────────
CREATE OR REPLACE FUNCTION preventivatore.match_chunks(
  query_embedding  vector,
  match_threshold  double precision DEFAULT 0.5,
  match_count      integer DEFAULT 8,
  filter_cliente   text DEFAULT NULL,
  filter_categoria text DEFAULT NULL
)
RETURNS TABLE (id uuid, documento_id uuid, contenuto text, metadata jsonb, similarity double precision)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    c.id,
    c.documento_id,
    c.contenuto,
    c.metadata,
    1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity
  FROM preventivatore.chunks c
  JOIN preventivatore.documenti d ON c.documento_id = d.id
  WHERE c.embedding IS NOT NULL
    AND 1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) > match_threshold
    AND (filter_cliente   IS NULL OR d.cliente ILIKE '%' || filter_cliente || '%')
    AND (filter_categoria IS NULL OR d.categoria = filter_categoria)
  ORDER BY c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  LIMIT match_count;
$function$;

-- ── 4) match_chunks_scoped: filtri dentro la query ────────────────────────────
-- p_cliente_ids NULL = nessuno scope (admin); array vuoto = nessun risultato.
-- `hnsw.iterative_scan` (pgvector ≥ 0.8) fa proseguire la scansione dell'indice
-- finché i filtri non hanno restituito abbastanza righe.
CREATE OR REPLACE FUNCTION preventivatore.match_chunks_scoped(
  query_embedding     vector(3072),
  match_threshold     double precision DEFAULT 0.5,
  match_count         integer DEFAULT 8,
  p_cliente_ids       uuid[] DEFAULT NULL,
  p_cliente           text DEFAULT NULL,
  p_tipo              text DEFAULT NULL,
  p_escludi_documento uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, documento_id uuid, contenuto text, metadata jsonb, similarity double precision)
LANGUAGE sql
STABLE
SET hnsw.iterative_scan = 'relaxed_order'
AS $function$
  SELECT s.id, s.documento_id, s.contenuto, s.metadata, s.similarity
  FROM (
    SELECT
      c.id,
      c.documento_id,
      c.contenuto,
      c.metadata,
      1 - (c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) AS similarity
    FROM preventivatore.chunks c
    JOIN preventivatore.documenti d ON d.id = c.documento_id
    WHERE c.embedding IS NOT NULL
      AND (p_cliente_ids IS NULL OR d.cliente_master_id = ANY (p_cliente_ids))
      AND (p_cliente IS NULL OR d.cliente ILIKE '%' || p_cliente || '%')
      AND (p_tipo IS NULL OR d.tipo = p_tipo)
      AND (p_escludi_documento IS NULL OR d.id <> p_escludi_documento)
    ORDER BY c.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
    LIMIT GREATEST(1, LEAST(match_count, 200))
  ) s
  WHERE s.similarity > match_threshold
  ORDER BY s.similarity DESC;
$function$;

-- ── 5) Testi ricercabili dei preventivi del builder ───────────────────────────
-- Inserisce un chunk riusando l'embedding di un chunk precedente con lo stesso testo.
CREATE OR REPLACE FUNCTION preventivatore._inserisci_chunk_builder(
  p_doc_id   uuid,
  p_indice   integer,
  p_testo    text,
  p_metadata jsonb,
  p_vecchi   uuid[]
)
RETURNS void
LANGUAGE sql
AS $function$
  INSERT INTO preventivatore.chunks
    (documento_id, chunk_index, contenuto, metadata, contenuto_hash, embedding, embedding_modello, embedded_at)
  SELECT p_doc_id, p_indice, p_testo, p_metadata, md5(p_testo),
         v.embedding, v.embedding_modello, v.embedded_at
  FROM (SELECT 1) AS uno
  LEFT JOIN LATERAL (
    SELECT c.embedding, c.embedding_modello, c.embedded_at
    FROM preventivatore.chunks c
    WHERE c.id = ANY (p_vecchi)
      AND c.embedding IS NOT NULL
      AND md5(c.contenuto) = md5(p_testo)
    LIMIT 1
  ) v ON true;
$function$;

CREATE OR REPLACE FUNCTION preventivatore.rigenera_chunks_documento(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
AS $function$
DECLARE
  v_doc      record;
  v_vecchi   uuid[];
  v_base     jsonb;
  v_testo    text;
  v_elenco   text;
  v_art      text;
  v_lav      text;
  v_costo    numeric;
  v_n        integer;
  v_indice   integer := 0;
  b          record;
BEGIN
  SELECT id, codice, cliente, tipo, tipo_prodotto, numero_preventivo, note,
         data_consegna_richiesta, consegna_settimane_min, consegna_settimane_max,
         importo_preventivo, margine_trattativa_pct
    INTO v_doc
  FROM preventivatore.documenti
  WHERE id = p_id;

  -- Gli storici hanno i propri chunk dall'ingest (Word/Excel): non si toccano.
  IF NOT FOUND OR v_doc.tipo <> 'generato' THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(array_agg(c.id), '{}'::uuid[]) INTO v_vecchi
  FROM preventivatore.chunks c WHERE c.documento_id = p_id;

  v_base := jsonb_build_object(
    'source_type', 'builder',
    'codice_progetto', v_doc.codice,
    'cliente', v_doc.cliente);

  SELECT count(*), COALESCE(sum(costo_complessivo), 0) INTO v_n, v_costo
  FROM preventivatore.blocchi WHERE documento_id = p_id;

  SELECT string_agg(format('- %s (%s pz)', COALESCE(codice_blocco, 'Blocco senza nome'), COALESCE(quantita_pezzi, 1)),
                    E'\n' ORDER BY ordine NULLS LAST, created_at)
    INTO v_elenco
  FROM preventivatore.blocchi WHERE documento_id = p_id;

  -- Chunk documento: la visione d'insieme.
  v_testo := concat_ws(E'\n',
    format('Preventivo %s — %s', v_doc.codice, COALESCE(v_doc.tipo_prodotto, 'senza titolo')),
    format('Cliente: %s', COALESCE(v_doc.cliente, '-')),
    CASE WHEN v_doc.numero_preventivo IS NOT NULL THEN format('Numero preventivo: %s', v_doc.numero_preventivo) END,
    CASE WHEN v_doc.consegna_settimane_min IS NOT NULL OR v_doc.consegna_settimane_max IS NOT NULL
         THEN format('Consegna: %s-%s settimane', COALESCE(v_doc.consegna_settimane_min::text, '?'), COALESCE(v_doc.consegna_settimane_max::text, '?')) END,
    CASE WHEN v_doc.data_consegna_richiesta IS NOT NULL
         THEN format('Consegna richiesta: %s', to_char(v_doc.data_consegna_richiesta, 'DD/MM/YYYY')) END,
    CASE WHEN v_doc.note IS NOT NULL THEN 'Note: ' || v_doc.note END,
    CASE WHEN v_elenco IS NOT NULL THEN E'Blocchi:\n' || v_elenco END,
    format('Prezzo %s EUR (costo %s).',
           to_char(COALESCE(v_doc.importo_preventivo, 0), 'FM999G999G990D00'),
           to_char(v_costo, 'FM999G999G990D00')));

  PERFORM preventivatore._inserisci_chunk_builder(p_id, v_indice, v_testo,
    v_base || jsonb_build_object(
      'tipo', 'preventivo_generato',
      'builder_state', jsonb_build_object('totali', jsonb_build_object(
        'prezzo_finale', v_doc.importo_preventivo,
        'costo_complessivo', v_costo,
        'margine_trattativa_pct', v_doc.margine_trattativa_pct,
        'n_blocchi', v_n))),
    v_vecchi);

  -- Un chunk per blocco: è ciò che la ricerca «preventivi simili» confronta.
  -- Blocchi con lo stesso nome condividono le righe (righe_distinta si lega per
  -- codice_blocco), quindi si raggruppano.
  FOR b IN
    SELECT codice_blocco,
           max(COALESCE(quantita_pezzi, 1)) AS quantita,
           string_agg(note, ' ' ORDER BY ordine NULLS LAST) FILTER (WHERE note IS NOT NULL) AS note,
           min(COALESCE(ordine, 2147483647)) AS ordine_min,
           min(created_at) AS creato
    FROM preventivatore.blocchi
    WHERE documento_id = p_id
    GROUP BY codice_blocco
    ORDER BY ordine_min, creato
  LOOP
    SELECT string_agg(format('- %s %s ×%s', COALESCE(r.codice_articolo, ''), COALESCE(r.descrizione, ''),
                             trim_scale(COALESCE(r.quantita, 0))), E'\n' ORDER BY r.ordine NULLS LAST, r.id)
      INTO v_art
    FROM (
      SELECT * FROM preventivatore.righe_distinta
      WHERE documento_id = p_id
        AND codice_blocco IS NOT DISTINCT FROM b.codice_blocco
        AND tipo_riga = 'materiale'
      ORDER BY ordine NULLS LAST, id
      LIMIT 150
    ) r;

    SELECT string_agg(format('- %s: %s h', COALESCE(r.descrizione, 'lavorazione'), trim_scale(COALESCE(r.quantita, 0))),
                      E'\n' ORDER BY r.ordine NULLS LAST, r.id)
      INTO v_lav
    FROM (
      SELECT * FROM preventivatore.righe_distinta
      WHERE documento_id = p_id
        AND codice_blocco IS NOT DISTINCT FROM b.codice_blocco
        AND tipo_riga = 'manodopera'
      ORDER BY ordine NULLS LAST, id
      LIMIT 60
    ) r;

    v_testo := concat_ws(E'\n',
      format('Preventivo %s — %s — Cliente: %s', v_doc.codice, COALESCE(v_doc.tipo_prodotto, 'senza titolo'), COALESCE(v_doc.cliente, '-')),
      format('Blocco: %s (%s pz)', COALESCE(b.codice_blocco, 'Blocco senza nome'), b.quantita),
      CASE WHEN b.note IS NOT NULL THEN 'Note: ' || b.note END,
      CASE WHEN v_art IS NOT NULL THEN E'Articoli:\n' || v_art END,
      CASE WHEN v_lav IS NOT NULL THEN E'Lavorazioni:\n' || v_lav END);

    v_indice := v_indice + 1;
    PERFORM preventivatore._inserisci_chunk_builder(p_id, v_indice, v_testo,
      v_base || jsonb_build_object(
        'tipo', 'blocco_generato',
        'sheet_name', b.codice_blocco,
        'codice_blocco', b.codice_blocco),
      v_vecchi);
  END LOOP;

  DELETE FROM preventivatore.chunks WHERE id = ANY (v_vecchi);
  RETURN v_indice + 1;
END;
$function$;

-- ── crea_documento_dal_builder (base: definizione in produzione al 27/09/2026) ──
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
           totale_riga, totale_riga_ceil_2, tipo_riga, scala_con_quantita, ordine)
        VALUES
          (v_doc_id, 'builder', cod_block, art->>'codice', art->>'descrizione',
           (art->>'qty')::numeric, (art->>'ult_costo')::numeric,
           (art->>'coeff_ricarico')::numeric, (art->>'coeff_ricarico')::numeric,
           CASE WHEN (art->>'coeff_ricarico')::numeric > 0 THEN (art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric ELSE 0 END,
           CASE WHEN (art->>'coeff_ricarico')::numeric > 0 THEN ceil((art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric * 100) / 100 ELSE 0 END,
           'materiale', true, v_riga_ord);
      END LOOP;
      IF blocco ? 'servizi' THEN
        FOR srv IN SELECT * FROM jsonb_array_elements(blocco->'servizi')
        LOOP
          v_riga_ord := v_riga_ord + 1;
          INSERT INTO preventivatore.righe_distinta
            (documento_id, sheet_name, codice_blocco, codice_articolo, descrizione,
             quantita, prezzo_unitario, ricarico_pct, ricarico_coefficiente,
             totale_riga, totale_riga_ceil_2, tipo_riga, scala_con_quantita, ordine)
          VALUES
            (v_doc_id, 'builder', cod_block, NULL, srv->>'nome',
             (srv->>'ore')::numeric, (srv->>'tariffa_ora')::numeric,
             (srv->>'coeff_ricarico')::numeric, (srv->>'coeff_ricarico')::numeric,
             CASE WHEN (srv->>'coeff_ricarico')::numeric > 0 THEN (srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric ELSE 0 END,
             CASE WHEN (srv->>'coeff_ricarico')::numeric > 0 THEN ceil((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric * 100) / 100 ELSE 0 END,
             'manodopera', COALESCE((srv->>'scala_con_quantita')::boolean, true), v_riga_ord);
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

-- ── aggiorna_documento_dal_builder (base: definizione in produzione al 27/09/2026) ──
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
           totale_riga, totale_riga_ceil_2, tipo_riga, scala_con_quantita, ordine)
        VALUES
          (p_id, 'builder', cod_block, art->>'codice', art->>'descrizione',
           (art->>'qty')::numeric, (art->>'ult_costo')::numeric,
           (art->>'coeff_ricarico')::numeric, (art->>'coeff_ricarico')::numeric,
           CASE WHEN (art->>'coeff_ricarico')::numeric > 0 THEN (art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric ELSE 0 END,
           CASE WHEN (art->>'coeff_ricarico')::numeric > 0 THEN ceil((art->>'ult_costo')::numeric * (art->>'qty')::numeric / (art->>'coeff_ricarico')::numeric * 100) / 100 ELSE 0 END,
           'materiale', true, v_riga_ord);
      END LOOP;
      IF blocco ? 'servizi' THEN
        FOR srv IN SELECT * FROM jsonb_array_elements(blocco->'servizi')
        LOOP
          v_riga_ord := v_riga_ord + 1;
          INSERT INTO preventivatore.righe_distinta
            (documento_id, sheet_name, codice_blocco, codice_articolo, descrizione,
             quantita, prezzo_unitario, ricarico_pct, ricarico_coefficiente,
             totale_riga, totale_riga_ceil_2, tipo_riga, scala_con_quantita, ordine)
          VALUES
            (p_id, 'builder', cod_block, NULL, srv->>'nome',
             (srv->>'ore')::numeric, (srv->>'tariffa_ora')::numeric,
             (srv->>'coeff_ricarico')::numeric, (srv->>'coeff_ricarico')::numeric,
             CASE WHEN (srv->>'coeff_ricarico')::numeric > 0 THEN (srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric ELSE 0 END,
             CASE WHEN (srv->>'coeff_ricarico')::numeric > 0 THEN ceil((srv->>'tariffa_ora')::numeric * (srv->>'ore')::numeric / (srv->>'coeff_ricarico')::numeric * 100) / 100 ELSE 0 END,
             'manodopera', COALESCE((srv->>'scala_con_quantita')::boolean, true), v_riga_ord);
        END LOOP;
      END IF;
    END;
  END LOOP;

  PERFORM preventivatore.rigenera_chunks_documento(p_id);

  RETURN jsonb_build_object('id', p_id, 'codice', v_codice);
END;
$function$;

-- ── 6) Permessi: lockdown (migration 062), solo service_role ──────────────────
REVOKE EXECUTE ON FUNCTION preventivatore._inserisci_chunk_builder(uuid, integer, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION preventivatore.rigenera_chunks_documento(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION preventivatore.match_chunks_scoped(vector, double precision, integer, uuid[], text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION preventivatore._inserisci_chunk_builder(uuid, integer, text, jsonb, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION preventivatore.rigenera_chunks_documento(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION preventivatore.match_chunks_scoped(vector, double precision, integer, uuid[], text, text, uuid) TO service_role;

-- ── 7) I preventivi del builder già esistenti ─────────────────────────────────
-- Rigenera i testi; gli embedding li calcola il backfill (script/timer).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM preventivatore.documenti WHERE tipo = 'generato' LOOP
    PERFORM preventivatore.rigenera_chunks_documento(r.id);
  END LOOP;
END $$;

-- ── 8) Embedding via OpenRouter ───────────────────────────────────────────────
-- Tutta l'AI passa da OpenRouter (27/09/2026). È lo stesso modello Google: i
-- vettori ricalcolati via OpenRouter coincidono con quelli salvati (coseno 1,00000).
UPDATE preventivatore.ai_config
SET valore = 'google/gemini-embedding-2-preview'
WHERE chiave = 'modello_embedding' AND valore IN ('gemini-embedding-2', '');

NOTIFY pgrst, 'reload schema';
