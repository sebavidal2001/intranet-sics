-- Migration 045: builder preventivi — quantità pezzi, flag manodopera ×quantità,
-- imballaggio, spese generali, margine trattativa, range settimane consegna,
-- data ultimo costo per cella "gialla" (>9 mesi).
--
-- Modello di calcolo SICS (per blocco, con Q = quantita_pezzi):
--   * Materiali: scalano SEMPRE × Q (inseriti per 1 pezzo).
--   * Manodopera: scala × Q solo se la riga ha scala_con_quantita = true
--     (es. Montaggio); le voci "una tantum" (Progettazione, Collaudo…) restano ×1.
--   base_vendita_blocco  = Σ materiali_vendita×Q + Σ manodopera_vendita×(Q|1)
--   imballaggio          = base × imballaggio_pct/100      (default 1%)
--   spese_generali       = base × spese_generali_pct/100   (default 24.2%)
--   totale_con_spese     = base + imballaggio + spese_generali
--   prezzo_finale_blocco = totale_con_spese × (1 + margine_eff/100)
--     dove margine_eff = override blocco, altrimenti margine globale documento.
--   importo_preventivo   = Σ prezzo_finale_blocco.

-- ── 1) Colonne documenti: settimane consegna + margine globale ───────────────
ALTER TABLE preventivatore.documenti
  ADD COLUMN IF NOT EXISTS consegna_settimane_min smallint,
  ADD COLUMN IF NOT EXISTS consegna_settimane_max smallint,
  ADD COLUMN IF NOT EXISTS margine_trattativa_pct numeric(6,3) NOT NULL DEFAULT 0;

-- ── 2) Colonne blocchi: quantità + percentuali + costi calcolati ─────────────
ALTER TABLE preventivatore.blocchi
  ADD COLUMN IF NOT EXISTS quantita_pezzi integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS imballaggio_pct numeric(6,3) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS spese_generali_pct numeric(6,3) NOT NULL DEFAULT 24.2,
  ADD COLUMN IF NOT EXISTS margine_trattativa_pct numeric(6,3),   -- NULL = usa globale
  ADD COLUMN IF NOT EXISTS costo_complessivo numeric;             -- costo vergine × quantità

-- ── 3) Flag riga: scala con la quantità (materiali sempre true) ──────────────
ALTER TABLE preventivatore.righe_distinta
  ADD COLUMN IF NOT EXISTS scala_con_quantita boolean NOT NULL DEFAULT true;

-- ── 4) Flag catalogo lavorazioni + default sensati ──────────────────────────
ALTER TABLE preventivatore.servizi_manodopera
  ADD COLUMN IF NOT EXISTS scala_con_quantita boolean NOT NULL DEFAULT true;

-- Lavorazioni tipicamente "una tantum" (non scalano col numero di pezzi)
UPDATE preventivatore.servizi_manodopera
SET scala_con_quantita = false
WHERE nome ~* '(progett|disegn|programmaz|collaud|messa a punto|avviam|test|debug|set[ -]?up)';

-- ── 5) search_prodotti: aggiunge data_ult_costo per la cella gialla 9 mesi ───
DROP FUNCTION IF EXISTS preventivatore.search_prodotti(text, integer);

CREATE OR REPLACE FUNCTION preventivatore.search_prodotti(q text, limite integer DEFAULT 20)
 RETURNS TABLE(codice text, descrizione text, uc text, categoria text, ult_costo numeric,
               data_ult_costo date, esistenza_totale numeric, disponibilita_totale numeric,
               n_magazzini integer, prezzo_stale boolean, score real)
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
    (v.data_ult_costo IS NULL OR v.data_ult_costo < (current_date - interval '1 year'))::boolean AS prezzo_stale,
    GREATEST(similarity(v.codice, (SELECT raw FROM q_norm)),
             similarity(v.codice_norm, (SELECT norm FROM q_norm)),
             similarity(COALESCE(v.descrizione, ''), (SELECT raw FROM q_norm)) * 0.7)::real AS score
  FROM preventivatore.v_prodotti_completo v
  WHERE v.attivo
    AND (v.codice_norm LIKE (SELECT norm FROM q_norm) || '%'
         OR v.codice ILIKE '%' || (SELECT raw FROM q_norm) || '%'
         OR v.descrizione ILIKE '%' || (SELECT raw FROM q_norm) || '%')
  ORDER BY score DESC, v.codice
  LIMIT GREATEST(1, LEAST(limite, 100));
$function$;

NOTIFY pgrst, 'reload schema';
