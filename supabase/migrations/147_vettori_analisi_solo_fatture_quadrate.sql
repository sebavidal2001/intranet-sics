-- 147_vettori_analisi_solo_fatture_quadrate.sql
--
-- Perche': una fattura acquisita «senza quadratura» (con il motivo scritto
-- dall'operatore) entrava nelle analisi come confermata. Una FedEx letta in
-- parte, per esempio, abbassava il fatturato del mese e falsava il confronto
-- con il vettore proprio quando serviva per trattare.
--
-- Cosa fa: vettori.analisi esclude dai totali le righe e le anomalie delle
-- fatture con quadratura_ok = false e restituisce `fatture_non_quadrate`
-- (quante, nel periodo) perche' la pagina Analisi lo dichiari. Le fatture
-- restano in archivio e in Spedizioni, dove sono segnalate come «non
-- quadrate»: quando l'amministrazione le corregge rientrano da sole.
--
-- Verifica dopo l'applicazione:
--   SELECT vettori.analisi('2026-01-01','2026-12-31')->'fatture_non_quadrate';

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
    AND f.quadratura_ok IS NOT FALSE
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
    AND f.quadratura_ok IS NOT FALSE
    AND NOT EXISTS (SELECT 1 FROM vettori.spedizioni s WHERE s.id = coalesce(a.spedizione_id, c.spedizione_id) AND s.stato = 'ignorata')
)
SELECT jsonb_build_object(
  'da', p_da,
  'a',  p_a,
  'fatture_non_quadrate', (
    SELECT count(*) FROM vettori.fatture f
     WHERE f.data_fattura BETWEEN p_da AND p_a
       AND f.stato <> 'bozza'
       AND f.quadratura_ok IS FALSE
  ),
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

NOTIFY pgrst, 'reload schema';
