-- 139 — Portale Campagne: i clienti nuovi entrano da soli nelle campagne «a pubblico».
--
-- PRIMA: i destinatari erano una fotografia. Un cliente acquisito dopo la partenza
-- della campagna non ci entrava mai, a meno che un admin premesse «Aggiungi i clienti
-- che rientrano». Per una campagna aperta tutto l'anno vuol dire avere solo i clienti
-- iniziali.
--
-- ORA: ogni campagna ha `destinatari_automatici` (nessun pulsante: lo decide il modo in
-- cui e' stata costruita, vedi sotto). Se e' vero, `sincronizza_pubblici()`
-- (lanciata dal controllo notturno, dopo il caricamento di Impresa, e a ogni modifica
-- di un pubblico) aggiunge fra i destinatari i clienti che rientrano nel pubblico e non
-- ci sono. Solo aggiunte: non toglie mai nessuno.
--
-- Una campagna mirata (poche decine di clienti scelti a mano) NON deve riempirsi con
-- tutto il suo pubblico, e un pubblico fatto di soli clienti scelti a mano non si
-- aggiorna mai: la sincronizzazione agisce solo se il pubblico ha degli agenti
-- (cioe' «tutti i clienti di quel commerciale»). Alla creazione l'interruttore e' acceso
-- se si parte da «aggiungi i clienti del pubblico»; per le esistenti vedi l'UPDATE sotto.
--
-- `destinatari_esclusi`: chi un admin toglie a mano da una campagna non viene
-- riaggiunto dalla sincronizzazione. Un'aggiunta manuale lo rimette in gioco.
--
-- Da applicare con `psql -1`. Additiva. Dopo, ricaricare lo schema di PostgREST
-- (`NOTIFY pgrst, 'reload schema'`).
-- Rollback: DROP FUNCTION campagne.sincronizza_pubblici(uuid); DROP TABLE campagne.destinatari_esclusi;
--           ALTER TABLE campagne.campagne DROP COLUMN destinatari_automatici;
--           ALTER TABLE campagne.destinatari DROP COLUMN automatico;
--           (poi ripristinare pubblico_mancanti e applica_pubblico dalla 135.)

ALTER TABLE campagne.campagne
  ADD COLUMN IF NOT EXISTS destinatari_automatici boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN campagne.campagne.destinatari_automatici IS
  'Se vero i clienti che rientrano nel pubblico entrano da soli fra i destinatari (sincronizza_pubblici). Solo aggiunte.';

ALTER TABLE campagne.destinatari
  ADD COLUMN IF NOT EXISTS automatico boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN campagne.destinatari.automatico IS
  'Aggiunto dalla sincronizzazione notturna del pubblico, non da una persona.';

CREATE TABLE IF NOT EXISTS campagne.destinatari_esclusi (
  campagna_id    uuid NOT NULL REFERENCES campagne.campagne(id) ON DELETE CASCADE,
  codice_cliente text NOT NULL CHECK (codice_cliente = btrim(codice_cliente) AND codice_cliente <> ''),
  escluso_il     timestamptz NOT NULL DEFAULT now(),
  escluso_da     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (campagna_id, codice_cliente)
);
ALTER TABLE campagne.destinatari_esclusi ENABLE ROW LEVEL SECURITY;
GRANT ALL ON campagne.destinatari_esclusi TO service_role;
COMMENT ON TABLE campagne.destinatari_esclusi IS
  'Clienti tolti a mano da una campagna: la sincronizzazione del pubblico non li riaggiunge.';

-- Campagne esistenti: si aggiornano da sole quelle costruite su un'intera fascia di
-- clienti (pubblico con agenti e almeno meta' del pubblico gia' destinataria). Le mirate
-- (poche decine di clienti sul pubblico standard) restano ferme.
UPDATE campagne.campagne c
   SET destinatari_automatici = true
  FROM campagne.pubblici p
 WHERE p.id = c.pubblico_id
   AND c.stato <> 'terminata'
   AND cardinality(p.agenti) > 0
   AND (SELECT count(*) FROM campagne.destinatari d WHERE d.campagna_id = c.id) * 2
       >= campagne.pubblico_conteggio(p.id);

-- Quanti clienti rientrerebbero nel pubblico e non sono destinatari ne' esclusi a mano.
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
                      WHERE d.campagna_id = c.id AND d.codice_cliente = cod)
     AND NOT EXISTS (SELECT 1 FROM campagne.destinatari_esclusi e
                      WHERE e.campagna_id = c.id AND e.codice_cliente = cod);
$$;

-- Applicazione esplicita (creazione campagna): come prima, ma rispetta le esclusioni.
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
   WHERE NOT EXISTS (SELECT 1 FROM campagne.destinatari_esclusi e
                      WHERE e.campagna_id = p_campagna AND e.codice_cliente = cod)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_aggiunti = ROW_COUNT;
  RETURN v_aggiunti;
END;
$$;

-- La sincronizzazione. p_campagna NULL = tutte le campagne non terminate con
-- l'interruttore acceso. Restituisce quanti destinatari ha aggiunto in tutto.
CREATE OR REPLACE FUNCTION campagne.sincronizza_pubblici(p_campagna uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_aggiunti integer;
BEGIN
  INSERT INTO campagne.destinatari (campagna_id, codice_cliente, aggiunto_da, automatico)
  SELECT c.id, cod, NULL, true
    FROM campagne.campagne c
    JOIN campagne.pubblici p ON p.id = c.pubblico_id
    CROSS JOIN LATERAL campagne.pubblico_codici(c.pubblico_id) AS cod
   WHERE c.destinatari_automatici
     AND cardinality(p.agenti) > 0   -- pubblico fatto di soli clienti scelti a mano: non si aggiorna
     AND c.stato <> 'terminata'
     AND (p_campagna IS NULL OR c.id = p_campagna)
     AND NOT EXISTS (SELECT 1 FROM campagne.destinatari_esclusi e
                      WHERE e.campagna_id = c.id AND e.codice_cliente = cod)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_aggiunti = ROW_COUNT;
  RETURN v_aggiunti;
END;
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA campagne TO service_role;
