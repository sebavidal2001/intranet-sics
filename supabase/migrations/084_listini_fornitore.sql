-- 084_listini_fornitore.sql
--
-- LISTINI FORNITORE — costo di preventivazione alternativo all'ultimo costo (UC).
--
-- Problema:
--   Per alcuni marchi (Dorner, Alusic) l'UC del gestionale NON è il costo corretto
--   da usare in preventivazione: il costo giusto sta sul listino del fornitore, che
--   non entra nell'estrazione del Cruscotto. Inoltre il listino contiene MOLTI più
--   articoli della nostra anagrafica (Dorner 2026: 1.837 codici, ~3% presenti in
--   `prodotti`), quindi serve poterli anche cercare/inserire pur non essendo a DB.
--
-- Soluzione:
--   1) `listini_fornitore`      — un listino caricato (file Excel) per fornitore.
--   2) `listini_fornitore_voci` — le righe codice→costo estratte dal file.
--   3) `v_listino_voci_attive`  — le voci dei soli listini attivi, deduplicate.
--   4) `v_prodotti_costo`       — anagrafica con COSTO EFFETTIVO (listino se c'è,
--      altrimenti UC) + le voci di listino che non esistono in anagrafica, esposte
--      come articoli "virtuali" (giacenza 0) così il builder può cercarle.
--   5) `search_prodotti`        — ricalcolata su `v_prodotti_costo`, con due colonne
--      nuove: `fonte_costo` ('listino'|'anagrafica') e `fornitore_listino`.
--
-- Regola di prevalenza: se il codice è nel listino attivo, il suo costo VINCE
-- sempre sull'UC. Il costo è già normalizzato in fase di import (per Dorner:
-- colonna R / 2), qui non si applica nessuna trasformazione.
--
-- Impatto: nessuno sui documenti già salvati (il costo è congelato sulla riga al
-- momento dell'inserimento). L'override agisce su ricerca articoli, lookup costo,
-- "Aggiorna prezzi" e duplicazione preventivo.

-- ============================================================
-- 1) TABELLE
-- ============================================================
CREATE TABLE IF NOT EXISTS preventivatore.listini_fornitore (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fornitore      text NOT NULL,                       -- es. 'DORNER' (upper, senza spazi doppi)
  nome_file      text,
  colonne        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {codice:"B",descrizione:"C",prezzo:"R",divisore:2}
  righe_lette    int  NOT NULL DEFAULT 0,             -- righe del foglio esaminate
  righe_valide   int  NOT NULL DEFAULT 0,             -- voci effettivamente importate
  attivo         boolean NOT NULL DEFAULT true,
  note           text,
  caricato_da    uuid REFERENCES public.utenti(id) ON DELETE SET NULL,
  caricato_il    timestamptz NOT NULL DEFAULT now()
);

-- Un solo listino ATTIVO per fornitore: caricare un nuovo file sostituisce il vecchio.
CREATE UNIQUE INDEX IF NOT EXISTS uq_listini_fornitore_attivo
  ON preventivatore.listini_fornitore (upper(fornitore)) WHERE attivo;

COMMENT ON TABLE preventivatore.listini_fornitore IS
  'Listino prezzi di un fornitore caricato da Excel in Impostazioni. Il costo delle sue voci sostituisce l''UC del Cruscotto in preventivazione.';
COMMENT ON COLUMN preventivatore.listini_fornitore.colonne IS
  'Mappatura colonne del file: quale lettera contiene codice/descrizione/prezzo e per quanto dividere il prezzo (Dorner: R/2).';

CREATE TABLE IF NOT EXISTS preventivatore.listini_fornitore_voci (
  listino_id     uuid NOT NULL REFERENCES preventivatore.listini_fornitore(id) ON DELETE CASCADE,
  codice_norm    text NOT NULL,          -- UPPER(codice) senza spazi/punteggiatura (stessa norma di prodotti)
  codice         text NOT NULL,          -- codice come scritto sul listino
  descrizione    text,
  prezzo_origine numeric(14,4),          -- valore letto dalla colonna prezzo, prima del divisore
  costo          numeric(14,4) NOT NULL, -- costo finale da usare in preventivazione
  riga_file      int,                    -- numero di riga nel foglio (per diagnostica)
  PRIMARY KEY (listino_id, codice_norm)
);

CREATE INDEX IF NOT EXISTS idx_listini_voci_codice_norm
  ON preventivatore.listini_fornitore_voci (codice_norm);

COMMENT ON TABLE preventivatore.listini_fornitore_voci IS
  'Righe codice→costo di un listino fornitore. Il costo è già normalizzato all''import (nessun calcolo a runtime).';

