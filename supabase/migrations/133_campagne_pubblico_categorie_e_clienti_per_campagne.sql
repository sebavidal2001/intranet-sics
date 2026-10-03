-- 133_campagne_pubblico_categorie_e_clienti_per_campagne.sql
--
-- PORTALE CAMPAGNE MARKETING — due correzioni dopo la prima prova in produzione.
--
-- 1) IL PUBBLICO STANDARD SI CONFIGURA ANCHE PER CATEGORIA DI ATTIVITA'.
--    La regola salvata era "agente + categoria commerciale (Attivo/Potenziale)":
--    non permetteva di dire "solo costruttori e impiantisti". Si aggiunge
--    `categorie_attivita` (le Cat Attivita' di Impresa: `COSTR. macch.automatiche`,
--    `UT.FIN. tornerie/off.mecc.`, `IMP. impiantisti`...). VUOTO = tutte le categorie:
--    una regola gia' salvata continua a valere esattamente come prima.
--    Il filtro vale per i clienti presi "per agente"; i clienti scelti a mano
--    (`clienti_extra`) restano dentro comunque: chi li ha scelti sapeva cosa faceva.
--
-- 2) CLIENTI PER CAMPAGNE RICEVUTE (`clienti_per_campagne`), per la pagina Invii:
--    "chi ha ricevuto almeno N di queste campagne, e quali", "chi le ha ricevute
--    tutte", "chi non ne ha ricevuta nessuna". Ricevuta = consegnata o consegnata al
--    banco; le buste ancora in lavorazione si mostrano ma non contano.
--
-- Additiva: una colonna con default e due funzioni. Rollback:
--   ALTER TABLE campagne.pubblico_standard DROP COLUMN categorie_attivita;
--   DROP FUNCTION campagne.clienti_per_campagne(uuid[], text, integer, text, integer, integer);
-- (e ripristinare `pubblico_standard_codici` dalla 131).

DO $$
BEGIN
  IF to_regclass('campagne.pubblico_standard') IS NULL THEN
    RAISE EXCEPTION 'Manca campagne.pubblico_standard: applicare prima la migration 131.';
  END IF;
END $$;

ALTER TABLE campagne.pubblico_standard
  ADD COLUMN IF NOT EXISTS categorie_attivita text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN campagne.pubblico_standard.categorie_attivita IS
  'Cat Attivita'' dei clienti presi per agente. Vuoto = tutte. Non limita i clienti_extra.';

-- Stessa funzione della 131 (stessa firma) con il filtro in piu'.
CREATE OR REPLACE FUNCTION campagne.pubblico_standard_codici()
RETURNS SETOF text
LANGUAGE sql
STABLE
AS $$
  SELECT c.codice_cliente
    FROM campagne.v_clienti c
    CROSS JOIN campagne.pubblico_standard p
   WHERE NOT c.rivenditore
     AND (
       c.codice_cliente = ANY (p.clienti_extra)
       OR (
         EXISTS (SELECT 1 FROM unnest(p.agenti) a
                  WHERE upper(btrim(a)) = upper(btrim(c.agente_nome)))
         AND EXISTS (SELECT 1 FROM unnest(p.categorie_commerciali) k
                      WHERE upper(btrim(k)) = upper(btrim(c.cat_commerciale)))
         AND (
           cardinality(p.categorie_attivita) = 0
           OR EXISTS (SELECT 1 FROM unnest(p.categorie_attivita) t
                       WHERE upper(btrim(t)) = upper(btrim(c.cat_attivita)))
         )
       )
     );
$$;

