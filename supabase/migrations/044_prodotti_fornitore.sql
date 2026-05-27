-- Migration 044: aggiunge colonne fornitore a preventivatore.prodotti
-- Sorgente: file Cruscotto articoli SICS — colonne D/E:
--   D = Cat Com Articolo Codice       → fornitore_codice (es. AZPN/001, WURT/001, AF/AFD)
--   E = Cat Com Articolo Descrizione  → fornitore (es. 'WURTH netto', 'AZ PNEUM. (PLURI) acq. 35%')
--
-- Lo script scripts/import-cruscotto.mjs è stato aggiornato per leggere le 2
-- colonne e popolare le rispettive colonne in `preventivatore.prodotti` ad
-- ogni import. Reimport eseguito con --force il 2026-05-26: 19959/19959
-- prodotti popolati (100%), 471 fornitori distinti.

ALTER TABLE preventivatore.prodotti
  ADD COLUMN IF NOT EXISTS fornitore_codice TEXT,
  ADD COLUMN IF NOT EXISTS fornitore        TEXT;

CREATE INDEX IF NOT EXISTS prodotti_fornitore_codice
  ON preventivatore.prodotti (fornitore_codice)
  WHERE fornitore_codice IS NOT NULL;

CREATE INDEX IF NOT EXISTS prodotti_fornitore_lower
  ON preventivatore.prodotti (LOWER(fornitore))
  WHERE fornitore IS NOT NULL;

NOTIFY pgrst, 'reload schema';