-- RLS attiva: coerente con il lockdown di migration 062, l'accesso passa solo
-- dalle route server con service_role. Nessun GRANT ad authenticated/anon.
ALTER TABLE preventivatore.listini_fornitore      ENABLE ROW LEVEL SECURITY;
ALTER TABLE preventivatore.listini_fornitore_voci ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2) VISTA: voci dei listini attivi (deduplicate per codice)
-- ============================================================
-- Se lo stesso codice compare su più listini attivi (fornitori diversi), vince
-- quello caricato più di recente.
CREATE OR REPLACE VIEW preventivatore.v_listino_voci_attive AS
SELECT DISTINCT ON (v.codice_norm)
  v.codice_norm,
  v.codice,
  v.descrizione,
  v.costo,
  l.id          AS listino_id,
  l.fornitore,
  l.caricato_il
FROM preventivatore.listini_fornitore_voci v
JOIN preventivatore.listini_fornitore l ON l.id = v.listino_id
WHERE l.attivo
ORDER BY v.codice_norm, l.caricato_il DESC;

-- ============================================================
-- 3) VISTA: anagrafica con costo effettivo + voci solo-listino
-- ============================================================
CREATE OR REPLACE VIEW preventivatore.v_prodotti_costo AS
-- (a) articoli in anagrafica: costo listino se presente, altrimenti UC
SELECT
  p.codice,
  p.codice_norm,
  p.descrizione,
  p.uc,
  p.categoria,
  COALESCE(lv.costo, p.ult_costo)                                    AS ult_costo,
  CASE WHEN lv.costo IS NOT NULL
       THEN lv.caricato_il::date ELSE p.data_ult_costo END           AS data_ult_costo,
  p.ult_costo                                                        AS ult_costo_anagrafica,
  p.data_ult_costo                                                   AS data_ult_costo_anagrafica,
  CASE WHEN lv.costo IS NOT NULL THEN 'listino' ELSE 'anagrafica' END AS fonte_costo,
  lv.fornitore                                                       AS fornitore_listino,
  true                                                               AS in_anagrafica,
  p.attivo,
  COALESCE(g.esistenza_totale, 0)     AS esistenza_totale,
  COALESCE(g.disponibilita_totale, 0) AS disponibilita_totale,
  COALESCE(g.n_magazzini, 0)          AS n_magazzini
FROM preventivatore.prodotti p
LEFT JOIN preventivatore.v_listino_voci_attive lv ON lv.codice_norm = p.codice_norm
LEFT JOIN LATERAL (
  SELECT SUM(esistenza)::numeric(14,3)     AS esistenza_totale,
         SUM(disponibilita)::numeric(14,3) AS disponibilita_totale,
         COUNT(*)::int                     AS n_magazzini
  FROM preventivatore.prodotti_giacenze gg
  WHERE gg.codice = p.codice
) g ON true

UNION ALL

-- (b) voci di listino che NON esistono in anagrafica: articoli "virtuali",
--     ricercabili e inseribili in preventivo (descrizione presa dal listino).
SELECT
  lv.codice,
  lv.codice_norm,
  lv.descrizione,
  'PZ'::text        AS uc,
  NULL::text        AS categoria,
  lv.costo          AS ult_costo,
  lv.caricato_il::date AS data_ult_costo,
  NULL::numeric(14,4) AS ult_costo_anagrafica,
  NULL::date          AS data_ult_costo_anagrafica,
  'listino'::text   AS fonte_costo,
  lv.fornitore      AS fornitore_listino,
  false             AS in_anagrafica,
  true              AS attivo,
  0::numeric(14,3)  AS esistenza_totale,
  0::numeric(14,3)  AS disponibilita_totale,
  0                 AS n_magazzini
FROM preventivatore.v_listino_voci_attive lv
WHERE NOT EXISTS (
  SELECT 1 FROM preventivatore.prodotti p WHERE p.codice_norm = lv.codice_norm
);

COMMENT ON VIEW preventivatore.v_prodotti_costo IS
  'Anagrafica articoli con COSTO EFFETTIVO di preventivazione: listino fornitore se il codice c''è, altrimenti UC. Include le voci di listino non presenti in anagrafica (in_anagrafica=false, giacenza 0).';

-- ============================================================
-- 4) search_prodotti su v_prodotti_costo (+ fonte_costo, fornitore_listino)
-- ============================================================
DROP FUNCTION IF EXISTS preventivatore.search_prodotti(text, integer);

CREATE OR REPLACE FUNCTION preventivatore.search_prodotti(q text, limite integer DEFAULT 20)
 RETURNS TABLE(codice text, descrizione text, uc text, categoria text, ult_costo numeric,
               data_ult_costo date, esistenza_totale numeric, disponibilita_totale numeric,
               n_magazzini integer, prezzo_stale boolean, fonte_costo text,
               fornitore_listino text, in_anagrafica boolean, score real)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'preventivatore', 'public'
