-- 112_bi_costi_listino_storico.sql
-- ============================================================================
-- Storico del listino "Ultimo Costo" del gestionale — costo alla data di vendita
--
-- PERCHE'
--   Il margine del BI usa oggi `preventivatore.prodotti.ult_costo`, cioe'
--   l'ULTIMO costo noto, applicato anche a vendite di anni fa. Misurato sul
--   2022: margine 28,97% invece di 34,53% (-5,55 punti, -177.158 EUR). E il
--   numero cambia da solo ogni mese, perche' `ult_costo` si muove.
--   Il gestionale conserva pero' il listino costi VERSIONATO PER DATA dal 1999
--   (dba.listino 331 -> dba.variazione.data_inizio -> dba.prezzo): il costo
--   valido alla vendita e' l'ultima variazione con data_inizio <= data del
--   documento. Referto: docs/bi/REFERTO-costo-alla-vendita-20260917.md
--
-- PRINCIPI
--   * NON e' un dataset a run. I sette dataset commerciali vivono nel modello
--     run-swap (bi_activate_run sostituisce tutto ogni notte); qui i dati sono
--     CUMULATIVI e gli anni chiusi non vanno riscritti. Quindi: tabella propria
--     con chiave naturale e ingest a UPSERT.
--   * Gli anni chiusi si caricano una volta sola. Verificato sul gestionale il
--     17/09/2026: un anno si assesta entro il 31 marzo dell'anno successivo,
--     poi la deriva e' di ~4 righe su 19.000 (0,02%). La notte si ricarica solo
--     l'anno corrente, passando `p_anno_da`.
--   * Costo <= 0 non entra: nel gestionale e' un campo non compilato, non un
--     costo. Una riga a costo zero darebbe margine 100%.
--
-- ATTENZIONE AL NOME
--   `bi.costi_storico` (migration 073) e' un'ALTRA cosa: la rilevazione
--   change-only che facciamo noi dal 02/08/2026 sullo stato corrente. Questa
--   tabella e' lo storico che il gestionale aveva gia'.
--
-- Additiva e non distruttiva. Rollback in coda al file.
-- ============================================================================

-- ── 1) La tabella ───────────────────────────────────────────────────────────

create table if not exists bi.costi_listino_storico (
  codice_articolo text          not null,
  valido_dal      date          not null,
  costo           numeric(14,4) not null,
  aggiornato_il   timestamptz   not null default now(),
  primary key (codice_articolo, valido_dal),
  constraint costi_listino_storico_costo_positivo check (costo > 0)
);

-- NESSUN indice oltre alla chiave primaria, ed e' voluto.
--
-- L'accesso e' sempre "ultimo costo valido a una data, per un articolo":
--   where codice_articolo = X and valido_dal <= D order by valido_dal desc limit 1
-- Sembra chiedere un indice (codice_articolo, valido_dal DESC), e infatti nella
-- prima stesura c'era. Misurato su 402.170 righe: il planner sceglie
-- `Index Scan Backward using costi_listino_storico_pkey` con gli STESSI 4
-- buffer e lo stesso tempo. Un btree si percorre in entrambi i versi, quindi
-- la PK basta e avanza.
--
-- Costava 14 MB su 52, piu' una scrittura in piu' per ogni riga a ogni ingest.

comment on table bi.costi_listino_storico is
  'Storico del listino Ultimo Costo del gestionale (dba.listino 331), una riga per articolo e data di inizio validita''. Cumulativo: gli anni chiusi non si riscrivono. Da non confondere con bi.costi_storico (rilevazione change-only nostra, migration 073).';
comment on column bi.costi_listino_storico.codice_articolo is
  'Codice articolo NORMALIZZATO in maiuscolo e senza spazi ai bordi: stessa chiave di chiaveArticolo() in src/lib/prototipo-bi/sorgente.ts. Nessun'' altra normalizzazione, altrimenti non aggancia le righe di vendita.';
