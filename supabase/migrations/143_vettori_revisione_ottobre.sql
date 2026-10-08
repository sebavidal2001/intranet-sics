-- 143_vettori_revisione_ottobre.sql
-- A: la 125 lasciava visibili bolle ignorate nel ramo fatturato; si allineano
--    lo storico, i filtri della 098 e letture/anomalie della 092.
--    Verifica: le query 1-2 in fondo non devono restituire righe.
-- B: la 091 riattivava una bolla ignorata trovata per id_documento.
--    Ora la riga resta senza bolla e la spedizione conserva lo stato.
--    Verifica con acquisizione di prova su un documento ignorato.
-- C: get_vettori_context e' SECURITY DEFINER con p_user_id arbitrario;
--    in src/ lo usa soltanto ruoli.ts con client admin. Verificare query 3.
-- D: due sganci simultanei potevano contare senza sincronizzarsi. Si blocca
--    la bolla prima del distacco. La 129 applica_aggancio lo fa gia'.
--    Verifica: due sganci concorrenti lasciano la bolla scongelata.
-- Nessun UNIQUE(id_documento): usare prima la diagnostica separata.


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

REVOKE ALL ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.elenco_spedizioni(text, text[], date, date, int, int, text[], text[], text[], text, boolean, numeric, numeric, numeric, numeric, numeric, text, int, int, boolean) TO service_role;

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
  WHERE s.stato <> 'ignorata'
    AND NOT EXISTS (
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
    FROM vettori.spedizioni s WHERE s.zona_provincia IS NOT NULL AND s.stato <> 'ignorata'
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

REVOKE ALL ON FUNCTION vettori.filtri_spedizioni() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.filtri_spedizioni() TO service_role;

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
        'vettore_codice',     v.codice,
        'vettore_nome',       v.nome,
        'fattura_numero',     f.numero,
        'fattura_data',       f.data_fattura,
        'anno',               f.anno,
        'mese',               f.mese,
        'riga_numero',        fr.riga_numero,
        'riferimento',        fr.numero_riferimento,
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
    WHERE (s.id IS NULL OR s.stato <> 'ignorata')
      AND (p_stati   IS NULL OR a.stato = ANY (p_stati))
      AND (p_vettore IS NULL OR v.codice = p_vettore)
      AND (p_da      IS NULL OR f.data_fattura >= p_da)
      AND (p_a       IS NULL OR f.data_fattura <= p_a)
    ORDER BY (a.stato = 'aperta') DESC, a.creata_il DESC
    LIMIT p_limite
  ) t;
$fn$;

