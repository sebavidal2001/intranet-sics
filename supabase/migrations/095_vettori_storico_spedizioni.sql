-- 095_vettori_storico_spedizioni.sql
--
-- Lo storico delle spedizioni controllate: quello che nei fogli erano i due
-- elenchi «partenze» e «arrivi», qui come archivio interrogabile.
--
-- Perché serve, e perché non bastava la schermata di acquisizione: quella
-- mostra *una* fattura mentre la si carica e poi sparisce. Il foglio invece
-- si riapriva — a novembre si guardava cosa era successo a luglio, si cercava
-- una bolla per numero, si sommavano i colli di un cliente. Senza un archivio
-- consultabile il programma sarebbe un passo indietro rispetto all'Excel, per
-- quanto i calcoli siano più corretti.
--
-- LA DIREZIONE È IL PRIMO FILTRO, NON UNA COLONNA.
-- Nei fogli partenze e arrivi erano due tabelle separate, e non per comodità:
-- cambiano la chiave di aggancio (nostro numero di bolla contro numero del
-- fornitore), il significato del porto, la controparte (cliente contro
-- fornitore) e la disponibilità dei dati fisici. Metterle in un elenco solo
-- con una colonna «direzione» renderebbe ogni totale ambiguo.
--
-- UNA RIGA DI FATTURA = UNA RIGA DI STORICO.
-- L'unità è la riga fatturata, non la spedizione logica: è quella che porta
-- l'importo, ed è su quella che si contesta. La spedizione agganciata entra
-- come contesto (controparte anagrafica, provincia, porto), non come chiave.
--
-- Le fatture in bozza restano fuori dai totali ma **dentro l'elenco**, marcate:
-- nasconderle farebbe sparire righe che l'operatore ha caricato e si aspetta
-- di ritrovare, mostrarle nei totali falserebbe le somme.

