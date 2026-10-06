-- ════════════════════════════════════════════════════════════════════════════
-- 141 — Anagrafica clienti: indirizzo, controllo di freschezza e Preventivatore
-- ════════════════════════════════════════════════════════════════════════════
--
-- Segue la 140 (pipeline "clienti"). Tre cose:
--
-- 1) cap, localita, provincia dell'anagrafica principale: il Preventivatore li
--    mostra nell'elenco clienti e un cliente nuovo, senza, comparirebbe senza
--    citta'. Colonne in coda (17 in totale nel CSV).
--
-- 2) bi.clienti_health(): il semaforo dell'anagrafica (ok / attenzione /
--    critico) in base all'ultimo caricamento riuscito. Chi lo guarda e' la
--    barra in cima al portale Campagne e scripts/bi-cruscotto-stato.mjs: le
--    email dalla VM non partono (SMTP scaduto dal 29/08/2026) e il semaforo
--    esistente di bi_pipeline_health non lo lancia nessun timer, quindi un
--    allarme che non si vede non serve a niente.
--
-- 3) preventivatore.sincronizza_clienti_da_impresa(): i clienti attivi o
--    potenziali che Impresa conosce e preventivatore.clienti_master no (fermo
--    al 25/05/2026, import manuale da Excel) vengono aggiunti, UNA riga per
--    cliente, senza destinazione. Le righe esistenti NON si toccano: le
--    destinazioni, gli alias (migration 080) e i documenti che le puntano
--    restano come sono. Il conteggio dei clienti con l'agente diverso da
--    quello di Impresa si restituisce soltanto: cambiarlo cambierebbe in
--    silenzio chi vede quali preventivi (scope commerciale).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Indirizzo ───────────────────────────────────────────────────────────
alter table bi.clienti_anagrafica add column if not exists cap       text;
alter table bi.clienti_anagrafica add column if not exists localita  text;
alter table bi.clienti_anagrafica add column if not exists provincia text;
alter table bi.clienti_staging    add column if not exists cap       text;
alter table bi.clienti_staging    add column if not exists localita  text;
alter table bi.clienti_staging    add column if not exists provincia text;

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
    creato_il, modificato_il, cap, localita, provincia, run_id, aggiornato_il
  )
  select distinct on (btrim(s.codice_cliente))
         btrim(s.codice_cliente), nullif(btrim(s.ragione_sociale), ''),
         nullif(btrim(s.cat_attivita_codice), ''), nullif(btrim(s.cat_attivita), ''),
         nullif(btrim(s.cat_commerciale_codice), ''), nullif(btrim(s.cat_commerciale), ''),
         nullif(btrim(s.cat_zona_codice), ''), nullif(btrim(s.cat_zona), ''),
         nullif(btrim(s.agente_codice), ''), nullif(btrim(s.agente), ''),
         s.tipo, coalesce(s.attivo, true), s.creato_il, s.modificato_il,
         nullif(btrim(s.cap), ''), nullif(btrim(s.localita), ''), nullif(btrim(s.provincia), ''),
         p_run_id, now()
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
         r.agente_codice, r.agente, r.tipo, r.attivo, r.creato_il, r.modificato_il,
         r.cap, r.localita, r.provincia
    from jsonb_populate_recordset(null::bi.clienti_staging, p_righe) r;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace view public.bi_clienti_anagrafica as
select c.codice_cliente, c.ragione_sociale, c.cat_attivita_codice, c.cat_attivita,
       c.cat_commerciale_codice, c.cat_commerciale, c.cat_zona_codice, c.cat_zona,
       c.agente_codice, c.agente, c.tipo, c.attivo, c.creato_il, c.modificato_il, c.aggiornato_il,
       c.cap, c.localita, c.provincia
  from bi.clienti_anagrafica c;

