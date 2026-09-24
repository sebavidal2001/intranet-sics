-- ════════════════════════════════════════════════════════════════════════════
-- 118 — Ordini di acquisto a fornitore per il BI (profilo pipeline "acquisti")
-- ════════════════════════════════════════════════════════════════════════════
--
-- Una riga per ogni riga d'ordine a fornitore (OF, OFT, OFR) dal 2024, con gli
-- arrivi aggregati dai DDT d'acquisto (BF) collegati per provenienza. Fonte:
-- scripts/bi-bridge/query/ACQUISTI.sql sul gestionale Impresa.
--
-- Serve a misurare fornitori e ufficio acquisti — puntualita', tempi di
-- consegna, ordini scaduti, carico di lavoro per buyer — nel Cruscotto e nel
-- briefing. Piano: docs/bi/PIANO-ACQUISTI.md.
--
-- Modello di caricamento: come lo storico costi (migration 112), staging +
-- funzione in transazione unica, ma a RICARICO DI FINESTRA: un ordine resta
-- vivo per mesi (arrivi parziali, chiusure forzate, date riconfermate), quindi
-- ogni notte il file porta tutto dal 2024 e l'ingest sostituisce ogni riga con
-- data_ordine >= alla minima del file. Le righe cancellate nel gestionale
-- spariscono anche qui.
--
-- Lo schema bi non e' esposto da PostgREST: si scrive dai wrapper public.bi_acquisti_*
-- (solo service_role) e si legge dalla vista public.bi_acquisti.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists bi.acquisti_righe (
  id_riga          bigint primary key,
  profilo          text          not null,
  numero_ordine    int,
  data_ordine      date          not null,
  creato_il        timestamp,
  codice_fornitore text,
  fornitore        text,
  buyer_utente     text,
  buyer            text,
  codice_articolo  text          not null,
  descrizione      text,
  gruppo_articoli  text,
  quantita         numeric(14,4) not null default 0,
  qta_evasa        numeric(14,4) not null default 0,
  prezzo_netto     numeric(16,6) not null default 0,
  valore           numeric(14,2) not null default 0,
  data_prevista    date,
  data_confermata  date,
  data_richiesta   date,
  riga_evasa       boolean       not null default false,
  chiusa_forzata   boolean       not null default false,
  primo_arrivo     date,
  ultimo_arrivo    date,
  qta_arrivata     numeric(14,4) not null default 0,
  run_id           text          not null,
  aggiornato_il    timestamptz   not null default now()
);
comment on table bi.acquisti_righe is
  'Righe d''ordine a fornitore (OF/OFT/OFR) dal 2024 con arrivi aggregati dai DDT BF collegati (riga_documento.id_riga_doc_provenienza). Ricaricata per finestra ogni notte.';
comment on column bi.acquisti_righe.id_riga is 'dba.riga_documento.id_riga_documento nel gestionale.';
comment on column bi.acquisti_righe.buyer_utente is
  'Utente del gestionale che ha creato l''ordine (documento.id_utente_crea). "produzione" = Daniele Mandrioli, "acquisti" = utente condiviso.';
comment on column bi.acquisti_righe.data_confermata is
  'Data di consegna confermata dal fornitore. Quando manca, la puntualita'' si misura sulla data_prevista.';
comment on column bi.acquisti_righe.primo_arrivo is
  'Data documento del primo DDT BF che evade la riga. NULL = non ancora arrivata.';

create index if not exists acquisti_righe_data_idx on bi.acquisti_righe (data_ordine);
create index if not exists acquisti_righe_fornitore_idx on bi.acquisti_righe (codice_fornitore);

create table if not exists bi.acquisti_ingest (
  run_id       text primary key,
  eseguito_il  timestamptz not null default now(),
  finestra_dal date,
  righe_lette  bigint not null default 0,
  inserite     bigint not null default 0,
  eliminate    bigint not null default 0,
  esito        text   not null default 'ok' check (esito in ('ok','fallito')),
  messaggio    text
);
comment on table bi.acquisti_ingest is 'Una riga per ogni caricamento degli ordini di acquisto.';

