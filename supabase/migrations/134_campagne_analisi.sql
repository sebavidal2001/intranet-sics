-- ============================================================
-- PORTALE CAMPAGNE MARKETING — Fase 3: Analisi (solo admin)
--
-- Per una campagna: ogni cliente che l'ha RICEVUTA (consegnata o consegnata al
-- banco), con gli acquisti dei N mesi prima e dei N mesi dopo la data di
-- consegna. Fonte: `public.bi_fatturato` (righe di fattura/nota di credito, gia'
-- netta dei resi: le note di credito hanno importo negativo).
--
-- Lo storico di fatturato parte dal 13/01/2025: una finestra "prima" che parte
-- prima di quella data e' INCOMPLETA, e una finestra "dopo" che finisce nel
-- futuro pure. Le funzioni lo dicono per ogni cliente (prima_completa,
-- dopo_completa) e NON lo nascondono: i totali per campagna li fa il codice
-- confrontando solo i clienti con entrambe le finestre complete.
--
-- "Prodotti promossi": `campagne.articoli_promossi` e' un elenco di codici
-- articolo. Un elemento senza asterisco e' un codice ESATTO; con l'asterisco e'
-- un prefisso/pattern (AFD.00.* = tutti i codici che iniziano per AFD.00.).
-- Maiuscole e minuscole sono uguali. Elenco vuoto = analisi dei prodotti
-- promossi non configurata (le colonne *_prom restano NULL).
--
-- Additiva e in sola lettura: nessuna tabella nuova.
-- ============================================================

-- Primo e ultimo giorno coperti dal fatturato: servono a dire quando una
-- finestra e' incompleta.
CREATE OR REPLACE FUNCTION campagne.fatturato_estremi()
RETURNS TABLE (dal date, al date)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT min(f."Data Documento")::date, max(f."Data Documento")::date
    FROM public.bi_fatturato f;
$$;

CREATE OR REPLACE FUNCTION campagne.analisi_clienti(
  p_campagna uuid,
  p_mesi     integer DEFAULT 6
)
RETURNS TABLE (
  codice_cliente  text,
  ragione_sociale text,
  agente_nome     text,
  data_invio      date,
  prima_tot       numeric,
  dopo_tot        numeric,
  prima_prom      numeric,
  dopo_prom       numeric,
  mai_prima_prom  boolean,
  prima_completa  boolean,
  dopo_completa   boolean
)
LANGUAGE sql
STABLE
SET search_path = public, campagne, pg_temp
AS $$
  WITH par AS (
    SELECT greatest(least(coalesce(p_mesi, 6), 24), 1) AS mesi,
           coalesce((SELECT array_agg(upper(replace(a, '*', '%')))
                       FROM unnest(c.articoli_promossi) a), '{}'::text[]) AS pat,
           cardinality(c.articoli_promossi) > 0 AS ha_prom
      FROM campagne.campagne c
     WHERE c.id = p_campagna
  ),
  estremi AS (SELECT dal, al FROM campagne.fatturato_estremi()),
  ricevuti AS (
    SELECT i.codice_cliente, i.data_consegna AS data_invio
      FROM campagne.invii i
     WHERE i.campagna_id = p_campagna
       AND i.stato IN ('consegnata', 'consegnata_banco')
       AND i.data_consegna IS NOT NULL
  ),
  righe AS (
    SELECT r.codice_cliente, r.data_invio, p.mesi, p.ha_prom,
           f."Data Documento"::date AS data_doc,
           f."Importo" AS importo,
           (p.ha_prom AND upper(f."Codice Articolo") LIKE ANY (p.pat)) AS promosso
      FROM ricevuti r
      CROSS JOIN par p
      JOIN public.bi_fatturato f ON f."Codice Cliente" = r.codice_cliente
  ),
  somme AS (
    SELECT g.codice_cliente,
           sum(g.importo) FILTER (WHERE g.data_doc >= (g.data_invio - make_interval(months => g.mesi))::date
                                    AND g.data_doc <  g.data_invio)                             AS prima_tot,
           sum(g.importo) FILTER (WHERE g.data_doc >= g.data_invio
                                    AND g.data_doc <  (g.data_invio + make_interval(months => g.mesi))::date) AS dopo_tot,
           sum(g.importo) FILTER (WHERE g.promosso
                                    AND g.data_doc >= (g.data_invio - make_interval(months => g.mesi))::date
                                    AND g.data_doc <  g.data_invio)                             AS prima_prom,
           sum(g.importo) FILTER (WHERE g.promosso
                                    AND g.data_doc >= g.data_invio
                                    AND g.data_doc <  (g.data_invio + make_interval(months => g.mesi))::date) AS dopo_prom,
           bool_or(g.promosso AND g.data_doc < g.data_invio AND g.importo > 0)                 AS prom_prima_mai
      FROM righe g
     GROUP BY g.codice_cliente
  )
  SELECT r.codice_cliente,
         v.ragione_sociale,
         v.agente_nome,
         r.data_invio,
         coalesce(s.prima_tot, 0),
         coalesce(s.dopo_tot, 0),
         CASE WHEN p.ha_prom THEN coalesce(s.prima_prom, 0) END,
         CASE WHEN p.ha_prom THEN coalesce(s.dopo_prom, 0) END,
         CASE WHEN p.ha_prom THEN NOT coalesce(s.prom_prima_mai, false) END,
         (r.data_invio - make_interval(months => p.mesi))::date >= e.dal,
         (r.data_invio + make_interval(months => p.mesi))::date <= e.al + 1
    FROM ricevuti r
    CROSS JOIN par p
    CROSS JOIN estremi e
    LEFT JOIN somme s ON s.codice_cliente = r.codice_cliente
    LEFT JOIN campagne.v_clienti v ON v.codice_cliente = r.codice_cliente
   ORDER BY v.ragione_sociale NULLS LAST, r.codice_cliente;
$$;

COMMENT ON FUNCTION campagne.analisi_clienti(uuid, integer) IS
  'Analisi di una campagna: per ogni cliente che l''ha ricevuta, acquisti (bi_fatturato) nei N mesi prima e dopo la consegna, totali e dei soli articoli promossi. mai_prima_prom = nessun acquisto promosso prima dell''invio nello storico disponibile. prima_completa/dopo_completa = la finestra sta dentro lo storico.';

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA campagne TO service_role;
NOTIFY pgrst, 'reload schema';
