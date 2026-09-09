CREATE TABLE IF NOT EXISTS vettori.bozze_outlook (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  bozza jsonb NOT NULL,
  utente_id uuid REFERENCES public.utenti(id) ON DELETE CASCADE,
  scade_il timestamptz NOT NULL DEFAULT now() + interval '5 minutes'
);
ALTER TABLE vettori.bozze_outlook ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vettori.bozze_outlook FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION vettori.prepara_bozza_outlook(p_hash text, p_bozza jsonb, p_utente uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, vettori AS $$
BEGIN
  DELETE FROM vettori.bozze_outlook WHERE scade_il < now();
  INSERT INTO vettori.bozze_outlook(token_hash, bozza, utente_id) VALUES (p_hash, p_bozza, p_utente);
END $$;
CREATE OR REPLACE FUNCTION vettori.ritira_bozza_outlook(p_hash text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, vettori AS $$
  DELETE FROM vettori.bozze_outlook WHERE token_hash = p_hash AND scade_il > now() RETURNING bozza;
$$;
REVOKE ALL ON FUNCTION vettori.prepara_bozza_outlook(text,jsonb,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION vettori.ritira_bozza_outlook(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.prepara_bozza_outlook(text,jsonb,uuid), vettori.ritira_bozza_outlook(text) TO service_role;
NOTIFY pgrst, 'reload schema';
