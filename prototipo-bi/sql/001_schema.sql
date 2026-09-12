-- ============================================================================
-- ⛔ NON APPLICARE — SCHEMA PER LA FUTURA PRODUZIONE DEL BI DIREZIONALE
--
-- Questo file NON è stato eseguito da nessuna parte. Esiste per rendere
-- immediato il passaggio in produzione SE E QUANDO Sebastiano lo autorizza.
-- Nel prototipo tutta questa roba vive in file JSON sotto prototipo-bi/dati/.
--
-- Quando si attiva:
--   1) rinominare in supabase/migrations/0XX_bi_direzionale.sql
--   2) applicarlo dal SQL Editor
--   3) sostituire src/lib/prototipo-bi/archivio.ts con la versione Postgres
--      (l'interfaccia pubblica è già identica: leggiConfigurazione,
--       salvaConfigurazione, archiviaBriefing, registraRiscontro, …)
--
-- Additivo e non distruttivo: crea solo oggetti nuovi in uno schema nuovo.
-- Rollback: DROP SCHEMA bi_direzionale CASCADE;
-- ============================================================================

create schema if not exists bi_direzionale;
comment on schema bi_direzionale is
  'Configurazione del BI Direzionale: budget, BEP, calendario aziendale, briefing dell''analista.';

-- ── 1) Configurazione annuale ───────────────────────────────────────────────
-- Due numeri per anno. Tutto il resto è generato.
create table if not exists bi_direzionale.configurazione_anno (
  anno            int primary key check (anno between 2000 and 2100),
  budget_annuo    numeric(14,2) not null default 0 check (budget_annuo >= 0),
  bep_annuo       numeric(14,2) not null default 0 check (bep_annuo >= 0),
  modalita        text not null default 'giorni_lavorativi'
                    check (modalita in ('giorni_lavorativi', 'lineare_mese')),
  escludi_weekend boolean not null default true,
  aggiornato_il   timestamptz not null default now(),
  aggiornato_da   uuid references public.utenti(id)
);

comment on table bi_direzionale.configurazione_anno is
  'Budget e BEP annuali. La distribuzione giornaliera NON è memorizzata: si calcola, così non può divergere dai parametri.';

-- ── 2) Chiusure aziendali ───────────────────────────────────────────────────
-- Il pezzo che evita i falsi allarmi di agosto: nel 2026 dal 10 al 23 agosto
-- non esiste un solo ordine, e senza queste righe il sistema lo legge come
-- un crollo del 100%.
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

-- ── 6) Briefing archiviati ──────────────────────────────────────────────────
-- Servono per il cooldown (non ripetere la stessa notizia) e per lo storico.
create table if not exists bi_direzionale.briefing (
  id              uuid primary key default gen_random_uuid(),
  generato_il     timestamptz not null default now(),
  data_riferimento date not null,
  destinatario_id uuid references public.utenti(id),
  ruolo           text not null check (ruolo in ('direzione', 'responsabile', 'agente')),
  motore          text not null default 'deterministico',
  contenuto       jsonb not null,
  segnali_valutati int not null default 0
);
create index if not exists briefing_dest_idx
  on bi_direzionale.briefing (destinatario_id, generato_il desc);

-- ── 7) Riscontri sulle voci del briefing ────────────────────────────────────
-- L'unico modo onesto di tarare i pesi dei rilevatori: senza questo ciclo il
-- sistema non impara a tacere e viene spento.
create table if not exists bi_direzionale.riscontri (
  id           uuid primary key default gen_random_uuid(),
  segnale_id   text not null,
  famiglia     text not null,
  utile        boolean not null,
  nota         text,
  utente_id    uuid references public.utenti(id),
  registrato_il timestamptz not null default now()
);
create index if not exists riscontri_famiglia_idx on bi_direzionale.riscontri (famiglia);

-- ── 8) RLS ──────────────────────────────────────────────────────────────────
-- Il perimetro per agente, che in Power BI richiederebbe i ruoli RLS del
-- servizio, qui è nativo.
alter table bi_direzionale.configurazione_anno enable row level security;
alter table bi_direzionale.chiusure            enable row level security;
alter table bi_direzionale.incidenze_bu        enable row level security;
alter table bi_direzionale.budget_commerciali  enable row level security;
alter table bi_direzionale.obiettivi_visite    enable row level security;
alter table bi_direzionale.briefing            enable row level security;
alter table bi_direzionale.riscontri           enable row level security;

-- Le policy vanno scritte al momento dell'attivazione, allineate al modello
-- permessi definitivo (portale 'bi' in `portali` + `portali_utenti`).
-- Volutamente NON create qui: policy scritte oggi e dimenticate domani sono
-- peggio di nessuna policy.

-- ── 9) Vista di comodo: il calendario con i giorni lavorativi ───────────────
-- Replica lato SQL la logica di src/lib/prototipo-bi/calendario.ts, per chi
-- volesse interrogare direttamente il database.
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
  'Giorni dell''anno con marcatura lavorativo/chiusura. NB: non include le festività nazionali, che nel prototipo sono calcolate lato applicazione (Pasqua compresa).';
