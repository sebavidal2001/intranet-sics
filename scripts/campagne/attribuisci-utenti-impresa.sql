-- Attribuisce agli invii «chi ha inserito la riga in Impresa» (migration 138).
--
-- Prerequisito: /tmp/camp_utenti.csv, prodotto da utenti-impresa.dbisql.sql
-- (colonne: profilo;numero;anno;cliente;utente;creata_il;descrizione, senza intestazione).
--   sudo -u postgres psql -d intranet -v ON_ERROR_STOP=1 -1 -f attribuisci-utenti-impresa.sql
--
-- Un invio e' identificato da (cliente, anno, numero d'ordine). Se l'ordine ha piu' righe
-- DOCUMENTAZIONE di utenti diversi, vince quella la cui descrizione nomina la campagna
-- dell'invio (parole di `testo_riconoscimento`, ignorando i caratteri non stampabili).
-- Riempie `utente_impresa` e, se l'invio non ha gia' un utente intranet, `assegnata_da`.
-- Idempotente: salta gli invii che hanno gia' `utente_impresa`.

CREATE TEMP TABLE tmp_righe (profilo text, numero text, anno int, cliente text, utente text, creata_il text, descrizione text);
\copy tmp_righe FROM '/tmp/camp_utenti.csv' WITH (FORMAT csv, DELIMITER ';', QUOTE '"')

WITH cand AS (
  SELECT i.id AS invio_id, lower(btrim(t.utente)) AS utente,
         CASE WHEN EXISTS (
                SELECT 1 FROM unnest(c.testo_riconoscimento) k
                 WHERE regexp_replace(t.descrizione, '[^[:print:]]', '', 'g') ILIKE '%' || k || '%'
              ) THEN 0 ELSE 1 END AS prio
    FROM campagne.invii i
    JOIN campagne.campagne c ON c.id = i.campagna_id
    JOIN tmp_righe t ON t.cliente = i.codice_cliente
                    AND t.anno = i.ordine_anno
                    AND campagne.norm_numero(t.numero) = campagne.norm_numero(i.ordine_numero)
   WHERE i.ordine_numero IS NOT NULL
     AND i.utente_impresa IS NULL
     AND btrim(t.utente) <> ''
),
uno AS (
  SELECT DISTINCT ON (invio_id) invio_id, utente FROM cand ORDER BY invio_id, prio, utente
)
UPDATE campagne.invii i
   SET utente_impresa = u.utente,
       assegnata_da   = COALESCE(i.assegnata_da, m.utente_id)
  FROM uno u
  LEFT JOIN campagne.utenti_impresa m ON m.login = u.utente
 WHERE i.id = u.invio_id;
