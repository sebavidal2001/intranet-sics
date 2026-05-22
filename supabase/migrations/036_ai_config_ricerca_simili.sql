-- ============================================================
-- Migration 036 — Parametri configurabili per la ricerca preventivi simili
-- ============================================================
-- Il tool chat `cerca_simili` usava soglia di similarità e numero di candidati
-- hard-coded. Questi parametri diventano configurabili da `ai_config`
-- (editabili da /preventivatore/impostazioni).
-- ============================================================

INSERT INTO preventivatore.ai_config (chiave, valore) VALUES
  ('soglia_similarity_simili', '0.50'),   -- soglia minima similarità (match_threshold)
  ('match_count_simili',       '40')      -- numero di chunk-blocco candidati recuperati
ON CONFLICT (chiave) DO NOTHING;
