-- 100_vettori_bolle_manuali.sql
--
-- Bolle manuali, correzioni tracciate e congelamento alla fattura.
-- `bi.trasporti_documenti` resta la fonte gestionale grezza e di sola lettura:
-- tutte le modifiche operative vivono nello schema `vettori`.

-- ============================================================
-- 1) LE MISURE APPARTENGONO ALLA SPEDIZIONE
-- ============================================================
-- La colonna nuova viene prima popolata attraverso la tabella di legame. Se
-- anche una sola riga esistente non ha un legame univoco, la migration abortisce
-- prima del DROP: PostgreSQL annulla la transazione e non viene perso alcun dato.
ALTER TABLE vettori.bolla_misure
  ADD COLUMN IF NOT EXISTS spedizione_id uuid;

UPDATE vettori.bolla_misure bm
SET spedizione_id = collegamenti.spedizione_id
FROM (
  SELECT id_documento, min(spedizione_id::text)::uuid AS spedizione_id
  FROM vettori.spedizioni_documenti
  GROUP BY id_documento
  HAVING count(DISTINCT spedizione_id) = 1
) collegamenti
WHERE collegamenti.id_documento = bm.id_documento
  AND bm.spedizione_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM vettori.bolla_misure
    WHERE spedizione_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Migration 100 interrotta: esistono misure senza una spedizione univoca in vettori.spedizioni_documenti';
  END IF;
END;
$$;

ALTER TABLE vettori.bolla_misure
  DROP CONSTRAINT IF EXISTS bolla_misure_id_documento_fkey;
DROP INDEX IF EXISTS vettori.idx_bolla_misure_documento;

ALTER TABLE vettori.bolla_misure
  DROP COLUMN id_documento,
  ALTER COLUMN spedizione_id SET NOT NULL,
  ADD CONSTRAINT bolla_misure_spedizione_id_fkey
    FOREIGN KEY (spedizione_id)
    REFERENCES vettori.spedizioni(id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_bolla_misure_spedizione
  ON vettori.bolla_misure (spedizione_id, inserito_il);

COMMENT ON TABLE vettori.bolla_misure IS
  'Gruppi di colli omogenei misurati per una spedizione. Le dimensioni sopravvivono alla fusione con il gestionale e non vengono mai scritte in bi.trasporti_documenti.';
COMMENT ON COLUMN vettori.bolla_misure.spedizione_id IS
  'Spedizione proprietaria delle misure: vale anche per le bolle manuali prive di un documento gestionale.';

-- ============================================================
-- 2) CAMPI FORZATI
-- ============================================================
ALTER TABLE vettori.spedizioni
  ADD COLUMN IF NOT EXISTS campi_forzati jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION vettori.campi_forzati_validi(p_campi jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT jsonb_typeof(p_campi) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_each(p_campi) AS campo(nome, dettaglio)
      WHERE nome <> ALL (ARRAY[
              'direzione', 'numero_riferimento', 'data_documento',
              'controparte_nome', 'vettore_id', 'colli_bolla', 'peso_bolla'
            ])
         OR jsonb_typeof(dettaglio) <> 'object'
         -- Il valore puo' essere JSON null se anche il gestionale era vuoto,
         -- ma la chiave deve esserci: e' la prova di cosa diceva la fonte.
         OR NOT (dettaglio ? 'valore_precedente')
         OR coalesce(dettaglio->>'forzato_da', '') = ''
         OR coalesce(dettaglio->>'forzato_il', '') = ''
    );
$fn$;

ALTER TABLE vettori.spedizioni
  DROP CONSTRAINT IF EXISTS spedizioni_campi_forzati_validi;
ALTER TABLE vettori.spedizioni
  ADD CONSTRAINT spedizioni_campi_forzati_validi
  CHECK (vettori.campi_forzati_validi(campi_forzati));

COMMENT ON COLUMN vettori.spedizioni.campi_forzati IS
  'Per ogni campo corretto dopo il collegamento al gestionale conserva valore_precedente (anche null), forzato_da e forzato_il. La fusione non sovrascrive le chiavi presenti.';

