-- Migration 015: Aggiungi data_assunzione a utenti + tabella certificato_config

-- Aggiungi data_assunzione alla tabella utenti
ALTER TABLE utenti ADD COLUMN IF NOT EXISTS data_assunzione date;

-- Tabella configurazione certificato PDF (riga globale unica, upsert via id fisso)
CREATE TABLE IF NOT EXISTS certificato_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Titoli varianti per ruolo
  titolo_personale text NOT NULL DEFAULT 'Scheda di valutazione della prestazione del Personale',
  titolo_coordinatori text NOT NULL DEFAULT 'Scheda di valutazione della prestazione dei Coordinatori',
  titolo_responsabili text NOT NULL DEFAULT 'Scheda di valutazione della prestazione dei Responsabili',
  -- Codice documento
  codice_documento text NOT NULL DEFAULT 'D.50-9 Rev 04',
  data_edizione text NOT NULL DEFAULT '',
  data_aggiornamento text NOT NULL DEFAULT '',
  -- Stile
  colore_primario text NOT NULL DEFAULT '#00A1BE',
  colore_testo text NOT NULL DEFAULT '#1a202c',
  font_corpo text NOT NULL DEFAULT 'Helvetica',
  -- Orientamento
  orientamento text NOT NULL DEFAULT 'portrait' CHECK (orientamento IN ('portrait', 'landscape')),
  -- Toggle sezioni
  mostra_radar boolean NOT NULL DEFAULT true,
  -- Etichette griglia info
  etichetta_area text NOT NULL DEFAULT 'Area',
  etichetta_responsabile text NOT NULL DEFAULT 'Responsabile',
  etichetta_valutatore text NOT NULL DEFAULT 'Valutatore',
  etichetta_data_assunzione text NOT NULL DEFAULT 'Data Assunzione',
  etichetta_data_valutazione text NOT NULL DEFAULT 'Data Valutazione',
  etichetta_anzianita text NOT NULL DEFAULT 'Anzianità',
  -- Logo personalizzato (URL pubblico o Supabase Storage, null = usa logo SICS default)
  logo_url text,
  -- Timestamp
  updated_at timestamptz DEFAULT now()
);

-- RLS: solo superadmin/admin possono leggere e modificare
ALTER TABLE certificato_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tutti possono leggere certificato_config"
  ON certificato_config FOR SELECT
  USING (true);

CREATE POLICY "Solo admin possono modificare certificato_config"
  ON certificato_config FOR ALL
  USING (is_valutazioni_admin(auth.uid()))
  WITH CHECK (is_valutazioni_admin(auth.uid()));

-- Inserisce riga di default (se non esiste)
INSERT INTO certificato_config (
  titolo_personale, titolo_coordinatori, titolo_responsabili,
  codice_documento, data_edizione, data_aggiornamento,
  colore_primario, colore_testo, font_corpo, orientamento
) SELECT
  'Scheda di valutazione della prestazione del Personale',
  'Scheda di valutazione della prestazione dei Coordinatori',
  'Scheda di valutazione della prestazione dei Responsabili',
  'D.50-9 Rev 04',
  to_char(now(), 'DD/MM/YYYY'),
  to_char(now(), 'DD/MM/YYYY'),
  '#00A1BE',
  '#1a202c',
  'Helvetica',
  'portrait'
WHERE NOT EXISTS (SELECT 1 FROM certificato_config);
