-- 104_bi_motore_sql_e_analisi.sql
--
-- Fase 1 del passaggio in produzione del BI Direzionale — terzo pezzo.
--
-- Due cose:
--   A) il motore SQL esplorativo, riservato alla direzione;
--   B) le analisi e le dashboard salvate dagli utenti (servono alla Fase 3).
--
-- ============================================================================
-- NOTA SULLA NUMERAZIONE — leggere prima di cercare la 086
-- ============================================================================
-- Il motore SQL esisteva gia' come `086_prototipo_bi_sql_sola_lettura.sql`,
-- scritto il 29/08/2026 e **mai applicato da nessuna parte**. Quel file non e'
-- mai stato committato: nella sequenza la 085 e la 087 sono tracciate e la 086
-- e' un buco. Riprenderlo con quel numero avrebbe creato una migration che
-- appare "vecchia" pur essendo nuova, in mezzo a trenta migration successive
-- gia' applicate.
--
-- Il contenuto e' quello, invariato nella sostanza. Il file 086 va cancellato
-- dopo l'applicazione di questa.
--
-- ============================================================================
-- A) MOTORE SQL — perche' e' difendibile
-- ============================================================================
-- La query arriva come testo, anche dall'analista AI. La difesa non e' il
-- filtro testuale (le regex si aggirano), e' il RUOLO: la funzione gira come
-- `powerbi_reader`, che possiede esclusivamente SELECT sulle viste BI.
-- Verificato sul database di produzione il 12/09/2026: ZERO privilegi di
-- INSERT/UPDATE/DELETE/TRUNCATE su qualunque oggetto, non e' membro di altri
-- ruoli, non e' superuser. Anche bucando ogni controllo di questo file, non
-- c'e' un privilegio di scrittura da rubare.
--
-- NB: il ruolo HA il login abilitato — Power BI ci si collega in diretta al
-- database. Non e' un NOLOGIN, ed e' giusto cosi'.
--
-- Il filtro testuale resta come primo sbarramento, in doppia copia: qui e in
-- src/lib/prototipo-bi/sql.ts. Due implementazioni della stessa regola in due
-- linguaggi diversi e' ridondanza voluta.
--
-- L'accesso e' comunque chiuso a monte: `/api/prototipo-bi/sql` risponde 403 a
-- chi non ha livello direzione, e l'analista non riceve nemmeno lo strumento.
-- Chi ha un perimetro di riga non arriva mai qui, perche' dentro una SELECT
-- arbitraria un perimetro non si puo' imporre.
-- ============================================================================

-- Precondizione. `powerbi_reader` non e' creato da nessuna migration: e' un
-- ruolo preesistente, usato dalla 074 e da 23 GRANT dello schema, e replicato
-- a mano sul PostgreSQL della VM. Senza di lui questa migration fallirebbe su
-- `alter function ... owner to` con un "role does not exist" che non spiega
-- niente a chi la sta applicando alle 19 di sera.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'powerbi_reader') then
    raise exception
      'Il ruolo powerbi_reader non esiste su questo database. E'' il ruolo con cui gira il motore SQL del BI (sola SELECT sulle viste) ed e'' lo stesso con cui Power BI si collega. Crearlo prima: CREATE ROLE powerbi_reader LOGIN NOINHERIT PASSWORD ''...'';';
  end if;
end $$;

