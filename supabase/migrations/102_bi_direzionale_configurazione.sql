-- 102_bi_direzionale_configurazione.sql
--
-- Fase 1 del passaggio in produzione del BI Direzionale.
-- Piano completo: docs/bi/PIANO-PRODUZIONE-BI.md
--
-- Porta in database la configurazione che il prototipo teneva in file JSON
-- sotto `prototipo-bi/dati/`. Serviva farlo: il deploy sulla VM esegue
-- `git reset --hard origin/main`, quindi qualunque stato in una cartella del
-- repo e' a un deploy di distanza dalla sparizione.
--
-- ============================================================================
-- PERCHE' LO SCHEMA SI CHIAMA bi_direzionale E NON bi
-- ============================================================================
-- Lo schema `bi` esiste gia' ed e' della PIPELINE DI INGEST: `cruscotto_runs`,
-- `costi_storico`, `giacenze_storico` (073, 075, 076), `trasporti_documenti`
-- e `trasporti_runs` (090, 099). Ci scrivono processi automatici, non persone.
--
-- Qui dentro va l'opposto: configurazione scritta dagli utenti, con un altro
-- ciclo di vita, altri permessi e altra RLS. Tenerle nello stesso schema
-- avrebbe significato una sola superficie di GRANT per due cose che vanno
-- protette in modo diverso.
--
-- ============================================================================
-- COSA NON ENTRA IN DATABASE, E PERCHE'
-- ============================================================================
--   * la cache dello snapshot (~66.000 righe, riscritta ogni sei ore): resta
--     su disco. In Postgres sarebbe un jsonb da decine di MB riscritto per
--     intero a ogni giro, per un dato che e' gia' derivato e ricostruibile.
--   * i documenti Word/Excel prodotti dall'analista: restano file.
--
-- Additivo e non distruttivo: crea solo oggetti nuovi in uno schema nuovo.
-- Rollback: DROP SCHEMA bi_direzionale CASCADE;
-- ============================================================================

create schema if not exists bi_direzionale;

comment on schema bi_direzionale is
  'Configurazione del BI Direzionale: budget, BEP, calendario aziendale, briefing. Distinto da `bi`, che e'' la pipeline di ingest.';

-- ── 1) Configurazione annuale ───────────────────────────────────────────────
-- Due numeri per anno. Tutto il resto e' generato: la distribuzione giornaliera
-- NON e' memorizzata, si calcola, cosi' non puo' divergere dai parametri.
create table if not exists bi_direzionale.configurazione_anno (
  anno            int primary key check (anno between 2000 and 2100),
  budget_annuo    numeric(14,2) not null default 0 check (budget_annuo >= 0),
  bep_annuo       numeric(14,2) not null default 0 check (bep_annuo >= 0),
  modalita        text not null default 'giorni_lavorativi'
                    check (modalita in ('giorni_lavorativi', 'lineare_mese')),
  escludi_weekend boolean not null default true,
  aggiornato_il   timestamptz not null default now(),
  aggiornato_da   uuid references public.utenti(id) on delete set null
);

-- ── 2) Chiusure aziendali ───────────────────────────────────────────────────
-- Il pezzo che evita i falsi allarmi di agosto: nel 2026 dal 10 al 23 agosto
-- non esiste un solo ordine, e senza queste righe il sistema lo legge come un
-- crollo del 100%.
create table if not exists bi_direzionale.chiusure (
  id           uuid primary key default gen_random_uuid(),
  anno         int not null references bi_direzionale.configurazione_anno(anno) on delete cascade,
  dal          date not null,
  al           date not null,
  descrizione  text not null default 'Chiusura',
  creato_il    timestamptz not null default now(),
  check (dal <= al)
);
create index if not exists chiusure_anno_idx on bi_direzionale.chiusure (anno, dal);

-- ── 3) Incidenza delle business unit ────────────────────────────────────────
create table if not exists bi_direzionale.incidenze_bu (
  anno      int not null references bi_direzionale.configurazione_anno(anno) on delete cascade,
  bu        text not null,
  peso_pct  numeric(6,2) not null default 0 check (peso_pct >= 0 and peso_pct <= 100),
  primary key (anno, bu)
);

