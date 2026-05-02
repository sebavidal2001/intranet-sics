-- ============================================================
-- Migration 021: Schema Preventivatore — RAG + Anagrafiche
-- ============================================================

-- Assicura che pgvector sia abilitato (già presente nel progetto valutazione)
CREATE EXTENSION IF NOT EXISTS vector;

-- Schema dedicato al preventivatore
CREATE SCHEMA IF NOT EXISTS preventivatore;

-- ─── ANAGRAFICHE ──────────────────────────────────────────────────────────────

-- Clienti
CREATE TABLE IF NOT EXISTS preventivatore.clienti (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ragione_sociale TEXT NOT NULL,
  piva            TEXT,
  codice_fiscale  TEXT,
  sede            TEXT,
  citta           TEXT,
  provincia       TEXT,
  cap             TEXT,
  telefono        TEXT,
  email           TEXT,
  referente       TEXT,
  note            TEXT,
  is_attivo       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prodotti semplici
CREATE TABLE IF NOT EXISTS preventivatore.prodotti (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice          TEXT UNIQUE NOT NULL,
  descrizione     TEXT NOT NULL,
  categoria       TEXT,
  unita_misura    TEXT NOT NULL DEFAULT 'pz',
  prezzo_listino  NUMERIC(12,2),
  fornitore       TEXT,
  lead_time_gg    INT,
  giacenza        NUMERIC(10,2),
  note            TEXT,
  is_attivo       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Semilavorati (prodotti composti, BOM 1 livello)
CREATE TABLE IF NOT EXISTS preventivatore.semilavorati (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice      TEXT UNIQUE NOT NULL,
  descrizione TEXT NOT NULL,
  categoria   TEXT,
  note        TEXT,
  is_attivo   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Componenti di un semilavorato
CREATE TABLE IF NOT EXISTS preventivatore.semilavorato_componenti (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semilavorato_id   UUID NOT NULL REFERENCES preventivatore.semilavorati(id) ON DELETE CASCADE,
  prodotto_id       UUID REFERENCES preventivatore.prodotti(id),
  tipo              TEXT NOT NULL CHECK (tipo IN ('prodotto', 'manodopera')),
  descrizione_voce  TEXT,
  quantita          NUMERIC(10,3) NOT NULL,
  unita_misura      TEXT NOT NULL DEFAULT 'pz',
  ordinamento       INT NOT NULL DEFAULT 0
);

-- Servizi manodopera (tariffario ore)
CREATE TABLE IF NOT EXISTS preventivatore.servizi_manodopera (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  categoria   TEXT,
  tariffa_ora NUMERIC(10,2),
  unita       TEXT NOT NULL DEFAULT 'h',
  ordine      INT NOT NULL DEFAULT 0,
  is_attivo   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── RAG — DOCUMENTI E CHUNKS ─────────────────────────────────────────────────

-- Motivi di rifiuto (configurabili da superadmin)
CREATE TABLE IF NOT EXISTS preventivatore.motivi_rifiuto (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label     TEXT NOT NULL,
  ordine    INT NOT NULL DEFAULT 0,
  is_attivo BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO preventivatore.motivi_rifiuto (label, ordine) VALUES
  ('Prezzo non competitivo',                  1),
  ('Tempi di consegna',                       2),
  ('Specifiche tecniche non adeguate',        3),
  ('Cliente ha scelto altro fornitore',       4),
  ('Progetto annullato dal cliente',          5),
  ('Budget non approvato',                    6),
  ('Altro',                                  99)
ON CONFLICT DO NOTHING;

-- Preventivi master (uno per cartella/progetto)
CREATE TABLE IF NOT EXISTS preventivatore.documenti (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codice               TEXT UNIQUE,
  tipo                 TEXT NOT NULL CHECK (tipo IN ('storico', 'generato')),
  cliente              TEXT,
  numero_offerta       TEXT,
  data_offerta         TEXT,
  categoria            TEXT,
  tags                 TEXT[],
  note                 TEXT,
  -- Importi
  importo_preventivo   NUMERIC(12,2),
  importo_ordinato     NUMERIC(12,2),
  -- Stato commerciale
  stato                TEXT NOT NULL CHECK (stato IN ('pending', 'ordinato', 'rifiutato')) DEFAULT 'pending',
  motivo_rifiuto_id    UUID REFERENCES preventivatore.motivi_rifiuto(id),
  codici_articolo      TEXT[],
  stato_note           TEXT,
  stato_aggiornato_da  UUID REFERENCES auth.users(id),
  stato_aggiornato_il  TIMESTAMPTZ,
  -- Audit
  creato_da            UUID REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Chunks vettorizzati (gemini-embedding-2 = 3072 dim)
CREATE TABLE IF NOT EXISTS preventivatore.chunks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id  UUID NOT NULL REFERENCES preventivatore.documenti(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  contenuto     TEXT NOT NULL,
  embedding     VECTOR(3072),
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indice HNSW per similarity search (cosine)
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON preventivatore.chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Configurazione AI (system prompt, soglie, modello)
CREATE TABLE IF NOT EXISTS preventivatore.ai_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chiave        TEXT UNIQUE NOT NULL,
  valore        TEXT NOT NULL,
  aggiornato_da UUID REFERENCES auth.users(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO preventivatore.ai_config (chiave, valore) VALUES
  ('system_prompt_preciso',
   'Sei un ingegnere tecnico pre-sales SICS. Rispondi SOLO con dati presenti nei documenti storici. Cita sempre cliente, codice offerta e specifiche tecniche esatte. Se non trovi corrispondenza, dillo esplicitamente.'),
  ('system_prompt_creativo',
   'Sei un ingegnere commerciale senior SICS. Usa i preventivi storici come base di conoscenza per proporre configurazioni nuove, stimare range di costo e suggerire componenti. Specifica quando stai stimando vs. citando dati certi.'),
  ('soglia_similarity',        '0.4'),
  ('max_chunks_per_query',     '3'),
  ('temperatura_precisa',      '0.3'),
  ('temperatura_creativa',     '0.7'),
  ('modello_generazione',      'gemini-2.5-flash')
ON CONFLICT (chiave) DO NOTHING;

-- Log query AI (audit e analytics)
CREATE TABLE IF NOT EXISTS preventivatore.query_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  utente_id   UUID REFERENCES auth.users(id),
  query_testo TEXT,
  modalita    TEXT CHECK (modalita IN ('preciso', 'creativo')),
  chunk_ids   UUID[],
  risposta    TEXT,
  latenza_ms  INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── RPC: SIMILARITY SEARCH ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION preventivatore.match_chunks(
  query_embedding  VECTOR(3072),
  match_threshold  FLOAT   DEFAULT 0.4,
  match_count      INT     DEFAULT 8,
  filter_cliente   TEXT    DEFAULT NULL,
  filter_categoria TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id            UUID,
  documento_id  UUID,
  contenuto     TEXT,
  metadata      JSONB,
  similarity    FLOAT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    c.id,
    c.documento_id,
    c.contenuto,
    c.metadata,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM preventivatore.chunks c
  JOIN preventivatore.documenti d ON c.documento_id = d.id
  WHERE 1 - (c.embedding <=> query_embedding) > match_threshold
    AND (filter_cliente   IS NULL OR d.cliente   ILIKE '%' || filter_cliente || '%')
    AND (filter_categoria IS NULL OR d.categoria = filter_categoria)
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE preventivatore.clienti              ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.prodotti             ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.semilavorati         ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.semilavorato_componenti ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.servizi_manodopera   ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.motivi_rifiuto       ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.documenti            ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.chunks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.ai_config            ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.query_log            ENABLE ROW LEVEL SECURITY;

-- Utenti autenticati possono leggere tutto
CREATE POLICY "auth_read" ON preventivatore.clienti
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "auth_read" ON preventivatore.prodotti
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "auth_read" ON preventivatore.semilavorati
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "auth_read" ON preventivatore.semilavorato_componenti
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "auth_read" ON preventivatore.servizi_manodopera
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "auth_read" ON preventivatore.motivi_rifiuto
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "auth_read" ON preventivatore.documenti
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "auth_read" ON preventivatore.chunks
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "auth_read" ON preventivatore.ai_config
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "auth_read" ON preventivatore.query_log
  FOR SELECT USING (auth.role() = 'authenticated');
