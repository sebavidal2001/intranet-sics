-- 102_vettori_codici_gestionale.sql
--
-- Popola `vettori.codici_gestionale`, creata dalla 087 e rimasta vuota.
--
-- ============================================================================
-- COSA SI ROMPEVA
-- ============================================================================
-- Il gestionale identifica i vettori con codici tipo `VT000015`; la tabella
-- `vettori.vettori` usa slug (`gls`, `tnt`, `fedex`, `trading_post`). La
-- sincronizzazione delle bolle cercava `vt000015` fra gli slug e non lo trovava
-- mai: **734 spedizioni su 1.210 senza vettore**, e tutte le 165 create alla
-- prima apertura della pagina il 13 settembre.
--
-- Senza vettore non c'e' divisore volumetrico — 300 kg/mc per GLS e Trading
-- Post, 250 per TNT e FedEx — quindi la pagina Bolle mostrava «Coeff. assente»
-- e il magazzino poteva inserire le misure senza veder comparire alcun peso
-- volumetrico. Cioe' senza ottenere la cosa per cui quella pagina esiste.
--
-- ============================================================================
-- I DICIASSETTE CODICI, E PERCHE' NON SONO TUTTI VETTORI
-- ============================================================================
-- Guardando i codici veri emergono tre famiglie, e solo la prima e' fatta di
-- vettori nel senso in cui li intende il portale.
--
--   `vettore`     3 codici, 478 documenti. GLS, Trading Post, FedEx.
--
--   `regola`      5 codici, 120 documenti. NON sono vettori: sono criteri di
--                 scelta scritti a mano nel campo del vettore, del tipo «GLS
--                 fino a 30 Kg-FEDEX oltre». Il gestionale ci registra la
--                 politica di spedizione, non il trasportatore. Nessun calcolo
--                 puo' risolverli da solo: dipendono dal peso o dal tipo di
--                 collo, e la scelta la fa una persona.
--
--   `non_nostro`  9 codici, 166 documenti. Vettori veri, ma dei clienti o dei
--                 fornitori: non ci fatturano, non c'e' niente da controllare.
--
-- La classificazione dell'ultima famiglia non e' un'ipotesi, e' quello che
-- dicono i porti. Il porto si legge al contrario nei due versi — sulle uscite
-- paghiamo noi con franco (01) e franco addebito fattura (03), sugli arrivi con
-- porto assegnato (02) — e applicandolo ai 166 documenti risulta a nostro
-- carico **uno solo**. Vedi la nota su TRASCOOP piu' sotto.
--
-- TNT non compare mai come vettore diretto: esiste solo dentro le regole.

-- ============================================================
-- 1) TUTTO QUELLO CHE IL GESTIONALE HA USATO
-- ============================================================
-- Prima si prende dai dati, cosi' un codice comparso dopo non resta invisibile:
-- entra come `da_mappare` e la classificazione lo intercetta. In sviluppo, dove
-- `bi.trasporti_documenti` e' vuota, questo blocco non inserisce nulla e la
-- mappa arriva comunque completa dal blocco esplicito che segue.
INSERT INTO vettori.codici_gestionale (codice_gestionale, ragione_sociale, tipo)
SELECT d.vettore_codice, max(d.vettore), 'da_mappare'
  FROM bi.trasporti_documenti d
 WHERE coalesce(d.vettore_codice, '') <> ''
 GROUP BY d.vettore_codice
ON CONFLICT (codice_gestionale) DO NOTHING;

-- ============================================================
-- 2) LA CLASSIFICAZIONE
-- ============================================================
-- Esplicita e non derivata: e' una decisione presa guardando i dati, e deve
-- valere identica in produzione e in sviluppo.
INSERT INTO vettori.codici_gestionale
  (codice_gestionale, ragione_sociale, tipo, regola_testo, note)