-- ============================================================
-- CLIENTI PER CAMPAGNE RICEVUTE
-- ============================================================
-- p_campagne : le campagne su cui filtrare (vuoto o NULL = tutte).
-- p_modo     : 'almeno_una'  ha ricevuto almeno p_min delle campagne indicate
--              'tutte'       le ha ricevute tutte
--              'nessuna'     non ne ha ricevuta nessuna (fra i destinatari di quelle campagne)
-- Per ogni cliente restituisce TUTTE le sue campagne (non solo quelle filtrate),
-- ordinate per precedenza, con stato e data: serve a rispondere a "quali".
-- Gli invii annullati non esistono per questa funzione.
CREATE OR REPLACE FUNCTION campagne.clienti_per_campagne(
  p_campagne uuid[] DEFAULT NULL,
  p_modo     text    DEFAULT 'almeno_una',
  p_min      integer DEFAULT 1,
  p_q        text    DEFAULT NULL,
  p_limit    integer DEFAULT 50,
  p_offset   integer DEFAULT 0
)
RETURNS TABLE (
  codice_cliente  text,
  ragione_sociale text,
  agente_nome     text,
  cat_attivita    text,
  n_ricevute      integer,
  campagne        jsonb,
  totale          bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH sel AS (
    SELECT c.id
      FROM campagne.campagne c
     WHERE p_campagne IS NULL OR cardinality(p_campagne) = 0 OR c.id = ANY (p_campagne)
  ),
  per_cliente AS (
    SELECT i.codice_cliente,
           max(i.ragione_sociale) AS nome_invio,
           count(*) FILTER (WHERE i.stato IN ('consegnata', 'consegnata_banco')
                              AND i.campagna_id IN (SELECT id FROM sel))::integer AS n_sel_ricevute,
           jsonb_agg(
             jsonb_build_object(
               'codice', c.codice, 'nome', c.nome, 'stato', i.stato,
               'data', i.data_consegna, 'selezionata', i.campagna_id IN (SELECT id FROM sel)
             ) ORDER BY c.ordine
           ) AS campagne,
           count(*) FILTER (WHERE i.stato IN ('consegnata', 'consegnata_banco'))::integer AS n_ricevute
      FROM campagne.invii i
      JOIN campagne.campagne c ON c.id = i.campagna_id
     WHERE i.stato <> 'annullata'
     GROUP BY i.codice_cliente
  ),
  popolazione AS (
    -- 'nessuna' parte dai destinatari delle campagne scelte: chi non e' un
    -- destinatario non "dovrebbe" averla ricevuta.
    SELECT DISTINCT d.codice_cliente FROM campagne.destinatari d WHERE d.campagna_id IN (SELECT id FROM sel)
    UNION
    SELECT pc.codice_cliente FROM per_cliente pc
  ),
  base AS (
    SELECT p.codice_cliente,
           coalesce(v.ragione_sociale, pc.nome_invio, p.codice_cliente) AS ragione_sociale,
           v.agente_nome,
           v.cat_attivita,
           coalesce(pc.n_ricevute, 0) AS n_ricevute,
           coalesce(pc.n_sel_ricevute, 0) AS n_sel_ricevute,
           coalesce(pc.campagne, '[]'::jsonb) AS campagne
      FROM popolazione p
      LEFT JOIN per_cliente pc ON pc.codice_cliente = p.codice_cliente
      LEFT JOIN campagne.v_clienti v ON v.codice_cliente = p.codice_cliente
  ),
  filtrata AS (
    SELECT b.*
      FROM base b
     WHERE (p_q IS NULL OR btrim(p_q) = ''
            OR b.ragione_sociale ILIKE '%' || btrim(p_q) || '%'
            OR b.codice_cliente  ILIKE '%' || btrim(p_q) || '%')
       AND CASE p_modo
             WHEN 'tutte'   THEN b.n_sel_ricevute = (SELECT count(*) FROM sel) AND (SELECT count(*) FROM sel) > 0
             -- 'nessuna' guarda solo i DESTINATARI delle campagne scelte: chi non lo e' non
             -- "dovrebbe" averle ricevute, e mostrarlo sarebbe rumore.
             WHEN 'nessuna' THEN b.n_sel_ricevute = 0
                             AND b.codice_cliente IN (SELECT d.codice_cliente FROM campagne.destinatari d
                                                       WHERE d.campagna_id IN (SELECT id FROM sel))
             ELSE                b.n_sel_ricevute >= greatest(coalesce(p_min, 1), 1)
           END
  )
  SELECT f.codice_cliente, f.ragione_sociale, f.agente_nome, f.cat_attivita,
         f.n_ricevute, f.campagne, count(*) OVER () AS totale
    FROM filtrata f
   ORDER BY f.n_sel_ricevute DESC, f.ragione_sociale
   LIMIT greatest(coalesce(p_limit, 50), 1) OFFSET greatest(coalesce(p_offset, 0), 0);
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA campagne TO service_role;
NOTIFY pgrst, 'reload schema';
