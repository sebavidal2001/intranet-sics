-- ════════════════════════════════════════════════════════════════════════════
-- 150 — Fatture fornitore, condizioni di pagamento e scadenzario per il BI
-- ════════════════════════════════════════════════════════════════════════════
--
-- Tre dataset nuovi nel profilo pipeline "acquisti" (gli stessi file, lo stesso
-- ciclo notturno degli ordini a fornitore: migration 118):
--
--   fatture_fornitore    una riga per riga di fattura/nota di credito fornitore
--                        (FF, FFCEE, NAF, NAFCEE) dal 2024, con la catena
--                        FF -> BF -> OF verso l'ordine e la condizione di
--                        pagamento. Fonte: query/FATTURE_FORNITORE.sql.
--   documenti_pagamento  una riga per DOCUMENTO (preventivi, ordini e fatture
--                        di clienti e fornitori) con condizione di pagamento e
--                        giorni medi effettivi delle scadenze.
--                        Fonte: query/DOCUMENTI_PAGAMENTO.sql.
--   scadenzario          fotografia delle scadenze aperte: incassi attesi
--                        (tipo A) e pagamenti dovuti (tipo P).
--                        Fonte: query/SCADENZARIO.sql.
--
-- COSA NON C'E'. Fra ordine cliente e ordine fornitore nel gestionale non
-- esiste alcun legame (provenienza, commessa e pegging MRP sono vuoti): questi
-- dati non permettono di dire "quale acquisto serve quale ordine". Servono a
-- misurare i fornitori e i tempi di cassa, a livello aggregato.
--
-- Modello di caricamento: come gli acquisti (staging + funzione in transazione
-- unica), ma con UNA staging generica per i tre dataset (riga jsonb) invece di
-- una tabella di staging per ciascuno. Le finestre:
--   fatture_fornitore, documenti_pagamento  ricarico di finestra: si sostituisce
--       ogni riga con data_registrazione >= alla minima del file;
--   scadenzario  sostituzione integrale: e' la fotografia di oggi.
--
-- Lo schema bi non e' esposto da PostgREST: si scrive dai wrapper
-- public.bi_fornitori_* (solo service_role) e si legge dalle viste public.bi_*.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists bi.fatture_fornitore_righe (
  id_riga                bigint primary key,
  profilo                text          not null,
  numero_registrazione   int,
  numero_fattura         text,
  data_fattura           date,
  data_registrazione     date          not null,
  codice_fornitore       text,
  fornitore              text,
  codice_articolo        text,
  descrizione            text,
  gruppo_articoli        text,
  quantita               numeric(14,4) not null default 0,
  valore                 numeric(14,2) not null default 0,
  id_riga_ordine         bigint,
  profilo_ordine         text,
  numero_ordine          int,
  data_ordine            date,
  condizione_codice      text,
  condizione_descrizione text,
  id_documento           bigint,
  run_id                 text          not null,
  aggiornato_il          timestamptz   not null default now()
);
comment on table bi.fatture_fornitore_righe is
  'Righe di fatture e note di credito fornitore (FF, FFCEE, NAF, NAFCEE) dal 2024. Ricaricata per finestra ogni notte.';
comment on column bi.fatture_fornitore_righe.valore is
  'Importo di riga POSITIVO anche per le note di credito: il segno sta nella vista (colonna valore_netto).';
comment on column bi.fatture_fornitore_righe.id_riga_ordine is
  'Riga dell''ordine fornitore, risalita FF -> BF -> OF. NULL = nessun legame (spese, servizi, reclami).';
comment on column bi.fatture_fornitore_righe.profilo_ordine is
  'A cosa punta la riga: OF/OFT/OFR (ordine fornitore) o altro (RECLAVES...). NULL = nessun legame.';
create index if not exists fatture_fornitore_righe_data_idx on bi.fatture_fornitore_righe (data_registrazione);
create index if not exists fatture_fornitore_righe_fornitore_idx on bi.fatture_fornitore_righe (codice_fornitore);

