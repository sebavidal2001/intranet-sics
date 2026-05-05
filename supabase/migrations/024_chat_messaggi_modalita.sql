-- Store the AI mode used to generate each assistant response.
ALTER TABLE preventivatore.chat_messaggi
  ADD COLUMN IF NOT EXISTS modalita text CHECK (modalita IN ('preciso', 'creativo'));