create unlogged table if not exists bi.acquisti_staging (
  run_id           text not null,
  id_riga          bigint,
  profilo          text,
  numero_ordine    int,
  data_ordine      date,
  creato_il        timestamp,
  codice_fornitore text,
  fornitore        text,
  buyer_utente     text,
  buyer            text,
  codice_articolo  text,
  descrizione      text,
  gruppo_articoli  text,
  quantita         numeric(14,4),
  qta_evasa        numeric(14,4),
  prezzo_netto     numeric(16,6),
  valore           numeric(14,2),
  data_prevista    date,
  data_confermata  date,
  data_richiesta   date,
  riga_evasa       boolean,
  chiusa_forzata   boolean,
  primo_arrivo     date,
  ultimo_arrivo    date,
  qta_arrivata     numeric(14,4)
);
create index if not exists acquisti_staging_run_idx on bi.acquisti_staging (run_id);

-- ── Validazione ────────────────────────────────────────────────────────────
create or replace function bi.valida_acquisti_staging(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language plpgsql
stable
as $fn$
declare v_tot bigint;
begin
  select count(*) into v_tot from bi.acquisti_staging s where s.run_id = p_run_id;
  if v_tot = 0 then
    return query select true, 'staging_vuota', 0::bigint,
      'Nessuna riga in staging per questo run: non si ingesta il vuoto'::text;
    return;
  end if;

  -- Un file molto piu' piccolo della tabella e' un'estrazione monca: caricato,
  -- cancellerebbe mezzo storico. Soglia al 50% delle righe gia' presenti nella
  -- stessa finestra.
  return query
    select true, 'file_troppo_piccolo', v_tot,
           format('Il file ha %s righe, la tabella ne ha %s nella stessa finestra', v_tot, t.n)::text
      from (
        select count(*) as n from bi.acquisti_righe r
         where r.data_ordine >= (select min(s.data_ordine) from bi.acquisti_staging s where s.run_id = p_run_id)
      ) t
     where t.n > 1000 and v_tot < t.n / 2;

  return query
    select true, 'chiave_mancante', count(*), 'Righe senza id_riga'::text
      from bi.acquisti_staging s
     where s.run_id = p_run_id and s.id_riga is null
    having count(*) > 0;

  return query
    select true, 'data_ordine_mancante', count(*), 'Righe senza data ordine'::text
      from bi.acquisti_staging s
     where s.run_id = p_run_id and s.data_ordine is null
    having count(*) > 0;

  return query
    select false, 'duplicati_in_staging', count(*), 'id_riga ripetuti nel file: si tiene il primo'::text
      from (
        select s.id_riga from bi.acquisti_staging s
         where s.run_id = p_run_id group by s.id_riga having count(*) > 1
      ) d
    having count(*) > 0;

  return query
    select false, 'senza_buyer', count(*), 'Righe senza utente creatore'::text
      from bi.acquisti_staging s
     where s.run_id = p_run_id and coalesce(btrim(s.buyer_utente), '') = ''
    having count(*) > 0;
end;
$fn$;

-- ── Ingest ─────────────────────────────────────────────────────────────────
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
    chiusa_forzata, primo_arrivo, ultimo_arrivo, qta_arrivata, run_id, aggiornato_il
  )
  select distinct on (s.id_riga)
         s.id_riga, s.profilo, s.numero_ordine, s.data_ordine, s.creato_il,
         nullif(btrim(s.codice_fornitore), ''), nullif(btrim(s.fornitore), ''),
         nullif(btrim(s.buyer_utente), ''), nullif(btrim(s.buyer), ''),
         upper(btrim(s.codice_articolo)), s.descrizione, s.gruppo_articoli,
         coalesce(s.quantita, 0), coalesce(s.qta_evasa, 0), coalesce(s.prezzo_netto, 0),
         coalesce(s.valore, 0), s.data_prevista, s.data_confermata, s.data_richiesta,
         coalesce(s.riga_evasa, false), coalesce(s.chiusa_forzata, false),
         s.primo_arrivo, s.ultimo_arrivo, coalesce(s.qta_arrivata, 0), p_run_id, now()
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

-- ── Vista di lettura per il BI ─────────────────────────────────────────────
create or replace view public.bi_acquisti as
select r.id_riga, r.profilo, r.numero_ordine, r.data_ordine, r.creato_il,
       r.codice_fornitore, r.fornitore, r.buyer_utente, r.buyer,
       r.codice_articolo, r.descrizione, r.gruppo_articoli,
       r.quantita, r.qta_evasa, r.prezzo_netto, r.valore,
       r.data_prevista, r.data_confermata, r.data_richiesta,
       r.riga_evasa, r.chiusa_forzata,
       r.primo_arrivo, r.ultimo_arrivo, r.qta_arrivata,
       r.aggiornato_il
  from bi.acquisti_righe r;