comment on column bi.costi_listino_storico.valido_dal is
  'dba.variazione.data_inizio. Il costo vale da questa data fino alla successiva: nel gestionale data_fine e'' sempre NULL su questo listino, il versionamento e'' per sola data_inizio.';

-- ── 2) Registro degli ingest ────────────────────────────────────────────────
-- Non un run-swap: solo la traccia di cosa e' stato caricato e quando, che
-- serve al controllo di freschezza e a capire se un anno chiuso e' stato
-- toccato quando non doveva.

create table if not exists bi.costi_listino_ingest (
  run_id        text primary key,
  eseguito_il   timestamptz not null default now(),
  anno_da       int,                       -- null = backfill completo
  righe_lette   bigint not null default 0,
  inserite      bigint not null default 0,
  aggiornate    bigint not null default 0,
  eliminate     bigint not null default 0,
  duplicate     bigint not null default 0,
  esito         text   not null default 'ok' check (esito in ('ok','fallito')),
  messaggio     text
);

comment on table bi.costi_listino_ingest is
  'Una riga per ogni caricamento dello storico costi. anno_da NULL = backfill completo.';

-- ── 3) Staging ──────────────────────────────────────────────────────────────

create unlogged table if not exists bi.costi_listino_staging (
  run_id          text not null,
  codice_articolo text,
  valido_dal      date,
  costo           numeric(14,4)
);

create index if not exists costi_listino_staging_run_idx
  on bi.costi_listino_staging (run_id);

comment on table bi.costi_listino_staging is
  'Atterraggio del CSV prima dell''ingest. Unlogged: si ricostruisce dal file, non vale il costo del WAL.';

-- ── 4) Validazione ──────────────────────────────────────────────────────────
-- Una riga per anomalia. bloccante = true impedisce l'ingest.

create or replace function bi.valida_costi_listino_staging(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language plpgsql
stable
as $fn$
declare v_tot bigint;
begin
  select count(*) into v_tot
    from bi.costi_listino_staging s where s.run_id = p_run_id;

  if v_tot = 0 then
    return query select true, 'staging_vuota', 0::bigint,
      'Nessuna riga in staging per questo run: non si ingesta il vuoto'::text;
    return;
  end if;

  return query
    select true, 'codice_mancante', count(*),
           'Righe senza codice articolo'::text
      from bi.costi_listino_staging s
     where s.run_id = p_run_id and coalesce(btrim(s.codice_articolo), '') = ''
    having count(*) > 0;

  return query
    select true, 'data_mancante', count(*),
           'Righe senza data di validita'''::text
      from bi.costi_listino_staging s
     where s.run_id = p_run_id and s.valido_dal is null
    having count(*) > 0;

  -- Costo assente o <= 0: NON bloccante, le righe vengono scartate.
  -- Nel gestionale e' un campo non compilato; ereditarlo come zero darebbe
  -- margine 100% su quella riga.
  return query
    select false, 'costo_non_valido', count(*),
           'Righe con costo nullo o <= 0: scartate, non caricate'::text
      from bi.costi_listino_staging s
     where s.run_id = p_run_id and coalesce(s.costo, 0) <= 0
    having count(*) > 0;

  -- Date future: il listino non dovrebbe avere variazioni in avanti.
  return query
    select false, 'data_futura', count(*),
           'Righe con data di validita'' nel futuro'::text
      from bi.costi_listino_staging s
     where s.run_id = p_run_id and s.valido_dal > current_date
    having count(*) > 0;

  return query
    select false, 'duplicati_in_staging', count(*),
           'Coppie (articolo, data) ripetute nel file: si tiene il costo maggiore'::text
      from (
        select s.codice_articolo, s.valido_dal
          from bi.costi_listino_staging s
         where s.run_id = p_run_id
         group by s.codice_articolo, s.valido_dal
        having count(*) > 1
      ) d
    having count(*) > 0;
end;
$fn$;

comment on function bi.valida_costi_listino_staging(text) is
  'Controlli sullo staging dello storico costi. Righe con bloccante=true impediscono l''ingest.';

-- ── 5) Ingest atomico ───────────────────────────────────────────────────────
--
-- p_anno_da:
--   NULL  → backfill: si scrive quello che c'e', non si cancella nulla.
--   2026  → ricarico dell'anno corrente: le righe dell'anno che NON sono piu'
--           nel file vengono eliminate (una variazione cancellata a mano nel
--           gestionale deve sparire anche qui), gli anni precedenti NON si
--           toccano nemmeno per sbaglio.

