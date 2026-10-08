-- ════════════════════════════════════════════════════════════════════════════
-- 145 — Visite dei commerciali da Impresa (profilo pipeline "clienti") e
--        coordinate per la mappa
-- ════════════════════════════════════════════════════════════════════════════
--
-- PERCHE'. Le visite stanno nel gestionale (dba.visita, ~5.900 righe dal 2014)
-- ma nessun job le estraeva: l'unica traccia era "Visite n" nel Cruscotto Excel,
-- un contatore fotografato senza date. Senza date non si disegna una giornata,
-- e senza giornata non si disegna una rotta.
--
-- COSA. Una riga per visita dal 01/01/2024, caricata ogni notte da
-- scripts/bi-bridge/query/VISITE.sql a SOSTITUZIONE TOTALE della finestra (e'
-- una fotografia: ~840 righe a ottobre 2026). Stesso modello di 140: staging +
-- funzione in transazione unica + wrapper public.* solo per service_role.
--
-- COSA NON C'E' NEL GESTIONALE (verificato l'08/10/2026):
--   · l'ORA della visita: `ora_visita` e' sempre vuota. Dentro una giornata
--     l'ordine delle tappe e' quello di registrazione (id_visita), che non e'
--     necessariamente quello del giro.
--   · l'UTENTE che ha inserito la visita: `id_utente` e' sempre nullo. Il
--     commerciale e' il gruppo agenti della visita.
--   · le COORDINATE dei clienti: latitudine/longitudine sono vuote su tutti gli
--     8.901 clienti. La mappa usa il CAP (vedi bi.cap_coordinate): nessun
--     indirizzo di cliente viene mandato a servizi esterni.
--   · la DESTINAZIONE: valorizzata in 22 visite su 5.886.
--
-- Le note libere (note, note_azienda, memo) NON si caricano.
--
-- Additivo. Rollback:
--   DROP TABLE bi.visite, bi.visite_ingest, bi.visite_staging,
--              bi.cap_coordinate, bi.provincia_coordinate CASCADE;
--   DROP VIEW public.bi_visite; DROP FUNCTION public.bi_visite_* ;
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists bi.visite (
  id_visita        integer primary key,
  data_visita      date    not null,
  codice_cliente   text    not null,
  ragione_sociale  text,
  agente_codice    text,
  agente           text,
  grado_codice     text,
  grado            text,
  tipo_codice      text,
  tipo             text,
  esito            text,
  data_prox_visita date,
  cap              text,
  localita         text,
  provincia        text,
  run_id           text        not null,
  aggiornato_il    timestamptz not null default now()
);
comment on table bi.visite is
  'Visite dei commerciali da Impresa (dba.visita) dal 2024, una riga per visita. Fotografia ricaricata ogni notte.';
comment on column bi.visite.id_visita is 'Chiave del gestionale. Dentro una giornata e'' anche l''ordine di registrazione: il gestionale non ha l''ora.';
comment on column bi.visite.agente_codice is 'Gruppo agenti della visita (il commerciale). id_utente e'' sempre nullo nel gestionale.';
comment on column bi.visite.cap is 'CAP della destinazione se la visita ne ha una, altrimenti dell''anagrafica principale.';

create index if not exists visite_data_idx   on bi.visite (data_visita);
create index if not exists visite_agente_idx on bi.visite (agente_codice, data_visita);

create table if not exists bi.visite_ingest (
  run_id       text primary key,
  eseguito_il  timestamptz not null default now(),
  righe_lette  bigint not null default 0,
  inserite     bigint not null default 0,
  eliminate    bigint not null default 0,
  esito        text   not null default 'ok' check (esito in ('ok','fallito')),
  messaggio    text
);
comment on table bi.visite_ingest is 'Una riga per ogni caricamento delle visite.';

create unlogged table if not exists bi.visite_staging (
  run_id           text not null,
  id_visita        integer,
  data_visita      date,
  codice_cliente   text,
  ragione_sociale  text,
  agente_codice    text,
  agente           text,
  grado_codice     text,
  grado            text,
  tipo_codice      text,
  tipo             text,
  esito            text,
  data_prox_visita date,
  cap              text,
  localita         text,
  provincia        text
);
create index if not exists visite_staging_run_idx on bi.visite_staging (run_id);

-- ── Validazione ────────────────────────────────────────────────────────────
create or replace function bi.valida_visite_staging(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language plpgsql
stable
as $fn$
declare v_tot bigint; v_esistenti bigint;
begin
  select count(*) into v_tot from bi.visite_staging s where s.run_id = p_run_id;
  if v_tot = 0 then
    return query select true, 'staging_vuota', 0::bigint,
      'Nessuna riga in staging per questo run: non si ingesta il vuoto'::text;
    return;
  end if;

  -- E' una fotografia che SOSTITUISCE la tabella: un file molto piu' piccolo e'
  -- un'estrazione monca e cancellerebbe visite vere.
  select count(*) into v_esistenti from bi.visite;
  if v_esistenti > 100 and v_tot < v_esistenti / 2 then
    return query select true, 'file_troppo_piccolo', v_tot,
      format('Il file ha %s visite, la tabella ne ha %s', v_tot, v_esistenti)::text;
  end if;

  return query
    select true, 'chiave_o_data_mancante', count(*), 'Righe senza id_visita o senza data'::text
      from bi.visite_staging s
     where s.run_id = p_run_id and (s.id_visita is null or s.data_visita is null)
    having count(*) > 0;

  return query
    select true, 'cliente_mancante', count(*), 'Righe senza codice cliente'::text
      from bi.visite_staging s
     where s.run_id = p_run_id and coalesce(btrim(s.codice_cliente), '') = ''
    having count(*) > 0;

  return query
    select false, 'duplicati_in_staging', count(*), 'id_visita ripetuti nel file: si tiene il primo'::text
      from (
        select s.id_visita from bi.visite_staging s
         where s.run_id = p_run_id and s.id_visita is not null
         group by s.id_visita having count(*) > 1
      ) d
    having count(*) > 0;

  return query
    select false, 'senza_cap', count(*), 'Visite senza CAP: non compaiono sulla mappa'::text
      from bi.visite_staging s
     where s.run_id = p_run_id and coalesce(btrim(s.cap), '') = ''
    having count(*) > 0;

  return query
    select false, 'senza_agente', count(*), 'Visite senza gruppo agenti'::text
      from bi.visite_staging s
     where s.run_id = p_run_id and coalesce(btrim(s.agente_codice), '') = ''
    having count(*) > 0;
end;
$fn$;

-- ── Ingest: sostituzione totale in una transazione ─────────────────────────
create or replace function bi.ingest_visite(p_run_id text)
returns table (inserite bigint, eliminate bigint)
language plpgsql
as $fn$
declare
  v_bloccanti int;
  v_dettaglio text;
  v_ins       bigint := 0;
  v_del       bigint := 0;
begin
  perform pg_advisory_xact_lock(hashtext('bi.ingest_visite'));

  select count(*), string_agg(v.tipo || ': ' || v.dettaglio, '; ')
    into v_bloccanti, v_dettaglio
    from bi.valida_visite_staging(p_run_id) v
   where v.bloccante;
  if v_bloccanti > 0 then
    raise exception 'Visite, run %: validazione fallita (%)', p_run_id, v_dettaglio;
  end if;

  delete from bi.visite;
  get diagnostics v_del = row_count;

  insert into bi.visite (
    id_visita, data_visita, codice_cliente, ragione_sociale, agente_codice, agente,
    grado_codice, grado, tipo_codice, tipo, esito, data_prox_visita,
    cap, localita, provincia, run_id, aggiornato_il
  )
  select distinct on (s.id_visita)
         s.id_visita, s.data_visita, btrim(s.codice_cliente), nullif(btrim(s.ragione_sociale), ''),
         nullif(btrim(s.agente_codice), ''), nullif(btrim(s.agente), ''),
         nullif(btrim(s.grado_codice), ''), nullif(btrim(s.grado), ''),
         nullif(btrim(s.tipo_codice), ''), nullif(btrim(s.tipo), ''),
         nullif(btrim(s.esito), ''), s.data_prox_visita,
         nullif(btrim(s.cap), ''), nullif(btrim(s.localita), ''), nullif(upper(btrim(s.provincia)), ''),
         p_run_id, now()
    from bi.visite_staging s
   where s.run_id = p_run_id and s.id_visita is not null and s.data_visita is not null
   order by s.id_visita;
  get diagnostics v_ins = row_count;

  update bi.visite_ingest
     set righe_lette = (select count(*) from bi.visite_staging s where s.run_id = p_run_id),
         inserite = v_ins, eliminate = v_del, esito = 'ok'
   where run_id = p_run_id;

  delete from bi.visite_staging where run_id = p_run_id;
  return query select v_ins, v_del;
end;
$fn$;

-- ── Coordinate: per CAP, con ripiego sul capoluogo di provincia ────────────
-- Il gestionale non ha coordinate (colonne vuote su tutti i clienti) e non si
-- geocodificano indirizzi: il punto sulla mappa e' il centro del CAP. Questo
-- vale per la maggior parte dei CAP monocomune; per le citta' con piu' CAP
-- (Bologna, Milano...) tutti i CAP della citta' cadono nello stesso punto o in
-- punti vicini: la mappa dice "per CAP", non "per via".
create table if not exists bi.cap_coordinate (
  cap       text primary key,
  lat       numeric(8,5) not null check (lat between 35 and 48),
  lon       numeric(8,5) not null check (lon between 6 and 19),
  comune    text,
  provincia text,
  origine   text not null default 'cap'
);
comment on table bi.cap_coordinate is
  'Centro di ogni CAP. Caricata con scripts/bi-carica-cap.mjs da un elenco CAP->coordinate; vuota finche'' non si carica.';

create table if not exists bi.provincia_coordinate (
  provincia text primary key,
  nome      text not null,
  lat       numeric(8,5) not null,
  lon       numeric(8,5) not null
);
comment on table bi.provincia_coordinate is
  'Capoluogo di ogni provincia: ripiego per i CAP che bi.cap_coordinate non conosce. Precisione di una citta'', non di una via.';

insert into bi.provincia_coordinate (provincia, nome, lat, lon) values
  ('AG','Agrigento',37.31,13.58),('AL','Alessandria',44.91,8.61),('AN','Ancona',43.62,13.52),
  ('AO','Aosta',45.74,7.32),('AR','Arezzo',43.46,11.88),('AP','Ascoli Piceno',42.85,13.58),
  ('AT','Asti',44.90,8.21),('AV','Avellino',40.91,14.79),('BA','Bari',41.12,16.87),
  ('BT','Barletta',41.32,16.28),('BL','Belluno',46.14,12.22),('BN','Benevento',41.13,14.78),
  ('BG','Bergamo',45.70,9.67),('BI','Biella',45.57,8.05),('BO','Bologna',44.49,11.34),
  ('BZ','Bolzano',46.50,11.35),('BS','Brescia',45.54,10.22),('BR','Brindisi',40.63,17.94),
  ('CA','Cagliari',39.22,9.12),('CL','Caltanissetta',37.49,14.06),('CB','Campobasso',41.56,14.66),
  ('CE','Caserta',41.07,14.33),('CT','Catania',37.50,15.09),('CZ','Catanzaro',38.91,16.59),
  ('CH','Chieti',42.35,14.17),('CO','Como',45.81,9.09),('CS','Cosenza',39.30,16.25),
  ('CR','Cremona',45.13,10.02),('KR','Crotone',39.08,17.13),('CN','Cuneo',44.38,7.54),
  ('EN','Enna',37.57,14.28),('FM','Fermo',43.16,13.72),('FE','Ferrara',44.84,11.62),
  ('FI','Firenze',43.77,11.25),('FG','Foggia',41.46,15.54),('FC','Forlì',44.22,12.04),
  ('FR','Frosinone',41.64,13.34),('GE','Genova',44.41,8.93),('GO','Gorizia',45.94,13.62),
  ('GR','Grosseto',42.76,11.11),('IM','Imperia',43.89,8.03),('IS','Isernia',41.59,14.23),
  ('SP','La Spezia',44.10,9.82),('AQ','L''Aquila',42.35,13.40),('LT','Latina',41.47,12.90),
  ('LE','Lecce',40.35,18.17),('LC','Lecco',45.86,9.40),('LI','Livorno',43.55,10.31),
  ('LO','Lodi',45.31,9.50),('LU','Lucca',43.84,10.50),('MC','Macerata',43.30,13.45),
  ('MN','Mantova',45.16,10.79),('MS','Massa',44.04,10.14),('MT','Matera',40.67,16.60),
  ('ME','Messina',38.19,15.55),('MI','Milano',45.46,9.19),('MO','Modena',44.65,10.93),
  ('MB','Monza',45.58,9.27),('NA','Napoli',40.85,14.27),('NO','Novara',45.45,8.62),
  ('NU','Nuoro',40.32,9.33),('OR','Oristano',39.90,8.59),('PD','Padova',45.41,11.88),
  ('PA','Palermo',38.12,13.36),('PR','Parma',44.80,10.33),('PV','Pavia',45.19,9.16),
  ('PG','Perugia',43.11,12.39),('PU','Pesaro',43.91,12.91),('PE','Pescara',42.46,14.21),
  ('PC','Piacenza',45.05,9.69),('PI','Pisa',43.72,10.40),('PT','Pistoia',43.93,10.92),
  ('PN','Pordenone',45.96,12.66),('PZ','Potenza',40.64,15.80),('PO','Prato',43.88,11.10),
  ('RG','Ragusa',36.93,14.73),('RA','Ravenna',44.42,12.20),('RC','Reggio Calabria',38.11,15.65),
  ('RE','Reggio Emilia',44.70,10.63),('RI','Rieti',42.40,12.86),('RN','Rimini',44.06,12.57),
  ('RM','Roma',41.90,12.50),('RO','Rovigo',45.07,11.79),('SA','Salerno',40.68,14.77),
  ('SS','Sassari',40.73,8.56),('SV','Savona',44.31,8.48),('SI','Siena',43.32,11.33),
  ('SR','Siracusa',37.08,15.29),('SO','Sondrio',46.17,9.87),('SU','Carbonia',39.17,8.52),
  ('TA','Taranto',40.47,17.24),('TE','Teramo',42.66,13.70),('TR','Terni',42.56,12.64),
  ('TO','Torino',45.07,7.69),('TP','Trapani',38.02,12.51),('TN','Trento',46.07,11.12),
  ('TV','Treviso',45.67,12.24),('TS','Trieste',45.65,13.78),('UD','Udine',46.06,13.24),
  ('VA','Varese',45.82,8.83),('VE','Venezia',45.44,12.32),('VB','Verbania',45.92,8.55),
  ('VC','Vercelli',45.32,8.42),('VR','Verona',45.44,10.99),('VV','Vibo Valentia',38.68,16.10),
  ('VI','Vicenza',45.55,11.55),('VT','Viterbo',42.42,12.11)
on conflict (provincia) do nothing;

-- ── Viste di lettura per il BI ─────────────────────────────────────────────
-- Lo schema bi non e' esposto da PostgREST: le viste public.* sono la via.
create or replace view public.bi_visite as
select v.id_visita, v.data_visita, v.codice_cliente, v.ragione_sociale,
       v.agente_codice, v.agente, v.grado_codice, v.grado, v.tipo_codice, v.tipo,
       v.esito, v.data_prox_visita, v.cap, v.localita, v.provincia, v.aggiornato_il
  from bi.visite v;
comment on view public.bi_visite is
  'Visite dei commerciali da Impresa dal 2024 (una riga per visita).';

-- Un solo punto per CAP: quello del CAP se noto, altrimenti il capoluogo della
-- provincia. `precisione` dice quale dei due e' stato usato: la mappa deve poterlo
-- dichiarare invece di spacciare una citta' per un indirizzo.
create or replace view public.bi_visite_punti as
select c.cap,
       coalesce(cc.lat, pp.lat)::float8 as lat,
       coalesce(cc.lon, pp.lon)::float8 as lon,
       case when cc.cap is not null then 'cap' else 'provincia' end as precisione,
       coalesce(cc.comune, max(c.localita)) as comune,
       c.provincia
  from (select distinct v.cap, v.localita, v.provincia from bi.visite v where v.cap is not null) c
  left join bi.cap_coordinate cc on cc.cap = c.cap
  left join bi.provincia_coordinate pp on pp.provincia = c.provincia
 where coalesce(cc.lat, pp.lat) is not null
 group by c.cap, cc.cap, cc.lat, cc.lon, cc.comune, pp.lat, pp.lon, c.provincia;
comment on view public.bi_visite_punti is
  'Coordinate per ogni CAP che compare nelle visite: del CAP se noto, altrimenti del capoluogo di provincia.';

-- ── Elenco degli agenti per la scelta del perimetro ─────────────────────────
-- Il modulo di assegnazione delle dashboard propone i codici agente invece di
-- farli digitare: un codice sbagliato di una cifra darebbe una dashboard vuota
-- senza spiegazione. Un agente compare nel gestionale in quattro posti (anagrafica
-- clienti, visite, ordinato, fatturato) e ognuno ne conosce solo una parte.
create or replace view public.bi_agenti as
select a.codice, max(a.nome) as nome
from (
  select btrim(c.agente_codice) as codice, c.agente as nome from bi.clienti_anagrafica c
  union all select btrim(v.agente_codice), v.agente from bi.visite v
  union all select btrim(o."Codice Agente"), o."Agente" from public.bi_ordinato o
  union all select btrim(f."Codice Agente"), f."Agente" from public.bi_fatturato f
) a
where coalesce(a.codice, '') <> '' and coalesce(a.nome, '') <> ''
group by a.codice;
comment on view public.bi_agenti is 'Codici agente noti al BI, con il nome. Alimenta la scelta del perimetro.';

create or replace view public.bi_provincia_coordinate as
select p.provincia, p.nome, p.lat::float8 as lat, p.lon::float8 as lon
  from bi.provincia_coordinate p;
comment on view public.bi_provincia_coordinate is
  'Capoluogo di ogni provincia, per la mappa quando si raggruppa per provincia.';

-- ── Wrapper per la pipeline (solo service_role) ────────────────────────────
create or replace function public.bi_visite_run_start(p_run_id text)
returns text
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  insert into bi.visite_ingest (run_id) values (p_run_id)
  on conflict (run_id) do update set eseguito_il = now(), esito = 'ok', messaggio = null;
  delete from bi.visite_staging where run_id = p_run_id;
  return p_run_id;
end;
$fn$;

create or replace function public.bi_visite_staging_load(p_run_id text, p_righe jsonb)
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
  insert into bi.visite_staging
  select p_run_id, r.id_visita, r.data_visita, r.codice_cliente, r.ragione_sociale,
         r.agente_codice, r.agente, r.grado_codice, r.grado, r.tipo_codice, r.tipo,
         r.esito, r.data_prox_visita, r.cap, r.localita, r.provincia
    from jsonb_populate_recordset(null::bi.visite_staging, p_righe) r;
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

create or replace function public.bi_visite_valida(p_run_id text)
returns table (bloccante boolean, tipo text, occorrenze bigint, dettaglio text)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select v.bloccante, v.tipo, v.occorrenze, v.dettaglio from bi.valida_visite_staging(p_run_id) v;
$fn$;

create or replace function public.bi_visite_ingest(p_run_id text)
returns table (inserite bigint, eliminate bigint)
language sql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
  select i.inserite, i.eliminate from bi.ingest_visite(p_run_id) i;
$fn$;

create or replace function public.bi_visite_run_fail(p_run_id text, p_messaggio text)
returns void
language plpgsql
security definer
set search_path to 'bi', 'public', 'pg_temp'
as $fn$
begin
  update bi.visite_ingest
     set esito = 'fallito', messaggio = left(coalesce(p_messaggio, ''), 2000)
   where run_id = p_run_id;
  delete from bi.visite_staging where run_id = p_run_id;
end;
$fn$;

-- ── Permessi ───────────────────────────────────────────────────────────────
alter table bi.visite              enable row level security;
alter table bi.visite_ingest       enable row level security;
alter table bi.visite_staging      enable row level security;
alter table bi.cap_coordinate      enable row level security;
alter table bi.provincia_coordinate enable row level security;

revoke all on bi.visite, bi.visite_ingest, bi.visite_staging,
              bi.cap_coordinate, bi.provincia_coordinate from public, anon, authenticated;
revoke all on public.bi_visite, public.bi_visite_punti, public.bi_provincia_coordinate, public.bi_agenti from public, anon, authenticated;
revoke all on function public.bi_visite_run_start(text)           from public, anon, authenticated;
revoke all on function public.bi_visite_staging_load(text, jsonb) from public, anon, authenticated;
revoke all on function public.bi_visite_valida(text)              from public, anon, authenticated;
revoke all on function public.bi_visite_ingest(text)              from public, anon, authenticated;
revoke all on function public.bi_visite_run_fail(text, text)      from public, anon, authenticated;

grant select, insert, update, delete on bi.visite, bi.visite_ingest, bi.visite_staging,
                                        bi.cap_coordinate, bi.provincia_coordinate to service_role;
grant select on public.bi_visite, public.bi_visite_punti, public.bi_provincia_coordinate, public.bi_agenti to service_role;
grant execute on function bi.valida_visite_staging(text)             to service_role;
grant execute on function bi.ingest_visite(text)                     to service_role;
grant execute on function public.bi_visite_run_start(text)           to service_role;
grant execute on function public.bi_visite_staging_load(text, jsonb) to service_role;
grant execute on function public.bi_visite_valida(text)              to service_role;
grant execute on function public.bi_visite_ingest(text)              to service_role;
grant execute on function public.bi_visite_run_fail(text, text)      to service_role;

notify pgrst, 'reload schema';