-- ── 4) Budget dei commerciali ───────────────────────────────────────────────
-- `importo_annuo` prevale su `quota_pct` quando valorizzato: serve per gli
-- agenti con un obiettivo negoziato invece che proporzionale.
create table if not exists bi_direzionale.budget_commerciali (
  anno          int not null references bi_direzionale.configurazione_anno(anno) on delete cascade,
  codice_agente text not null,
  agente        text not null,
  quota_pct     numeric(6,2) not null default 0 check (quota_pct >= 0 and quota_pct <= 100),
  importo_annuo numeric(14,2) check (importo_annuo is null or importo_annuo >= 0),
  bu            text,
  primary key (anno, codice_agente)
);

-- ── 5) Obiettivi visite ─────────────────────────────────────────────────────
-- Oggi in obiettivo_visite.xlsx: tre righe in un file su un PC.
create table if not exists bi_direzionale.obiettivi_visite (
  anno          int not null,
  codice_agente text not null,
  agente        text not null,
  obiettivo     int not null default 0 check (obiettivo >= 0),
  primary key (anno, codice_agente)
);

-- ── 6) Serie budget importate dagli Excel aziendali ─────────────────────────
-- Le righe stanno in jsonb e non in una tabella normalizzata: il codice le
-- carica sempre TUTTE insieme per un anno (sono i 5.844 giorni x area del file
-- giornaliero), non ne interroga mai una. Normalizzarle darebbe query che
-- nessuno scrive, al prezzo di un import in 5.844 insert.
--
-- Se un domani servisse interrogare il budget in SQL — per esempio per farlo
-- leggere anche a Power BI — si normalizza allora, con i dati gia' in casa.
create table if not exists bi_direzionale.serie_budget (
  anno            int primary key check (anno between 2000 and 2100),
  origine         text not null check (origine in ('importato', 'generato')),
  formato         text not null default '',
  importato_il    timestamptz not null default now(),
  totale_budget   numeric(14,2) not null default 0,
  totale_bep      numeric(14,2) not null default 0,
  righe           jsonb not null default '[]'::jsonb,
  importato_da    uuid references public.utenti(id) on delete set null
);

-- ── 7) Briefing archiviati ──────────────────────────────────────────────────
-- Servono per il cooldown (non ripetere la stessa notizia due giorni di fila)
-- e per lo storico.
create table if not exists bi_direzionale.briefing (
  id               uuid primary key default gen_random_uuid(),
  generato_il      timestamptz not null default now(),
  data_riferimento date not null,
  destinatario_id  uuid references public.utenti(id) on delete set null,
  ruolo            text not null check (ruolo in ('direzione', 'responsabile', 'agente')),
  motore           text not null default 'deterministico',
  contenuto        jsonb not null,
  segnali_valutati int not null default 0
);
create index if not exists briefing_dest_idx
  on bi_direzionale.briefing (destinatario_id, generato_il desc);

-- ── 8) Riscontri sulle voci del briefing ────────────────────────────────────
-- L'unico modo onesto di tarare i pesi dei rilevatori: senza questo ciclo il
-- sistema non impara a tacere e finisce spento.
create table if not exists bi_direzionale.riscontri (
  id            uuid primary key default gen_random_uuid(),
  segnale_id    text not null,
  famiglia      text not null,
  utile         boolean not null,
  nota          text,
  utente_id     uuid references public.utenti(id) on delete set null,
  registrato_il timestamptz not null default now()
);
create index if not exists riscontri_famiglia_idx on bi_direzionale.riscontri (famiglia);

-- ============================================================================
-- PERMESSI
-- ============================================================================
-- Lezione dello schema `preventivatore` (062): **i GRANT sono il gate, non le
-- RLS**. Le policy dicono `authenticated`, ma sono irrilevanti se manca il
-- privilegio di tabella. Qui si revoca tutto a `anon` e `authenticated`: la
-- lettura e la scrittura passano dal service role lato server, dopo che la
-- route ha verificato il livello.
--
-- Le policy si scrivono lo stesso, come seconda cintura per il giorno in cui
-- qualcuno concedesse un GRANT per comodita'.
-- ============================================================================

revoke all on all tables in schema bi_direzionale from anon, authenticated;
revoke all on all functions in schema bi_direzionale from anon, authenticated;
revoke all on all sequences in schema bi_direzionale from anon, authenticated;
alter default privileges in schema bi_direzionale
  revoke all on tables from anon, authenticated;