create or replace function bi.ingest_costi_listino(
  p_run_id  text,
  p_anno_da int default null
)
returns table (inserite bigint, aggiornate bigint, eliminate bigint, duplicate bigint)
language plpgsql
as $fn$
declare
  v_bloccanti  int;
  v_dettaglio  text;
  v_ins        bigint := 0;
  v_upd        bigint := 0;
  v_del        bigint := 0;
  v_dup        bigint := 0;
begin
  -- Un ingest per volta: due caricamenti concorrenti dello stesso anno si
  -- cancellerebbero le righe a vicenda fra il delete e l'upsert.
  perform pg_advisory_xact_lock(hashtext('bi.ingest_costi_listino'));

  select count(*), string_agg(v.tipo || ': ' || v.dettaglio, '; ')
    into v_bloccanti, v_dettaglio
    from bi.valida_costi_listino_staging(p_run_id) v
   where v.bloccante;

  if v_bloccanti > 0 then
    raise exception 'Storico costi, run %: validazione fallita (%)', p_run_id, v_dettaglio;
  end if;

  -- Le righe buone, normalizzate e deduplicate. Il codice va in maiuscolo e
  -- senza spazi ai bordi, e basta: qualsiasi altra normalizzazione lo
  -- scollegherebbe da "Codice Articolo" delle viste di vendita.
  create temporary table _costi_pulite on commit drop as
  select distinct on (upper(btrim(s.codice_articolo)), s.valido_dal)
         upper(btrim(s.codice_articolo)) as codice_articolo,
         s.valido_dal,
         s.costo
    from bi.costi_listino_staging s
   where s.run_id = p_run_id
     and coalesce(btrim(s.codice_articolo), '') <> ''
     and s.valido_dal is not null
     and coalesce(s.costo, 0) > 0
   order by upper(btrim(s.codice_articolo)), s.valido_dal, s.costo desc;

  -- Quante coppie ripetute c'erano nel file: informativo, il distinct on le ha
  -- gia' risolte tenendo il costo maggiore.
  select coalesce(sum(g.n - 1), 0) into v_dup
    from (
      select count(*) as n
        from bi.costi_listino_staging s2
       where s2.run_id = p_run_id
       group by upper(btrim(s2.codice_articolo)), s2.valido_dal
    ) g;

  -- Cancellazione mirata: SOLO l'anno ricaricato, e solo se richiesto.
  if p_anno_da is not null then
    delete from bi.costi_listino_storico t
     where t.valido_dal >= make_date(p_anno_da, 1, 1)
       and not exists (
         select 1 from _costi_pulite p
          where p.codice_articolo = t.codice_articolo
            and p.valido_dal = t.valido_dal
       );
    get diagnostics v_del = row_count;
  end if;

  -- `xmax = 0` distingue l'inserimento dall'aggiornamento senza contare le
  -- righe prima e dopo. Le righe il cui costo non e' cambiato non vengono
  -- toccate (clausola WHERE) e quindi non tornano affatto: `aggiornato_il`
  -- degli anni chiusi resta fermo, ed e' la prova che non li stiamo
  -- riscrivendo.
  with upsert as (
    insert into bi.costi_listino_storico as t (codice_articolo, valido_dal, costo, aggiornato_il)
    select p.codice_articolo, p.valido_dal, p.costo, now()
      from _costi_pulite p
        on conflict (codice_articolo, valido_dal) do update
           set costo = excluded.costo,
               aggiornato_il = now()
           where t.costo is distinct from excluded.costo
    returning (xmax = 0) as inserita
  )
  select count(*) filter (where inserita),
         count(*) filter (where not inserita)
    into v_ins, v_upd
    from upsert;

  update bi.costi_listino_ingest
     set righe_lette = (select count(*) from _costi_pulite),
         inserite = v_ins, aggiornate = v_upd, eliminate = v_del, duplicate = v_dup,
         esito = 'ok'
   where run_id = p_run_id;

  delete from bi.costi_listino_staging where run_id = p_run_id;

  return query select v_ins, v_upd, v_del, v_dup;
