-- ─── Chat Sessioni & Messaggi ─────────────────────────────────────────────────
-- Salvataggio conversazioni AI del Preventivatore

CREATE TABLE preventivatore.chat_sessioni (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contesto   text NOT NULL DEFAULT 'archivio' CHECK (contesto IN ('archivio', 'nuovo')),
  titolo     text NOT NULL DEFAULT 'Nuova chat',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE preventivatore.chat_messaggi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sessione_id uuid NOT NULL REFERENCES preventivatore.chat_sessioni(id) ON DELETE CASCADE,
  ruolo       text NOT NULL CHECK (ruolo IN ('user', 'assistant')),
  contenuto   text NOT NULL,
  tool_usato  text,
  risultati   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Indici
CREATE INDEX idx_chat_sessioni_user_id ON preventivatore.chat_sessioni(user_id, updated_at DESC);
CREATE INDEX idx_chat_messaggi_sessione ON preventivatore.chat_messaggi(sessione_id, created_at ASC);

-- Trigger: aggiorna updated_at su chat_sessioni quando arriva un nuovo messaggio
CREATE OR REPLACE FUNCTION preventivatore.touch_sessione()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE preventivatore.chat_sessioni
  SET updated_at = now()
  WHERE id = NEW.sessione_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_sessione
  AFTER INSERT ON preventivatore.chat_messaggi
  FOR EACH ROW EXECUTE FUNCTION preventivatore.touch_sessione();

-- RLS
ALTER TABLE preventivatore.chat_sessioni ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.chat_messaggi ENABLE ROW LEVEL SECURITY;

-- Ogni utente vede solo le proprie sessioni
CREATE POLICY "own_sessions" ON preventivatore.chat_sessioni
  FOR ALL USING (user_id = auth.uid());

-- Ogni utente vede solo i messaggi delle proprie sessioni
CREATE POLICY "own_messages" ON preventivatore.chat_messaggi
  FOR ALL USING (
    sessione_id IN (
      SELECT id FROM preventivatore.chat_sessioni WHERE user_id = auth.uid()
    )
  );