grant usage on schema bi_direzionale to service_role;
grant all on all tables in schema bi_direzionale to service_role;
alter default privileges in schema bi_direzionale
  grant all on tables to service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'configurazione_anno','chiusure','incidenze_bu','budget_commerciali',
    'obiettivi_visite','serie_budget','briefing','riscontri'
  ] loop
    execute format('alter table bi_direzionale.%I enable row level security', t);

    -- Seconda cintura: anche con un GRANT concesso per errore, un utente
    -- autenticato legge solo se e' admin del portale BI.
    --
    -- Due EXECUTE separate e non una sola stringa con due istruzioni: EXECUTE
    -- in plpgsql esegue UNA istruzione, e due separate da ';' danno errore di
    -- sintassi al primo giro del ciclo.
    execute format('drop policy if exists %I on bi_direzionale.%I',
                   t || '_lettura_admin', t);
    execute format(
      'create policy %I on bi_direzionale.%I for select to authenticated '
      'using (public.get_portale_livello(auth.uid(), ''bi'') in (''superadmin'',''admin''))',
      t || '_lettura_admin', t);
  end loop;
end $$;

-- I briefing e i riscontri sono l'eccezione: ognuno vede i propri anche senza
-- essere admin, perche' il briefing e' indirizzato a lui.
drop policy if exists briefing_proprio on bi_direzionale.briefing;
create policy briefing_proprio on bi_direzionale.briefing
  for select to authenticated
  using (destinatario_id = auth.uid());

drop policy if exists riscontri_proprio on bi_direzionale.riscontri;
create policy riscontri_proprio on bi_direzionale.riscontri
  for select to authenticated
  using (utente_id = auth.uid());

-- ============================================================================
-- SCRITTURA ATOMICA DELLA CONFIGURAZIONE
-- ============================================================================
-- La configurazione di un anno vive su QUATTRO tabelle: la testata, le
-- chiusure, le incidenze BU e i budget dei commerciali. Il client Supabase non
-- ha transazioni, quindi salvarle con quattro chiamate significa accettare che
-- la seconda fallisca dopo la prima.
--
-- Non e' un rischio teorico: le chiusure si salvano cancellando e reinserendo,
-- e un'interruzione a meta' le lascerebbe VUOTE con la testata gia' aggiornata.
-- Il risultato sarebbe che agosto — due settimane senza un solo ordine —
-- tornerebbe a essere letto come un crollo del 100%, e il briefing lo
-- annuncerebbe alla direzione come la notizia del giorno.
--
-- Una funzione, una transazione.
-- ============================================================================
create or replace function bi_direzionale.salva_configurazione(
  p_dati   jsonb,
  p_utente uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, bi_direzionale, public
as $$
declare
  v_anno int := (p_dati->>'anno')::int;
begin
  if v_anno is null then
    raise exception 'Anno mancante nella configurazione';
  end if;

  insert into bi_direzionale.configurazione_anno
    (anno, budget_annuo, bep_annuo, modalita, escludi_weekend, aggiornato_il, aggiornato_da)
  values (
    v_anno,
    coalesce((p_dati->>'budgetAnnuo')::numeric, 0),
    coalesce((p_dati->>'bepAnnuo')::numeric, 0),
    coalesce(p_dati->>'modalita', 'giorni_lavorativi'),
    coalesce((p_dati->>'escludiWeekend')::boolean, true),
    now(),
    p_utente
  )
  on conflict (anno) do update set
    budget_annuo    = excluded.budget_annuo,
    bep_annuo       = excluded.bep_annuo,
    modalita        = excluded.modalita,
    escludi_weekend = excluded.escludi_weekend,
    aggiornato_il   = now(),
    aggiornato_da   = excluded.aggiornato_da;

  -- Sostituzione integrale dei figli: l'applicazione manda sempre l'elenco
  -- completo, non un delta.
  delete from bi_direzionale.chiusure where anno = v_anno;
  insert into bi_direzionale.chiusure (anno, dal, al, descrizione)
  select v_anno, (e->>'dal')::date, (e->>'al')::date,
         coalesce(e->>'descrizione', 'Chiusura')
  from jsonb_array_elements(coalesce(p_dati->'chiusure', '[]'::jsonb)) e;

  delete from bi_direzionale.incidenze_bu where anno = v_anno;
  insert into bi_direzionale.incidenze_bu (anno, bu, peso_pct)
  select v_anno, e->>'bu', coalesce((e->>'pesoPct')::numeric, 0)
  from jsonb_array_elements(coalesce(p_dati->'incidenzeBU', '[]'::jsonb)) e
  where coalesce(e->>'bu', '') <> '';

  delete from bi_direzionale.budget_commerciali where anno = v_anno;
  insert into bi_direzionale.budget_commerciali
    (anno, codice_agente, agente, quota_pct, importo_annuo, bu)
  select v_anno, e->>'codiceAgente', coalesce(e->>'agente', e->>'codiceAgente'),
         coalesce((e->>'quotaPct')::numeric, 0),
         nullif(e->>'importoAnnuo', '')::numeric,
         nullif(e->>'bu', '')
  from jsonb_array_elements(coalesce(p_dati->'commerciali', '[]'::jsonb)) e
  where coalesce(e->>'codiceAgente', '') <> '';
end $$;

revoke all on function bi_direzionale.salva_configurazione(jsonb, uuid) from public, anon, authenticated;
grant execute on function bi_direzionale.salva_configurazione(jsonb, uuid) to service_role;

comment on function bi_direzionale.salva_configurazione is
  'Salva testata, chiusure, incidenze BU e budget commerciali di un anno in una sola transazione. Chiamata da src/lib/prototipo-bi/archivio.ts.';

-- ── 9) Calendario dei giorni lavorativi, lato SQL ───────────────────────────
-- Replica di src/lib/prototipo-bi/calendario.ts, per chi interroga il database
-- direttamente (Power BI resta acceso in parallelo per tutto il rollout).
create or replace function bi_direzionale.giorni_lavorativi(p_anno int)
returns table (data date, lavorativo boolean, chiusura text)
language sql
stable
as $$
  select
    d::date,
    not (
      extract(isodow from d) >= 6
      or exists (
        select 1 from bi_direzionale.chiusure c
        where c.anno = p_anno and d::date between c.dal and c.al
      )
    ) as lavorativo,
    (select c.descrizione from bi_direzionale.chiusure c
      where c.anno = p_anno and d::date between c.dal and c.al limit 1) as chiusura
  from generate_series(
    make_date(p_anno, 1, 1),
    make_date(p_anno, 12, 31),
    interval '1 day'
  ) d;