end;
$fn$;

comment on function bi.ingest_costi_listino(text, int) is
  'Staging -> storico costi, in transazione singola. p_anno_da NULL = backfill (non cancella nulla); valorizzato = ricarico di quell''anno in avanti, con cancellazione delle righe sparite dal gestionale.';

-- ── 6) La vista che legge il BI ─────────────────────────────────────────────
--
-- Lo schema `bi` NON e' esposto da PostgREST, e una query su schema non
-- esposto torna VUOTA SENZA ERRORE: senza questa vista il margine sarebbe
-- silenziosamente assente. Vedi docs/bi/.
--
-- Non espone tutto lo storico (402.000 righe dal 1999): lo snapshot lo carica
-- ogni sei ore e non gli servono i costi del 1999. Restituisce gli ultimi tre
-- anni solari PIU' la riga di apertura di ogni articolo — l'ultima precedente
-- al taglio — senza la quale una vendita di inizio periodo resterebbe senza
-- costo. Il taglio segue il calendario da solo.
--
-- ── Perche' NON filtra sugli articoli effettivamente venduti ────────────────
-- Delle 82.770 righe esposte, solo 21.759 riguardano i 6.734 articoli che
-- compaiono davvero nelle viste di vendita: le altre 61.000 sono righe di
-- apertura di articoli fermi da anni. Sembra spreco, e la variante filtrata
-- (`exists` sulle sette viste `bi_*`) e' stata scritta e MISURATA.
--
--   vista attuale   82.770 righe · 83 pagine · 14,3 s · 11 MB
--   vista filtrata  21.759 righe · 22 pagine · 39,7 s ·  2 MB
--
-- E' piu' lenta di tre volte pur leggendo un quarto dei dati: PostgREST pagina
-- a 1.000 righe e RIESEGUE la query a ogni pagina, quindi la union delle sette
-- viste si paga 22 volte (1,8 s a pagina contro 172 ms). Meno righe non vuol
-- dire piu' veloce, quando si pagina.
--
-- Se un giorno i 14 s dessero fastidio, la strada e' togliere la paginazione
-- (una funzione che restituisce tutto in un `jsonb`), non ridurre le righe.

create or replace view public.bi_costi_listino_storico as
select u.codice_articolo, u.valido_dal, u.costo
  from (
    select s.codice_articolo, s.valido_dal, s.costo
      from bi.costi_listino_storico s
     where s.valido_dal >= (date_trunc('year', now()) - interval '2 years')::date
    union all
    select a.codice_articolo, a.valido_dal, a.costo
      from (
        select distinct on (s.codice_articolo)
               s.codice_articolo, s.valido_dal, s.costo
          from bi.costi_listino_storico s
         where s.valido_dal < (date_trunc('year', now()) - interval '2 years')::date
         order by s.codice_articolo, s.valido_dal desc
      ) a
  ) u;

comment on view public.bi_costi_listino_storico is
  'Storico costi leggibile dallo snapshot BI: ultimi tre anni solari piu'' la riga di apertura per articolo. Lo schema bi non e'' esposto da PostgREST, questa vista e'' l''unica via.';

-- ── 7) Wrapper per l'ingest da PostgREST ────────────────────────────────────
-- Stesso schema della pipeline Cruscotto (migration 075): lo script node
-- chiama funzioni in `public`, mai `bi` direttamente.

create or replace function public.bi_costi_run_start(
  p_run_id  text,
  p_anno_da int default null
)
returns text
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  insert into bi.costi_listino_ingest (run_id, anno_da)
  values (p_run_id, p_anno_da)
  on conflict (run_id) do update set eseguito_il = now(), anno_da = excluded.anno_da;
  delete from bi.costi_listino_staging where run_id = p_run_id;
  return p_run_id;