create table if not exists bi.documenti_pagamento (
  id_documento           bigint primary key,
  profilo                text          not null,
  numero_registrazione   int,
  numero_documento       text,
  data_documento         date,
  data_registrazione     date          not null,
  codice_soggetto        text,
  soggetto               text,
  condizione_codice      text,
  condizione_descrizione text,
  importo_documento      numeric(14,2) not null default 0,
  n_scadenze             int           not null default 0,
  prima_scadenza         date,
  ultima_scadenza        date,
  giorni_medi            numeric(8,1),
  importo_scadenze       numeric(14,2) not null default 0,
  saldo_aperto           numeric(14,2) not null default 0,
  sconto_cassa           numeric(8,2)  not null default 0,
  run_id                 text          not null,
  aggiornato_il          timestamptz   not null default now()
);
comment on table bi.documenti_pagamento is
  'Una riga per documento (preventivi, ordini e fatture, clienti e fornitori) con la condizione di pagamento scritta sul documento e i giorni medi effettivi delle scadenze. Ricaricata per finestra ogni notte.';
comment on column bi.documenti_pagamento.giorni_medi is
  'Giorni fra data documento e scadenze, mediati sull''importo di ciascuna rata. NULL = documento senza scadenze (la maggior parte degli ordini).';
comment on column bi.documenti_pagamento.importo_scadenze is
  'Somma delle scadenze, IVA compresa; importo_documento e'' l''imponibile.';
comment on column bi.documenti_pagamento.saldo_aperto is 'Quanto resta da incassare/pagare, in valore assoluto.';
create index if not exists documenti_pagamento_data_idx on bi.documenti_pagamento (data_registrazione);
create index if not exists documenti_pagamento_soggetto_idx on bi.documenti_pagamento (codice_soggetto);

create table if not exists bi.scadenzario (
  id_scadenza       bigint primary key,
  tipo              text          not null check (tipo in ('A', 'P')),
  data_scadenza     date          not null,
  data_documento    date,
  importo           numeric(14,2) not null default 0,
  saldo             numeric(14,2) not null default 0,
  profilo           text,
  numero_documento  text,
  id_documento      bigint,
  codice_soggetto   text,
  soggetto          text,
  condizione_codice text,
  esito_pagamento   text,
  run_id            text          not null,
  aggiornato_il     timestamptz   not null default now()
);
comment on table bi.scadenzario is
  'Scadenze con saldo aperto: A = incassi attesi dai clienti, P = pagamenti ai fornitori. Fotografia di oggi, sostituita per intero ogni notte.';
comment on column bi.scadenzario.saldo is 'Negativo per le scadenze passive (da pagare); importo e'' sempre positivo.';
create index if not exists scadenzario_data_idx on bi.scadenzario (data_scadenza);

create table if not exists bi.fornitori_ingest (
  run_id       text        not null,
  dataset      text        not null check (dataset in ('fatture_fornitore', 'documenti_pagamento', 'scadenzario')),
  eseguito_il  timestamptz not null default now(),
  finestra_dal date,
  righe_lette  bigint      not null default 0,
  inserite     bigint      not null default 0,
  eliminate    bigint      not null default 0,
  esito        text        not null default 'ok' check (esito in ('ok', 'fallito')),
  messaggio    text,
  primary key (run_id, dataset)
);
comment on table bi.fornitori_ingest is 'Una riga per ogni caricamento di ciascun dataset fornitori/pagamenti.';

-- Una staging per tutti e tre: la riga resta jsonb e si tipizza all'ingest.
create unlogged table if not exists bi.fornitori_staging (
  run_id  text  not null,
  dataset text  not null,
  riga    jsonb not null
);
create index if not exists fornitori_staging_run_idx on bi.fornitori_staging (run_id, dataset);

