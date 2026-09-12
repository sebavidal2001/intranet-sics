-- 085_listini_validazione.sql
--
-- Traccia del controllo fatto al caricamento di un listino fornitore.
--
-- Perché: il formato di ogni fornitore è fissato nel codice (vedi
-- `src/lib/portali/preventivatore/listini.ts`) e il file viene rifiutato se non
-- corrisponde. Quando però un listino è già in vigore e i costi non tornano,
-- serve poter rispondere a "cosa aveva letto quel giorno?" senza il file
-- originale: qui restano il foglio letto, i passi della validazione e gli avvisi
-- accettati da chi ha caricato.
--
-- Struttura del jsonb:
--   { "nomeFoglio": "...", "log": ["..."], "problemi": [ {gravita, codice, messaggio, azione} ],
--     "righe_lette": 2104, "righe_scartate": 268, "codici_in_conflitto": ["..."] }

ALTER TABLE preventivatore.listini_fornitore
  ADD COLUMN IF NOT EXISTS validazione jsonb;

COMMENT ON COLUMN preventivatore.listini_fornitore.validazione IS
  'Rapporto del controllo eseguito al caricamento: foglio letto, passi della validazione, avvisi accettati. Serve a ricostruire cosa era stato importato senza avere più il file.';

NOTIFY pgrst, 'reload schema';