-- ── 2) Freschezza ──────────────────────────────────────────────────────────
-- ok: ultimo caricamento riuscito entro p_max_ore. attenzione: oltre. critico:
-- oltre il doppio, o nessun caricamento. Un ultimo tentativo fallito (dopo
-- l'ultimo riuscito) porta almeno ad "attenzione" e riporta il motivo. Le
-- prove con --dry-run (esito 'fallito', messaggio "dry-run...") non contano.
create or replace function bi.clienti_health(p_max_ore numeric default 30)
returns jsonb
language plpgsql
stable
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
declare
  v_ok         timestamptz;
  v_clienti    bigint;
  v_ore        numeric;
  v_falliti    bigint;
  v_ult_fall   record;
  v_stato      text;
  v_motivi     text[] := array[]::text[];
begin
  select max(i.eseguito_il) into v_ok from bi.clienti_ingest i where i.esito = 'ok';
  select count(*) into v_clienti from bi.clienti_anagrafica;

  select count(*) into v_falliti
    from bi.clienti_ingest i
   where i.esito = 'fallito' and coalesce(i.messaggio, '') not like 'dry-run%'
     and i.eseguito_il > now() - interval '48 hours';

  select i.eseguito_il, i.messaggio into v_ult_fall
    from bi.clienti_ingest i
   where i.esito = 'fallito' and coalesce(i.messaggio, '') not like 'dry-run%'
   order by i.eseguito_il desc limit 1;

  if v_ok is null then
    v_stato := 'critico';
    v_motivi := v_motivi || 'nessun caricamento riuscito'::text;
  else
    v_ore := round(extract(epoch from now() - v_ok) / 3600.0, 1);
    if v_ore > p_max_ore * 2 then
      v_stato := 'critico';
      v_motivi := v_motivi || format('ultimo aggiornamento %s ore fa', v_ore)::text;
    elsif v_ore > p_max_ore then
      v_stato := 'attenzione';
      v_motivi := v_motivi || format('ultimo aggiornamento %s ore fa', v_ore)::text;
    else
      v_stato := 'ok';
    end if;
    if v_ult_fall.eseguito_il is not null and v_ult_fall.eseguito_il > v_ok then
      if v_stato = 'ok' then v_stato := 'attenzione'; end if;
      v_motivi := v_motivi || ('ultimo tentativo fallito: ' || coalesce(v_ult_fall.messaggio, 'senza messaggio'))::text;
    end if;
  end if;

  return jsonb_build_object(
    'stato', v_stato,
    'motivi', to_jsonb(v_motivi),
    'ultimo_aggiornamento', v_ok,
    'ore_dall_aggiornamento', v_ore,
    'clienti', v_clienti,
    'falliti_48h', v_falliti,
    'ultimo_errore', v_ult_fall.messaggio
  );
end;
$fn$;
comment on function bi.clienti_health(numeric) is
  'Semaforo dell''anagrafica clienti da Impresa: ok / attenzione / critico, con i numeri che lo motivano.';

create or replace function public.bi_clienti_health(p_max_ore numeric default 30)
returns jsonb
language sql
stable
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$ select bi.clienti_health(p_max_ore); $fn$;

-- Per il portale Campagne (client con schema campagne): soglia fissa, 30 ore =
-- il giro notturno piu' un margine.
create or replace function campagne.anagrafica_clienti_stato()
returns jsonb
language sql
stable
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$ select bi.clienti_health(30); $fn$;

-- ── 3) Preventivatore ──────────────────────────────────────────────────────
create or replace function preventivatore.sincronizza_clienti_da_impresa()
returns table (inseriti integer, agente_diverso integer)
language plpgsql
security definer
set search_path to 'preventivatore', 'bi', 'public', 'pg_temp'
as $fn$
declare
  v_ins  integer := 0;
  v_diff integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('preventivatore.sincronizza_clienti_da_impresa'));

  -- Mai su una tabella vuota: un caricamento mai fatto non deve "sincronizzare" nulla.
  if not exists (select 1 from bi.clienti_anagrafica) then
    return query select 0, 0;
    return;
  end if;

  insert into preventivatore.clienti_master (
    codice_cliente, ragione_sociale, destinazione, id_destinazione, cap, localita,
    cat_commerciale, cat_zona, cat_attivita, agente_nome, agente_codice,
    ultimo_import_il, attivo, da_validare, note
  )
  select a.codice_cliente,
         coalesce(a.ragione_sociale, a.codice_cliente),
         null, null, a.cap, a.localita,
         a.cat_commerciale, a.cat_zona, a.cat_attivita, a.agente, a.agente_codice,
         now(), true, false,
         'Aggiunto dal caricamento notturno di Impresa: anagrafica principale, senza destinazioni'
    from bi.clienti_anagrafica a
   where a.attivo and a.cat_commerciale_codice in ('A', 'P')
     and not exists (
       select 1 from preventivatore.clienti_master m where m.codice_cliente = a.codice_cliente
     );
  get diagnostics v_ins = row_count;

  select count(distinct a.codice_cliente)::integer into v_diff
    from bi.clienti_anagrafica a
    join preventivatore.clienti_master m
      on m.codice_cliente = a.codice_cliente and m.attivo and m.duplicato_di is null
   where a.cat_commerciale_codice in ('A', 'P')
     and coalesce(a.agente_codice, '') <> coalesce(m.agente_codice, '');

  return query select v_ins, v_diff;
end;
$fn$;
comment on function preventivatore.sincronizza_clienti_da_impresa() is
  'Aggiunge a clienti_master i clienti attivi/potenziali di Impresa che non ci sono (una riga per cliente, senza destinazione). Non modifica righe esistenti; restituisce quanti ne ha aggiunti e quanti clienti hanno un agente diverso da Impresa.';

create or replace function public.bi_clienti_sincronizza_preventivatore()
returns table (inseriti integer, agente_diverso integer)
language sql
security definer
set search_path to 'preventivatore', 'public', 'pg_temp'
as $fn$ select s.inseriti, s.agente_diverso from preventivatore.sincronizza_clienti_da_impresa() s; $fn$;

-- ── Permessi ───────────────────────────────────────────────────────────────
revoke all on function bi.clienti_health(numeric)                          from public, anon, authenticated;
revoke all on function public.bi_clienti_health(numeric)                   from public, anon, authenticated;
revoke all on function campagne.anagrafica_clienti_stato()                 from public, anon, authenticated;
revoke all on function preventivatore.sincronizza_clienti_da_impresa()     from public, anon, authenticated;
revoke all on function public.bi_clienti_sincronizza_preventivatore()      from public, anon, authenticated;
revoke all on public.bi_clienti_anagrafica                                 from public, anon, authenticated;

grant execute on function bi.clienti_health(numeric)                       to service_role;
grant execute on function public.bi_clienti_health(numeric)                to service_role;
grant execute on function campagne.anagrafica_clienti_stato()              to service_role;
grant execute on function preventivatore.sincronizza_clienti_da_impresa()  to service_role;
grant execute on function public.bi_clienti_sincronizza_preventivatore()   to service_role;
grant select on public.bi_clienti_anagrafica to service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'powerbi_reader') then
    grant select on public.bi_clienti_anagrafica to powerbi_reader;
  end if;
end;
$$;

notify pgrst, 'reload schema';
