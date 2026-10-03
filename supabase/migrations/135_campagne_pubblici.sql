-- 135_campagne_pubblici.sql
--
-- PORTALE CAMPAGNE MARKETING — piu' pubblici (target), uno per campagna.
--
-- PRIMA: un solo "pubblico standard" (riga unica `pubblico_standard`). Una campagna
-- con un target diverso si costruiva a mano, cliente per cliente, e crearne
-- un'altra con lo standard voleva dire ripartire dallo standard e ritoccarlo.
--
-- ORA: `campagne.pubblici` e' un elenco di pubblici con nome, ciascuno con la
-- stessa regola di prima (agenti, categorie commerciali, categorie di attivita',
-- clienti scelti a mano). Uno e' lo STANDARD (`standard = true`, uno solo): e' quello
-- che ogni campagna nuova riceve di default. Ogni campagna ha il suo `pubblico_id`;
-- campagne con pubblici diversi convivono, e cambiare lo standard non tocca le
-- campagne che usano un altro pubblico.
--
-- I DESTINATARI RESTANO UNA FOTOGRAFIA PER CAMPAGNA (`destinatari`): cambiare un
-- pubblico non toglie e non aggiunge nessuno da solo. `pubblico_mancanti` dice quanti
-- clienti rientrerebbero adesso e non sono ancora destinatari; `applica_pubblico` li
-- aggiunge (mai rimuove nessuno).
--
-- Compatibilita': le funzioni `pubblico_standard_*` e `applica_pubblico_standard`
-- restano, come scorciatoie sul pubblico standard, cosi' il codice gia' in servizio
-- continua a funzionare fra l'applicazione della migration e il deploy.
-- La tabella `pubblico_standard` viene SVUOTATA DI SIGNIFICATO e rimossa: la sua
-- unica riga e' copiata in `pubblici` come pubblico standard.
--
-- Rollback: non automatico (la tabella vecchia sparisce). Il contenuto e' in
-- `pubblici` (riga standard): basta ricreare `pubblico_standard` da li'.

DO $$
BEGIN
  IF to_regclass('campagne.pubblico_standard') IS NULL AND to_regclass('campagne.pubblici') IS NULL THEN
    RAISE EXCEPTION 'Manca campagne.pubblico_standard: applicare prima le migration 131 e 133.';
  END IF;
END $$;

-- ============================================================
-- 1) I PUBBLICI
-- ============================================================
CREATE TABLE IF NOT EXISTS campagne.pubblici (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                  text NOT NULL CHECK (nome = btrim(nome) AND nome <> ''),
  descrizione           text,
  -- Uno solo (indice unico parziale): il pubblico che ogni campagna nuova riceve.
  standard              boolean NOT NULL DEFAULT false,
  -- Stessa regola del pubblico standard di prima (migration 131/133).
  agenti                text[] NOT NULL DEFAULT '{}',
  categorie_commerciali text[] NOT NULL DEFAULT ARRAY['Attivo'],
  -- Vuoto = tutte le categorie di attivita'. Non limita i clienti_extra.
  categorie_attivita    text[] NOT NULL DEFAULT '{}',
  clienti_extra         text[] NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  aggiornato_il         timestamptz NOT NULL DEFAULT now(),
  aggiornato_da         uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS pubblici_standard_uq ON campagne.pubblici ((standard)) WHERE standard;
CREATE UNIQUE INDEX IF NOT EXISTS pubblici_nome_uq ON campagne.pubblici (lower(nome));

COMMENT ON TABLE campagne.pubblici IS
  'Pubblici (target) delle campagne. Uno e'' lo standard, il default di ogni campagna nuova. I rivenditori sono sempre esclusi.';

-- Copia della riga unica di prima, una volta sola.
DO $$
BEGIN
  IF to_regclass('campagne.pubblico_standard') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM campagne.pubblici WHERE standard) THEN
    INSERT INTO campagne.pubblici (nome, descrizione, standard, agenti, categorie_commerciali, categorie_attivita,
                                    clienti_extra, aggiornato_il, aggiornato_da)
    SELECT 'Standard', 'Il pubblico di partenza di ogni campagna', true, p.agenti, p.categorie_commerciali,
           p.categorie_attivita, p.clienti_extra, p.aggiornato_il, p.aggiornato_da
      FROM campagne.pubblico_standard p;
  END IF;
  -- Installazione pulita senza la tabella vecchia: uno standard vuoto di base.
  IF NOT EXISTS (SELECT 1 FROM campagne.pubblici WHERE standard) THEN
    INSERT INTO campagne.pubblici (nome, descrizione, standard, agenti)
    VALUES ('Standard', 'Il pubblico di partenza di ogni campagna', true, ARRAY['AIRFLUID']);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION campagne.pubblico_standard_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM campagne.pubblici WHERE standard;
$$;

-- ============================================================
-- 2) OGNI CAMPAGNA HA IL SUO PUBBLICO
-- ============================================================
ALTER TABLE campagne.campagne
  ADD COLUMN IF NOT EXISTS pubblico_id uuid REFERENCES campagne.pubblici(id) ON DELETE RESTRICT;

UPDATE campagne.campagne SET pubblico_id = campagne.pubblico_standard_id() WHERE pubblico_id IS NULL;

ALTER TABLE campagne.campagne
  ALTER COLUMN pubblico_id SET DEFAULT campagne.pubblico_standard_id(),
  ALTER COLUMN pubblico_id SET NOT NULL;

COMMENT ON COLUMN campagne.campagne.pubblico_id IS
  'Il pubblico della campagna. Di default lo standard. Cambiarlo non tocca i destinatari gia'' presenti.';

