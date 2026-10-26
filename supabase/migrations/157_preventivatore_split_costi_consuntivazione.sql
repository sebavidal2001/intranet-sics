-- ════════════════════════════════════════════════════════════════════════════
-- 157 — Split dei costi (materiale / manodopera / lavorazioni) e consuntivazione
-- ════════════════════════════════════════════════════════════════════════════
--
-- Richiesta dell'ufficio tecnico (mail di Danilo del 26/10/2026): il costo di un
-- articolo va diviso in materia prima, manodopera e trattamenti esterni, anche
-- per i sottogruppi. Impresa lo calcola gia': dba.prd_costo_articolo, riga
-- tipo_costo = 'S' (costo standard, fotografia notturna), colonne costo_dist_*
-- = costo cumulato lungo la distinta. La somma delle componenti quadra con
-- costo_articolo su tutti i 55.657 articoli dello snapshot del 25/10/2026.
--
-- Cosa fa questa migration (tutto additivo, nessuna RPC del builder toccata):
--   1. articoli_costi_split        — lo split di Impresa per codice articolo
--                                    (+ staging e funzione di sostituzione atomica)
--   2. righe_distinta.costo_*      — lo split CONGELATO su ogni riga del builder,
--                                    riempito da un trigger BEFORE INSERT: crea_ e
--                                    aggiorna_documento_dal_builder restano identiche
--   3. consuntivi, consuntivo_righe — il consuntivo per codice articolo: snapshot
--                                    del preventivato selezionato + riferimento
--                                    Impresa; crea_consuntivo() fa lo snapshot
--
-- Regola dello split sul preventivo: le PERCENTUALI vengono da Impresa, l'IMPORTO
-- dal costo effettivamente usato nella riga (prezzo_unitario, che per Dorner e
-- Alusic e' gia' quello di listino). Cosi' le componenti sommano sempre al costo
-- della riga, anche quando il costo del preventivo differisce dallo standard.
--
-- Applicazione: PRIMA del deploy del codice (le route nuove leggono queste tabelle).
-- Rollback: drop delle tre tabelle/funzioni nuove, trigger e colonne di righe_distinta.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) Split dei costi per codice articolo (da Impresa) ────────────────────

CREATE TABLE IF NOT EXISTS preventivatore.articoli_costi_split (
  codice_norm        text PRIMARY KEY,           -- UPPER(codice) senza spazi/punteggiatura
  codice             text NOT NULL,              -- codice come in Impresa (dba.articolo.codice)
  descrizione        text,
  tipo_costo         text NOT NULL DEFAULT 'S',  -- 'S' standard; predisposto per 'C' (consuntivo di OdL)
  data_elaborazione  timestamptz NOT NULL,       -- dba.prd_costo_articolo.data_elaborazione
  costo_totale       numeric(14,4) NOT NULL,
  costo_materiale    numeric(14,4) NOT NULL DEFAULT 0,
  costo_manodopera   numeric(14,4) NOT NULL DEFAULT 0,
  costo_lavorazione  numeric(14,4) NOT NULL DEFAULT 0,  -- ore macchina interne
  costo_lav_esterna  numeric(14,4) NOT NULL DEFAULT 0,  -- trattamenti / lavorazioni esterne
  costo_altro        numeric(14,4) NOT NULL DEFAULT 0,  -- attrezzaggio, indiretti, imballo, trasporto, scarto, ...
  caricato_il        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT articoli_costi_split_quadra CHECK (
    abs(costo_materiale + costo_manodopera + costo_lavorazione + costo_lav_esterna + costo_altro - costo_totale) < 0.01
  )
);

COMMENT ON TABLE preventivatore.articoli_costi_split IS
  'Split del costo standard di Impresa (prd_costo_articolo tipo S, colonne costo_dist_* = cumulato lungo la distinta) per codice articolo. Sostituita per intero a ogni sincronizzazione.';

CREATE UNLOGGED TABLE IF NOT EXISTS preventivatore.articoli_costi_split_staging (
  codice             text,
  descrizione        text,
  data_elaborazione  timestamptz,
  costo_totale       numeric,
  costo_materiale    numeric,
  costo_manodopera   numeric,
  costo_lavorazione  numeric,
  costo_lav_esterna  numeric,
  costo_altro        numeric
);