create or replace function bi_direzionale.query_sola_lettura(
  p_sql text,
  p_limite integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, powerbi, pg_temp
set statement_timeout = '8s'
as $function$
declare
  v_sql text;
  v_limite integer := greatest(1, least(coalesce(p_limite, 200), 501));
  v_righe jsonb;
begin
  v_sql := btrim(coalesce(p_sql, ''));
  v_sql := regexp_replace(v_sql, ';\s*$', '');

  if v_sql = '' or length(v_sql) > 20000 then
    raise exception 'SQL assente o troppo lungo';
  end if;
  if v_sql !~* '^(select|with)\M' then
    raise exception 'Sono consentiti solo SELECT o WITH';
  end if;
  if strpos(v_sql, ';') > 0 or v_sql ~ '(--|/\*)' then
    raise exception 'È consentita una sola istruzione, senza commenti';
  end if;
  if v_sql ~* '\m(insert|update|delete|merge|upsert|drop|alter|truncate|create|replace|grant|revoke|comment|copy|call|do|execute|prepare|deallocate|set|reset|listen|notify|vacuum|analyze|refresh|reindex|cluster|lock|into)\M' then
    raise exception 'Comando non consentito in sola lettura';
  end if;
  if v_sql ~* '\m(pg_catalog|information_schema|auth\.|storage\.|vault\.|realtime\.|net\.|extensions\.|pg_sleep|generate_series|dblink|lo_import|lo_export)' then
    raise exception 'Schema o funzione non autorizzati';
  end if;

  execute format(
    'select coalesce(jsonb_agg(to_jsonb(q)), ''[]''::jsonb) from (select * from (%s) raw_query limit %s) q',
    v_sql,
    v_limite
  ) into v_righe;
  return coalesce(v_righe, '[]'::jsonb);
end;
$function$;

-- Il proprietario effettivo e' il ruolo gia' usato da Power BI: la funzione
-- non eredita i privilegi di chi applica la migration. E' il punto su cui
-- poggia tutta la difesa, quindi non e' saltabile.
--
-- Per cedere la proprieta' a un ruolo bisogna poterne fare SET ROLE, cioe'
-- esserne membro. Sul PostgreSQL della VM chi applica e' superuser e la cosa
-- e' implicita; su Supabase gestito `postgres` NON e' superuser e la stessa
-- istruzione fallisce con:
--     42501: must be able to SET ROLE "powerbi_reader"
--
-- ============================================================================
-- PERCHE' LA FUNZIONE STA IN bi_direzionale E NON IN public
-- ============================================================================
-- `ALTER FUNCTION ... OWNER TO` richiede che il NUOVO proprietario abbia
-- CREATE sullo schema che contiene la funzione. `powerbi_reader` non ha CREATE
-- su `public` — giustamente, e' un ruolo di sola lettura — e su Supabase
-- `public` appartiene a `pg_database_owner`, quindi nemmeno chi applica le
-- migration puo' concederglielo. Verificato il 12/09/2026: l'istruzione
-- falliva con "permission denied for schema public".
--
-- `bi_direzionale` invece e' nostro. La funzione del BI nello schema del BI e'
-- anche piu' coerente di una funzione applicativa in `public`.
--
-- Due accortezze sui privilegi:
--   * da PostgreSQL 16 essere MEMBER non basta per SET ROLE, serve l'opzione
--     SET: su Supabase `postgres` risulta membro di powerbi_reader con
--     `set = false`, quindi un controllo su 'MEMBER' passa, non fa nulla, e
--     l'ALTER fallisce lo stesso. Il predicato giusto e' 'USAGE'.
--   * CREATE su `bi_direzionale` serve solo PER DIVENTARE proprietario: si
--     concede, si cede la funzione, e si revoca. La proprieta' resta, il
--     privilegio no. `powerbi_reader` deve restare minimale.
-- ============================================================================
do $$
begin
  if not pg_catalog.pg_has_role(current_user, 'powerbi_reader', 'USAGE') then
    execute format('grant powerbi_reader to %I with set true', current_user);
    raise notice 'Concessa a % l''opzione SET su powerbi_reader', current_user;
  end if;
end $$;

grant create on schema bi_direzionale to powerbi_reader;
alter function bi_direzionale.query_sola_lettura(text, integer) owner to powerbi_reader;
revoke create on schema bi_direzionale from powerbi_reader;

-- USAGE sugli schemi, ma solo se manca davvero.
--
-- Su Supabase lo schema `public` appartiene a `pg_database_owner`, non a chi
-- applica le migration: un `grant usage on schema public` incondizionato
-- fallisce con "permission denied for schema public" e porta giu' l'intera
-- migration. E fallisce per niente, perche' powerbi_reader quel privilegio ce
-- l'ha gia' da quando Power BI legge queste viste — verificato su entrambi i
-- database il 12/09/2026.
--
-- Se invece mancasse sul serio e non si potesse concedere, meglio un avviso
-- esplicito che un fallimento: il resto della migration e' utile lo stesso e
-- il rimedio (un GRANT da parte del proprietario dello schema) e' una riga.
do $$
declare s text;
begin
  foreach s in array array['public','powerbi'] loop
    if not has_schema_privilege('powerbi_reader', s, 'USAGE') then
      begin
        execute format('grant usage on schema %I to powerbi_reader', s);
        raise notice 'Concesso USAGE su % a powerbi_reader', s;
      exception when insufficient_privilege then
        raise warning 'USAGE su schema % mancante per powerbi_reader e non concedibile da %: farlo eseguire al proprietario dello schema.', s, current_user;
      end;
    end if;
  end loop;
end $$;

-- ── I GRANT sulle viste, uno per uno e in modo tollerante ───────────────────
-- Le sette viste `public.bi_*` NON sono versionate in questa cartella: vivono
-- nel database e basta (bi_preventivi_backoffice e' stata applicata a mano il
-- 29/08/2026 da prototipo-bi/sql/002_vista_preventivi_backoffice.sql). Sono le
-- stesse che legge Power BI.
--
-- Un GRANT unico su tutte fallirebbe per intero se una sola mancasse, e con un
-- errore che non dice quale. Qui si concede su quelle che esistono e si elenca
-- quelle assenti: la migration passa, e chi la applica vede subito cosa manca.
--
-- > [!todo] Le viste andrebbero versionate. Se il database venisse ricostruito
-- > da zero dalle migration, il BI resterebbe senza sorgenti.
do $$
declare
  v record;
  v_mancanti text[] := '{}';
begin
  for v in
    select * from (values
      ('public','bi_ordinato'), ('public','bi_fatturato'), ('public','bi_consegnato'),
      ('public','bi_portafoglio'), ('public','bi_preventivi_backoffice'),
      ('public','bi_controllo_banco'), ('public','bi_consegnato_futuro_per_mese'),
      ('powerbi','bi_cruscotto_articoli_corrente'), ('powerbi','bi_ultimo_costo_storico'),
      ('powerbi','bi_variazioni_ultimo_costo'), ('powerbi','bi_variazioni_giacenze'),
      ('powerbi','bi_marginalita_documenti'), ('powerbi','bi_copertura_costi')
    ) as t(sch, nome)
  loop
    if to_regclass(format('%I.%I', v.sch, v.nome)) is null then
      v_mancanti := v_mancanti || format('%s.%s', v.sch, v.nome);
    else
      execute format('grant select on %I.%I to powerbi_reader', v.sch, v.nome);
    end if;
  end loop;

  if array_length(v_mancanti, 1) > 0 then
    raise warning 'Viste BI non trovate, GRANT saltato: %. Il motore SQL non potra'' interrogarle finche'' non esistono.',
      array_to_string(v_mancanti, ', ');
  end if;
end $$;

-- Non e' una superficie pubblica: si passa sempre dall'API, che applica
-- l'allowlist di viste e funzioni e verifica il livello dell'utente.
revoke all on function bi_direzionale.query_sola_lettura(text, integer) from public, anon, authenticated;
grant execute on function bi_direzionale.query_sola_lettura(text, integer) to service_role;

comment on function bi_direzionale.query_sola_lettura is
  'Esegue una singola SELECT/WITH sulle sole viste BI, come powerbi_reader, con timeout e limite righe. Riservata al livello direzione: vedi /api/prototipo-bi/sql.';

-- ============================================================================
-- B) ANALISI E DASHBOARD SALVATE
-- ============================================================================
-- Il pezzo su cui poggia il costruttore manuale (Fase 3).
--
-- Si salva la SPEC, non i dati né il grafico renderizzato. E' la scelta che
-- rende sensata la condivisione: chi apre un'analisi condivisa la ESEGUE con
-- il proprio perimetro e vede i propri numeri. Lo stesso cruscotto puo' quindi
-- girare fra direzione e agenti senza duplicare niente e senza che un utente
-- riceva, dentro un'analisi altrui, righe che non gli spettano.
--
-- Salvare il risultato avrebbe avuto l'effetto opposto: un'analisi condivisa
-- sarebbe diventata un canale per far uscire dati dal perimetro di chi
-- l'ha creata.
-- ============================================================================

