-- Unisce le bolle create al banco (Simulazione o a mano) alla bolla arrivata
-- poi dal gestionale con lo stesso numero.
--
-- Il difetto: la bolla del banco porta il codice cliente scritto dall'operatore
-- («SIT»), quella di Impresa il codice vero («05000607»). La fusione le trattava
-- come bolle diverse e ne nasceva una seconda, senza le misure e il riaddebito
-- decisi al banco. Da ora la fusione adotta la bolla del banco (bolle.ts,
-- trovaBollaManualeAdottabile); questo script ripulisce quelle gia' duplicate.
--
-- Cosa fa, per ogni coppia: stesso verso, stesso numero normalizzato, stessa data,
-- bolla del banco senza documenti collegati, UNA sola bolla del gestionale con
-- nome compatibile (uno dei due e' il prefisso dell'altro, o somiglianza
-- pg_trgm >= 0.5):
--   1) le misure del banco passano alla bolla del gestionale (se non ne ha);
--   2) riaddebito previsto e vettore scelto al banco si conservano;
--   3) le simulazioni puntano alla bolla del gestionale;
--   4) la bolla del banco diventa `ignorata`, con una nota che dice dove e' finita.
-- Rieseguibile: non trova piu' coppie.
--
--   psql -d intranet --single-transaction -f scripts/vettori/unisci-bolle-banco.sql

CREATE TEMP TABLE coppie_banco ON COMMIT DROP AS
WITH norm AS (
  SELECT s.id, s.direzione, s.numero_riferimento_norm, s.data_documento, s.origine,
         s.controparte_nome,
         regexp_replace(lower(coalesce(s.controparte_nome, '')), '[^a-z0-9]', '', 'g') AS nome
    FROM vettori.spedizioni s
   WHERE s.stato <> 'ignorata'
),
candidate AS (
  SELECT m.id AS banco_id, g.id AS gestionale_id
    FROM norm m
    JOIN norm g
      ON g.direzione = m.direzione
     AND g.numero_riferimento_norm = m.numero_riferimento_norm
     AND g.data_documento = m.data_documento
     AND g.origine = 'gestionale'
   WHERE m.origine IN ('simulazione', 'manuale')
     AND m.nome <> '' AND g.nome <> ''
     AND NOT EXISTS (SELECT 1 FROM vettori.spedizioni_documenti d WHERE d.spedizione_id = m.id)
     AND (
       left(g.nome, length(m.nome)) = m.nome
       OR left(m.nome, length(g.nome)) = g.nome
       OR similarity(m.controparte_nome, g.controparte_nome) >= 0.5
     )
)
SELECT c.banco_id, c.gestionale_id
  FROM candidate c
 WHERE (SELECT count(*) FROM candidate x WHERE x.banco_id = c.banco_id) = 1
   AND (SELECT count(*) FROM candidate x WHERE x.gestionale_id = c.gestionale_id) = 1;

-- 1) le misure del banco, se la bolla del gestionale non ne ha
UPDATE vettori.bolla_misure b
   SET spedizione_id = c.gestionale_id
  FROM coppie_banco c
 WHERE b.spedizione_id = c.banco_id
   AND NOT EXISTS (SELECT 1 FROM vettori.bolla_misure x WHERE x.spedizione_id = c.gestionale_id);

-- 2) riaddebito e vettore scelti al banco
UPDATE vettori.spedizioni g
   SET riaddebito_previsto = coalesce(g.riaddebito_previsto, m.riaddebito_previsto),
       vettore_id          = coalesce(g.vettore_id, m.vettore_id),
       aggiornata_il       = now()
  FROM coppie_banco c
  JOIN vettori.spedizioni m ON m.id = c.banco_id
 WHERE g.id = c.gestionale_id
   AND (
     (g.riaddebito_previsto IS NULL AND m.riaddebito_previsto IS NOT NULL)
     OR (g.vettore_id IS NULL AND m.vettore_id IS NOT NULL)
   );

-- 3) le simulazioni seguono la bolla vera
UPDATE vettori.simulazioni si
   SET spedizione_id = c.gestionale_id
  FROM coppie_banco c
 WHERE si.spedizione_id = c.banco_id;

-- 4) la bolla del banco non conta piu'
UPDATE vettori.spedizioni m
   SET stato = 'ignorata',
       note = trim(both ' ' from coalesce(m.note, '') || ' Unita alla bolla del gestionale ' || c.gestionale_id::text || ' il ' || to_char(now(), 'YYYY-MM-DD') || '.'),
       aggiornata_il = now()
  FROM coppie_banco c
 WHERE m.id = c.banco_id;

SELECT count(*) AS bolle_unite FROM coppie_banco;