CREATE TABLE IF NOT EXISTS preventivatore.split_costi_sync (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  eseguita_il    timestamptz NOT NULL DEFAULT now(),
  righe          int  NOT NULL,
  snapshot_dal   timestamptz,
  snapshot_al    timestamptz,
  nota           text
);

ALTER TABLE preventivatore.articoli_costi_split         ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.articoli_costi_split_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.split_costi_sync             ENABLE ROW LEVEL SECURITY;

-- Sostituzione atomica dal file caricato nello staging. Rifiuta un file palesemente
-- monco (meno di p_min_righe): meglio tenere lo split di ieri che perderlo.
CREATE OR REPLACE FUNCTION preventivatore.sostituisci_split_costi(p_min_righe int DEFAULT 5000, p_nota text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = preventivatore, pg_temp
AS $fn$
DECLARE
  v_n  int;
  v_dal timestamptz;
  v_al  timestamptz;
BEGIN
  SELECT count(*), min(data_elaborazione), max(data_elaborazione)
    INTO v_n, v_dal, v_al
    FROM articoli_costi_split_staging
   WHERE codice IS NOT NULL AND btrim(codice) <> '';

  IF v_n < p_min_righe THEN
    RAISE EXCEPTION 'Split costi: % righe nello staging, ne servono almeno % (file incompleto?)', v_n, p_min_righe;
  END IF;

  DELETE FROM articoli_costi_split;
  INSERT INTO articoli_costi_split
    (codice_norm, codice, descrizione, data_elaborazione, costo_totale,
     costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro)
  SELECT DISTINCT ON (upper(regexp_replace(codice, '[\s.\-_/\\*?]+', '', 'g')))
         upper(regexp_replace(codice, '[\s.\-_/\\*?]+', '', 'g')),
         btrim(codice), NULLIF(btrim(descrizione), ''), data_elaborazione, costo_totale,
         costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro
    FROM articoli_costi_split_staging
   WHERE codice IS NOT NULL AND btrim(codice) <> ''
   ORDER BY upper(regexp_replace(codice, '[\s.\-_/\\*?]+', '', 'g')), data_elaborazione DESC;

  TRUNCATE articoli_costi_split_staging;
  INSERT INTO split_costi_sync (righe, snapshot_dal, snapshot_al, nota) VALUES (v_n, v_dal, v_al, p_nota);
  RETURN jsonb_build_object('righe', v_n, 'snapshot_dal', v_dal, 'snapshot_al', v_al);
END;
$fn$;

-- ─── 2) Split congelato sulle righe del builder ─────────────────────────────

ALTER TABLE preventivatore.righe_distinta
  ADD COLUMN IF NOT EXISTS costo_materiale   numeric,   -- parte di prezzo_unitario che e' materia prima
  ADD COLUMN IF NOT EXISTS costo_manodopera  numeric,
  ADD COLUMN IF NOT EXISTS costo_lavorazione numeric,
  ADD COLUMN IF NOT EXISTS costo_lav_esterna numeric,
  ADD COLUMN IF NOT EXISTS costo_altro       numeric,
  ADD COLUMN IF NOT EXISTS split_fonte       text,       -- 'impresa' | 'assunto' | 'servizio'
  ADD COLUMN IF NOT EXISTS split_data        timestamptz; -- data dello snapshot Impresa usato

ALTER TABLE preventivatore.righe_distinta DROP CONSTRAINT IF EXISTS righe_distinta_split_fonte_check;
ALTER TABLE preventivatore.righe_distinta
  ADD CONSTRAINT righe_distinta_split_fonte_check
  CHECK (split_fonte IS NULL OR split_fonte IN ('impresa', 'assunto', 'servizio'));

COMMENT ON COLUMN preventivatore.righe_distinta.costo_materiale IS
  'Split di prezzo_unitario (per unita) congelato all''inserimento. Somma delle cinque componenti = prezzo_unitario. NULL per lo storico importato da Excel.';
