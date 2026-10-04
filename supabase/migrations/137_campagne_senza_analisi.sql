-- 137 — Portale Campagne: via l'Analisi e gli articoli promossi.
--
-- L'Analisi confrontava il fatturato prima e dopo l'invio, ma non era
-- attendibile: la campagna non e' legata a un prodotto riconoscibile nei codici
-- articolo. Si toglie tutto (pagina, funzioni, colonne). Al posto degli
-- «articoli promossi» scelti da un albero, la campagna ha un testo libero
-- `riferimento` («a cosa si riferisce») che scrive l'admin.
--
-- Da applicare con `psql -1`. Irreversibile: le colonne eliminate contengono
-- gli articoli promossi eventualmente compilati.

BEGIN;

ALTER TABLE campagne.campagne ADD COLUMN IF NOT EXISTS riferimento text;
COMMENT ON COLUMN campagne.campagne.riferimento IS
  'A cosa si riferisce la campagna: testo libero scritto a mano dall''admin. Informativo, non guida nessun calcolo.';

-- Funzioni dell'Analisi (134, 136).
DROP FUNCTION IF EXISTS campagne.analisi_clienti(uuid, integer);
DROP FUNCTION IF EXISTS campagne.fatturato_estremi();

-- Funzioni dell'albero degli articoli (136).
DROP FUNCTION IF EXISTS campagne.promossi_conteggio(jsonb);
DROP FUNCTION IF EXISTS campagne.cerca_articoli(text, integer);
DROP FUNCTION IF EXISTS campagne.albero_articoli(text, text, text, text, integer, integer);
DROP FUNCTION IF EXISTS campagne.articoli_da_selettori(jsonb);
DROP FUNCTION IF EXISTS campagne.attr_articolo(text);

-- Colonne che servivano solo all'Analisi.
ALTER TABLE campagne.campagne
  DROP COLUMN IF EXISTS marchio,
  DROP COLUMN IF EXISTS articoli_promossi,
  DROP COLUMN IF EXISTS promossi_albero;

COMMIT;
