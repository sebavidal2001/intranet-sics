-- 070_cruscotto_colonne_complete.sql
--
-- Import cruscotto "completo": aggiunge TUTTE le colonne del file Cruscotto articoli
-- che finora venivano scartate, così da avere in DB tutte le info senza rielaborare
-- il file. Tutte le colonne sono NULLABLE e additive → nessun impatto su FK, viste
-- (v_prodotti_completo), RPC (search_prodotti) o relazioni esistenti.
--
-- File sorgente: 40 colonne. Mappatura → 5 nuove su `prodotti` (anagrafica per codice)
-- + 20 nuove su `prodotti_giacenze` (movimenti per magazzino).

-- ── prodotti: codici/descrizioni categoria mancanti ───────────────────────────
ALTER TABLE preventivatore.prodotti
  ADD COLUMN IF NOT EXISTS cat_merc_codice        text,  -- "Cat Merceologica Codice"
  ADD COLUMN IF NOT EXISTS gruppo_codice          text,  -- "Gruppo Articoli Codice"
  ADD COLUMN IF NOT EXISTS cat_fiscale_codice     text,  -- "Cat Fiscale Codice"
  ADD COLUMN IF NOT EXISTS cat_fiscale_desc       text,  -- "Cat Fiscale Descrizione"
  ADD COLUMN IF NOT EXISTS cat_esposizione_codice text;  -- "Cat Esposizione Codice"

-- ── prodotti_giacenze: tutte le quantità di movimento per magazzino ───────────
ALTER TABLE preventivatore.prodotti_giacenze
  ADD COLUMN IF NOT EXISTS qta_rim_iniziale    numeric(18,3),  -- "Qta Rim Iniziale"
  ADD COLUMN IF NOT EXISTS qta_caricata        numeric(18,3),  -- "Qta Caricata"
  ADD COLUMN IF NOT EXISTS qta_scaricata       numeric(18,3),  -- "Qta Scaricata"
  ADD COLUMN IF NOT EXISTS qta_altri_carichi   numeric(18,3),  -- "Qta Altri Carichi"
  ADD COLUMN IF NOT EXISTS qta_altri_scarichi  numeric(18,3),  -- "Qta Altri Scarichi"
  ADD COLUMN IF NOT EXISTS qta_imp_produzione  numeric(18,3),  -- "Qta Imp Produzione"
  ADD COLUMN IF NOT EXISTS qta_ord_clienti     numeric(18,3),  -- "Qta Ord Clienti"
  ADD COLUMN IF NOT EXISTS qta_ord_fornitori   numeric(18,3),  -- "Qta Ord Fornitori"
  ADD COLUMN IF NOT EXISTS qta_vis_clienti     numeric(18,3),  -- "Qta Vis Clienti"
  ADD COLUMN IF NOT EXISTS qta_vis_fornitori   numeric(18,3),  -- "Qta Vis Fornitori"
  ADD COLUMN IF NOT EXISTS qta_reso_clienti    numeric(18,3),  -- "Qta Reso Clienti"
  ADD COLUMN IF NOT EXISTS qta_reso_fornitori  numeric(18,3),  -- "Qta Reso Fornitori"
  ADD COLUMN IF NOT EXISTS qta_ord_produzione  numeric(18,3),  -- "Qta Ord Produzione"
  ADD COLUMN IF NOT EXISTS qta_cl_clienti      numeric(18,3),  -- "Qta Cl Clienti"
  ADD COLUMN IF NOT EXISTS qta_cl_fornitori    numeric(18,3),  -- "Qta Cl Fornitori"
  ADD COLUMN IF NOT EXISTS qta_cl_terzi        numeric(18,3),  -- "Qta Cl Terzi"
  ADD COLUMN IF NOT EXISTS qta_gruppo_lib_1    numeric(18,3),  -- "Qta Gruppo Lib 1"
  ADD COLUMN IF NOT EXISTS qta_gruppo_lib_2    numeric(18,3),  -- "Qta Gruppo Lib 2"
  ADD COLUMN IF NOT EXISTS qta_gruppo_lib_3    numeric(18,3),  -- "Qta Gruppo Lib 3"
  ADD COLUMN IF NOT EXISTS qta_gruppo_lib_4    numeric(18,3);  -- "Qta Gruppo Lib 4"

NOTIFY pgrst, 'reload schema';
