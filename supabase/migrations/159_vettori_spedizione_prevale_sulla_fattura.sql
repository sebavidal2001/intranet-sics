-- 159_vettori_spedizione_prevale_sulla_fattura.sql
-- Dopo l'importazione di una fattura le pagine Spedizioni e Anomalie
-- mostravano vettore e numero bolla DELLA FATTURA al posto di quelli della
-- spedizione (la BF di Impresa). Esempio: fattura "TNT" intestata a FedEx ->
-- tutte le BF registrate con FEDEX comparivano come TNT, col numero bolla
-- citato dal vettore (es. AIRFLUIDS) invece di quello della BF.
--
-- Ora, per le righe agganciate a una spedizione, prevalgono i dati della
-- spedizione (vettore_id, numero_riferimento); la fattura resta il ripiego
-- quando la riga non e' agganciata. Il numero citato in fattura e' esposto a
-- parte (`riferimento_fattura`) e resta ricercabile.
-- Anomalie: aggiunti numero bolla, protocollo, numero spedizione del vettore
-- e il dettaglio economico per poterle "esplodere" in pagina.
-- Nessun dato scritto: solo due funzioni di lettura.

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
    coalesce(vs.codice, vf.codice)         AS vettore_codice,
    coalesce(vs.nome, vf.nome)             AS vettore_nome,
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
    coalesce(s.numero_riferimento, fr.numero_riferimento) AS riferimento,
    fr.numero_riferimento                  AS riferimento_fattura,
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
  JOIN vettori.vettori       vf ON vf.id = f.vettore_id
  LEFT JOIN vettori.controlli  c ON c.fattura_riga_id = fr.id
  LEFT JOIN vettori.spedizioni s ON s.id = c.spedizione_id
  LEFT JOIN vettori.vettori    vs ON vs.id = s.vettore_id
  WHERE s.id IS NULL OR s.stato <> 'ignorata'
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
    NULL::text                              AS riferimento_fattura,
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
      r.riferimento_fattura ILIKE '%' || btrim(p_cerca) || '%' OR
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

REVOKE ALL ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int, boolean) TO service_role;

CREATE OR REPLACE FUNCTION vettori.elenco_anomalie(
  p_stati    text[] DEFAULT NULL,
  p_vettore  text   DEFAULT NULL,
  p_da       date   DEFAULT NULL,
  p_a        date   DEFAULT NULL,
  p_limite   int    DEFAULT 400
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
  SELECT coalesce(jsonb_agg(x ORDER BY aperta DESC, creata_il DESC), '[]'::jsonb)
  FROM (
    SELECT
      (a.stato = 'aperta')            AS aperta,
      a.creata_il                     AS creata_il,
      jsonb_build_object(
        'id',                 a.id,
        'tipo',               a.tipo,
        'gravita',            a.gravita,
        'stato',              a.stato,
        'descrizione',        a.descrizione,
        'importo_contestato', a.importo_contestato,
        'motivazione',        a.motivazione,
        'creata_il',          a.creata_il,
        'decisa_il',          a.decisa_il,
        'vettore_codice',     coalesce(vs.codice, v.codice),
        'vettore_nome',       coalesce(vs.nome, v.nome),
        'fattura_numero',     f.numero,
        'fattura_data',       f.data_fattura,
        'anno',               f.anno,
        'mese',               f.mese,
        'riga_numero',        fr.riga_numero,
        'riferimento',        coalesce(s.numero_riferimento, fr.numero_riferimento),
        'riferimento_fattura', fr.numero_riferimento,
        'numero_spedizione',  fr.numero_spedizione,
        'protocollo',         s.numero_protocollo,
        'spedizione_id',      s.id,
        'peso_volumetrico',   fr.peso_volumetrico,
        'nolo',               fr.nolo,
        'supplementi',        fr.supplementi,
        'adeguamento',        fr.adeguamento,
        'carburante',         fr.carburante,
        'peso_applicato',     c.peso_applicato,
        'avvertenze',         c.avvertenze,
        'controparte',        coalesce(s.controparte_nome, fr.controparte_testo),
        'direzione',          coalesce(s.direzione, fr.direzione),
        'data_spedizione',    fr.data_spedizione,
        'colli',              fr.colli,
        'peso',               fr.peso,
        'peso_tassato',       fr.peso_tassato,
        'fatturato',          fr.totale,
        'atteso',             c.atteso_totale,
        'scostamento',        c.scostamento,
        'listino',            c.listino_etichetta,
        'zona',               c.zona_codice,
        'abbinamento',        c.abbinamento
      ) AS x
    FROM vettori.anomalie a
    LEFT JOIN vettori.controlli      c  ON c.id  = a.controllo_id
    LEFT JOIN vettori.fatture_righe  fr ON fr.id = c.fattura_riga_id
    LEFT JOIN vettori.fatture        f  ON f.id  = fr.fattura_id
    LEFT JOIN vettori.vettori        v  ON v.id  = f.vettore_id
    LEFT JOIN vettori.spedizioni     s  ON s.id  = coalesce(a.spedizione_id, c.spedizione_id)
    LEFT JOIN vettori.vettori        vs ON vs.id = s.vettore_id
    WHERE (s.id IS NULL OR s.stato <> 'ignorata')
      AND (p_stati   IS NULL OR a.stato = ANY (p_stati))
      AND (p_vettore IS NULL OR coalesce(vs.codice, v.codice) = p_vettore)
      AND (p_da      IS NULL OR f.data_fattura >= p_da)
      AND (p_a       IS NULL OR f.data_fattura <= p_a)
    ORDER BY (a.stato = 'aperta') DESC, a.creata_il DESC
    LIMIT p_limite
  ) t;
$fn$;

REVOKE ALL ON FUNCTION vettori.elenco_anomalie(text[], text, date, date, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.elenco_anomalie(text[], text, date, date, int) TO service_role;
