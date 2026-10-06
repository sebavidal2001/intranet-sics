-- ════════════════════════════════════════════════════════════════════════════
-- 140 — Anagrafica clienti da Impresa (profilo pipeline "clienti") e
--        campagne.v_clienti letta da li'
-- ════════════════════════════════════════════════════════════════════════════
--
-- PERCHE'. preventivatore.clienti_master si alimentava da un Excel esportato a
-- mano ("Cruscotto Dinamico", scripts/import-clienti-cruscotto.cjs): l'ultimo
-- caricamento e' del 25/05/2026 e nessun timer lo ripeteva. Conseguenze viste il
-- 06/10/2026: i clienti nuovi (58 attivi/potenziali) non esistono per il
-- portale, e le categorie arrivavano dalle DESTINAZIONI (una riga per
-- destinazione): un rivenditore con una destinazione "UT.FIN." veniva mostrato
-- come cliente finale. La categoria giusta e' quella dell'anagrafica principale
-- (dba.sog_commerciale).
--
-- COSA. Una riga per cliente (codice) caricata ogni notte da
-- scripts/bi-bridge/query/CLIENTI_ANAGRAFICA.sql, a SOSTITUZIONE TOTALE (e' una
-- fotografia: ~7.300 righe). Stesso modello di 118_bi_acquisti: staging +
-- funzione in transazione unica + wrapper public.* solo per service_role.
--
-- v_clienti. Legge la nuova tabella (cat. commerciale Attivo o Potenziale: gli
-- "Inutilizzabile" sono i ~3.000 che l'Excel gia' escludeva). Per i codici che la
-- tabella non conosce — e per tutti, finche' non e' stata caricata — ripiega su
-- clienti_master come prima: la migration si puo' applicare prima del primo run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists bi.clienti_anagrafica (
  codice_cliente         text primary key,
  ragione_sociale        text,
  cat_attivita_codice    text,
  cat_attivita           text,
  cat_commerciale_codice text,
  cat_commerciale        text,
  cat_zona_codice        text,
  cat_zona               text,
  agente_codice          text,
  agente                 text,
  tipo                   text        not null check (tipo in ('C', 'P')),
  attivo                 boolean     not null default true,
  creato_il              timestamp,
  modificato_il          timestamp,
  run_id                 text        not null,
  aggiornato_il          timestamptz not null default now()
);
comment on table bi.clienti_anagrafica is
  'Anagrafica clienti da Impresa (dba.sog_commerciale tipo C/P), una riga per codice, categorie dell''ANAGRAFICA PRINCIPALE. Fotografia ricaricata ogni notte.';
comment on column bi.clienti_anagrafica.tipo is 'C = cliente, P = potenziale (codici P@...).';
comment on column bi.clienti_anagrafica.cat_commerciale_codice is 'A = Attivo, P = Potenziale, I = Inutilizzabile, D = Destinazione.';
comment on column bi.clienti_anagrafica.agente is 'Gruppo agenti del cliente (sog_commerciale.id_gruppo_agenti): AIRFLUID oppure il commerciale.';

create index if not exists clienti_anagrafica_cat_com_idx on bi.clienti_anagrafica (cat_commerciale_codice);

create table if not exists bi.clienti_ingest (
  run_id       text primary key,
  eseguito_il  timestamptz not null default now(),
  righe_lette  bigint not null default 0,
  inserite     bigint not null default 0,
  nuovi        bigint not null default 0,
  eliminati    bigint not null default 0,
  esito        text   not null default 'ok' check (esito in ('ok','fallito')),
  messaggio    text
);
comment on table bi.clienti_ingest is 'Una riga per ogni caricamento dell''anagrafica clienti.';

create unlogged table if not exists bi.clienti_staging (
  run_id                 text not null,
  codice_cliente         text,
  ragione_sociale        text,
  cat_attivita_codice    text,
  cat_attivita           text,
  cat_commerciale_codice text,
  cat_commerciale        text,
  cat_zona_codice        text,
  cat_zona               text,
  agente_codice          text,
  agente                 text,
  tipo                   text,
  attivo                 boolean,
  creato_il              timestamp,
  modificato_il          timestamp
);
create index if not exists clienti_staging_run_idx on bi.clienti_staging (run_id);