end;
$fn$;

create or replace function public.bi_costi_staging_load(
  p_run_id text,
  p_righe  jsonb
)
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

  insert into bi.costi_listino_staging (run_id, codice_articolo, valido_dal, costo)
  select p_run_id, r.codice_articolo, r.valido_dal, r.costo
    from jsonb_populate_recordset(null::bi.costi_listino_staging, p_righe) r;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function public.bi_costi_valida(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select v.bloccante, v.tipo, v.occorrenze, v.dettaglio
    from bi.valida_costi_listino_staging(p_run_id) v;
$fn$;

create or replace function public.bi_costi_ingest(
  p_run_id  text,
  p_anno_da int default null
)
returns table (inserite bigint, aggiornate bigint, eliminate bigint, duplicate bigint)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select i.inserite, i.aggiornate, i.eliminate, i.duplicate
    from bi.ingest_costi_listino(p_run_id, p_anno_da) i;
$fn$;

create or replace function public.bi_costi_run_fail(p_run_id text, p_messaggio text)
returns void
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  update bi.costi_listino_ingest
     set esito = 'fallito', messaggio = left(coalesce(p_messaggio, ''), 2000)
   where run_id = p_run_id;
  delete from bi.costi_listino_staging where run_id = p_run_id;
end;
$fn$;

-- ── 8) Sicurezza ────────────────────────────────────────────────────────────
-- Stesse convenzioni della pipeline esistente: RLS accesa, nessun privilegio
-- ad anon/authenticated, tutto al solo service_role. Il vero gate sono i GRANT.

alter table bi.costi_listino_storico enable row level security;
alter table bi.costi_listino_ingest  enable row level security;
alter table bi.costi_listino_staging enable row level security;

revoke all on bi.costi_listino_storico from public, anon, authenticated;
revoke all on bi.costi_listino_ingest  from public, anon, authenticated;
revoke all on bi.costi_listino_staging from public, anon, authenticated;
revoke all on public.bi_costi_listino_storico from public, anon, authenticated;

revoke all on function public.bi_costi_run_start(text, int)      from public, anon, authenticated;
revoke all on function public.bi_costi_staging_load(text, jsonb) from public, anon, authenticated;
revoke all on function public.bi_costi_valida(text)              from public, anon, authenticated;
revoke all on function public.bi_costi_ingest(text, int)         from public, anon, authenticated;
revoke all on function public.bi_costi_run_fail(text, text)      from public, anon, authenticated;

grant select, insert, update, delete on bi.costi_listino_storico to service_role;
grant select, insert, update, delete on bi.costi_listino_ingest  to service_role;
grant select, insert, update, delete on bi.costi_listino_staging to service_role;
grant select on public.bi_costi_listino_storico to service_role;

grant execute on function bi.valida_costi_listino_staging(text)  to service_role;
grant execute on function bi.ingest_costi_listino(text, int)     to service_role;
grant execute on function public.bi_costi_run_start(text, int)      to service_role;
grant execute on function public.bi_costi_staging_load(text, jsonb) to service_role;
grant execute on function public.bi_costi_valida(text)              to service_role;
grant execute on function public.bi_costi_ingest(text, int)         to service_role;
grant execute on function public.bi_costi_run_fail(text, text)      to service_role;

notify pgrst, 'reload schema';

-- ── Rollback ────────────────────────────────────────────────────────────────
-- drop view if exists public.bi_costi_listino_storico;
-- drop function if exists public.bi_costi_run_start(text,int),
--                         public.bi_costi_staging_load(text,jsonb),
--                         public.bi_costi_valida(text),
--                         public.bi_costi_ingest(text,int),
--                         public.bi_costi_run_fail(text,text),
--                         bi.ingest_costi_listino(text,int),
--                         bi.valida_costi_listino_staging(text);
-- drop table if exists bi.costi_listino_staging, bi.costi_listino_ingest,
--                      bi.costi_listino_storico;