VALUES
  -- --- vettori nostri -------------------------------------------------------
  ('VT000015', 'GLS ENTERPRISE srl',                   'vettore', NULL, NULL),
  ('VT010005', 'TRADING POST EXPRESS SERVICE srl',     'vettore', NULL, NULL),
  ('VT000010', 'FEDEX EXPRESS ITALY srl',              'vettore', NULL, NULL),

  -- --- regole travestite da vettore ----------------------------------------
  ('VT010063', 'TNT per scatole - GLS per pallet',     'regola',
   'TNT per scatole, GLS per pallet',
   'Dipende dal tipo di collo: la scelta non e ricavabile dai dati della bolla.'),
  ('VT010015', 'GLS fino a 30 Kg-FEDEX oltre',         'regola',
   'GLS fino a 30 kg, FedEx oltre',
   'Dipende dal peso: risolvibile a video quando il peso della bolla c e.'),
  ('VT010051', 'GLS fino a 30 Kg-FEDEX oltre',         'regola',
   'GLS fino a 30 kg, FedEx oltre',
   'Stessa regola di VT010015 con un secondo codice: il gestionale la duplica.'),
  ('VT010033', 'FEDEX fino a 100 Kg-BRT oltre',        'regola',
   'FedEx fino a 100 kg, BRT oltre',
   'Oltre i 100 kg indica BRT, per cui non abbiamo listino.'),
  ('VT009997', 'GLS fino 30Kg-ARTONI oltre',           'regola',
   'GLS fino a 30 kg, Artoni oltre',
   'Oltre i 30 kg indica Artoni, per cui non abbiamo listino.'),

  -- --- vettori di clienti e fornitori --------------------------------------
  ('VT010002', 'TRASCOOP E SERVIZI scrl',              'non_nostro', NULL,
   'Su 67 documenti, 66 sono uscite in porto assegnato: paga il cliente. Unica eccezione l arrivo 565610 del 03/06/2026 da AIGNEP spa, in porto assegnato, che per la regola degli arrivi risulterebbe a nostro carico: da verificare se il porto e sbagliato.'),
  ('VT000013', 'BRT spa',                              'non_nostro', NULL, NULL),
  ('VT000030', 'AMADEI snc',                           'non_nostro', NULL, NULL),
  ('VT000040', 'DHL EXPRESS ITALY srl',                'non_nostro', NULL, NULL),
  ('VT010057', 'ITALIANSPED spa',                      'non_nostro', NULL, NULL),
  ('VT010029', 'SANTI srl',                            'non_nostro', NULL, NULL),
  ('VT000029', 'AUTOTRASPORTI R.D.M.',                 'non_nostro', NULL, NULL),
  ('VT010022', 'FERCAM spa',                           'non_nostro', NULL, NULL),
  ('VT010010', 'CUTI.CONSAI Società Consortile Coop.', 'non_nostro', NULL, NULL)
ON CONFLICT (codice_gestionale) DO UPDATE
SET ragione_sociale = excluded.ragione_sociale,
    tipo            = excluded.tipo,
    regola_testo    = excluded.regola_testo,
    note            = excluded.note,
    aggiornato_il   = now();

-- Il legame al vettore si risolve per slug, non per UUID scritto a mano: un id
-- copiato in una migration e' la cosa che si rompe quando si rifa il database.
UPDATE vettori.codici_gestionale cg
   SET vettore_id = v.id, aggiornato_il = now()
  FROM vettori.vettori v
 WHERE cg.tipo = 'vettore'
   AND v.codice = CASE cg.codice_gestionale
                    WHEN 'VT000015' THEN 'gls'
                    WHEN 'VT010005' THEN 'trading_post'
                    WHEN 'VT000010' THEN 'fedex'
                  END;

-- Se un codice classificato `vettore` resta senza legame, la mappa e' rotta e
-- la pagina Bolle tornerebbe muta: meglio fermare la migration adesso.
DO $$
DECLARE
  v_orfani int;
BEGIN
  SELECT count(*) INTO v_orfani
    FROM vettori.codici_gestionale
   WHERE tipo = 'vettore' AND vettore_id IS NULL;
  IF v_orfani > 0 THEN
    RAISE EXCEPTION
      'Migration 102 interrotta: % codici di tipo vettore non hanno trovato il vettore corrispondente in vettori.vettori', v_orfani;
  END IF;
END;
$$;

COMMENT ON COLUMN vettori.codici_gestionale.tipo IS
  'vettore = mappato su un vettore del portale. regola = il campo del gestionale contiene un criterio di scelta, non un trasportatore: vettore_id resta NULL e la scelta la fa una persona. non_nostro = vettore del cliente o del fornitore, non ci fattura. da_mappare = comparso nei dati e mai classificato.';

NOTIFY pgrst, 'reload schema';