CREATE OR REPLACE FUNCTION vettori.elenco_spedizioni(
  p_direzione    text    DEFAULT NULL,   -- 'entrata' | 'uscita' | NULL = entrambe
  p_vettori      text[]  DEFAULT NULL,
  p_da           date    DEFAULT NULL,   -- data spedizione
  p_a            date    DEFAULT NULL,
  p_anno         int     DEFAULT NULL,   -- anno/mese della FATTURA
  p_mese         int     DEFAULT NULL,
  p_esiti        text[]  DEFAULT NULL,
  p_abbinamenti  text[]  DEFAULT NULL,
  p_province     text[]  DEFAULT NULL,
  p_cerca        text    DEFAULT NULL,   -- riferimento, n. spedizione, controparte
  p_solo_anomalie boolean DEFAULT false,
  p_peso_min     numeric DEFAULT NULL,
  p_peso_max     numeric DEFAULT NULL,
  p_importo_min  numeric DEFAULT NULL,
  p_importo_max  numeric DEFAULT NULL,
  p_scostamento_min numeric DEFAULT NULL, -- frazione: 0.2 = almeno +20%
  p_ordine       text    DEFAULT 'data_desc',
  p_pagina       int     DEFAULT 1,
  p_per_pagina   int     DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
WITH righe AS (
  SELECT
    fr.id,
    f.id                                   AS fattura_id,
    coalesce(s.direzione, fr.direzione)    AS direzione,
    v.codice                               AS vettore_codice,
    v.nome                                 AS vettore_nome,
    f.numero                               AS fattura_numero,
    f.data_fattura,
    f.anno,
    f.mese,
    f.stato                                AS stato_fattura,
    fr.riga_numero,
    fr.data_spedizione,
    fr.numero_spedizione,
    fr.numero_riferimento                  AS riferimento,
    coalesce(s.controparte_nome, fr.controparte_testo) AS controparte,
    s.controparte_codice,
    s.zona_provincia                       AS provincia,
    s.zona_cap                             AS cap,
    s.porto_descrizione,
    s.a_nostro_carico,
    fr.colli,
    fr.peso,
    fr.peso_volumetrico,
    fr.peso_tassato,
    fr.nolo,
    fr.supplementi,
    fr.adeguamento,
    fr.carburante,
    fr.totale                              AS fatturato,
    c.atteso_totale                        AS atteso,
    c.scostamento,
    coalesce(c.esito, 'non_valutabile')    AS esito,
    coalesce(c.abbinamento, 'nessuno')     AS abbinamento,
    c.listino_etichetta                    AS listino,
    c.zona_codice                          AS zona,
    c.peso_applicato,
    c.avvertenze,
    (SELECT count(*) FROM vettori.anomalie a
      WHERE a.controllo_id = c.id)                          AS anomalie,
    (SELECT count(*) FROM vettori.anomalie a
      WHERE a.controllo_id = c.id AND a.stato = 'aperta')   AS anomalie_aperte
  FROM vettori.fatture_righe fr
  JOIN vettori.fatture       f ON f.id = fr.fattura_id
  JOIN vettori.vettori       v ON v.id = f.vettore_id
  LEFT JOIN vettori.controlli  c ON c.fattura_riga_id = fr.id
  LEFT JOIN vettori.spedizioni s ON s.id = c.spedizione_id
),
filtrate AS (
  SELECT * FROM righe r
  WHERE (p_direzione IS NULL OR r.direzione = p_direzione)
    AND (p_vettori   IS NULL OR r.vettore_codice = ANY (p_vettori))
    AND (p_da        IS NULL OR r.data_spedizione >= p_da)
    AND (p_a         IS NULL OR r.data_spedizione <= p_a)
    AND (p_anno      IS NULL OR r.anno = p_anno)
    AND (p_mese      IS NULL OR r.mese = p_mese)
    AND (p_esiti     IS NULL OR r.esito = ANY (p_esiti))
    AND (p_abbinamenti IS NULL OR r.abbinamento = ANY (p_abbinamenti))
    AND (p_province  IS NULL OR r.provincia = ANY (p_province))
    AND (NOT p_solo_anomalie OR r.anomalie_aperte > 0)
    AND (p_peso_min  IS NULL OR coalesce(r.peso_tassato, r.peso) >= p_peso_min)
    AND (p_peso_max  IS NULL OR coalesce(r.peso_tassato, r.peso) <= p_peso_max)
    AND (p_importo_min IS NULL OR r.fatturato >= p_importo_min)
    AND (p_importo_max IS NULL OR r.fatturato <= p_importo_max)
    -- Sullo scostamento si cerca lo scarto in valore assoluto: un addebito
    -- del 30% in meno del dovuto è anomalo quanto uno del 30% in più, e più
    -- raro, quindi più interessante da trovare.
    AND (p_scostamento_min IS NULL OR abs(r.scostamento) >= p_scostamento_min)
    AND (
      p_cerca IS NULL OR btrim(p_cerca) = '' OR
      r.riferimento        ILIKE '%' || btrim(p_cerca) || '%' OR
      r.numero_spedizione  ILIKE '%' || btrim(p_cerca) || '%' OR
      r.controparte        ILIKE '%' || btrim(p_cerca) || '%' OR
      r.controparte_codice ILIKE '%' || btrim(p_cerca) || '%' OR
      r.fattura_numero     ILIKE '%' || btrim(p_cerca) || '%'
    )
),
-- I totali escludono le bozze: una fattura che non quadra è una lettura
-- parziale, e sommarla darebbe un numero che nessuno può difendere.
totali AS (
  SELECT
    count(*)                                                          AS righe,
    count(*) FILTER (WHERE stato_fattura <> 'bozza')                  AS righe_valide,
    count(*) FILTER (WHERE stato_fattura = 'bozza')                   AS righe_bozza,
    coalesce(sum(colli)     FILTER (WHERE stato_fattura <> 'bozza'), 0) AS colli,
    round(coalesce(sum(coalesce(peso_tassato, peso))
                            FILTER (WHERE stato_fattura <> 'bozza'), 0), 1) AS kg,
    round(coalesce(sum(fatturato) FILTER (WHERE stato_fattura <> 'bozza'), 0), 2) AS fatturato,
    round(coalesce(sum(atteso)    FILTER (WHERE stato_fattura <> 'bozza'), 0), 2) AS atteso,
    count(*) FILTER (WHERE esito = 'anomalia')                        AS anomalie,
    count(*) FILTER (WHERE anomalie_aperte > 0)                       AS con_anomalie_aperte
  FROM filtrate
),
pagina AS (
  SELECT * FROM filtrate
  ORDER BY
    CASE WHEN p_ordine = 'data_asc'        THEN data_spedizione END ASC  NULLS LAST,
    CASE WHEN p_ordine = 'importo_desc'    THEN fatturato       END DESC NULLS LAST,
    CASE WHEN p_ordine = 'importo_asc'     THEN fatturato       END ASC  NULLS LAST,
    CASE WHEN p_ordine = 'scostamento_desc' THEN abs(scostamento) END DESC NULLS LAST,
    CASE WHEN p_ordine = 'peso_desc'       THEN coalesce(peso_tassato, peso) END DESC NULLS LAST,
    CASE WHEN p_ordine NOT IN ('data_asc','importo_desc','importo_asc','scostamento_desc','peso_desc')
         THEN data_spedizione END DESC NULLS LAST,
    riga_numero
  LIMIT  greatest(1, least(coalesce(p_per_pagina, 100), 500))
  OFFSET greatest(0, (greatest(1, coalesce(p_pagina, 1)) - 1)
                     * greatest(1, least(coalesce(p_per_pagina, 100), 500)))
)
SELECT jsonb_build_object(
  'righe', coalesce((SELECT jsonb_agg(to_jsonb(pagina.*)) FROM pagina), '[]'::jsonb),
  'totali', (SELECT to_jsonb(totali.*) FROM totali),
  -- Il conteggio per direzione è calcolato **prima** del filtro di direzione,
  -- così le due linguette mostrano sempre quante righe ci sono di là.
  'per_direzione', (
    SELECT jsonb_object_agg(direzione, n) FROM (
      SELECT coalesce(direzione, 'ignota') AS direzione, count(*) AS n
      FROM righe r
      WHERE (p_vettori IS NULL OR r.vettore_codice = ANY (p_vettori))
        AND (p_da     IS NULL OR r.data_spedizione >= p_da)
        AND (p_a      IS NULL OR r.data_spedizione <= p_a)
        AND (p_anno   IS NULL OR r.anno = p_anno)
        AND (p_mese   IS NULL OR r.mese = p_mese)
      GROUP BY 1
    ) d
  ),
  'pagina', greatest(1, coalesce(p_pagina, 1)),
  'per_pagina', greatest(1, least(coalesce(p_per_pagina, 100), 500))
);
$fn$;

COMMENT ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int) IS
  'Storico delle righe di fattura controllate, filtrabile e paginato. L''unità è la riga fatturata — quella che porta l''importo e su cui si contesta — con la spedizione agganciata come contesto. I totali escludono le fatture in bozza; l''elenco le mostra marcate.';

