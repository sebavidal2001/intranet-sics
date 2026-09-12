-- 096_vettori_bolla_misure.sql
--
-- Misure fisiche inserite sull'intranet per le bolle importate dal gestionale.
-- `bi.trasporti_documenti` resta grezzo e di sola lettura per l'applicazione:
-- una riga qui rappresenta un gruppo di colli con dimensioni omogenee.

CREATE TABLE IF NOT EXISTS vettori.bolla_misure (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_documento    integer NOT NULL
                    REFERENCES bi.trasporti_documenti(id_documento)
                    ON DELETE RESTRICT,
  quantita        integer NOT NULL CHECK (quantita BETWEEN 1 AND 999),
  lunghezza_cm    numeric(10,2) NOT NULL CHECK (lunghezza_cm > 0 AND lunghezza_cm <= 2000),
  larghezza_cm    numeric(10,2) NOT NULL CHECK (larghezza_cm > 0 AND larghezza_cm <= 2000),
  altezza_cm      numeric(10,2) NOT NULL CHECK (altezza_cm > 0 AND altezza_cm <= 2000),
  peso_reale_kg   numeric(14,3) CHECK (peso_reale_kg > 0 AND peso_reale_kg <= 100000),
  volume_m3       numeric(14,6) NOT NULL CHECK (volume_m3 > 0),
  fonte           text NOT NULL DEFAULT 'manuale'
                    CHECK (fonte IN ('manuale', 'magazzino', 'vettore')),
  inserito_da     uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  inserito_il     timestamptz NOT NULL DEFAULT now(),
  modificato_da   uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  modificato_il   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bolla_misure_documento
  ON vettori.bolla_misure (id_documento, inserito_il);

COMMENT ON TABLE vettori.bolla_misure IS
  'Gruppi di colli omogenei misurati per una bolla del gestionale. Le dimensioni non vengono mai scritte in bi.trasporti_documenti.';
COMMENT ON COLUMN vettori.bolla_misure.volume_m3 IS
  'Volume complessivo del gruppo: quantita x lunghezza_cm x larghezza_cm x altezza_cm / 1.000.000.';
COMMENT ON COLUMN vettori.bolla_misure.fonte IS
  'Origine della misura: manuale sull intranet, rilevazione di magazzino o dato dichiarato dal vettore.';

-- Stesso lockdown delle altre tabelle vettori.*: nessuna policy per anon o
-- authenticated. Le route server verificano i ruoli e usano service_role.
ALTER TABLE vettori.bolla_misure ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA vettori TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA vettori TO service_role;

NOTIFY pgrst, 'reload schema';