comment on view public.bi_acquisti is
  'Righe d''ordine a fornitore per lo snapshot BI. Lo schema bi non e'' esposto da PostgREST: questa vista e'' la via di lettura.';

-- ── Wrapper per la pipeline (solo service_role) ────────────────────────────
create or replace function public.bi_acquisti_run_start(p_run_id text)
returns text
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  insert into bi.acquisti_ingest (run_id) values (p_run_id)
  on conflict (run_id) do update set eseguito_il = now(), esito = 'ok', messaggio = null;
  delete from bi.acquisti_staging where run_id = p_run_id;
  return p_run_id;
end;
$fn$;

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
  insert into bi.acquisti_staging
  select p_run_id, r.id_riga, r.profilo, r.numero_ordine, r.data_ordine, r.creato_il,
         r.codice_fornitore, r.fornitore, r.buyer_utente, r.buyer, r.codice_articolo,
         r.descrizione, r.gruppo_articoli, r.quantita, r.qta_evasa, r.prezzo_netto, r.valore,
         r.data_prevista, r.data_confermata, r.data_richiesta, r.riga_evasa, r.chiusa_forzata,
         r.primo_arrivo, r.ultimo_arrivo, r.qta_arrivata
    from jsonb_populate_recordset(null::bi.acquisti_staging, p_righe) r;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function public.bi_acquisti_valida(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select v.bloccante, v.tipo, v.occorrenze, v.dettaglio from bi.valida_acquisti_staging(p_run_id) v;
$fn$;

create or replace function public.bi_acquisti_ingest(p_run_id text)
returns table (inserite bigint, eliminate bigint, finestra_dal date)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select i.inserite, i.eliminate, i.finestra_dal from bi.ingest_acquisti(p_run_id) i;
$fn$;

create or replace function public.bi_acquisti_run_fail(p_run_id text, p_messaggio text)
returns void
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  update bi.acquisti_ingest
     set esito = 'fallito', messaggio = left(coalesce(p_messaggio, ''), 2000)
   where run_id = p_run_id;
  delete from bi.acquisti_staging where run_id = p_run_id;
end;
$fn$;

-- ── Permessi ───────────────────────────────────────────────────────────────
alter table bi.acquisti_righe   enable row level security;
alter table bi.acquisti_ingest  enable row level security;
alter table bi.acquisti_staging enable row level security;

revoke all on bi.acquisti_righe   from public, anon, authenticated;
revoke all on bi.acquisti_ingest  from public, anon, authenticated;
revoke all on bi.acquisti_staging from public, anon, authenticated;
revoke all on public.bi_acquisti  from public, anon, authenticated;
revoke all on function public.bi_acquisti_run_start(text)            from public, anon, authenticated;
revoke all on function public.bi_acquisti_staging_load(text, jsonb)  from public, anon, authenticated;
revoke all on function public.bi_acquisti_valida(text)               from public, anon, authenticated;
revoke all on function public.bi_acquisti_ingest(text)               from public, anon, authenticated;
revoke all on function public.bi_acquisti_run_fail(text, text)       from public, anon, authenticated;

grant select, insert, update, delete on bi.acquisti_righe   to service_role;
grant select, insert, update, delete on bi.acquisti_ingest  to service_role;
grant select, insert, update, delete on bi.acquisti_staging to service_role;
grant select on public.bi_acquisti to service_role;
grant execute on function bi.valida_acquisti_staging(text)            to service_role;
grant execute on function bi.ingest_acquisti(text)                    to service_role;
grant execute on function public.bi_acquisti_run_start(text)          to service_role;
grant execute on function public.bi_acquisti_staging_load(text, jsonb) to service_role;
grant execute on function public.bi_acquisti_valida(text)             to service_role;
grant execute on function public.bi_acquisti_ingest(text)             to service_role;
grant execute on function public.bi_acquisti_run_fail(text, text)     to service_role;

-- Come le altre viste bi_*: leggibile da Power BI e dal motore SQL in sola
-- lettura dell'analista (bi_direzionale.query_sola_lettura gira come powerbi_reader).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'powerbi_reader') then
    grant select on public.bi_acquisti to powerbi_reader;
  end if;
end;
$$;

notify pgrst, 'reload schema';
