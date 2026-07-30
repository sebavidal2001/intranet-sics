-- 072_scheda_chat_revisione_e_apprendimento.sql
--
-- Chat di revisione della scheda tecnica + loop di apprendimento.
--
-- 1) `schede_generate`: storico della conversazione di revisione e marcatura di
--    approvazione (la scheda che l'utente scarica dopo averla rifinita).
-- 2) `schede_approvate`: le schede APPROVATE diventano esempi di riferimento per
--    le generazioni successive (RAG). Tabella dedicata e NON `chunks` perché
--    `chunks.documento_id` è NOT NULL con FK a `documenti`, mentre una scheda può
--    essere approvata prima che il preventivo venga salvato.
-- 3) RPC `match_schede_approvate`: ricerca semantica sugli esempi approvati.
-- 4) `ai_usage_events`: il CHECK su `modalita` ammetteva solo 'preciso'/'creativo';
--    esteso per tracciare anche i costi della scheda tecnica e delle revisioni,
--    così il contatore spesa AI include anche queste chiamate.

-- ── 1) Storico revisioni + approvazione ───────────────────────────────────────
ALTER TABLE preventivatore.schede_generate
  ADD COLUMN IF NOT EXISTS revisioni    jsonb,          -- [{ruolo, testo, at, costo}]
  ADD COLUMN IF NOT EXISTS approvata_il timestamptz;

COMMENT ON COLUMN preventivatore.schede_generate.revisioni IS
  'Conversazione di revisione: array di messaggi {ruolo: utente|ai, testo, at, costo}. NULL = nessuna revisione.';
COMMENT ON COLUMN preventivatore.schede_generate.approvata_il IS
  'Valorizzata quando l''utente approva/scarica la scheda: da lì nasce l''esempio in schede_approvate.';

-- ── 2) Esempi approvati (memoria di lungo periodo) ────────────────────────────
CREATE TABLE IF NOT EXISTS preventivatore.schede_approvate (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scheda_id      uuid REFERENCES preventivatore.schede_generate(id) ON DELETE SET NULL,
  documento_id   uuid REFERENCES preventivatore.documenti(id) ON DELETE SET NULL,
  titolo         text,
  cliente        text,
  tipo_prodotto  text,
  contenuto_md   text NOT NULL,
  embedding      vector(3072),
  n_revisioni    int NOT NULL DEFAULT 0,   -- quante correzioni sono servite (metrica qualità prompt)
  approvata_da   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_schede_approvate_created ON preventivatore.schede_approvate (created_at DESC);
-- HNSW non supporta oltre 2000 dimensioni su `vector`: si indicizza il cast a
-- `halfvec(3072)`, esattamente come `idx_chunks_embedding`.
CREATE INDEX IF NOT EXISTS idx_schede_approvate_embedding
  ON preventivatore.schede_approvate USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);

COMMENT ON TABLE preventivatore.schede_approvate IS
  'Schede tecniche approvate dall''utente: usate come esempi di stile nelle generazioni successive (hanno priorità sui Word storici).';

ALTER TABLE preventivatore.schede_approvate ENABLE ROW LEVEL SECURITY;
-- Coerente con il lockdown (migration 062): nessun GRANT ad authenticated,
-- l'accesso passa dalle route server con service_role.

-- ── 3) Ricerca semantica sugli esempi approvati ───────────────────────────────
CREATE OR REPLACE FUNCTION preventivatore.match_schede_approvate(
  query_embedding  vector(3072),
  match_threshold  float DEFAULT 0.35,
  match_count      int   DEFAULT 4
)
RETURNS TABLE (
  id            uuid,
  contenuto_md  text,
  titolo        text,
  cliente       text,
  n_revisioni   int,
  similarity    float
)
LANGUAGE sql STABLE
AS $$
  SELECT s.id, s.contenuto_md, s.titolo, s.cliente, s.n_revisioni,
         1 - (s.embedding <=> query_embedding) AS similarity
  FROM preventivatore.schede_approvate s
  WHERE s.embedding IS NOT NULL
    AND 1 - (s.embedding <=> query_embedding) > match_threshold
  ORDER BY s.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ── 4) Tracciamento costi anche per scheda tecnica e revisioni ────────────────
ALTER TABLE preventivatore.ai_usage_events DROP CONSTRAINT IF EXISTS ai_usage_events_modalita_check;
ALTER TABLE preventivatore.ai_usage_events ADD CONSTRAINT ai_usage_events_modalita_check
  CHECK (modalita = ANY (ARRAY['preciso', 'creativo', 'scheda_tecnica', 'scheda_domande', 'scheda_revisione']));

NOTIFY pgrst, 'reload schema';