COMMENT ON COLUMN preventivatore.righe_distinta.split_fonte IS
  'impresa = percentuali dallo standard di Impresa; assunto = nessuno split disponibile, tutto materiale; servizio = riga di manodopera, tutto manodopera.';

-- Trigger: solo righe del builder (sheet_name = 'builder'); l'import Excel resta com'e'.
-- aggiorna_documento_dal_builder rifa DELETE + INSERT: lo split si ricalcola con lo
-- standard del momento, coerentemente con il fatto che la bozza e' modificabile.
CREATE OR REPLACE FUNCTION preventivatore.righe_distinta_calcola_split()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = preventivatore, pg_temp
AS $fn$
DECLARE
  s      articoli_costi_split%ROWTYPE;
  v_tot  numeric := COALESCE(NEW.prezzo_unitario, 0);
  v_mat  numeric;
  v_mdo  numeric;
  v_lav  numeric;
  v_est  numeric;
BEGIN
  IF NEW.split_fonte IS NOT NULL OR NEW.sheet_name IS DISTINCT FROM 'builder' THEN
    RETURN NEW;
  END IF;

  NEW.split_data := now();

  IF NEW.tipo_riga = 'manodopera' THEN
    NEW.costo_materiale := 0; NEW.costo_manodopera := v_tot; NEW.costo_lavorazione := 0;
    NEW.costo_lav_esterna := 0; NEW.costo_altro := 0;
    NEW.split_fonte := 'servizio';
    RETURN NEW;
  END IF;

  IF NEW.codice_articolo IS NOT NULL THEN
    SELECT * INTO s FROM articoli_costi_split
     WHERE codice_norm = upper(regexp_replace(NEW.codice_articolo, '[\s.\-_/\\*?]+', '', 'g'));
  END IF;

  IF s.codice_norm IS NOT NULL AND s.costo_totale > 0 THEN
    v_mat := round(v_tot * s.costo_materiale   / s.costo_totale, 6);
    v_mdo := round(v_tot * s.costo_manodopera  / s.costo_totale, 6);
    v_lav := round(v_tot * s.costo_lavorazione / s.costo_totale, 6);
    v_est := round(v_tot * s.costo_lav_esterna / s.costo_totale, 6);
    NEW.costo_materiale   := v_mat;
    NEW.costo_manodopera  := v_mdo;
    NEW.costo_lavorazione := v_lav;
    NEW.costo_lav_esterna := v_est;
    NEW.costo_altro       := v_tot - v_mat - v_mdo - v_lav - v_est;  -- assorbe l'arrotondamento
    NEW.split_fonte := 'impresa';
    NEW.split_data  := s.data_elaborazione;
  ELSE
    NEW.costo_materiale := v_tot; NEW.costo_manodopera := 0; NEW.costo_lavorazione := 0;
    NEW.costo_lav_esterna := 0; NEW.costo_altro := 0;
    NEW.split_fonte := 'assunto';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_righe_distinta_split ON preventivatore.righe_distinta;
CREATE TRIGGER trg_righe_distinta_split
  BEFORE INSERT ON preventivatore.righe_distinta
  FOR EACH ROW EXECUTE FUNCTION preventivatore.righe_distinta_calcola_split();

