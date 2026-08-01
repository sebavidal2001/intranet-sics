-- 073_bi_cruscotto_articoli.sql
-- ============================================================================
-- Pipeline BI "cruscotto_articoli" — schema di supporto (Fase 2)
--
-- PRINCIPI (da audit read-only del 2026-08-01):
--  * Lo STATO CORRENTE resta in preventivatore.prodotti / prodotti_giacenze:
--    hanno già tutte le 40 colonne del Cruscotto (migration 070). Qui NON si
--    duplica lo stato corrente.
--  * Il Cruscotto è un FLUSSO INDIPENDENTE: non entra in public.bi_documenti_raw
--    (il CHECK elenca i 7 dataset commerciali e bi_activate_run — tuttora viva,
--    invocata da bi_activate_complete_run — pretende esattamente 7 dataset).
--  * Si replica il pattern già in uso per daily/forecast: tabelle proprie +
--    puntatore dedicato in bi_publication_state + funzione di attivazione che
--    valida i conteggi prima di spostare il puntatore.
--  * Storico CHANGE-ONLY: si scrive solo ciò che cambia davvero.
--
-- Additiva e non distruttiva: non modifica tabelle, viste, policy o funzioni
-- esistenti. Rollback = DROP SCHEMA bi CASCADE + drop della colonna aggiunta.
-- ============================================================================

create schema if not exists bi;
comment on schema bi is
  'Oggetti della pipeline BI Cruscotto articoli (run, storico costi e giacenze). Accesso solo service_role; Power BI legge dalle viste in schema powerbi.';

-- ── 1) Run del Cruscotto ────────────────────────────────────────────────────
create table if not exists bi.cruscotto_runs (
  run_id          text primary key,
  source          text not null default 'SRVWOA',
  captured_at     timestamp without time zone,          -- estrazione sul gestionale
  received_at     timestamptz not null default now(),
  published_at    timestamptz,
  row_count       bigint,
  articoli_count  bigint,
  sha256          text,
  status          text not null default 'loading'
                    check (status in ('loading','validated','current','failed','archived')),
  error_message   text,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

-- Un solo run corrente (stesso meccanismo di bi_runs_one_current_idx).
create unique index if not exists cruscotto_runs_one_current_idx
  on bi.cruscotto_runs ((status)) where status = 'current';
create index if not exists cruscotto_runs_received_idx
  on bi.cruscotto_runs (received_at desc);

comment on table bi.cruscotto_runs is
  'Un record per ogni snapshot Cruscotto ricevuto. status: loading→validated→current; archived quando sostituito.';

-- ── 2) Storico ULTIMO COSTO (intervalli di validità) ────────────────────────
-- Sorgente: dba.vs_listino_ultimo_costo (prezzo + data_inizio).
-- Gli articoli senza costo restano presenti con costo NULL: non si eredita
-- silenziosamente l'ultimo costo noto.
create table if not exists bi.costi_storico (
  id             bigint generated always as identity primary key,
  codice         text not null,
  uc             text,                       -- unità di confezione al momento del rilievo
  costo          numeric(14,4),              -- NULL = costo assente in origine
  data_costo     date,                       -- data_inizio dal gestionale
  first_seen_at  timestamptz not null default now(),
  valid_from     timestamptz not null,
  valid_to       timestamptz,                -- esclusivo; NULL = intervallo aperto
  detected_at    timestamptz not null default now(),
  run_id         text not null references bi.cruscotto_runs(run_id) on delete cascade,
  constraint costi_storico_intervallo_valido check (valid_to is null or valid_to > valid_from)
);

-- Un solo intervallo aperto per articolo.
create unique index if not exists costi_storico_open_idx
  on bi.costi_storico (codice) where valid_to is null;
-- Join temporale della marginalità: data_documento >= valid_from AND (< valid_to OR NULL).
create index if not exists costi_storico_lookup_idx
  on bi.costi_storico (codice, valid_from desc, valid_to);
-- Idempotenza / diagnostica per run.
create index if not exists costi_storico_run_idx
  on bi.costi_storico (run_id);

comment on table bi.costi_storico is
  'Storico ultimo costo per articolo, a intervalli. Nuova riga solo quando il costo (o la sua data) cambia.';
comment on column bi.costi_storico.valid_to is
  'Esclusivo: il costo vale per data_documento >= valid_from AND data_documento < valid_to. NULL = tuttora valido.';

-- ── 3) Storico GIACENZE in formato lungo ────────────────────────────────────
-- Una riga per (articolo, magazzino, CAMPO) che cambia: formato scelto perché
-- il consumatore è Power BI, che gestisce male il JSON e ama il formato lungo
-- (il campo diventa uno slicer). Nessuna riga se il valore non cambia.
create table if not exists bi.giacenze_storico (
  id                 bigint generated always as identity primary key,
  codice             text not null,
  magazzino          text not null,
  campo              text not null,           -- es. 'esistenza', 'qta_ord_clienti'
  valore_precedente  numeric(18,3),
  valore             numeric(18,3),
  delta              numeric(18,3) generated always as (coalesce(valore,0) - coalesce(valore_precedente,0)) stored,
  first_seen_at      timestamptz not null default now(),
  valid_from         timestamptz not null,
  valid_to           timestamptz,
  detected_at        timestamptz not null default now(),
  run_id             text not null references bi.cruscotto_runs(run_id) on delete cascade,
  constraint giacenze_storico_intervallo_valido check (valid_to is null or valid_to > valid_from),
  -- Il valore deve cambiare davvero (confronto NULL-safe): niente righe inutili.
  constraint giacenze_storico_cambio_reale check (valore is distinct from valore_precedente)
);