CREATE INDEX IF NOT EXISTS campagne_pubblico_idx ON campagne.campagne (pubblico_id);

-- ============================================================
-- 3) LA REGOLA, PER QUALSIASI PUBBLICO
-- ============================================================
-- Una sola definizione della regola, usata da anteprima, conteggio e applicazione.
-- Un cliente rientra se NON e' rivenditore e (e' fra i clienti scelti a mano, oppure
-- agente fra quelli «tutti», categoria commerciale scelta e — se se ne e' scelta
-- almeno una — categoria di attivita' scelta).
CREATE OR REPLACE FUNCTION campagne.pubblico_codici(p_pubblico uuid)
RETURNS SETOF text
LANGUAGE sql
STABLE
AS $$
  SELECT c.codice_cliente
    FROM campagne.v_clienti c
    JOIN campagne.pubblici p ON p.id = p_pubblico
   WHERE NOT c.rivenditore
     AND (
       c.codice_cliente = ANY (p.clienti_extra)
       OR (
         EXISTS (SELECT 1 FROM unnest(p.agenti) a
                  WHERE upper(btrim(a)) = upper(btrim(c.agente_nome)))
         AND EXISTS (SELECT 1 FROM unnest(p.categorie_commerciali) k
                      WHERE upper(btrim(k)) = upper(btrim(c.cat_commerciale)))
         AND (
           cardinality(p.categorie_attivita) = 0
           OR EXISTS (SELECT 1 FROM unnest(p.categorie_attivita) t
                       WHERE upper(btrim(t)) = upper(btrim(c.cat_attivita)))
         )
       )
     );
$$;

CREATE OR REPLACE FUNCTION campagne.pubblico_conteggio(p_pubblico uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::int FROM campagne.pubblico_codici(p_pubblico);
$$;

-- Quanti clienti rientrerebbero nel pubblico della campagna e non sono ancora suoi
-- destinatari: il numero dietro al bottone «aggiungi i clienti che rientrano».
CREATE OR REPLACE FUNCTION campagne.pubblico_mancanti(p_campagna uuid)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::int
    FROM campagne.campagne c
    CROSS JOIN LATERAL campagne.pubblico_codici(c.pubblico_id) AS cod
   WHERE c.id = p_campagna
     AND NOT EXISTS (SELECT 1 FROM campagne.destinatari d
                      WHERE d.campagna_id = c.id AND d.codice_cliente = cod);
$$;

-- Copia nei destinatari i clienti del pubblico. p_pubblico NULL = il pubblico della
-- campagna. Non rimuove nessuno e non tocca chi c'e' gia'. Restituisce quanti ne ha aggiunti.
CREATE OR REPLACE FUNCTION campagne.applica_pubblico(
  p_campagna uuid,
  p_pubblico uuid DEFAULT NULL,
  p_utente   uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_pubblico uuid;
  v_aggiunti integer;
BEGIN
  SELECT coalesce(p_pubblico, c.pubblico_id) INTO v_pubblico FROM campagne.campagne c WHERE c.id = p_campagna;
  IF v_pubblico IS NULL THEN
    RAISE EXCEPTION 'Campagna non trovata' USING ERRCODE = 'PT404';
  END IF;
  INSERT INTO campagne.destinatari (campagna_id, codice_cliente, aggiunto_da)
  SELECT p_campagna, cod, p_utente
    FROM campagne.pubblico_codici(v_pubblico) AS cod
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_aggiunti = ROW_COUNT;
  RETURN v_aggiunti;
END;
$$;

-- Scorciatoie sul pubblico standard (compatibilita' con il codice gia' in servizio).
CREATE OR REPLACE FUNCTION campagne.pubblico_standard_codici()
RETURNS SETOF text
LANGUAGE sql
STABLE
AS $$
  SELECT campagne.pubblico_codici(campagne.pubblico_standard_id());
$$;

CREATE OR REPLACE FUNCTION campagne.pubblico_standard_conteggio()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT campagne.pubblico_conteggio(campagne.pubblico_standard_id());
$$;

CREATE OR REPLACE FUNCTION campagne.applica_pubblico_standard(p_campagna_id uuid, p_utente_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
AS $$
  SELECT campagne.applica_pubblico(p_campagna_id, campagne.pubblico_standard_id(), p_utente_id);
$$;

-- Riepilogo per pubblico: quante campagne lo usano e a quanti clienti arriva oggi.
CREATE OR REPLACE FUNCTION campagne.pubblici_riepilogo()
RETURNS TABLE (id uuid, raggiunti integer, campagne integer)
LANGUAGE sql
STABLE
AS $$
  SELECT p.id,
         campagne.pubblico_conteggio(p.id),
         (SELECT count(*)::int FROM campagne.campagne c WHERE c.pubblico_id = p.id)
    FROM campagne.pubblici p;
$$;

-- Chi ha seguito degli invii (per il filtro «seguita da» della pagina Invii).
CREATE OR REPLACE FUNCTION campagne.utenti_invii()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT i.assegnata_da FROM campagne.invii i WHERE i.assegnata_da IS NOT NULL;
$$;

-- La tabella vecchia: la sua unica riga e' gia' in `pubblici`.
DROP TABLE IF EXISTS campagne.pubblico_standard;

-- RLS come le altre tabelle dello schema: nessun GRANT ad authenticated, solo service_role.
ALTER TABLE campagne.pubblici ENABLE ROW LEVEL SECURITY;
GRANT ALL ON campagne.pubblici TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA campagne TO service_role;
NOTIFY pgrst, 'reload schema';