REVOKE ALL ON FUNCTION vettori.elenco_anomalie(text[], text, date, date, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.elenco_anomalie(text[], text, date, date, int) TO service_role;

CREATE OR REPLACE FUNCTION vettori.analisi(p_da date, p_a date)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $fn$
WITH base AS (
  SELECT
    v.codice AS vettore_codice,
    v.nome   AS vettore_nome,
    f.anno,
    f.mese,
    fr.colli,
    coalesce(fr.peso_tassato, fr.peso)  AS kg,
    fr.totale                            AS fatturato,
    c.atteso_totale                      AS atteso,
    c.esito,
    c.abbinamento
  FROM vettori.fatture f
  JOIN vettori.vettori       v  ON v.id = f.vettore_id
  JOIN vettori.fatture_righe fr ON fr.fattura_id = f.id
  LEFT JOIN vettori.controlli c ON c.fattura_riga_id = fr.id
  WHERE f.data_fattura BETWEEN p_da AND p_a
    AND f.stato <> 'bozza'
    AND NOT EXISTS (SELECT 1 FROM vettori.spedizioni s WHERE s.id = c.spedizione_id AND s.stato = 'ignorata')
),
anom AS (
  SELECT
    v.codice AS vettore_codice,
    a.tipo,
    a.stato,
    a.importo_contestato
  FROM vettori.anomalie a
  JOIN vettori.controlli      c  ON c.id  = a.controllo_id
  JOIN vettori.fatture_righe  fr ON fr.id = c.fattura_riga_id
  JOIN vettori.fatture        f  ON f.id  = fr.fattura_id
  JOIN vettori.vettori        v  ON v.id  = f.vettore_id
  WHERE f.data_fattura BETWEEN p_da AND p_a
    AND NOT EXISTS (SELECT 1 FROM vettori.spedizioni s WHERE s.id = coalesce(a.spedizione_id, c.spedizione_id) AND s.stato = 'ignorata')
)
SELECT jsonb_build_object(
  'da', p_da,
  'a',  p_a,
  'totali', (
    SELECT jsonb_build_object(
      'righe',     count(*),
      'colli',     coalesce(sum(colli), 0),
      'kg',        round(coalesce(sum(kg), 0), 1),
      'fatturato', round(coalesce(sum(fatturato), 0), 2),
      'atteso',    round(coalesce(sum(atteso), 0), 2),
      'anomalie',  count(*) FILTER (WHERE esito = 'anomalia')
    ) FROM base
  ),
  'vettori', coalesce((
    SELECT jsonb_agg(x ORDER BY fatturato DESC)
    FROM (
      SELECT
        round(coalesce(sum(fatturato), 0), 2) AS fatturato,
        jsonb_build_object(
          'codice',         vettore_codice,
          'nome',           vettore_nome,
          'righe',          count(*),
          'colli',          coalesce(sum(colli), 0),
          'kg',             round(coalesce(sum(kg), 0), 1),
          'fatturato',      round(coalesce(sum(fatturato), 0), 2),
          'atteso',         round(coalesce(sum(atteso), 0), 2),
          'in_linea',       count(*) FILTER (WHERE esito = 'in_linea'),
          'da_verificare',  count(*) FILTER (WHERE esito = 'da_verificare'),
          'anomalie',       count(*) FILTER (WHERE esito = 'anomalia'),
          'non_valutabili', count(*) FILTER (WHERE esito IS NULL OR esito = 'non_valutabile'),
          'senza_bolla',    count(*) FILTER (WHERE abbinamento = 'nessuno'),
          'contestato',     round(coalesce((
                              SELECT sum(importo_contestato) FROM anom
                               WHERE anom.vettore_codice = base.vettore_codice
                                 AND anom.stato IN ('aperta', 'contestata')
                            ), 0), 2)
        ) AS x
      FROM base
      GROUP BY vettore_codice, vettore_nome
    ) t
  ), '[]'::jsonb),
  'mesi', coalesce((
    SELECT jsonb_agg(x ORDER BY anno, mese)
    FROM (
      SELECT anno, mese,
        jsonb_build_object(
          'anno',      anno,
          'mese',      mese,
          'righe',     count(*),
          'colli',     coalesce(sum(colli), 0),
          'kg',        round(coalesce(sum(kg), 0), 1),
          'fatturato', round(coalesce(sum(fatturato), 0), 2),
          'atteso',    round(coalesce(sum(atteso), 0), 2),
          'anomalie',  count(*) FILTER (WHERE esito = 'anomalia')
        ) AS x
      FROM base
      GROUP BY anno, mese
    ) t
  ), '[]'::jsonb),
  'tipi_anomalia', coalesce((
    SELECT jsonb_agg(x ORDER BY quante DESC)
    FROM (
      SELECT count(*) AS quante,
        jsonb_build_object(
          'tipo',       tipo,
          'quante',     count(*),
          'aperte',     count(*) FILTER (WHERE stato = 'aperta'),
          'contestato', round(coalesce(sum(importo_contestato), 0), 2)
        ) AS x
      FROM anom
      GROUP BY tipo
    ) t
  ), '[]'::jsonb)
);
$fn$;

REVOKE ALL ON FUNCTION vettori.analisi(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.analisi(date, date) TO service_role;

CREATE OR REPLACE FUNCTION vettori.acquisisci_fattura(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_vettore_id   uuid;
  v_fattura_id   uuid;
  v_utente       uuid;
  v_sped         jsonb;
  v_riga         jsonb;
  v_anomalia     jsonb;
  v_spedizione_id uuid;
  v_ignorata boolean;
  v_riga_id      uuid;
  v_controllo_id uuid;
  v_id_doc       integer;
  v_chiave       text;
  -- chiave della spedizione nel payload -> id in tabella
  v_mappa        jsonb := '{}'::jsonb;
  v_n_righe      int := 0;
  v_n_sped       int := 0;
  v_n_controlli  int := 0;
  v_n_anomalie   int := 0;
BEGIN
  SELECT id INTO v_vettore_id
    FROM vettori.vettori
   WHERE codice = p_payload->>'vettore_codice';
  IF v_vettore_id IS NULL THEN
    RAISE EXCEPTION 'Vettore % non configurato', p_payload->>'vettore_codice'
      USING ERRCODE = 'no_data_found';
  END IF;

  v_utente := nullif(p_payload->>'utente_id', '')::uuid;

  -- Il mese chiuso non si tocca. Riaprirlo è un'operazione esplicita, non un
  -- effetto collaterale di un caricamento.
  IF EXISTS (
    SELECT 1 FROM vettori.chiusure
     WHERE vettore_id = v_vettore_id
       AND anno = (p_payload->>'anno')::int
       AND mese = (p_payload->>'mese')::int
  ) THEN
    RAISE EXCEPTION 'Il mese %/% di questo vettore è già chiuso: va riaperto prima di caricare altro.',
      p_payload->>'mese', p_payload->>'anno'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  INSERT INTO vettori.fatture (
    vettore_id, numero, data_fattura, anno, mese,
    tot_nolo, tot_supplementi, tot_adeguamento, tot_carburante, tot_documento,
    perc_carburante, nome_file, hash_file, metodo_lettura, righe_lette,
    quadratura_ok, quadratura_note, stato, caricata_da
  ) VALUES (
    v_vettore_id,
    coalesce(nullif(p_payload->>'numero', ''), 'senza numero'),
    (p_payload->>'data_fattura')::date,
    (p_payload->>'anno')::int,
    (p_payload->>'mese')::int,
    (p_payload#>>'{totali,nolo}')::numeric,
    (p_payload#>>'{totali,supplementi}')::numeric,
    (p_payload#>>'{totali,adeguamento}')::numeric,
    (p_payload#>>'{totali,carburante}')::numeric,
    (p_payload#>>'{totali,totaleDocumento}')::numeric,
    (p_payload#>>'{totali,percentualeCarburante}')::numeric,
    p_payload->>'nome_file',
    p_payload->>'hash_file',
    coalesce(p_payload->>'metodo_lettura', 'testo'),
    jsonb_array_length(coalesce(p_payload->'righe', '[]'::jsonb)),
    (p_payload->>'quadratura_ok')::boolean,
    p_payload->>'quadratura_note',
    'confermata',
    v_utente
  )
  RETURNING id INTO v_fattura_id;

  -- ============================================================
  -- Spedizioni: si riusa quella che già contiene uno dei documenti
  -- ============================================================
  -- Cercare per numero e data non basterebbe: una bolla del fornitore può
  -- corrispondere a più carichi, e la stessa spedizione può essere già stata
  -- creata da un caricamento precedente con un raggruppamento diverso.
  -- L'identità certa è il documento del gestionale.
  FOR v_sped IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'spedizioni', '[]'::jsonb))
  LOOP
    v_chiave := v_sped->>'chiave';
    v_spedizione_id := NULL;
    v_ignorata := false;

    SELECT sd.spedizione_id, s.stato = 'ignorata'
      INTO v_spedizione_id, v_ignorata
      FROM vettori.spedizioni_documenti sd
      JOIN vettori.spedizioni s ON s.id = sd.spedizione_id
     WHERE sd.id_documento IN (
             SELECT (x)::int FROM jsonb_array_elements_text(v_sped->'idDocumenti') AS x
           )
     LIMIT 1;

    IF coalesce(v_ignorata, false) THEN
      -- Non duplicare o riattivare una spedizione ignorata.
      v_spedizione_id := NULL;
    ELSIF v_spedizione_id IS NULL THEN
      INSERT INTO vettori.spedizioni (
        direzione, vettore_id, numero_riferimento, numero_riferimento_norm,
        data_documento, controparte_codice, controparte_nome,
        zona_cap, zona_provincia, porto_codice, porto_descrizione,
        a_nostro_carico, colli_bolla, peso_bolla, origine, stato
      ) VALUES (
        v_sped->>'direzione',
        v_vettore_id,
        v_sped->>'riferimento',
        v_sped->>'riferimentoNorm',
        (v_sped->>'dataDocumento')::date,
        v_sped->>'codiceControparte',
        v_sped->>'controparte',
        v_sped->>'zonaCap',
        v_sped->>'zonaProvincia',
        v_sped->>'portoCodice',
        v_sped->>'porto',
        (v_sped->>'aNostroCarico')::boolean,
        (v_sped->>'colli')::numeric::int,
        (v_sped->>'peso')::numeric,
        'gestionale',
        'abbinata'
      )
      RETURNING id INTO v_spedizione_id;

      FOR v_id_doc IN
        SELECT (x)::int FROM jsonb_array_elements_text(v_sped->'idDocumenti') AS x
      LOOP
        INSERT INTO vettori.spedizioni_documenti (spedizione_id, id_documento)
        VALUES (v_spedizione_id, v_id_doc)
        ON CONFLICT DO NOTHING;
      END LOOP;

      v_n_sped := v_n_sped + 1;
    ELSE
      UPDATE vettori.spedizioni
         SET stato = 'abbinata', vettore_id = coalesce(vettore_id, v_vettore_id),
             aggiornata_il = now()
       WHERE id = v_spedizione_id;
    END IF;

    v_mappa := v_mappa || jsonb_build_object(v_chiave, v_spedizione_id::text);
  END LOOP;

  -- ============================================================
  -- Righe, controlli, anomalie
  -- ============================================================
  FOR v_riga IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'righe', '[]'::jsonb))
  LOOP
    INSERT INTO vettori.fatture_righe (
      fattura_id, riga_numero, data_spedizione, numero_spedizione,
      numero_riferimento, numero_riferimento_norm, controparte_testo, direzione,
      colli, peso, peso_volumetrico, peso_tassato,
      nolo, supplementi, adeguamento, carburante, totale, dettaglio, confermata
    ) VALUES (
      v_fattura_id,
      (v_riga->>'riga_numero')::int,
      (v_riga->>'data')::date,
      v_riga->>'numero_spedizione',
      v_riga->>'riferimento',
      v_riga->>'riferimento_norm',
      v_riga->>'controparte',
      v_riga->>'direzione',
      (v_riga->>'colli')::numeric::int,
      (v_riga->>'peso')::numeric,
      (v_riga->>'peso_volumetrico')::numeric,
      (v_riga->>'peso_tassato')::numeric,
      (v_riga->>'nolo')::numeric,
      coalesce((v_riga->>'supplementi')::numeric, 0),
      coalesce((v_riga->>'adeguamento')::numeric, 0),
      coalesce((v_riga->>'carburante')::numeric, 0),
      (v_riga->>'totale')::numeric,
      coalesce(v_riga->'dettaglio', '{}'::jsonb),
      coalesce((v_riga->>'confermata')::boolean, true)
    )
    RETURNING id INTO v_riga_id;
    v_n_righe := v_n_righe + 1;

    v_spedizione_id := nullif(v_mappa->>(v_riga->>'spedizione_chiave'), '')::uuid;

    INSERT INTO vettori.controlli (
      fattura_riga_id, spedizione_id, abbinamento, abbinato_da,
      listino_id, listino_etichetta, zona_codice,
      perc_adeguamento, perc_carburante,
      peso_reale, peso_volumetrico, peso_tassabile, peso_applicato,
      atteso_nolo, atteso_imponibile, atteso_adeguamento, atteso_carburante,
      atteso_fuori_base, atteso_totale, atteso_dettaglio,
      fatturato_totale, scostamento, esito, avvertenze
    ) VALUES (
      v_riga_id,
      v_spedizione_id,
      coalesce(v_riga->>'abbinamento', 'nessuno'),
      v_utente,
      nullif(v_riga#>>'{controllo,listino_id}', '')::uuid,
      v_riga#>>'{controllo,listino_etichetta}',
      v_riga#>>'{controllo,zona_codice}',
      (v_riga#>>'{controllo,perc_adeguamento}')::numeric,
      (v_riga#>>'{controllo,perc_carburante}')::numeric,
      (v_riga#>>'{controllo,peso_reale}')::numeric,
      (v_riga#>>'{controllo,peso_volumetrico}')::numeric,
      (v_riga#>>'{controllo,peso_tassabile}')::numeric,
      v_riga#>>'{controllo,peso_applicato}',
      coalesce((v_riga#>>'{controllo,atteso_nolo}')::numeric, 0),
      coalesce((v_riga#>>'{controllo,atteso_imponibile}')::numeric, 0),
      coalesce((v_riga#>>'{controllo,atteso_adeguamento}')::numeric, 0),
      coalesce((v_riga#>>'{controllo,atteso_carburante}')::numeric, 0),
      coalesce((v_riga#>>'{controllo,atteso_fuori_base}')::numeric, 0),
      coalesce((v_riga#>>'{controllo,atteso_totale}')::numeric, 0),
      coalesce(v_riga#>'{controllo,atteso_dettaglio}', '[]'::jsonb),
      (v_riga->>'totale')::numeric,
      (v_riga#>>'{controllo,scostamento}')::numeric,
      coalesce(v_riga#>>'{controllo,esito}', 'non_valutabile'),
      coalesce(
        ARRAY(SELECT jsonb_array_elements_text(coalesce(v_riga#>'{controllo,avvertenze}', '[]'::jsonb))),
        ARRAY[]::text[]
      )
    )
    RETURNING id INTO v_controllo_id;
    v_n_controlli := v_n_controlli + 1;

    FOR v_anomalia IN SELECT * FROM jsonb_array_elements(coalesce(v_riga->'anomalie', '[]'::jsonb))
    LOOP
      INSERT INTO vettori.anomalie (
        controllo_id, spedizione_id, tipo, gravita, descrizione, importo_contestato
      ) VALUES (
        v_controllo_id,
        v_spedizione_id,
        v_anomalia->>'tipo',
        coalesce(v_anomalia->>'gravita', 'da_verificare'),
        v_anomalia->>'descrizione',
        (v_anomalia->>'importo')::numeric
      );
      v_n_anomalie := v_n_anomalie + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'fattura_id', v_fattura_id,
    'righe', v_n_righe,
    'spedizioni_nuove', v_n_sped,
    'controlli', v_n_controlli,
    'anomalie', v_n_anomalie
  );
END;
$$;

REVOKE ALL ON FUNCTION vettori.acquisisci_fattura(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.acquisisci_fattura(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION vettori.sgancia_aggancio(
  p_riga uuid,
  p_utente uuid,
  p_motivo text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_controllo vettori.controlli%ROWTYPE;
  v_spedizione vettori.spedizioni%ROWTYPE;
  v_altre integer;
  v_fattura uuid;
BEGIN
  IF coalesce(btrim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'Il motivo è obbligatorio.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_controllo FROM vettori.controlli WHERE fattura_riga_id = p_riga FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Riga di fattura senza controllo.' USING ERRCODE = 'P0001';
  END IF;
  IF v_controllo.spedizione_id IS NULL THEN
    RAISE EXCEPTION 'La riga non è agganciata a nessuna bolla.' USING ERRCODE = 'P0001';
  END IF;

  -- Il lock serializza sganci e agganci sulla stessa bolla fino al conteggio.
  SELECT * INTO v_spedizione FROM vettori.spedizioni
   WHERE id = v_controllo.spedizione_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bolla non trovata.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE vettori.controlli
     SET spedizione_id = NULL,
         abbinamento = 'assistito',
         abbinato_da = NULL
   WHERE id = v_controllo.id;

  SELECT count(*) INTO v_altre FROM vettori.controlli WHERE spedizione_id = v_controllo.spedizione_id;

  IF v_altre = 0 THEN
    UPDATE vettori.spedizioni
       SET congelata = false,
           congelata_il = NULL,
           congelata_da_controllo_id = NULL,
           aggiornata_il = now()
     WHERE id = v_controllo.spedizione_id AND congelata;

    UPDATE vettori.spedizioni
       SET stato = 'attesa', aggiornata_il = now()
     WHERE id = v_controllo.spedizione_id AND stato = 'abbinata';

    INSERT INTO vettori.spedizioni_congelamenti (spedizione_id, azione, controllo_id, utente_id, motivo)
    VALUES (v_controllo.spedizione_id, 'scongelamento', v_controllo.id, p_utente,
            'Aggancio annullato: ' || btrim(p_motivo));
  END IF;

  UPDATE vettori.agganci_proposti
     SET stato = 'scartata',
         decisa_il = now(),
         decisa_da = p_utente,
         motivo = coalesce(motivo, '') || ' [Aggancio annullato: ' || btrim(p_motivo) || ']'
   WHERE fattura_riga_id = p_riga AND stato IN ('applicata', 'proposta');

  SELECT r.fattura_id INTO v_fattura FROM vettori.fatture_righe r WHERE r.id = p_riga;
  RETURN jsonb_build_object('fattura_id', v_fattura, 'spedizione_id', v_controllo.spedizione_id, 'bolla_scongelata', v_altre = 0);
END;
$$;

REVOKE ALL ON FUNCTION vettori.sgancia_aggancio(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vettori.sgancia_aggancio(uuid, uuid, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_vettori_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_vettori_context(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';

-- VERIFICHE DOPO L'APPLICAZIONE
-- 1. Nessuna ignorata nel ramo fatturato visibile.
-- SELECT r.value->>'spedizione_id' AS spedizione_id
-- FROM jsonb_array_elements((vettori.elenco_spedizioni())->'righe') AS r(value)
-- JOIN vettori.spedizioni s ON s.id = (r.value->>'spedizione_id')::uuid
-- WHERE r.value->>'stato_fatturazione' = 'fatturata' AND s.stato = 'ignorata';
-- 2. Nessuna ignorata nella pagina completa richiesta.
-- SELECT r.value->>'spedizione_id' AS spedizione_id
-- FROM jsonb_array_elements((vettori.elenco_spedizioni(p_per_pagina => 500, p_tutte => true))->'righe') AS r(value)
-- JOIN vettori.spedizioni s ON s.id = (r.value->>'spedizione_id')::uuid
-- WHERE s.stato = 'ignorata';
-- 3. Solo service_role deve poter eseguire il contesto.
-- SELECT ruolo, has_function_privilege(ruolo, 'public.get_vettori_context(uuid)', 'EXECUTE') AS eseguibile
-- FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS t(ruolo);
-- 4. Controlli preesistenti ancora collegati a ignorate.
-- SELECT c.id, c.fattura_riga_id FROM vettori.controlli c
-- JOIN vettori.spedizioni s ON s.id = c.spedizione_id WHERE s.stato = 'ignorata';
-- 5. Bolle congelate senza controlli, da esaminare dopo gli sganci.
-- SELECT s.id, s.numero_riferimento FROM vettori.spedizioni s
-- WHERE s.congelata AND NOT EXISTS (
--   SELECT 1 FROM vettori.controlli c WHERE c.spedizione_id = s.id);
