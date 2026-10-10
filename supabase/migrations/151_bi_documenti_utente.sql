-- ════════════════════════════════════════════════════════════════════════════
-- 151 — Documenti per utente creatore: il carico di lavoro vero
-- ════════════════════════════════════════════════════════════════════════════
--
-- Un dataset in piu' nel profilo pipeline "acquisti" (stesso ciclo notturno e
-- stesso script di caricamento della migration 150): una riga per DOCUMENTO
-- (preventivi, ordini, bolle e fatture, di clienti e fornitori) dal 2024, con
-- l'utente del gestionale che lo ha creato e la data/ora di creazione. Fonte:
-- scripts/bi-bridge/query/DOCUMENTI_UTENTE.sql.
--
-- Serve al Personale › Backoffice del builder: quanti documenti di ogni tipo
-- crea ogni persona o ufficio, per giorno, settimana, mese.
--
-- ATTENZIONE: alcuni utenti sono condivisi («vendite», «segreteria»,
-- «amministrazione», «acquisti», «magazzino1», «magazzino2»): sono ruoli, non
-- persone.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists bi.documenti_utente (
  id_documento         bigint primary key,
  profilo              text          not null,
  numero_registrazione int,
  data_registrazione   date          not null,
  data_creazione       timestamp,
  codice_utente        text,
  utente               text,
  n_righe              int           not null default 0,
  importo_documento    numeric(14,2) not null default 0,
  codice_soggetto      text,
  soggetto             text,
  run_id               text          not null,
  aggiornato_il        timestamptz   not null default now()
);
comment on table bi.documenti_utente is
  'Una riga per documento dal 2024 con l''utente del gestionale che l''ha creato. Ricaricata per finestra ogni notte.';
comment on column bi.documenti_utente.codice_utente is
  'Utente di accesso al gestionale. Alcuni sono condivisi (vendite, segreteria, amministrazione, acquisti, magazzino1/2): ruoli, non persone.';
comment on column bi.documenti_utente.n_righe is 'Righe del documento: il lavoro di inserimento.';
create index if not exists documenti_utente_data_idx on bi.documenti_utente (data_registrazione);
create index if not exists documenti_utente_utente_idx on bi.documenti_utente (codice_utente);

alter table bi.fornitori_ingest drop constraint if exists fornitori_ingest_dataset_check;
alter table bi.fornitori_ingest add constraint fornitori_ingest_dataset_check
  check (dataset in ('fatture_fornitore', 'documenti_pagamento', 'scadenzario', 'documenti_utente'));

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

  elsif p_dataset = 'documenti_utente' then
    select min((s.riga ->> 'data_registrazione')::date) into v_dal
      from bi.fornitori_staging s where s.run_id = p_run_id and s.dataset = p_dataset;
    if v_dal is null then
      raise exception 'Fornitori/%, run %: righe senza data_registrazione', p_dataset, p_run_id;
    end if;
    select count(*) into v_prima from bi.documenti_utente r where r.data_registrazione >= v_dal;
    if v_prima > 1000 and v_tot < v_prima / 2 then
      raise exception 'Fornitori/%, run %: il file ha % righe, la tabella ne ha % nella stessa finestra', p_dataset, p_run_id, v_tot, v_prima;
    end if;
    delete from bi.documenti_utente r where r.data_registrazione >= v_dal;
    get diagnostics v_del = row_count;
    insert into bi.documenti_utente
    select distinct on (x.id_documento) x.*
      from (
        select (jsonb_populate_record(null::bi.documenti_utente, s.riga || v_extra)).*
          from bi.fornitori_staging s where s.run_id = p_run_id and s.dataset = p_dataset
      ) x
     where x.id_documento is not null and x.data_registrazione is not null
     order by x.id_documento;
    get diagnostics v_ins = row_count;

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

create or replace view public.bi_documenti_utente as
select d.id_documento, d.profilo, d.numero_registrazione, d.data_registrazione, d.data_creazione,
       d.codice_utente, d.utente, d.n_righe, d.importo_documento, d.codice_soggetto, d.soggetto,
       d.aggiornato_il
  from bi.documenti_utente d
 -- Ordine stabile: PostgREST legge a pagine da 1.000.
 order by d.id_documento;
comment on view public.bi_documenti_utente is
  'Documenti per utente creatore: il carico di lavoro di ogni persona e ufficio.';

alter table bi.documenti_utente enable row level security;
revoke all on bi.documenti_utente from public, anon, authenticated;
revoke all on public.bi_documenti_utente from public, anon, authenticated;
grant select, insert, update, delete on bi.documenti_utente to service_role;
grant select on public.bi_documenti_utente to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'powerbi_reader') then
    grant select on public.bi_documenti_utente to powerbi_reader;
  end if;
end;
$$;

notify pgrst, 'reload schema';