-- ============================================================
-- Valori disponibili per i menù dei filtri
-- ============================================================
-- Si ricavano dai dati presenti, non da un elenco fisso: un filtro che offre
-- una provincia senza nemmeno una spedizione fa perdere tempo, e uno che non
-- offre una provincia presente nasconde dati.
CREATE OR REPLACE FUNCTION vettori.filtri_spedizioni()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
SELECT jsonb_build_object(
  'vettori', coalesce((
    SELECT jsonb_agg(jsonb_build_object('codice', codice, 'nome', nome) ORDER BY nome)
    FROM vettori.vettori WHERE attivo
  ), '[]'::jsonb),
  'province', coalesce((
    SELECT jsonb_agg(DISTINCT s.zona_provincia)
    FROM vettori.spedizioni s WHERE s.zona_provincia IS NOT NULL
  ), '[]'::jsonb),
  'periodi', coalesce((
    SELECT jsonb_agg(jsonb_build_object('anno', anno, 'mese', mese) ORDER BY anno DESC, mese DESC)
    FROM (SELECT DISTINCT anno, mese FROM vettori.fatture) p
  ), '[]'::jsonb),
  'anni', coalesce((
    SELECT jsonb_agg(DISTINCT anno ORDER BY anno DESC) FROM vettori.fatture
  ), '[]'::jsonb)
);
$fn$;

COMMENT ON FUNCTION vettori.filtri_spedizioni() IS
  'Valori realmente presenti nei dati per popolare i menù dei filtri dello storico.';

REVOKE ALL ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION vettori.filtri_spedizioni() FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int)
  TO service_role;
GRANT EXECUTE ON FUNCTION vettori.filtri_spedizioni() TO service_role;

NOTIFY pgrst, 'reload schema';
