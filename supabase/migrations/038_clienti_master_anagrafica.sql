-- Migration 038: anagrafica clienti master (Cruscotto Dinamico)
--
-- Tabella popolata dall'import periodico del file "Cruscotto Dinamico.xlsx"
-- (gestionale). Granularità a 2 livelli (codice_cliente + id_destinazione)
-- per gestire le divisioni: es. IMA spa + IMA spa-div.SAFE,
-- WALVOIL spa + WALVOIL spa-stab.Bibbiano.
--
-- Schedulazione import via cron sulla VM (vedi scripts/import-clienti-cruscotto.cjs).
-- Mapping retroattivo dei 122 clienti storici applicato a parte (vedi sotto).

CREATE TABLE IF NOT EXISTS preventivatore.clienti_master (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice_cliente   TEXT NOT NULL,
  ragione_sociale  TEXT NOT NULL,
  destinazione     TEXT,
  id_destinazione  TEXT,
  cap              TEXT,
  localita         TEXT,
  cat_commerciale  TEXT,    -- 'Attivo' | 'Potenziale' | ...
  cat_zona         TEXT,
  cat_attivita     TEXT,
  agente_nome      TEXT,    -- es. 'VALERIA BATTELANI', 'AIRFLUID' (= casa SICS, visibile a tutti)
  agente_codice    TEXT,    -- es. 'AG009999'
  visite_n_meno_1  INT,
  visite_n         INT,
  -- audit
  ultimo_import_il TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  hash_riga        TEXT,    -- detection cambi su re-import
  attivo           BOOLEAN NOT NULL DEFAULT true,
  da_validare      BOOLEAN NOT NULL DEFAULT false, -- true per record manuali provvisori
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT clienti_master_codice_dest_unique UNIQUE (codice_cliente, id_destinazione)
);

CREATE INDEX IF NOT EXISTS clienti_master_ragione_lower
  ON preventivatore.clienti_master (LOWER(ragione_sociale));
CREATE INDEX IF NOT EXISTS clienti_master_dest_lower
  ON preventivatore.clienti_master (LOWER(destinazione))
  WHERE destinazione IS NOT NULL;
CREATE INDEX IF NOT EXISTS clienti_master_agente_codice
  ON preventivatore.clienti_master (agente_codice);
CREATE INDEX IF NOT EXISTS clienti_master_attivo
  ON preventivatore.clienti_master (attivo)
  WHERE attivo;

ALTER TABLE preventivatore.clienti_master ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON preventivatore.clienti_master
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "service_role_write" ON preventivatore.clienti_master
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Log dell'import periodico (audit cron VM)
CREATE TABLE IF NOT EXISTS preventivatore.clienti_master_import_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  iniziato_il    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  terminato_il   TIMESTAMPTZ,
  file_sorgente  TEXT,
  righe_totali   INT,
  inserite       INT DEFAULT 0,
  aggiornate     INT DEFAULT 0,
  invariate      INT DEFAULT 0,
  disattivate    INT DEFAULT 0,
  errori         INT DEFAULT 0,
  esito          TEXT,
  log_dettaglio  TEXT
);

ALTER TABLE preventivatore.clienti_master_import_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON preventivatore.clienti_master_import_log
  FOR SELECT USING (auth.role() = 'authenticated');

-- Link da documenti al cliente master (FK soft, NULL ammesso per backward-compat)
ALTER TABLE preventivatore.documenti
  ADD COLUMN IF NOT EXISTS cliente_master_id UUID
  REFERENCES preventivatore.clienti_master(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS documenti_cliente_master_id
  ON preventivatore.documenti (cliente_master_id);

-- Placeholder per i clienti storici NON_IN_ANAGRAFICA (provvisori, da_validare=true)
INSERT INTO preventivatore.clienti_master
  (codice_cliente, ragione_sociale, destinazione, id_destinazione, attivo, da_validare, note)
VALUES
  ('PROV-001', 'S.A.M.',        'S.A.M. (provvisorio)',        'PROV-1', false, true,
   'Cliente storico non trovato nel Cruscotto. Da validare manualmente.'),
  ('PROV-002', 'STUDIO ENTER',  'STUDIO ENTER (provvisorio)',  'PROV-2', false, true,
   'Cliente storico non trovato nel Cruscotto. Da validare manualmente.'),
  ('PROV-003', 'PROSGM',        'PROSGM (provvisorio)',        'PROV-3', false, true,
   'Cliente storico non trovato nel Cruscotto. Da validare manualmente.')
ON CONFLICT (codice_cliente, id_destinazione) DO NOTHING;

NOTIFY pgrst, 'reload schema';
