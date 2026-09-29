-- 125_vettori_spedizioni_solo_a_nostro_carico.sql
--
-- Riscontro dell'amministrazione del 29/09/2026: nella pagina Spedizioni
-- comparivano BC in porto assegnato e BF in porto franco, cioe' spedizioni che
-- il vettore non ci fattura. La pagina Bolle le nascondeva gia' dal 24/09
-- (con la casella «Mostra anche le bolle che non paghiamo noi»): qui si applica
-- la stessa regola all'elenco delle spedizioni.
--
-- `elenco_spedizioni` prende un parametro in piu', `p_tutte` (default false),
-- e restituisce `non_a_nostro_carico`, il numero di spedizioni nascoste. Le
-- righe di fattura non si toccano mai.
--
-- Il parametro nuovo cambia la firma: la vecchia si elimina, altrimenti
-- PostgREST si troverebbe due funzioni con lo stesso nome. Permessi come nella
-- 098: solo service_role.

DROP FUNCTION IF EXISTS vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int);

CREATE OR REPLACE FUNCTION vettori.elenco_spedizioni(p_direzione text DEFAULT NULL::text, p_vettori text[] DEFAULT NULL::text[], p_da date DEFAULT NULL::date, p_a date DEFAULT NULL::date, p_anno integer DEFAULT NULL::integer, p_mese integer DEFAULT NULL::integer, p_esiti text[] DEFAULT NULL::text[], p_abbinamenti text[] DEFAULT NULL::text[], p_province text[] DEFAULT NULL::text[], p_cerca text DEFAULT NULL::text, p_solo_anomalie boolean DEFAULT false, p_peso_min numeric DEFAULT NULL::numeric, p_peso_max numeric DEFAULT NULL::numeric, p_importo_min numeric DEFAULT NULL::numeric, p_importo_max numeric DEFAULT NULL::numeric, p_scostamento_min numeric DEFAULT NULL::numeric, p_ordine text DEFAULT 'data_desc'::text, p_pagina integer DEFAULT 1, p_per_pagina integer DEFAULT 100, p_tutte boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
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
    s.id                                   AS spedizione_id,
    s.porto_codice,
    s.numero_protocollo,
    s.riaddebito_previsto,
    s.riaddebito_verificato_il,
    f.quadratura_ok                        AS fattura_quadrata,
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
    s.id                                    AS spedizione_id,
    s.porto_codice,
    s.numero_protocollo,
    s.riaddebito_previsto,
    s.riaddebito_verificato_il,
    NULL::boolean                           AS fattura_quadrata,
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
  -- Una spedizione ignorata non e' una spedizione da controllare. Ci finiscono
  -- le righe dei fogli Excel riconosciute come doppioni di una bolla gia'
  -- controllata: il dato resta consultabile, ma nell'elenco delle spedizioni
  -- da guardare comparirebbe due volte la stessa merce.
  AND s.stato <> 'ignorata'
),
righe_base AS (
  SELECT * FROM righe_fattura
  UNION ALL
  SELECT * FROM spedizioni_non_fatturate
),
-- Le righe di fattura restano sempre: se il vettore l'ha fatturata, ce la
-- fattura a noi, quale che sia il porto scritto sulla bolla. Si nascondono
-- solo le spedizioni ancora senza fattura il cui trasporto non paghiamo noi
-- (BC in assegnato, BF in franco), come nella pagina Bolle: le manuali e
-- quelle della simulazione restano, e quelle di cui il porto non si conosce
-- (a_nostro_carico NULL) anche.
righe AS (
  SELECT * FROM righe_base r
  WHERE p_tutte
     OR r.stato_fatturazione <> 'non_fatturata'
     OR r.a_nostro_carico IS NOT FALSE
     OR coalesce(r.origine, '') IN ('manuale', 'simulazione')
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
      r.numero_protocollo  ILIKE '%' || btrim(p_cerca) || '%' OR
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
  -- Quante spedizioni non a nostro carico l'elenco sta nascondendo, per dirlo
  -- a chi guarda (0 con «mostra tutte»).
  'non_a_nostro_carico', CASE WHEN p_tutte THEN 0 ELSE (
    SELECT count(*) FROM righe_base r
    WHERE r.stato_fatturazione = 'non_fatturata'
      AND r.a_nostro_carico IS FALSE
      AND coalesce(r.origine, '') NOT IN ('manuale', 'simulazione')
      AND (p_direzione IS NULL OR r.direzione = p_direzione)
      AND (p_vettori   IS NULL OR r.vettore_codice = ANY (p_vettori))
      AND (p_da        IS NULL OR r.data_spedizione >= p_da)
      AND (p_a         IS NULL OR r.data_spedizione <= p_a)
      AND (p_anno IS NULL OR extract(year FROM r.data_spedizione)::int = p_anno)
      AND (p_mese IS NULL OR extract(month FROM r.data_spedizione)::int = p_mese)
  ) END,
  'pagina', greatest(1, coalesce(p_pagina, 1)),
  'per_pagina', greatest(1, least(coalesce(p_per_pagina, 100), 500))
);
$function$;

REVOKE ALL ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int, boolean)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int, boolean)
  TO service_role;

NOTIFY pgrst, 'reload schema';
