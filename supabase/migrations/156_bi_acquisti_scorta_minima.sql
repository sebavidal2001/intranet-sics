-- ════════════════════════════════════════════════════════════════════════════
-- 156 — Scorta minima sulle righe d'ordine a fornitore
-- ════════════════════════════════════════════════════════════════════════════
--
-- Richiesta dell'ufficio acquisti (18/10/2026): nella tabella della dashboard
-- «Acquisti» accanto all'articolo serve la scorta minima.
--
-- La scorta viene dal gestionale (dba.scorta, agganciata all'articolo tramite
-- l'unita' di confezione, vedi scripts/bi-bridge/query/ACQUISTI.sql) ed e' la
-- 25a colonna del file notturno. E' lo stato di OGGI dell'anagrafica, ripetuto
-- su ogni riga d'ordine dello stesso articolo: non e' storicizzata.
-- NULL = nessuna scorta minima impostata (nel gestionale vale 0).
--
-- Additiva:
--   * colonna in coda a bi.acquisti_righe e bi.acquisti_staging;
--   * bi_acquisti_staging_load e bi.ingest_acquisti riscritte per portarla;
--   * public.bi_acquisti con la colonna in coda (CREATE OR REPLACE VIEW accetta
--     solo colonne nuove in fondo; i permessi restano quelli della vista).
--
-- Compatibilita': un file a 24 colonne (query vecchia ancora sul server
-- gestionale) si carica lo stesso, con scorta NULL. Va applicata PRIMA del
-- deploy del codice: lo script di ingest nuovo manda il campo scorta_minima.
--
-- Rollback: ricreare vista e funzioni da 153 / 118 e poi
--   alter table bi.acquisti_righe drop column scorta_minima;
--   alter table bi.acquisti_staging drop column scorta_minima;
-- ════════════════════════════════════════════════════════════════════════════

alter table bi.acquisti_righe   add column if not exists scorta_minima numeric(14,4);
alter table bi.acquisti_staging add column if not exists scorta_minima numeric(14,4);

comment on column bi.acquisti_righe.scorta_minima is
  'Scorta minima dell''articolo nel gestionale al momento dell''estrazione (dba.scorta via unita_confezione, la maggiore se piu'' righe). NULL = non impostata.';

create or replace function public.bi_acquisti_staging_load(p_run_id text, p_righe jsonb)
returns bigint
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
declare v_n bigint;
begin
  if jsonb_typeof(p_righe) <> 'array' then
    raise exception 'p_righe deve essere un array JSON';
  end if;
  insert into bi.acquisti_staging (
    run_id, id_riga, profilo, numero_ordine, data_ordine, creato_il,
    codice_fornitore, fornitore, buyer_utente, buyer, codice_articolo,
    descrizione, gruppo_articoli, quantita, qta_evasa, prezzo_netto, valore,
    data_prevista, data_confermata, data_richiesta, riga_evasa, chiusa_forzata,
    primo_arrivo, ultimo_arrivo, qta_arrivata, scorta_minima
  )
  select p_run_id, r.id_riga, r.profilo, r.numero_ordine, r.data_ordine, r.creato_il,
         r.codice_fornitore, r.fornitore, r.buyer_utente, r.buyer, r.codice_articolo,
         r.descrizione, r.gruppo_articoli, r.quantita, r.qta_evasa, r.prezzo_netto, r.valore,
         r.data_prevista, r.data_confermata, r.data_richiesta, r.riga_evasa, r.chiusa_forzata,
         r.primo_arrivo, r.ultimo_arrivo, r.qta_arrivata, r.scorta_minima
    from jsonb_populate_recordset(null::bi.acquisti_staging, p_righe) r;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function bi.ingest_acquisti(p_run_id text)
returns table (inserite bigint, eliminate bigint, finestra_dal date)
language plpgsql
as $fn$
declare
  v_bloccanti int;
  v_dettaglio text;
  v_dal       date;
  v_ins       bigint := 0;
  v_del       bigint := 0;