-- ─── 3) Consuntivazione ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS preventivatore.consuntivi (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codice_articolo    text NOT NULL,                 -- codice di Impresa a cui si attribuisce il consuntivo
  descrizione        text,
  documento_id       uuid REFERENCES preventivatore.documenti(id) ON DELETE SET NULL,  -- solo per navigare
  documento_codice   text,                          -- copiato: resta leggibile se il preventivo sparisce
  ambito             text NOT NULL CHECK (ambito IN ('preventivo', 'blocchi', 'righe')),
  quantita_articolo  numeric NOT NULL DEFAULT 1 CHECK (quantita_articolo > 0),  -- pezzi dell'articolo coperti dalla selezione
  stato              text NOT NULL DEFAULT 'aperto' CHECK (stato IN ('aperto', 'chiuso')),
  note               text,
  -- Preventivato (SNAPSHOT: totale della selezione, non per unita)
  prev_materiale     numeric NOT NULL DEFAULT 0,
  prev_manodopera    numeric NOT NULL DEFAULT 0,
  prev_lavorazione   numeric NOT NULL DEFAULT 0,
  prev_lav_esterna   numeric NOT NULL DEFAULT 0,
  prev_altro         numeric NOT NULL DEFAULT 0,
  prev_totale        numeric NOT NULL DEFAULT 0,
  -- Riferimento di Impresa (PER UNITA, congelato; rinfrescabile a mano)
  rif_tipo           text,                          -- 'S' standard, 'C' consuntivo di OdL
  rif_data           timestamptz,
  rif_materiale      numeric,
  rif_manodopera     numeric,
  rif_lavorazione    numeric,
  rif_lav_esterna    numeric,
  rif_altro          numeric,
  rif_totale         numeric,
  creato_da          uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consuntivi_codice   ON preventivatore.consuntivi (upper(codice_articolo));
CREATE INDEX IF NOT EXISTS idx_consuntivi_documento ON preventivatore.consuntivi (documento_id);

CREATE TABLE IF NOT EXISTS preventivatore.consuntivo_righe (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consuntivo_id      uuid NOT NULL REFERENCES preventivatore.consuntivi(id) ON DELETE CASCADE,
  ordine             int,
  codice_blocco      text,
  tipo_riga          text,
  codice_articolo    text,
  descrizione        text NOT NULL,
  quantita           numeric,
  quantita_pezzi_blocco integer,                    -- moltiplicatore dei materiali usato nello snapshot
  costo_unitario     numeric,
  split_fonte        text,
  -- Totali di riga (gia' moltiplicati per quantita e pezzi del blocco)
  costo_materiale    numeric NOT NULL DEFAULT 0,
  costo_manodopera   numeric NOT NULL DEFAULT 0,
  costo_lavorazione  numeric NOT NULL DEFAULT 0,
  costo_lav_esterna  numeric NOT NULL DEFAULT 0,
  costo_altro        numeric NOT NULL DEFAULT 0,
  costo_totale       numeric NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_consuntivo_righe_cons ON preventivatore.consuntivo_righe (consuntivo_id);

ALTER TABLE preventivatore.consuntivi        ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.consuntivo_righe  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE preventivatore.consuntivi IS
  'Confronto preventivato / riferimento Impresa per codice articolo. Il preventivato e'' uno SNAPSHOT copiato da righe_distinta (che viene riscritta a ogni salvataggio della bozza): nessuna FK verso le righe.';

-- Riferimento Impresa -> colonne rif_* del consuntivo (valori per unita).
CREATE OR REPLACE FUNCTION preventivatore._consuntivo_riferimento(p_codice text)
RETURNS preventivatore.articoli_costi_split
LANGUAGE sql STABLE
SET search_path = preventivatore, pg_temp
AS $fn$
  SELECT * FROM preventivatore.articoli_costi_split
   WHERE codice_norm = upper(regexp_replace(COALESCE(p_codice, ''), '[\s.\-_/\\*?]+', '', 'g'));
$fn$;

-- Snapshot del preventivato selezionato + riferimento Impresa.
-- p_payload: { codice_articolo, descrizione?, documento_id, ambito: preventivo|blocchi|righe,
--              blocchi?: [codice_blocco], righe?: [uuid], quantita_articolo?, note?, _user_id? }
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

  -- Pezzi dell'articolo coperti dalla selezione: se indicati vincono; altrimenti i pezzi
  -- del blocco quando la selezione e' un solo blocco, altrimenti 1.
  v_qta := NULLIF(p_payload->>'quantita_articolo', '')::numeric;
  IF v_qta IS NULL THEN
    SELECT CASE WHEN count(DISTINCT r.codice_blocco) = 1 THEN max(COALESCE(b.quantita_pezzi, 1)) ELSE 1 END
      INTO v_qta
      FROM righe_distinta r
      LEFT JOIN blocchi b ON b.documento_id = r.documento_id AND b.codice_blocco = r.codice_blocco
     WHERE r.documento_id = v_doc
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

  -- Snapshot. I materiali si moltiplicano per i pezzi del blocco, la manodopera no:
  -- e' la stessa regola con cui crea_documento_dal_builder calcola costo_complessivo.
  INSERT INTO consuntivo_righe
    (consuntivo_id, ordine, codice_blocco, tipo_riga, codice_articolo, descrizione, quantita,
     quantita_pezzi_blocco, costo_unitario, split_fonte,
     costo_materiale, costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro, costo_totale)
  SELECT v_id, r.ordine, r.codice_blocco, r.tipo_riga, r.codice_articolo, r.descrizione, r.quantita,
         m.pezzi, r.prezzo_unitario, r.split_fonte,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte IS NOT NULL THEN COALESCE(r.costo_materiale, 0)   WHEN r.tipo_riga = 'materiale'  THEN COALESCE(r.prezzo_unitario, 0) ELSE 0 END,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte IS NOT NULL THEN COALESCE(r.costo_manodopera, 0)  WHEN r.tipo_riga = 'manodopera' THEN COALESCE(r.prezzo_unitario, 0) ELSE 0 END,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte IS NOT NULL THEN COALESCE(r.costo_lavorazione, 0) ELSE 0 END,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte IS NOT NULL THEN COALESCE(r.costo_lav_esterna, 0) ELSE 0 END,
         m.mult * COALESCE(r.quantita, 0) * CASE WHEN r.split_fonte IS NOT NULL THEN COALESCE(r.costo_altro, 0)       ELSE 0 END,
         m.mult * COALESCE(r.quantita, 0) * COALESCE(r.prezzo_unitario, 0)
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

-- Rinfresca il riferimento di Impresa (per esempio dopo la sincronizzazione notturna).
CREATE OR REPLACE FUNCTION preventivatore.aggiorna_riferimento_consuntivo(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = preventivatore, pg_temp
AS $fn$
DECLARE
  v_codice text;
  rif      articoli_costi_split%ROWTYPE;
BEGIN
  SELECT codice_articolo INTO v_codice FROM consuntivi WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consuntivo inesistente'; END IF;
  rif := _consuntivo_riferimento(v_codice);
  IF rif.codice_norm IS NULL THEN
    RETURN jsonb_build_object('riferimento_trovato', false);
  END IF;
  UPDATE consuntivi SET
    rif_tipo = rif.tipo_costo, rif_data = rif.data_elaborazione,
    rif_materiale = rif.costo_materiale, rif_manodopera = rif.costo_manodopera,
    rif_lavorazione = rif.costo_lavorazione, rif_lav_esterna = rif.costo_lav_esterna,
    rif_altro = rif.costo_altro, rif_totale = rif.costo_totale, updated_at = now()
   WHERE id = p_id;
  RETURN jsonb_build_object('riferimento_trovato', true, 'rif_data', rif.data_elaborazione);
END;
$fn$;

-- ─── 4) Permessi: solo service_role (l'app accede dalle route server) ────────

REVOKE ALL ON preventivatore.articoli_costi_split, preventivatore.articoli_costi_split_staging,
              preventivatore.split_costi_sync, preventivatore.consuntivi, preventivatore.consuntivo_righe
  FROM PUBLIC, anon, authenticated;
GRANT ALL PRIVILEGES ON preventivatore.articoli_costi_split, preventivatore.articoli_costi_split_staging,
                        preventivatore.split_costi_sync, preventivatore.consuntivi, preventivatore.consuntivo_righe
  TO service_role;

REVOKE EXECUTE ON FUNCTION preventivatore.sostituisci_split_costi(int, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION preventivatore.righe_distinta_calcola_split() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION preventivatore._consuntivo_riferimento(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION preventivatore.crea_consuntivo(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION preventivatore.aggiorna_riferimento_consuntivo(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION preventivatore.sostituisci_split_costi(int, text) TO service_role;
GRANT EXECUTE ON FUNCTION preventivatore._consuntivo_riferimento(text) TO service_role;
GRANT EXECUTE ON FUNCTION preventivatore.crea_consuntivo(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION preventivatore.aggiorna_riferimento_consuntivo(uuid) TO service_role;
