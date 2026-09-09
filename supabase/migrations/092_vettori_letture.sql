-- 092_vettori_letture.sql
--
-- Le due letture che l'applicazione non può fare da sola: l'elenco delle
-- anomalie e l'analisi per vettore.
--
-- Tutto il resto del portale interroga una tabella per volta e passa dal client
-- con `service_role`. Queste due no, e per motivi diversi:
--
--   ELENCO ANOMALIE — la catena è anomalia → controllo → riga → fattura →
--   vettore, più la spedizione agganciata. Ricostruirla lato applicazione
--   significa cinque chiamate e un join fatto a mano in TypeScript, che è il
--   posto peggiore per farlo: basta una riga senza controllo e l'anomalia
--   sparisce dall'elenco invece di comparire incompleta.
--
--   ANALISI — è un'aggregazione. Portarsi in memoria tutte le righe di un anno
--   per contarle è lo stesso lavoro fatto nel posto sbagliato.
--
-- Sono `STABLE` e non scrivono niente: `EXECUTE` solo a `service_role`, come
-- tutto il resto dello schema.

-- ============================================================
-- 1) ELENCO DELLE ANOMALIE
-- ============================================================
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
    WHERE (p_stati   IS NULL OR a.stato = ANY (p_stati))
      AND (p_vettore IS NULL OR v.codice = p_vettore)
      AND (p_da      IS NULL OR f.data_fattura >= p_da)
      AND (p_a       IS NULL OR f.data_fattura <= p_a)
    ORDER BY (a.stato = 'aperta') DESC, a.creata_il DESC
    LIMIT p_limite
  ) t;
$fn$;

COMMENT ON FUNCTION vettori.elenco_anomalie(text[], text, date, date, int) IS
  'Anomalie con il contesto già ricomposto: riga di fattura, vettore, spedizione agganciata e costo atteso. I join sono LEFT di proposito — un''anomalia senza controllo deve comparire incompleta, non sparire.';

-- ============================================================
-- 2) ANALISI PER VETTORE E PER MESE
-- ============================================================
-- Serve a trattare col fornitore, quindi conta quello che si può mettere su un
-- tavolo: quanto è stato fatturato, quanto sarebbe dovuto costare, quante
-- spedizioni e quanti colli, e quante volte i conti non tornano.
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

COMMENT ON FUNCTION vettori.analisi(date, date) IS
  'Aggregati per vettore e per mese sul periodo: spedizioni, colli, chilogrammi, fatturato contro atteso, esiti e importo contestato. Esclude le fatture in bozza — quelle che non quadrano non devono entrare in una statistica usata per trattare.';

-- ============================================================
-- 3) PERMESSI
-- ============================================================
REVOKE ALL ON FUNCTION vettori.elenco_anomalie(text[], text, date, date, int)
  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION vettori.analisi(date, date)
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION vettori.elenco_anomalie(text[], text, date, date, int)
  TO service_role;
GRANT EXECUTE ON FUNCTION vettori.analisi(date, date)
  TO service_role;

NOTIFY pgrst, 'reload schema';