-- ============================================================
-- 3) CONGELAMENTO MATERIALIZZATO E REGISTRO EVENTI
-- ============================================================
-- Lo stato corrente e' materializzato sulla spedizione, invece di essere
-- ricalcolato a ogni lettura. Un trigger sui controlli lo mantiene e consente
-- di bloccare le scritture nello stesso punto transazionale. Lo scongelamento
-- e' un override esplicito: non scollega la fattura, lascia un evento e un
-- nuovo controllo ricongela automaticamente la spedizione.
ALTER TABLE vettori.spedizioni
  ADD COLUMN IF NOT EXISTS congelata boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS congelata_il timestamptz,
  ADD COLUMN IF NOT EXISTS congelata_da_controllo_id uuid
    REFERENCES vettori.controlli(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS vettori.spedizioni_congelamenti (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spedizione_id  uuid NOT NULL REFERENCES vettori.spedizioni(id) ON DELETE RESTRICT,
  azione         text NOT NULL CHECK (azione IN ('congelamento', 'scongelamento')),
  controllo_id   uuid REFERENCES vettori.controlli(id) ON DELETE SET NULL,
  utente_id      uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  motivo         text NOT NULL CHECK (btrim(motivo) <> ''),
  avvenuto_il    timestamptz NOT NULL DEFAULT now(),
  CHECK (azione <> 'congelamento' OR controllo_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_spedizioni_congelamenti_spedizione
  ON vettori.spedizioni_congelamenti (spedizione_id, avvenuto_il DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_spedizioni_congelamento_controllo
  ON vettori.spedizioni_congelamenti (controllo_id, azione)
  WHERE controllo_id IS NOT NULL AND azione = 'congelamento';

COMMENT ON TABLE vettori.spedizioni_congelamenti IS
  'Registro append-only di congelamenti e scongelamenti. Il motivo e l autore restano consultabili anche se il controllo viene eliminato.';

CREATE OR REPLACE FUNCTION vettori.congela_spedizione_da_controllo()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW.spedizione_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE vettori.spedizioni
     SET congelata = true,
         congelata_il = coalesce(NEW.calcolato_il, now()),
         congelata_da_controllo_id = NEW.id
   WHERE id = NEW.spedizione_id;

  INSERT INTO vettori.spedizioni_congelamenti (
    spedizione_id, azione, controllo_id, utente_id, motivo, avvenuto_il
  ) VALUES (
    NEW.spedizione_id,
    'congelamento',
    NEW.id,
    NEW.abbinato_da,
    'Aggancio della spedizione a una riga di fattura',
    coalesce(NEW.calcolato_il, now())
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_controlli_congela_spedizione ON vettori.controlli;
CREATE TRIGGER trg_controlli_congela_spedizione
AFTER INSERT OR UPDATE OF spedizione_id ON vettori.controlli
FOR EACH ROW
WHEN (NEW.spedizione_id IS NOT NULL)
EXECUTE FUNCTION vettori.congela_spedizione_da_controllo();

-- Protezione DB, non solo UI: una richiesta concorrente o una route futura non
-- puo' cambiare i dati commerciali di una spedizione congelata.
CREATE OR REPLACE FUNCTION vettori.impedisci_modifica_spedizione_congelata()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.congelata THEN
    RAISE EXCEPTION 'La spedizione e congelata da una fattura e non puo essere eliminata'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.congelata AND (
       NEW.direzione IS DISTINCT FROM OLD.direzione
    OR NEW.vettore_id IS DISTINCT FROM OLD.vettore_id
    OR NEW.numero_riferimento IS DISTINCT FROM OLD.numero_riferimento
    OR NEW.numero_riferimento_norm IS DISTINCT FROM OLD.numero_riferimento_norm
    OR NEW.data_documento IS DISTINCT FROM OLD.data_documento
    OR NEW.controparte_codice IS DISTINCT FROM OLD.controparte_codice
    OR NEW.controparte_nome IS DISTINCT FROM OLD.controparte_nome
    OR NEW.zona_cap IS DISTINCT FROM OLD.zona_cap
    OR NEW.zona_provincia IS DISTINCT FROM OLD.zona_provincia
    OR NEW.fonte_zona IS DISTINCT FROM OLD.fonte_zona
    OR NEW.porto_codice IS DISTINCT FROM OLD.porto_codice
    OR NEW.porto_descrizione IS DISTINCT FROM OLD.porto_descrizione
    OR NEW.a_nostro_carico IS DISTINCT FROM OLD.a_nostro_carico
    OR NEW.colli_bolla IS DISTINCT FROM OLD.colli_bolla
    OR NEW.peso_bolla IS DISTINCT FROM OLD.peso_bolla
    OR NEW.origine IS DISTINCT FROM OLD.origine
    OR NEW.stato IS DISTINCT FROM OLD.stato
    OR NEW.note IS DISTINCT FROM OLD.note
    OR NEW.campi_forzati IS DISTINCT FROM OLD.campi_forzati
  ) THEN
    RAISE EXCEPTION 'La spedizione e congelata da una fattura e non puo essere modificata'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_spedizioni_blocca_congelate ON vettori.spedizioni;
CREATE TRIGGER trg_spedizioni_blocca_congelate
BEFORE UPDATE OR DELETE ON vettori.spedizioni
FOR EACH ROW
EXECUTE FUNCTION vettori.impedisci_modifica_spedizione_congelata();

CREATE OR REPLACE FUNCTION vettori.impedisci_misure_su_spedizione_congelata()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_spedizione_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.spedizione_id ELSE NEW.spedizione_id END;
BEGIN
  IF EXISTS (
    SELECT 1 FROM vettori.spedizioni
    WHERE id = v_spedizione_id AND congelata
  ) THEN
    RAISE EXCEPTION 'Le misure appartengono a una spedizione congelata e non possono essere modificate'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_bolla_misure_blocca_congelate ON vettori.bolla_misure;
CREATE TRIGGER trg_bolla_misure_blocca_congelate
BEFORE INSERT OR UPDATE OR DELETE ON vettori.bolla_misure
FOR EACH ROW
EXECUTE FUNCTION vettori.impedisci_misure_su_spedizione_congelata();

-- Congela anche le spedizioni gia' riferite al momento della migration.
WITH ultimo_controllo AS (
  SELECT DISTINCT ON (spedizione_id)
         id, spedizione_id, abbinato_da, calcolato_il
    FROM vettori.controlli
   WHERE spedizione_id IS NOT NULL
   ORDER BY spedizione_id, calcolato_il DESC, id DESC
)
UPDATE vettori.spedizioni s
   SET congelata = true,
       congelata_il = u.calcolato_il,
       congelata_da_controllo_id = u.id
  FROM ultimo_controllo u
 WHERE s.id = u.spedizione_id;

INSERT INTO vettori.spedizioni_congelamenti (
  spedizione_id, azione, controllo_id, utente_id, motivo, avvenuto_il
)
SELECT c.spedizione_id, 'congelamento', c.id, c.abbinato_da,
       'Controllo gia presente alla migration 100', c.calcolato_il
  FROM vettori.controlli c
 WHERE c.spedizione_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION vettori.scongela_spedizione(
  p_spedizione_id uuid,
  p_utente_id uuid,
  p_motivo text
)
RETURNS boolean
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Il motivo dello scongelamento e obbligatorio'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE vettori.spedizioni
     SET congelata = false,
         aggiornata_il = now()
   WHERE id = p_spedizione_id
     AND congelata;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO vettori.spedizioni_congelamenti (
    spedizione_id, azione, utente_id, motivo
  ) VALUES (
    p_spedizione_id, 'scongelamento', p_utente_id, btrim(p_motivo)
  );

  RETURN true;
END;
$fn$;

-- ============================================================
-- 4) SCOSTAMENTI DEL GESTIONALE SU SPEDIZIONI CONGELATE
-- ============================================================
CREATE TABLE IF NOT EXISTS vettori.spedizioni_scostamenti (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spedizione_id  uuid NOT NULL REFERENCES vettori.spedizioni(id) ON DELETE RESTRICT,
  id_documento   integer NOT NULL,
  tipo           text NOT NULL DEFAULT 'gestionale_su_congelata'
                   CHECK (tipo = 'gestionale_su_congelata'),
  differenze     jsonb NOT NULL CHECK (jsonb_typeof(differenze) = 'object'),
  rilevato_il    timestamptz NOT NULL DEFAULT now(),
  aggiornato_il  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (spedizione_id, id_documento, tipo)
);

CREATE INDEX IF NOT EXISTS idx_spedizioni_scostamenti_spedizione
  ON vettori.spedizioni_scostamenti (spedizione_id, rilevato_il DESC);

COMMENT ON TABLE vettori.spedizioni_scostamenti IS
  'Differenze fra una spedizione gia congelata dalla fattura e il documento gestionale arrivato dopo. Sono visibili e non modificano i valori congelati.';

-- ============================================================
-- 5) CREAZIONE ATOMICA DELLA BOLLA MANUALE E DELLE MISURE
-- ============================================================
CREATE OR REPLACE FUNCTION vettori.crea_bolla_manuale(p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_spedizione_id uuid;
  v_misura jsonb;
BEGIN
  INSERT INTO vettori.spedizioni (
    direzione, vettore_id, numero_riferimento, numero_riferimento_norm,
    data_documento, controparte_nome, colli_bolla, peso_bolla,
    origine, stato, aggiornata_il
  ) VALUES (
    p_payload->>'direzione',
    nullif(p_payload->>'vettore_id', '')::uuid,
    p_payload->>'numero_riferimento',
    p_payload->>'numero_riferimento_norm',
    (p_payload->>'data_documento')::date,
    p_payload->>'controparte_nome',
    (p_payload->>'colli_bolla')::int,
    (p_payload->>'peso_bolla')::numeric,
    'manuale', 'attesa', now()
  )
  RETURNING id INTO v_spedizione_id;

  FOR v_misura IN
    SELECT * FROM jsonb_array_elements(coalesce(p_payload->'misure', '[]'::jsonb))
  LOOP
    INSERT INTO vettori.bolla_misure (
      spedizione_id, quantita, lunghezza_cm, larghezza_cm, altezza_cm,
      peso_reale_kg, volume_m3, fonte, inserito_da, modificato_da
    ) VALUES (
      v_spedizione_id,
      (v_misura->>'quantita')::int,
      (v_misura->>'lunghezza_cm')::numeric,
      (v_misura->>'larghezza_cm')::numeric,
      (v_misura->>'altezza_cm')::numeric,
      (v_misura->>'peso_reale_kg')::numeric,
      (v_misura->>'volume_m3')::numeric,
      'manuale',
      nullif(p_payload->>'utente_id', '')::uuid,
      nullif(p_payload->>'utente_id', '')::uuid
    );
  END LOOP;

  RETURN v_spedizione_id;
END;
$fn$;

-- ============================================================
-- 6) SICUREZZA
-- ============================================================
ALTER TABLE vettori.bolla_misure ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.spedizioni_congelamenti ENABLE ROW LEVEL SECURITY;
ALTER TABLE vettori.spedizioni_scostamenti ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION vettori.campi_forzati_validi(jsonb) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION vettori.scongela_spedizione(uuid, uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION vettori.crea_bolla_manuale(jsonb) FROM public, anon, authenticated;

GRANT USAGE ON SCHEMA vettori TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA vettori TO service_role;
GRANT EXECUTE ON FUNCTION vettori.campi_forzati_validi(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION vettori.scongela_spedizione(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION vettori.crea_bolla_manuale(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