create table if not exists bi_direzionale.analisi (
  id            uuid primary key default gen_random_uuid(),
  titolo        text not null check (length(btrim(titolo)) > 0),
  descrizione   text,
  -- La SpecQuery dello strato semantico. Validata dall'applicazione contro il
  -- vocabolario a ogni esecuzione: una spec che nomina una metrica inesistente
  -- viene rifiutata, non interpretata.
  spec          jsonb not null,
  -- Tipo di grafico scelto dall'utente. Null = lo propone il sistema leggendo
  -- la forma del risultato.
  grafico       text,
  autore_id     uuid not null references public.utenti(id) on delete cascade,
  visibilita    text not null default 'privata'
                  check (visibilita in ('privata', 'condivisa')),
  creato_il     timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

create index if not exists analisi_autore_idx on bi_direzionale.analisi (autore_id, aggiornato_il desc);
create index if not exists analisi_condivise_idx on bi_direzionale.analisi (aggiornato_il desc) where visibilita = 'condivisa';

create table if not exists bi_direzionale.dashboard (
  id            uuid primary key default gen_random_uuid(),
  titolo        text not null check (length(btrim(titolo)) > 0),
  autore_id     uuid not null references public.utenti(id) on delete cascade,
  visibilita    text not null default 'privata'
                  check (visibilita in ('privata', 'condivisa')),
  -- Filtri comuni a tutte le analisi della dashboard (il filtro incrociato).
  filtri_comuni jsonb not null default '{}'::jsonb,
  creato_il     timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

-- Posizione di ogni analisi nella griglia. Tabella separata e non un jsonb
-- perche' qui una riga si sposta davvero da sola: trascinare un riquadro non
-- deve riscrivere l'intera dashboard.
create table if not exists bi_direzionale.dashboard_analisi (
  dashboard_id uuid not null references bi_direzionale.dashboard(id) on delete cascade,
  analisi_id   uuid not null references bi_direzionale.analisi(id) on delete cascade,
  posizione    int not null default 0,
  larghezza    int not null default 6 check (larghezza between 1 and 12),
  altezza      int not null default 4 check (altezza between 1 and 12),
  primary key (dashboard_id, analisi_id)
);

create index if not exists dashboard_analisi_ordine_idx
  on bi_direzionale.dashboard_analisi (dashboard_id, posizione);

-- ── Permessi ────────────────────────────────────────────────────────────────
revoke all on bi_direzionale.analisi, bi_direzionale.dashboard,
              bi_direzionale.dashboard_analisi
  from anon, authenticated;
grant all on bi_direzionale.analisi, bi_direzionale.dashboard,
             bi_direzionale.dashboard_analisi
  to service_role;

alter table bi_direzionale.analisi            enable row level security;
alter table bi_direzionale.dashboard          enable row level security;
alter table bi_direzionale.dashboard_analisi  enable row level security;

drop policy if exists analisi_proprie_o_condivise on bi_direzionale.analisi;
create policy analisi_proprie_o_condivise on bi_direzionale.analisi
  for select to authenticated
  using (autore_id = auth.uid() or visibilita = 'condivisa');

drop policy if exists dashboard_proprie_o_condivise on bi_direzionale.dashboard;
create policy dashboard_proprie_o_condivise on bi_direzionale.dashboard
  for select to authenticated
  using (autore_id = auth.uid() or visibilita = 'condivisa');

drop policy if exists dashboard_analisi_visibili on bi_direzionale.dashboard_analisi;
create policy dashboard_analisi_visibili on bi_direzionale.dashboard_analisi
  for select to authenticated
  using (exists (
    select 1 from bi_direzionale.dashboard d
    where d.id = dashboard_id
      and (d.autore_id = auth.uid() or d.visibilita = 'condivisa')
  ));

notify pgrst, 'reload schema';