-- ── Ingest ─────────────────────────────────────────────────────────────────
create or replace function bi.ingest_fornitori(p_run_id text, p_dataset text)
returns table (inserite bigint, eliminate bigint, finestra_dal date)
language plpgsql
as $fn$
declare
  v_tot bigint;
  v_dal date;
  v_prima bigint;
  v_ins bigint := 0;
  v_del bigint := 0;
  v_ora timestamptz := now();
  v_extra jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('bi.ingest_fornitori:' || p_dataset));

  select count(*) into v_tot from bi.fornitori_staging s where s.run_id = p_run_id and s.dataset = p_dataset;
  if v_tot = 0 then
    raise exception 'Fornitori/%, run %: nessuna riga in staging (non si ingesta il vuoto)', p_dataset, p_run_id;
  end if;

  v_extra := jsonb_build_object('run_id', p_run_id, 'aggiornato_il', v_ora);

  if p_dataset = 'fatture_fornitore' then
    select min((s.riga ->> 'data_registrazione')::date) into v_dal
      from bi.fornitori_staging s where s.run_id = p_run_id and s.dataset = p_dataset;
    if v_dal is null then
      raise exception 'Fornitori/%, run %: righe senza data_registrazione', p_dataset, p_run_id;
    end if;
    select count(*) into v_prima from bi.fatture_fornitore_righe r where r.data_registrazione >= v_dal;
    if v_prima > 1000 and v_tot < v_prima / 2 then
      raise exception 'Fornitori/%, run %: il file ha % righe, la tabella ne ha % nella stessa finestra', p_dataset, p_run_id, v_tot, v_prima;
    end if;
    delete from bi.fatture_fornitore_righe r where r.data_registrazione >= v_dal;
    get diagnostics v_del = row_count;
    insert into bi.fatture_fornitore_righe
    select distinct on (x.id_riga) x.*
      from (
        select (jsonb_populate_record(null::bi.fatture_fornitore_righe, s.riga || v_extra)).*
          from bi.fornitori_staging s where s.run_id = p_run_id and s.dataset = p_dataset
      ) x
     where x.id_riga is not null and x.data_registrazione is not null
     order by x.id_riga;
    get diagnostics v_ins = row_count;

  elsif p_dataset = 'documenti_pagamento' then
    select min((s.riga ->> 'data_registrazione')::date) into v_dal
      from bi.fornitori_staging s where s.run_id = p_run_id and s.dataset = p_dataset;
    if v_dal is null then
      raise exception 'Fornitori/%, run %: righe senza data_registrazione', p_dataset, p_run_id;
    end if;
    select count(*) into v_prima from bi.documenti_pagamento r where r.data_registrazione >= v_dal;
    if v_prima > 1000 and v_tot < v_prima / 2 then
      raise exception 'Fornitori/%, run %: il file ha % righe, la tabella ne ha % nella stessa finestra', p_dataset, p_run_id, v_tot, v_prima;
    end if;
    delete from bi.documenti_pagamento r where r.data_registrazione >= v_dal;
    get diagnostics v_del = row_count;
    insert into bi.documenti_pagamento
    select distinct on (x.id_documento) x.*
      from (
        select (jsonb_populate_record(null::bi.documenti_pagamento, s.riga || v_extra)).*
          from bi.fornitori_staging s where s.run_id = p_run_id and s.dataset = p_dataset
      ) x
     where x.id_documento is not null and x.data_registrazione is not null
     order by x.id_documento;
    get diagnostics v_ins = row_count;

  elsif p_dataset = 'scadenzario' then
    -- Fotografia: si sostituisce tutto, ma un file monco non deve svuotare la
    -- tabella (un'estrazione interrotta produrrebbe poche righe).
    select count(*) into v_prima from bi.scadenzario;
    if v_prima > 200 and v_tot < v_prima / 2 then
      raise exception 'Fornitori/%, run %: il file ha % righe, la tabella ne ha %', p_dataset, p_run_id, v_tot, v_prima;
    end if;
    delete from bi.scadenzario;
    get diagnostics v_del = row_count;
    insert into bi.scadenzario
    select distinct on (x.id_scadenza) x.*
      from (
        select (jsonb_populate_record(null::bi.scadenzario, s.riga || v_extra)).*
          from bi.fornitori_staging s where s.run_id = p_run_id and s.dataset = p_dataset
      ) x
     where x.id_scadenza is not null and x.data_scadenza is not null
     order by x.id_scadenza;
    get diagnostics v_ins = row_count;
    v_dal := null;

  else
    raise exception 'Dataset sconosciuto: %', p_dataset;
  end if;

  update bi.fornitori_ingest f
     set righe_lette = v_tot, inserite = v_ins, eliminate = v_del, finestra_dal = v_dal, esito = 'ok'
   where f.run_id = p_run_id and f.dataset = p_dataset;

  delete from bi.fornitori_staging s where s.run_id = p_run_id and s.dataset = p_dataset;
  return query select v_ins, v_del, v_dal;
end;
$fn$;

-- ── Viste di lettura ───────────────────────────────────────────────────────
create or replace view public.bi_fatture_fornitore as
select r.id_riga, r.profilo,
       (r.profilo in ('NAF', 'NAFCEE')) as nota_credito,
       r.numero_registrazione, r.numero_fattura, r.data_fattura, r.data_registrazione,
       r.codice_fornitore, r.fornitore, r.codice_articolo, r.descrizione, r.gruppo_articoli,
       case when r.profilo in ('NAF', 'NAFCEE') then -r.quantita else r.quantita end as quantita_netta,
       r.valore,
       case when r.profilo in ('NAF', 'NAFCEE') then -r.valore else r.valore end as valore_netto,
       nullif(r.id_riga_ordine, 0) as id_riga_ordine,
       nullif(r.profilo_ordine, '') as profilo_ordine,
       nullif(r.numero_ordine, 0) as numero_ordine,
       r.data_ordine,
       r.condizione_codice, r.condizione_descrizione, r.id_documento, r.aggiornato_il
  from bi.fatture_fornitore_righe r;
comment on view public.bi_fatture_fornitore is
  'Righe di fattura fornitore per il BI. valore_netto ha il segno (negativo per le note di credito). Lo schema bi non e'' esposto da PostgREST: questa vista e'' la via di lettura.';

create or replace view public.bi_documenti_pagamento as
select d.id_documento, d.profilo, d.numero_registrazione, d.numero_documento,
       d.data_documento, d.data_registrazione, d.codice_soggetto, d.soggetto,
       d.condizione_codice, d.condizione_descrizione, d.importo_documento,
       d.n_scadenze, d.prima_scadenza, d.ultima_scadenza, d.giorni_medi,
       d.importo_scadenze, d.saldo_aperto, d.sconto_cassa, d.aggiornato_il
  from bi.documenti_pagamento d;
comment on view public.bi_documenti_pagamento is
  'Condizione di pagamento e giorni medi effettivi per documento (clienti e fornitori).';

create or replace view public.bi_scadenzario as
select s.id_scadenza, s.tipo, s.data_scadenza, s.data_documento, s.importo, s.saldo,
       s.profilo, s.numero_documento, s.id_documento, s.codice_soggetto, s.soggetto,
       s.condizione_codice, s.esito_pagamento, s.aggiornato_il
  from bi.scadenzario s;
comment on view public.bi_scadenzario is
  'Scadenze aperte: tipo A = incassi attesi, tipo P = pagamenti dovuti (saldo negativo).';

-- ── Wrapper per la pipeline (solo service_role) ────────────────────────────
create or replace function public.bi_fornitori_run_start(p_run_id text, p_dataset text)
returns text
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  insert into bi.fornitori_ingest (run_id, dataset) values (p_run_id, p_dataset)
  on conflict (run_id, dataset) do update set eseguito_il = now(), esito = 'ok', messaggio = null;
  delete from bi.fornitori_staging where run_id = p_run_id and dataset = p_dataset;
  return p_run_id;
end;
$fn$;

create or replace function public.bi_fornitori_staging_load(p_run_id text, p_dataset text, p_righe jsonb)
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
  insert into bi.fornitori_staging (run_id, dataset, riga)
  select p_run_id, p_dataset, e.value from jsonb_array_elements(p_righe) e;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function public.bi_fornitori_ingest(p_run_id text, p_dataset text)
returns table (inserite bigint, eliminate bigint, finestra_dal date)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select i.inserite, i.eliminate, i.finestra_dal from bi.ingest_fornitori(p_run_id, p_dataset) i;
$fn$;

create or replace function public.bi_fornitori_run_fail(p_run_id text, p_dataset text, p_messaggio text)
returns void
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  update bi.fornitori_ingest
     set esito = 'fallito', messaggio = left(coalesce(p_messaggio, ''), 2000)
   where run_id = p_run_id and dataset = p_dataset;
  delete from bi.fornitori_staging where run_id = p_run_id and dataset = p_dataset;
end;
$fn$;

-- ── Permessi ───────────────────────────────────────────────────────────────
alter table bi.fatture_fornitore_righe enable row level security;
alter table bi.documenti_pagamento     enable row level security;
alter table bi.scadenzario             enable row level security;
alter table bi.fornitori_ingest        enable row level security;
alter table bi.fornitori_staging       enable row level security;

revoke all on bi.fatture_fornitore_righe from public, anon, authenticated;
revoke all on bi.documenti_pagamento     from public, anon, authenticated;
revoke all on bi.scadenzario             from public, anon, authenticated;
revoke all on bi.fornitori_ingest        from public, anon, authenticated;
revoke all on bi.fornitori_staging       from public, anon, authenticated;
revoke all on public.bi_fatture_fornitore  from public, anon, authenticated;
revoke all on public.bi_documenti_pagamento from public, anon, authenticated;
revoke all on public.bi_scadenzario        from public, anon, authenticated;
revoke all on function public.bi_fornitori_run_start(text, text)          from public, anon, authenticated;
revoke all on function public.bi_fornitori_staging_load(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.bi_fornitori_ingest(text, text)             from public, anon, authenticated;
revoke all on function public.bi_fornitori_run_fail(text, text, text)     from public, anon, authenticated;

grant select, insert, update, delete on bi.fatture_fornitore_righe to service_role;
grant select, insert, update, delete on bi.documenti_pagamento     to service_role;
grant select, insert, update, delete on bi.scadenzario             to service_role;
grant select, insert, update, delete on bi.fornitori_ingest        to service_role;
grant select, insert, update, delete on bi.fornitori_staging       to service_role;
grant select on public.bi_fatture_fornitore   to service_role;
grant select on public.bi_documenti_pagamento to service_role;
grant select on public.bi_scadenzario         to service_role;
grant execute on function bi.ingest_fornitori(text, text)                  to service_role;
grant execute on function public.bi_fornitori_run_start(text, text)         to service_role;
grant execute on function public.bi_fornitori_staging_load(text, text, jsonb) to service_role;
grant execute on function public.bi_fornitori_ingest(text, text)            to service_role;
grant execute on function public.bi_fornitori_run_fail(text, text, text)    to service_role;

-- Come le altre viste bi_*: leggibili da Power BI e dal motore SQL in sola
-- lettura dell'analista (gira come powerbi_reader).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'powerbi_reader') then
    grant select on public.bi_fatture_fornitore   to powerbi_reader;
    grant select on public.bi_documenti_pagamento to powerbi_reader;
    grant select on public.bi_scadenzario         to powerbi_reader;
  end if;
end;
$$;

notify pgrst, 'reload schema';