$$;

comment on function bi_direzionale.giorni_lavorativi is
  'Giorni dell''anno con marcatura lavorativo/chiusura. NB: non include le festivita'' nazionali, che l''applicazione calcola a parte (Pasqua compresa).';

-- ============================================================================
-- POSTGREST — il passo che sembra superfluo e non lo e'
-- ============================================================================
-- Uno schema non elencato in `pgrst.db_schemas` fa tornare le query VUOTE
-- SENZA SOLLEVARE ERRORE. Il sintomo non assomiglia a un problema di
-- configurazione: la pagina dice "nessun dato configurato" con le righe
-- regolarmente in tabella, e si perde tempo a cercare il bug nel codice.
-- E' gia' successo il 6 settembre con lo schema `vettori`.
--
-- Si aggiunge in coda all'elenco esistente invece di riscriverlo: riscriverlo
-- significherebbe cancellare gli schemi aggiunti dopo la stesura di questa
-- migration.
-- ============================================================================
do $$
declare
  attuale text;
  nuovo   text;
begin
  select replace(s, 'pgrst.db_schemas=', '')
    into attuale
  from pg_catalog.pg_roles r, unnest(coalesce(r.rolconfig, '{}')) s
  where r.rolname = 'authenticator' and s like 'pgrst.db_schemas=%';

  if attuale is null then
    -- Nessuna impostazione esplicita: si parte dal default noto del progetto.
    attuale := 'public, preventivatore, service, vettori, bi';
  end if;

  if position('bi_direzionale' in attuale) > 0 then
    raise notice 'bi_direzionale gia'' esposto a PostgREST';
  else
    nuovo := attuale || ', bi_direzionale';
    execute format('alter role authenticator set pgrst.db_schemas = %L', nuovo);
    raise notice 'PostgREST db_schemas aggiornato: %', nuovo;
  end if;
end $$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';

-- > ATTENZIONE su Supabase gestito: l'elenco vive anche in
-- > Settings -> API -> Exposed schemas, e l'interfaccia sovrascrive questo
-- > comando (e viceversa). Sulla VM, dove PostgREST e' self-hosted, il comando
-- > qui sopra e' quello buono. Va applicato su ENTRAMBI i database.