AS $function$
  WITH q_norm AS (
    SELECT btrim(q) AS raw,
           upper(regexp_replace(btrim(q), '[\s\.\-_/\\\*\?]+', '', 'g')) AS norm
  )
  SELECT v.codice, v.descrizione, v.uc, v.categoria, v.ult_costo, v.data_ult_costo,
    v.esistenza_totale, v.disponibilita_totale, v.n_magazzini,
    -- Un costo che arriva dal listino non è mai "vecchio": è il prezzo ufficiale.
    (v.fonte_costo <> 'listino'
     AND (v.data_ult_costo IS NULL
          OR v.data_ult_costo < (current_date - interval '1 year')))::boolean AS prezzo_stale,
    v.fonte_costo, v.fornitore_listino, v.in_anagrafica,
    GREATEST(similarity(v.codice, (SELECT raw FROM q_norm)),
             similarity(v.codice_norm, (SELECT norm FROM q_norm)),
             similarity(COALESCE(v.descrizione, ''), (SELECT raw FROM q_norm)) * 0.7)::real AS score
  FROM preventivatore.v_prodotti_costo v
  WHERE v.attivo
    AND (v.codice_norm LIKE (SELECT norm FROM q_norm) || '%'
         OR v.codice ILIKE '%' || (SELECT raw FROM q_norm) || '%'
         OR v.descrizione ILIKE '%' || (SELECT raw FROM q_norm) || '%')
  -- A parità di score gli articoli in anagrafica vengono prima di quelli solo-listino.
  ORDER BY score DESC, v.in_anagrafica DESC, v.codice
  LIMIT GREATEST(1, LEAST(limite, 100));
$function$;

COMMENT ON FUNCTION preventivatore.search_prodotti IS
  'Ricerca articoli per il builder su v_prodotti_costo: il costo restituito è già quello effettivo (listino fornitore o UC).';

-- ============================================================
-- 5) Grants: solo service_role (l''app accede lato server)
-- ============================================================
GRANT ALL PRIVILEGES ON preventivatore.listini_fornitore      TO service_role;
GRANT ALL PRIVILEGES ON preventivatore.listini_fornitore_voci TO service_role;
GRANT SELECT ON preventivatore.v_listino_voci_attive TO service_role;
GRANT SELECT ON preventivatore.v_prodotti_costo      TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- 6) Confronto listino ↔ anagrafica (pannello di controllo Impostazioni)
-- ============================================================
-- Serve a rispondere a colpo d'occhio: quante voci del file toccano articoli
-- che abbiamo, di quanto il listino si discosta dall'UC, e su quali codici.
CREATE OR REPLACE FUNCTION preventivatore.listino_confronto_anagrafica(
  p_listino_id uuid,
  p_campione   int DEFAULT 15
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'preventivatore', 'public'
AS $function$
  WITH v AS (
    SELECT lv.codice, lv.descrizione, lv.costo,
           p.codice AS codice_anagrafica, p.descrizione AS descrizione_anagrafica,
           p.ult_costo, p.data_ult_costo, p.fornitore
    FROM preventivatore.listini_fornitore_voci lv
    LEFT JOIN preventivatore.prodotti p ON p.codice_norm = lv.codice_norm
    WHERE lv.listino_id = p_listino_id
  )
  SELECT jsonb_build_object(
    'voci_totali',   (SELECT count(*) FROM v),
    'in_anagrafica', (SELECT count(*) FROM v WHERE codice_anagrafica IS NOT NULL),
    'solo_listino',  (SELECT count(*) FROM v WHERE codice_anagrafica IS NULL),
    'uc_mancante',   (SELECT count(*) FROM v WHERE codice_anagrafica IS NOT NULL AND ult_costo IS NULL),
    'delta_medio_pct', (
      SELECT round(avg((costo - ult_costo) / ult_costo * 100)::numeric, 1)
      FROM v WHERE ult_costo IS NOT NULL AND ult_costo > 0
    ),
    -- Quali fornitori del gestionale vengono toccati: serve a verificare che il
    -- listino stia sovrascrivendo il marchio giusto (Dorner = "COLUMBUS (FlexMove)").
    'fornitori_gestionale', COALESCE((
      SELECT jsonb_agg(f) FROM (
        SELECT fornitore, count(*) AS articoli
        FROM v WHERE codice_anagrafica IS NOT NULL AND fornitore IS NOT NULL
        GROUP BY fornitore ORDER BY count(*) DESC LIMIT 8
      ) f
    ), '[]'::jsonb),
    'campione', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT codice, COALESCE(descrizione_anagrafica, descrizione) AS descrizione,
               ult_costo, costo AS costo_listino, data_ult_costo, fornitore,
               CASE WHEN ult_costo IS NOT NULL AND ult_costo > 0
                    THEN round(((costo - ult_costo) / ult_costo * 100)::numeric, 1) END AS delta_pct
        FROM v
        WHERE codice_anagrafica IS NOT NULL AND ult_costo IS NOT NULL
        ORDER BY abs(costo - ult_costo) DESC
        LIMIT GREATEST(1, LEAST(p_campione, 100))
      ) x
    ), '[]'::jsonb)
  );
$function$;

COMMENT ON FUNCTION preventivatore.listino_confronto_anagrafica IS
  'Statistiche di confronto fra le voci di un listino e l''UC dell''anagrafica, per il pannello Impostazioni.';

GRANT EXECUTE ON FUNCTION preventivatore.listino_confronto_anagrafica(uuid, int) TO service_role;

NOTIFY pgrst, 'reload schema';
