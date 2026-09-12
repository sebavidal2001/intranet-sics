-- 098_vettori_storico_include_spedizioni.sql
--
-- Lo storico segue il momento operativo reale: una spedizione viene annotata
-- quando parte o arriva, mentre la fattura del vettore può arrivare settimane
-- dopo. La 095 partiva invece dalle righe di fattura e rendeva invisibile tutto
-- ciò che era già in `vettori.spedizioni` ma non ancora fatturato.
--
-- L'unità resta la riga di fattura quando questa esiste; in più entra una riga
-- per ogni spedizione che non è riferita da alcun `vettori.controlli`.
-- `stato_fatturazione` è il campo esplicito introdotto da questa migration:
--   - fatturata: riga di una fattura confermata o chiusa;
--   - bozza: riga di una fattura ancora incompleta;
--   - non_fatturata: spedizione registrata, fattura non ancora presente.
-- `stato_fattura` resta invece il valore grezzo del documento ed è NULL nel
-- terzo caso. Così l'assenza della fattura non viene confusa con un importo a
-- zero o con l'esito "non valutabile" di un controllo già eseguito.

CREATE OR REPLACE FUNCTION vettori.elenco_spedizioni(
  p_direzione    text    DEFAULT NULL,
  p_vettori      text[]  DEFAULT NULL,
  p_da           date    DEFAULT NULL,
  p_a            date    DEFAULT NULL,
  p_anno         int     DEFAULT NULL,
  p_mese         int     DEFAULT NULL,
  p_esiti        text[]  DEFAULT NULL,
  p_abbinamenti  text[]  DEFAULT NULL,
  p_province     text[]  DEFAULT NULL,
  p_cerca        text    DEFAULT NULL,
  p_solo_anomalie boolean DEFAULT false,
  p_peso_min     numeric DEFAULT NULL,
  p_peso_max     numeric DEFAULT NULL,
  p_importo_min  numeric DEFAULT NULL,
  p_importo_max  numeric DEFAULT NULL,
  p_scostamento_min numeric DEFAULT NULL,
  p_ordine       text    DEFAULT 'data_desc',
  p_pagina       int     DEFAULT 1,
  p_per_pagina   int     DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
WITH righe_fattura AS (
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
    CASE WHEN f.stato = 'bozza' THEN 'bozza' ELSE 'fatturata' END::text
                                            AS stato_fatturazione,
    s.origine                              AS origine,
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
spedizioni_non_fatturate AS (
  SELECT
    s.id,
    NULL::uuid                              AS fattura_id,
    s.direzione,
    v.codice                                AS vettore_codice,
    v.nome                                  AS vettore_nome,
    NULL::text                              AS fattura_numero,
    NULL::date                              AS data_fattura,
    NULL::int                               AS anno,
    NULL::int                               AS mese,
    NULL::text                              AS stato_fattura,
    'non_fatturata'::text                   AS stato_fatturazione,
    s.origine,
    NULL::int                               AS riga_numero,
    s.data_documento                        AS data_spedizione,
    NULL::text                              AS numero_spedizione,
    s.numero_riferimento                    AS riferimento,
    s.controparte_nome                      AS controparte,
    s.controparte_codice,
    s.zona_provincia                        AS provincia,
    s.zona_cap                              AS cap,
    s.porto_descrizione,
    s.a_nostro_carico,
    s.colli_bolla                           AS colli,
    s.peso_bolla                            AS peso,
    NULL::numeric                           AS peso_volumetrico,
    NULL::numeric                           AS peso_tassato,
    NULL::numeric                           AS nolo,
    NULL::numeric                           AS supplementi,
    NULL::numeric                           AS adeguamento,
    NULL::numeric                           AS carburante,
    NULL::numeric                           AS fatturato,
    NULL::numeric                           AS atteso,
    NULL::numeric                           AS scostamento,
    NULL::text                              AS esito,
    NULL::text                              AS abbinamento,
    NULL::text                              AS listino,
    NULL::text                              AS zona,
    NULL::text                              AS peso_applicato,
    NULL::text[]                            AS avvertenze,
    0::bigint                               AS anomalie,
    0::bigint                               AS anomalie_aperte
  FROM vettori.spedizioni s
  LEFT JOIN vettori.vettori v ON v.id = s.vettore_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM vettori.controlli c
    WHERE c.spedizione_id = s.id
  )
),
righe AS (
  SELECT * FROM righe_fattura
  UNION ALL
  SELECT * FROM spedizioni_non_fatturate
),
filtrate AS (
  SELECT * FROM righe r
  WHERE (p_direzione IS NULL OR r.direzione = p_direzione)
    AND (p_vettori   IS NULL OR r.vettore_codice = ANY (p_vettori))
    AND (p_da        IS NULL OR r.data_spedizione >= p_da)
    AND (p_a         IS NULL OR r.data_spedizione <= p_a)
    -- Per una riga fatturata anno e mese sono quelli della fattura; per una
    -- spedizione ancora senza fattura il periodo ricade sulla data spedizione.
    -- I campi `anno` e `mese` restituiti restano comunque NULL in quel ramo.
    AND (p_anno IS NULL OR coalesce(
          r.anno,
          extract(year FROM r.data_spedizione)::int
        ) = p_anno)
    AND (p_mese IS NULL OR coalesce(
          r.mese,
          extract(month FROM r.data_spedizione)::int
        ) = p_mese)
    AND (p_esiti     IS NULL OR r.esito = ANY (p_esiti))
    AND (p_abbinamenti IS NULL OR r.abbinamento = ANY (p_abbinamenti))
    AND (p_province  IS NULL OR r.provincia = ANY (p_province))
    AND (NOT p_solo_anomalie OR r.anomalie_aperte > 0)
    AND (p_peso_min  IS NULL OR coalesce(r.peso_tassato, r.peso) >= p_peso_min)
    AND (p_peso_max  IS NULL OR coalesce(r.peso_tassato, r.peso) <= p_peso_max)
    AND (p_importo_min IS NULL OR r.fatturato >= p_importo_min)
    AND (p_importo_max IS NULL OR r.fatturato <= p_importo_max)
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
totali AS (
  SELECT
    -- `righe` è il conteggio operativo complessivo: include le spedizioni che
    -- aspettano la fattura. Gli aggregati monetari invece usano soltanto le
    -- fatture confermate/chiuse, mai bozze né assenze di fattura.
    count(*)                                                        AS righe,
    count(*) FILTER (WHERE stato_fatturazione = 'fatturata')       AS righe_valide,
    count(*) FILTER (WHERE stato_fatturazione = 'bozza')           AS righe_bozza,
    count(*) FILTER (WHERE stato_fatturazione = 'non_fatturata')   AS spedizioni_non_fatturate,
    coalesce(sum(colli) FILTER (
      WHERE stato_fatturazione <> 'bozza'
    ), 0)                                                          AS colli,
    round(coalesce(sum(coalesce(peso_tassato, peso)) FILTER (
      WHERE stato_fatturazione <> 'bozza'
    ), 0), 1)                                                      AS kg,
    round(coalesce(sum(fatturato) FILTER (
      WHERE stato_fatturazione = 'fatturata'
    ), 0), 2)                                                      AS fatturato,
    round(coalesce(sum(atteso) FILTER (
      WHERE stato_fatturazione = 'fatturata'
    ), 0), 2)                                                      AS atteso,
    count(*) FILTER (WHERE esito = 'anomalia')                     AS anomalie,
    count(*) FILTER (WHERE anomalie_aperte > 0)                    AS con_anomalie_aperte
  FROM filtrate
),
pagina AS (
  SELECT * FROM filtrate
  ORDER BY
    CASE WHEN p_ordine = 'data_asc'         THEN data_spedizione END ASC  NULLS LAST,
    CASE WHEN p_ordine = 'importo_desc'     THEN fatturato       END DESC NULLS LAST,
    CASE WHEN p_ordine = 'importo_asc'      THEN fatturato       END ASC  NULLS LAST,
    CASE WHEN p_ordine = 'scostamento_desc' THEN abs(scostamento) END DESC NULLS LAST,
    CASE WHEN p_ordine = 'peso_desc'        THEN coalesce(peso_tassato, peso) END DESC NULLS LAST,
    CASE WHEN p_ordine NOT IN ('data_asc','importo_desc','importo_asc','scostamento_desc','peso_desc')
         THEN data_spedizione END DESC NULLS LAST,
    riga_numero,
    id
  LIMIT greatest(1, least(coalesce(p_per_pagina, 100), 500))
  OFFSET greatest(0, (greatest(1, coalesce(p_pagina, 1)) - 1)
                     * greatest(1, least(coalesce(p_per_pagina, 100), 500)))
)
SELECT jsonb_build_object(
  'righe', coalesce((SELECT jsonb_agg(to_jsonb(pagina.*)) FROM pagina), '[]'::jsonb),
  'totali', (SELECT to_jsonb(totali.*) FROM totali),
  -- Il conteggio delle linguette ignora solo il filtro di direzione, come nella
  -- 095, ma ora conta anche le spedizioni non ancora fatturate.
  'per_direzione', (
    SELECT jsonb_object_agg(direzione, n) FROM (
      SELECT coalesce(direzione, 'ignota') AS direzione, count(*) AS n
      FROM righe r
      WHERE (p_vettori IS NULL OR r.vettore_codice = ANY (p_vettori))
        AND (p_da      IS NULL OR r.data_spedizione >= p_da)
        AND (p_a       IS NULL OR r.data_spedizione <= p_a)
        AND (p_anno IS NULL OR coalesce(
              r.anno,
              extract(year FROM r.data_spedizione)::int
            ) = p_anno)
        AND (p_mese IS NULL OR coalesce(
              r.mese,
              extract(month FROM r.data_spedizione)::int
            ) = p_mese)
      GROUP BY 1
    ) d
  ),
  'pagina', greatest(1, coalesce(p_pagina, 1)),
  'per_pagina', greatest(1, least(coalesce(p_per_pagina, 100), 500))
);
$fn$;

COMMENT ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int) IS
  'Storico unificato: righe di fattura e spedizioni registrate non ancora riferite da un controllo. stato_fatturazione distingue fatturata, bozza e non_fatturata; origine conserva la provenienza della spedizione. Gli importi escludono bozze e spedizioni senza fattura.';

-- I periodi includono le date delle spedizioni ancora non fatturate: in quel
-- ramo anno e mese dei filtri si applicano alla data spedizione. Province e
-- vettori continuano a derivare dai valori realmente utilizzabili.
CREATE OR REPLACE FUNCTION vettori.filtri_spedizioni()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
WITH periodi AS (
  SELECT f.anno, f.mese
  FROM vettori.fatture f
  UNION
  SELECT
    extract(year FROM s.data_documento)::int AS anno,
    extract(month FROM s.data_documento)::int AS mese
  FROM vettori.spedizioni s
  WHERE NOT EXISTS (
    SELECT 1 FROM vettori.controlli c WHERE c.spedizione_id = s.id
  )
)
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
    FROM periodi
  ), '[]'::jsonb),
  'anni', coalesce((
    SELECT jsonb_agg(DISTINCT anno ORDER BY anno DESC) FROM periodi
  ), '[]'::jsonb)
);
$fn$;

COMMENT ON FUNCTION vettori.filtri_spedizioni() IS
  'Valori presenti nello storico unificato. Per le spedizioni non ancora fatturate il periodo deriva da data_documento.';

REVOKE ALL ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION vettori.filtri_spedizioni()
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int)
  TO service_role;
GRANT EXECUTE ON FUNCTION vettori.filtri_spedizioni()
  TO service_role;

NOTIFY pgrst, 'reload schema';
