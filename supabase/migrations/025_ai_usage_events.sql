-- Track exact OpenRouter costs for the preventivatore AI chat.
CREATE TABLE IF NOT EXISTS preventivatore.ai_usage_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sessione_id       uuid REFERENCES preventivatore.chat_sessioni(id) ON DELETE SET NULL,
  provider          text NOT NULL CHECK (provider IN ('openrouter')),
  model             text NOT NULL,
  modalita          text NOT NULL CHECK (modalita IN ('preciso', 'creativo')),
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  cost_amount       numeric(12, 6) NOT NULL DEFAULT 0,
  currency          text NOT NULL DEFAULT 'usd',
  cost_source       text NOT NULL DEFAULT 'exact' CHECK (cost_source IN ('exact', 'estimated', 'reconciled')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_user_created
  ON preventivatore.ai_usage_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_events_session
  ON preventivatore.ai_usage_events(sessione_id, created_at DESC);

ALTER TABLE preventivatore.ai_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_ai_usage_events" ON preventivatore.ai_usage_events
  FOR SELECT USING (user_id = auth.uid());

INSERT INTO preventivatore.ai_config (chiave, valore) VALUES
  ('ai_cost_counter_enabled', 'true')
ON CONFLICT (chiave) DO NOTHING;