create unique index if not exists giacenze_storico_open_idx
  on bi.giacenze_storico (codice, magazzino, campo) where valid_to is null;
create index if not exists giacenze_storico_lookup_idx
  on bi.giacenze_storico (codice, magazzino, campo, valid_from desc);
create index if not exists giacenze_storico_campo_data_idx
  on bi.giacenze_storico (campo, valid_from desc);
create index if not exists giacenze_storico_run_idx
  on bi.giacenze_storico (run_id);

comment on table bi.giacenze_storico is
  'Storico giacenze change-only in formato lungo: una riga per campo variato. `disponibilita` NON viene storicizzata come misura indipendente perché è derivata (vedi bi.disponibilita_attesa).';

-- ── 4) Disponibilità: formula verificata sui dati reali ─────────────────────
-- Ricavata empiricamente sul dataset completo: con questi 7 termini le anomalie
-- sono 0 su 26.171 righe (la formula a 4 termini ne lasciava 42).
create or replace function bi.disponibilita_attesa(
  p_esistenza numeric, p_ord_fornitori numeric, p_ord_clienti numeric,
  p_imp_produzione numeric, p_ord_produzione numeric, p_vis_clienti numeric,
  p_cl_fornitori numeric
) returns numeric
language sql immutable
as $$
  select coalesce(p_esistenza,0)
       + coalesce(p_ord_fornitori,0)
       - coalesce(p_ord_clienti,0)
       - coalesce(p_imp_produzione,0)
       + coalesce(p_ord_produzione,0)
       - coalesce(p_vis_clienti,0)
       - coalesce(p_cl_fornitori,0);
$$;

comment on function bi.disponibilita_attesa is
  'Disponibilità ricalcolata dalle quantità. Usata in fase di ingest per validare il valore ricevuto dal gestionale.';

-- ── 5) Puntatore di pubblicazione dedicato ──────────────────────────────────
alter table public.bi_publication_state
  add column if not exists current_cruscotto_run_id text;

comment on column public.bi_publication_state.current_cruscotto_run_id is
  'Run Cruscotto attualmente pubblicato. Indipendente da daily e forecast.';

-- ── 6) Attivazione atomica del run Cruscotto ────────────────────────────────
-- Modellata su bi_activate_daily: valida i conteggi, poi sposta il puntatore.
create or replace function public.bi_activate_cruscotto(p_run_id text)
returns void
language plpgsql
security definer
set search_path to 'public', 'bi', 'preventivatore', 'pg_temp'
as $function$
declare
  v_status      text;
  v_row_count   bigint;
  v_articoli    bigint;
  v_giacenze    bigint;
  v_prodotti    bigint;
begin
  -- Serializza le attivazioni Cruscotto (non tocca bi_runs commerciale).
  lock table bi.cruscotto_runs in exclusive mode;

  select status, row_count, articoli_count
    into v_status, v_row_count, v_articoli
    from bi.cruscotto_runs
   where run_id = p_run_id;

  if not found then
    raise exception 'Run Cruscotto % non trovato', p_run_id;
  end if;

  if v_status not in ('loading','validated','current') then
    raise exception 'Run Cruscotto % non attivabile (status=%)', p_run_id, v_status;
  end if;

  -- Coerenza fra manifest dichiarato e stato corrente effettivamente scritto.
  select count(*) into v_giacenze from preventivatore.prodotti_giacenze;
  select count(*) into v_prodotti from preventivatore.prodotti where attivo;

  if v_row_count is not null and v_giacenze < (v_row_count * 0.5)::bigint then
    raise exception 'Run %: giacenze in DB (%) troppo poche rispetto allo snapshot (%): sospetto caricamento parziale',
      p_run_id, v_giacenze, v_row_count;
  end if;

  if v_articoli is not null and v_prodotti < (v_articoli * 0.5)::bigint then
    raise exception 'Run %: prodotti attivi (%) troppo pochi rispetto allo snapshot (%): sospetto caricamento parziale',
      p_run_id, v_prodotti, v_articoli;
  end if;

  update bi.cruscotto_runs
     set status = 'archived'
   where status = 'current' and run_id <> p_run_id;

  update bi.cruscotto_runs
     set status = 'current', published_at = now()
   where run_id = p_run_id;

  update public.bi_publication_state
     set current_cruscotto_run_id = p_run_id,
         updated_at = now()
   where singleton;
end;
$function$;

comment on function public.bi_activate_cruscotto is
  'Attiva un run Cruscotto: valida la coerenza dei conteggi e sposta current_cruscotto_run_id. Non interferisce con bi_activate_run/daily/forecast.';

-- ── 7) Sicurezza: stesse convenzioni della pipeline esistente ───────────────
alter table bi.cruscotto_runs    enable row level security;
alter table bi.costi_storico     enable row level security;
alter table bi.giacenze_storico  enable row level security;

revoke all on schema bi from public, anon, authenticated;
revoke all on all tables in schema bi from public, anon, authenticated;
revoke all on function public.bi_activate_cruscotto(text) from public, anon, authenticated;

grant usage on schema bi to service_role;
grant select, insert, update, delete on all tables in schema bi to service_role;
grant usage, select on all sequences in schema bi to service_role;
grant execute on function public.bi_activate_cruscotto(text) to service_role;
grant execute on function bi.disponibilita_attesa(numeric,numeric,numeric,numeric,numeric,numeric,numeric) to service_role;

alter default privileges in schema bi
  grant select, insert, update, delete on tables to service_role;

notify pgrst, 'reload schema';
