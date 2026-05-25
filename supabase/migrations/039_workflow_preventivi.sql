-- Migration 039: workflow preventivi
-- (tipo_cartella, tipo_riga, stati workflow, validazioni, tempi consegna, ruoli funzionali)

-- ── A. Famiglia cartella (S, C, G generato in piattaforma) ─────────────────
ALTER TABLE preventivatore.documenti
  ADD COLUMN IF NOT EXISTS tipo_cartella TEXT;

UPDATE preventivatore.documenti
SET tipo_cartella = CASE
  WHEN codice LIKE 'C\_%' ESCAPE '\' THEN 'C'
  WHEN codice LIKE 'G\_%' ESCAPE '\' THEN 'G'
  ELSE 'S'
END
WHERE tipo_cartella IS NULL;

ALTER TABLE preventivatore.documenti
  ALTER COLUMN tipo_cartella SET NOT NULL,
  ALTER COLUMN tipo_cartella SET DEFAULT 'S',
  ADD CONSTRAINT documenti_tipo_cartella_check CHECK (tipo_cartella IN ('S','C','G'));

CREATE INDEX IF NOT EXISTS documenti_tipo_cartella ON preventivatore.documenti(tipo_cartella);

-- ── B. Stati workflow esteso ────────────────────────────────────────────────
ALTER TABLE preventivatore.documenti DROP CONSTRAINT IF EXISTS documenti_stato_check;

ALTER TABLE preventivatore.documenti
  ADD CONSTRAINT documenti_stato_check
  CHECK (stato IN (
    -- storici importati (compat con vecchi import)
    'pending', 'ordinato', 'rifiutato',
    -- workflow nuovo (preventivi generati in piattaforma)
    'storico',          -- archivio importato (alias di 'pending' per nuovi import)
    'aperta',           -- cartella creata, builder vuoto
    'presa_in_carico',  -- preventivatore sta inserendo
    'completato',       -- preventivatore ha confermato definitivo
    'inviata',          -- back office: numero offerta + importo confermato + inviato cliente (= PIC nel registro)
    'ordinata',         -- cliente ha ordinato (= POR-ORDINATO)
    'fallita'           -- cliente ha rifiutato (motivo in motivo_rifiuto_id)
  ));

-- ── C. tipo_riga su righe_distinta (materiale vs manodopera) ────────────────
ALTER TABLE preventivatore.righe_distinta
  ADD COLUMN IF NOT EXISTS tipo_riga TEXT;

UPDATE preventivatore.righe_distinta SET tipo_riga = 'materiale' WHERE tipo_riga IS NULL;

ALTER TABLE preventivatore.righe_distinta
  ALTER COLUMN tipo_riga SET NOT NULL,
  ALTER COLUMN tipo_riga SET DEFAULT 'materiale',
  ADD CONSTRAINT righe_distinta_tipo_riga_check CHECK (tipo_riga IN ('materiale','manodopera'));

CREATE INDEX IF NOT EXISTS righe_distinta_tipo_riga ON preventivatore.righe_distinta(tipo_riga);

-- ── D. blocchi.incluso_offerta (back office sceglie i blocchi nell'offerta) ─
ALTER TABLE preventivatore.blocchi
  ADD COLUMN IF NOT EXISTS incluso_offerta BOOLEAN NOT NULL DEFAULT true;

-- ── E. Numero offerta + importo offerta + validazioni tecnica/economica ────
ALTER TABLE preventivatore.documenti
  ADD COLUMN IF NOT EXISTS numero_preventivo TEXT,
  ADD COLUMN IF NOT EXISTS importo_offerta NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS note_offerta TEXT,
  ADD COLUMN IF NOT EXISTS validazione_tecnica_il TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validazione_tecnica_da UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS validazione_economica_il TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validazione_economica_da UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS documenti_numero_preventivo ON preventivatore.documenti(numero_preventivo);

-- ── F. Tempi di consegna (4 colonne, sorgente: registro D.82-8 + builder) ──
ALTER TABLE preventivatore.documenti
  ADD COLUMN IF NOT EXISTS data_consegna_richiesta DATE,
  ADD COLUMN IF NOT EXISTS data_consegna_confermata DATE,
  ADD COLUMN IF NOT EXISTS data_consegna_effettiva DATE,
  ADD COLUMN IF NOT EXISTS giorni_consegna_offerti INT;

-- ── G. Ruoli funzionali per-portale (data-driven, niente hardcoded globali) ─
CREATE TABLE IF NOT EXISTS preventivatore.ruoli_funzionali (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL,
  nome        TEXT NOT NULL,
  descrizione TEXT,
  colore      TEXT,
  ordine      INT NOT NULL DEFAULT 0,
  is_attivo   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO preventivatore.ruoli_funzionali (slug, nome, descrizione, colore, ordine) VALUES
  ('commerciale',    'Commerciale',
   'Apre richieste, vede i propri clienti (+AIRFLUID), flagga validazione economica', '#3b82f6', 10),
  ('preventivatore', 'Preventivatore',
   'Apre cartella, usa il builder, marca preventivo completato', '#10b981', 20),
  ('back_office',    'Back Office',
   'Inserisce numero offerta, importo finale, sceglie blocchi inclusi, marca inviata/ordinata/fallita', '#f59e0b', 30)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS preventivatore.utente_ruoli_funzionali (
  utente_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ruolo_id     UUID NOT NULL REFERENCES preventivatore.ruoli_funzionali(id) ON DELETE CASCADE,
  assegnato_da UUID REFERENCES auth.users(id),
  assegnato_il TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (utente_id, ruolo_id)
);

ALTER TABLE preventivatore.ruoli_funzionali ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.utente_ruoli_funzionali ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON preventivatore.ruoli_funzionali
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "service_role_write" ON preventivatore.ruoli_funzionali
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "auth_read" ON preventivatore.utente_ruoli_funzionali
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "service_role_write" ON preventivatore.utente_ruoli_funzionali
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