begin
  perform pg_advisory_xact_lock(hashtext('bi.ingest_acquisti'));

  select count(*), string_agg(v.tipo || ': ' || v.dettaglio, '; ')
    into v_bloccanti, v_dettaglio
    from bi.valida_acquisti_staging(p_run_id) v
   where v.bloccante;
  if v_bloccanti > 0 then
    raise exception 'Acquisti, run %: validazione fallita (%)', p_run_id, v_dettaglio;
  end if;

  -- La finestra esce dal FILE, non da un parametro: stessa lezione dei costi.
  select min(s.data_ordine) into v_dal from bi.acquisti_staging s where s.run_id = p_run_id;

  delete from bi.acquisti_righe r where r.data_ordine >= v_dal;
  get diagnostics v_del = row_count;

  insert into bi.acquisti_righe (
    id_riga, profilo, numero_ordine, data_ordine, creato_il, codice_fornitore, fornitore,
    buyer_utente, buyer, codice_articolo, descrizione, gruppo_articoli, quantita, qta_evasa,
    prezzo_netto, valore, data_prevista, data_confermata, data_richiesta, riga_evasa,
    chiusa_forzata, primo_arrivo, ultimo_arrivo, qta_arrivata, scorta_minima, run_id, aggiornato_il
  )
  select distinct on (s.id_riga)
         s.id_riga, s.profilo, s.numero_ordine, s.data_ordine, s.creato_il,
         nullif(btrim(s.codice_fornitore), ''), nullif(btrim(s.fornitore), ''),
         nullif(btrim(s.buyer_utente), ''), nullif(btrim(s.buyer), ''),
         upper(btrim(s.codice_articolo)), s.descrizione, s.gruppo_articoli,
         coalesce(s.quantita, 0), coalesce(s.qta_evasa, 0), coalesce(s.prezzo_netto, 0),
         coalesce(s.valore, 0), s.data_prevista, s.data_confermata, s.data_richiesta,
         coalesce(s.riga_evasa, false), coalesce(s.chiusa_forzata, false),
         s.primo_arrivo, s.ultimo_arrivo, coalesce(s.qta_arrivata, 0),
         nullif(s.scorta_minima, 0), p_run_id, now()
    from bi.acquisti_staging s
   where s.run_id = p_run_id and s.id_riga is not null and s.data_ordine is not null
   order by s.id_riga;
  get diagnostics v_ins = row_count;

  update bi.acquisti_ingest
     set righe_lette = (select count(*) from bi.acquisti_staging s where s.run_id = p_run_id),
         inserite = v_ins, eliminate = v_del, finestra_dal = v_dal, esito = 'ok'
   where run_id = p_run_id;

  delete from bi.acquisti_staging where run_id = p_run_id;
  return query select v_ins, v_del, v_dal;
end;
$fn$;

create or replace view public.bi_acquisti as
with anagrafica as (
  select upper(btrim(a."Codice Articolo")) as codice,
         max(nullif(btrim(a."Categoria"), '')) as categoria,
         max(nullif(btrim(a."Gruppo"), ''))    as gruppo
    from public.bi_articoli_corrente a
   group by 1
)
select r.id_riga, r.profilo, r.numero_ordine, r.data_ordine, r.creato_il,
       r.codice_fornitore, r.fornitore, r.buyer_utente, r.buyer,
       r.codice_articolo, r.descrizione, r.gruppo_articoli,
       r.quantita, r.qta_evasa, r.prezzo_netto, r.valore,
       r.data_prevista, r.data_confermata, r.data_richiesta,
       r.riga_evasa, r.chiusa_forzata,
       r.primo_arrivo, r.ultimo_arrivo, r.qta_arrivata,
       r.aggiornato_il,
       coalesce(g.categoria, '-') as categoria,
       case
         when upper(g.categoria) in ('COSTRUITO', 'STRUTTURE') then upper(g.categoria)
         when coalesce(g.gruppo, nullif(btrim(r.gruppo_articoli), '')) = 'SISTEMI' then 'COSTRUITO'
         else coalesce(g.gruppo, nullif(btrim(r.gruppo_articoli), ''), '-')
       end as business_unit,
       r.scorta_minima
  from bi.acquisti_righe r
  left join anagrafica g on g.codice = r.codice_articolo;

comment on view public.bi_acquisti is
  'Righe d''ordine a fornitore per lo snapshot BI, con categoria e business unit dell''articolo (migration 153) e scorta minima (migration 156). Lo schema bi non e'' esposto da PostgREST: questa vista e'' la via di lettura.';

notify pgrst, 'reload schema';
