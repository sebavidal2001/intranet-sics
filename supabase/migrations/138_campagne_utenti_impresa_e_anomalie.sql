-- 138 — Portale Campagne: chi ha inserito la riga in Impresa, e le buste in anomalia.
--
-- 1) «Seguita da» dello storico: l'utente di Impresa che ha inserito la riga
--    DOCUMENTAZIONE (riga_documento.id_utente_crea) e la persona che e' (intranet).
--    `campagne.utenti_impresa` e' la mappa login Impresa -> utente intranet;
--    `invii.utente_impresa` tiene il login (provenienza). L'attribuzione dei
--    singoli invii e' un'operazione sui dati (script a parte), non di schema.
-- 2) Le buste con un'anomalia aperta (errore) non contano fra «preparate» e
--    «da spedire»: la vista di riepilogo delle campagne le esclude, come le
--    tessere della home.
--
-- Da applicare con `psql -1`. Additiva.

CREATE TABLE IF NOT EXISTS campagne.utenti_impresa (
  login      text PRIMARY KEY CHECK (login = lower(btrim(login)) AND login <> ''),
  persona    text NOT NULL CHECK (btrim(persona) <> ''),
  utente_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE campagne.utenti_impresa ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON campagne.utenti_impresa TO service_role;

COMMENT ON TABLE campagne.utenti_impresa IS
  'Login di Impresa (riga_documento.id_utente_crea -> utenti.ut_utente) -> persona e utente intranet.';

-- Utenti intranet per username, cosi' la migration vale su ogni database.
INSERT INTO campagne.utenti_impresa (login, persona, utente_id)
SELECT m.login, m.persona, (SELECT u.id FROM public.utenti u WHERE u.username = m.username)
  FROM (VALUES
    ('erikalivreri',   'Erika Livreri',   'e.livreri'),
    ('jessicagordini', 'Jessica Gordini', 'j.gordini'),
    ('assistente',     'Silvia Varas',    's.varas'),
    ('vendite',        'Lucia Roda',      'l.roda'),
    ('acquisti',       'Barbara Giorio',  'b.giorio')
  ) AS m(login, persona, username)
ON CONFLICT (login) DO UPDATE SET persona = EXCLUDED.persona, utente_id = EXCLUDED.utente_id;

ALTER TABLE campagne.invii ADD COLUMN IF NOT EXISTS utente_impresa text;
COMMENT ON COLUMN campagne.invii.utente_impresa IS
  'Login Impresa di chi ha inserito la riga DOCUMENTAZIONE dell''ordine (provenienza di assegnata_da per lo storico).';

-- Riepilogo per campagna: le buste con anomalia aperta non sono preparate ne' da spedire.
CREATE OR REPLACE VIEW campagne.v_campagne_riepilogo AS
SELECT c.id,
       (SELECT count(*) FROM campagne.destinatari d WHERE d.campagna_id = c.id)::int AS destinatari,
       count(i.id) FILTER (WHERE i.stato = 'preparata' AND NOT a.in_anomalia)::int        AS preparate,
       count(i.id) FILTER (WHERE i.stato = 'da_spedire' AND NOT a.in_anomalia)::int       AS da_spedire,
       count(i.id) FILTER (WHERE i.stato = 'consegnata')::int       AS consegnate,
       count(i.id) FILTER (WHERE i.stato = 'consegnata_banco')::int AS consegnate_banco
  FROM campagne.campagne c
  LEFT JOIN campagne.invii i ON i.campagna_id = c.id
  LEFT JOIN LATERAL (
        SELECT EXISTS (
                 SELECT 1 FROM campagne.anomalie x
                  WHERE x.invio_id = i.id AND x.stato = 'aperta' AND x.gravita = 'errore'
               ) AS in_anomalia
       ) a ON true
 GROUP BY c.id;
GRANT SELECT ON campagne.v_campagne_riepilogo TO service_role;