-- ── Validazione ────────────────────────────────────────────────────────────
create or replace function bi.valida_clienti_staging(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language plpgsql
stable
as $fn$
declare v_tot bigint; v_esistenti bigint;
begin
  select count(*) into v_tot from bi.clienti_staging s where s.run_id = p_run_id;
  if v_tot = 0 then
    return query select true, 'staging_vuota', 0::bigint,
      'Nessuna riga in staging per questo run: non si ingesta il vuoto'::text;
    return;
  end if;

  -- E' una fotografia che SOSTITUISCE la tabella: un file molto piu' piccolo e'
  -- un'estrazione monca e cancellerebbe clienti veri.
  select count(*) into v_esistenti from bi.clienti_anagrafica;
  if v_esistenti > 500 and v_tot < v_esistenti / 2 then
    return query select true, 'file_troppo_piccolo', v_tot,
      format('Il file ha %s clienti, la tabella ne ha %s', v_tot, v_esistenti)::text;
  end if;

  return query
    select true, 'chiave_mancante', count(*), 'Righe senza codice cliente'::text
      from bi.clienti_staging s
     where s.run_id = p_run_id and coalesce(btrim(s.codice_cliente), '') = ''
    having count(*) > 0;

  return query
    select true, 'tipo_non_valido', count(*), 'tipo diverso da C/P'::text
      from bi.clienti_staging s
     where s.run_id = p_run_id and coalesce(s.tipo, '') not in ('C', 'P')
    having count(*) > 0;

  return query
    select false, 'duplicati_in_staging', count(*), 'codici ripetuti nel file: si tiene il primo'::text
      from (
        select s.codice_cliente from bi.clienti_staging s
         where s.run_id = p_run_id group by s.codice_cliente having count(*) > 1
      ) d
    having count(*) > 0;

  return query
    select false, 'senza_categoria_attivita', count(*), 'Clienti attivi/potenziali senza categoria di attivita'''::text
      from bi.clienti_staging s
     where s.run_id = p_run_id and s.cat_commerciale_codice in ('A', 'P')
       and coalesce(btrim(s.cat_attivita), '') = ''
    having count(*) > 0;
end;
$fn$;

-- ── Ingest: sostituzione totale in una transazione ─────────────────────────
create or replace function bi.ingest_clienti(p_run_id text)
returns table (inserite bigint, nuovi bigint, eliminati bigint)
language plpgsql
as $fn$
declare
  v_bloccanti int;
  v_dettaglio text;
  v_ins       bigint := 0;
  v_nuovi     bigint := 0;
  v_del       bigint := 0;
begin
  perform pg_advisory_xact_lock(hashtext('bi.ingest_clienti'));

  select count(*), string_agg(v.tipo || ': ' || v.dettaglio, '; ')
    into v_bloccanti, v_dettaglio
    from bi.valida_clienti_staging(p_run_id) v
   where v.bloccante;
  if v_bloccanti > 0 then
    raise exception 'Clienti, run %: validazione fallita (%)', p_run_id, v_dettaglio;
  end if;

  select count(*) into v_nuovi
    from (select distinct btrim(s.codice_cliente) c from bi.clienti_staging s where s.run_id = p_run_id) n
   where not exists (select 1 from bi.clienti_anagrafica a where a.codice_cliente = n.c);

  delete from bi.clienti_anagrafica;
  get diagnostics v_del = row_count;

  insert into bi.clienti_anagrafica (
    codice_cliente, ragione_sociale, cat_attivita_codice, cat_attivita, cat_commerciale_codice,
    cat_commerciale, cat_zona_codice, cat_zona, agente_codice, agente, tipo, attivo,
    creato_il, modificato_il, run_id, aggiornato_il
  )
  select distinct on (btrim(s.codice_cliente))
         btrim(s.codice_cliente), nullif(btrim(s.ragione_sociale), ''),
         nullif(btrim(s.cat_attivita_codice), ''), nullif(btrim(s.cat_attivita), ''),
         nullif(btrim(s.cat_commerciale_codice), ''), nullif(btrim(s.cat_commerciale), ''),
         nullif(btrim(s.cat_zona_codice), ''), nullif(btrim(s.cat_zona), ''),
         nullif(btrim(s.agente_codice), ''), nullif(btrim(s.agente), ''),
         s.tipo, coalesce(s.attivo, true), s.creato_il, s.modificato_il, p_run_id, now()
    from bi.clienti_staging s
   where s.run_id = p_run_id and coalesce(btrim(s.codice_cliente), '') <> ''
   order by btrim(s.codice_cliente);
  get diagnostics v_ins = row_count;

  update bi.clienti_ingest
     set righe_lette = (select count(*) from bi.clienti_staging s where s.run_id = p_run_id),
         inserite = v_ins, nuovi = v_nuovi, eliminati = v_del, esito = 'ok'
   where run_id = p_run_id;

  delete from bi.clienti_staging where run_id = p_run_id;
  return query select v_ins, v_nuovi, v_del;
end;
$fn$;

-- ── Vista di lettura per il BI ─────────────────────────────────────────────
create or replace view public.bi_clienti_anagrafica as
select c.codice_cliente, c.ragione_sociale, c.cat_attivita_codice, c.cat_attivita,
       c.cat_commerciale_codice, c.cat_commerciale, c.cat_zona_codice, c.cat_zona,
       c.agente_codice, c.agente, c.tipo, c.attivo, c.creato_il, c.modificato_il, c.aggiornato_il
  from bi.clienti_anagrafica c;
comment on view public.bi_clienti_anagrafica is
  'Anagrafica clienti di Impresa (una riga per codice). Lo schema bi non e'' esposto da PostgREST: questa vista e'' la via di lettura.';

-- ── Wrapper per la pipeline (solo service_role) ────────────────────────────
create or replace function public.bi_clienti_run_start(p_run_id text)
returns text
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  insert into bi.clienti_ingest (run_id) values (p_run_id)
  on conflict (run_id) do update set eseguito_il = now(), esito = 'ok', messaggio = null;
  delete from bi.clienti_staging where run_id = p_run_id;
  return p_run_id;
end;
$fn$;

create or replace function public.bi_clienti_staging_load(p_run_id text, p_righe jsonb)
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
  insert into bi.clienti_staging
  select p_run_id, r.codice_cliente, r.ragione_sociale, r.cat_attivita_codice, r.cat_attivita,
         r.cat_commerciale_codice, r.cat_commerciale, r.cat_zona_codice, r.cat_zona,
         r.agente_codice, r.agente, r.tipo, r.attivo, r.creato_il, r.modificato_il
    from jsonb_populate_recordset(null::bi.clienti_staging, p_righe) r;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function public.bi_clienti_valida(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select v.bloccante, v.tipo, v.occorrenze, v.dettaglio from bi.valida_clienti_staging(p_run_id) v;
$fn$;

create or replace function public.bi_clienti_ingest(p_run_id text)
returns table (inserite bigint, nuovi bigint, eliminati bigint)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select i.inserite, i.nuovi, i.eliminati from bi.ingest_clienti(p_run_id) i;
$fn$;

create or replace function public.bi_clienti_run_fail(p_run_id text, p_messaggio text)
returns void
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  update bi.clienti_ingest
     set esito = 'fallito', messaggio = left(coalesce(p_messaggio, ''), 2000)
   where run_id = p_run_id;
  delete from bi.clienti_staging where run_id = p_run_id;
end;
$fn$;

-- ── Permessi ───────────────────────────────────────────────────────────────
alter table bi.clienti_anagrafica enable row level security;
alter table bi.clienti_ingest     enable row level security;
alter table bi.clienti_staging    enable row level security;

revoke all on bi.clienti_anagrafica      from public, anon, authenticated;
revoke all on bi.clienti_ingest          from public, anon, authenticated;
revoke all on bi.clienti_staging         from public, anon, authenticated;
revoke all on public.bi_clienti_anagrafica from public, anon, authenticated;
revoke all on function public.bi_clienti_run_start(text)           from public, anon, authenticated;
revoke all on function public.bi_clienti_staging_load(text, jsonb) from public, anon, authenticated;
revoke all on function public.bi_clienti_valida(text)              from public, anon, authenticated;
revoke all on function public.bi_clienti_ingest(text)              from public, anon, authenticated;
revoke all on function public.bi_clienti_run_fail(text, text)      from public, anon, authenticated;

grant select, insert, update, delete on bi.clienti_anagrafica to service_role;
grant select, insert, update, delete on bi.clienti_ingest     to service_role;
grant select, insert, update, delete on bi.clienti_staging    to service_role;
grant select on public.bi_clienti_anagrafica to service_role;
grant execute on function bi.valida_clienti_staging(text)            to service_role;
grant execute on function bi.ingest_clienti(text)                    to service_role;
grant execute on function public.bi_clienti_run_start(text)          to service_role;
grant execute on function public.bi_clienti_staging_load(text, jsonb) to service_role;
grant execute on function public.bi_clienti_valida(text)             to service_role;
grant execute on function public.bi_clienti_ingest(text)             to service_role;
grant execute on function public.bi_clienti_run_fail(text, text)     to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'powerbi_reader') then
    grant select on public.bi_clienti_anagrafica to powerbi_reader;
  end if;
end;
$$;

-- ── campagne.v_clienti: da Impresa, con ripiego sul vecchio cruscotto ──────
-- Stesse colonne e tipi della 131 (CREATE OR REPLACE VIEW non ne ammette altre).
create or replace view campagne.v_clienti as
select i.codice_cliente::text,
       i.ragione_sociale::text,
       i.cat_commerciale::text,
       i.cat_attivita::text,
       i.cat_zona::text,
       i.agente::text                                              as agente_nome,
       (coalesce(i.cat_attivita, '') ~* '^\s*riv')                 as rivenditore
  from bi.clienti_anagrafica i
 where i.attivo and i.cat_commerciale_codice in ('A', 'P')
union all
select f.codice_cliente::text,
       f.ragione_sociale::text,
       f.cat_commerciale::text,
       f.cat_attivita::text,
       f.cat_zona::text,
       f.agente_nome::text,
       (coalesce(f.cat_attivita, '') ~* '^\s*riv')
  from (
    select distinct on (cm.codice_cliente) cm.*
      from preventivatore.clienti_master cm
     where cm.attivo
       and not exists (select 1 from bi.clienti_anagrafica a where a.codice_cliente = cm.codice_cliente)
     order by cm.codice_cliente, (cm.id_destinazione is not null), cm.created_at
  ) f;

comment on view campagne.v_clienti is
  'Un cliente per codice. Fonte: bi.clienti_anagrafica (Impresa, categorie dell''anagrafica principale, solo Attivo/Potenziale); per i codici che la tabella non conosce, e finche'' non e'' caricata, il vecchio preventivatore.clienti_master. rivenditore = Cat Attivita che inizia per RIV.';

notify pgrst, 'reload schema';
