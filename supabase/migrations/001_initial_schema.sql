-- Piattaforma Valutazione SICS - Schema iniziale
create extension if not exists "uuid-ossp";

create table utenti (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  nome text not null,
  cognome text not null,
  ruolo text not null check (ruolo in ('admin', 'direttore', 'addetto')),
  reparto text,
  responsabile_id uuid references utenti(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table scale_valutazione (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  min integer not null default 1,
  max integer not null default 5,
  labels jsonb,
  is_attiva boolean default true,
  created_at timestamptz default now()
);

create table mansionari (
  id uuid primary key default uuid_generate_v4(),
  utente_id uuid references utenti(id) on delete cascade,
  anno integer not null,
  mansione text not null,
  competenze jsonb not null default '[]',
  is_storico boolean default false,
  created_at timestamptz default now(),
  unique(utente_id, anno)
);

create table parametri_radar (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  descrizione text,
  colore text default '#00a1be',
  ordine integer default 0,
  is_attivo boolean default true
);

create table sessioni_valutazione (
  id uuid primary key default uuid_generate_v4(),
  anno integer not null,
  nome text,
  is_aperta boolean default false,
  scala_id uuid references scale_valutazione(id),
  data_apertura timestamptz,
  data_chiusura timestamptz,
  created_at timestamptz default now()
);

create table domande (
  id uuid primary key default uuid_generate_v4(),
  sessione_id uuid references sessioni_valutazione(id) on delete cascade,
  parametro_id uuid references parametri_radar(id),
  testo text not null,
  ordine integer default 0,
  tipo text default 'scale' check (tipo in ('scale', 'text', 'boolean'))
);

create table risposte (
  id uuid primary key default uuid_generate_v4(),
  domanda_id uuid references domande(id) on delete cascade,
  sessione_id uuid references sessioni_valutazione(id),
  utente_id uuid references utenti(id),
  valutatore_id uuid references utenti(id),
  tipo text not null check (tipo in ('auto', 'responsabile')),
  punteggio numeric,
  testo_libero text,
  created_at timestamptz default now(),
  unique(domanda_id, utente_id, valutatore_id, tipo)
);

create table kpi_config (
  id uuid primary key default uuid_generate_v4(),
  nome text not null,
  parametro_id uuid references parametri_radar(id),
  operatore text check (operatore in ('>', '<', '>=', '<=', '=')),
  soglia numeric,
  anno integer,
  is_attivo boolean default true
);

alter table utenti enable row level security;
alter table mansionari enable row level security;
alter table risposte enable row level security;
alter table sessioni_valutazione enable row level security;
alter table domande enable row level security;

create policy admin_full_utenti on utenti for all using (
  exists (select 1 from utenti u where u.id = auth.uid() and u.ruolo = 'admin')
);
create policy user_see_self on utenti for select using (id = auth.uid());
create policy user_own_mansionario on mansionari for select using (utente_id = auth.uid());
create policy responsabile_mansionari on mansionari for select using (
  exists (select 1 from utenti u where u.id = mansionari.utente_id and u.responsabile_id = auth.uid())
);
create policy user_own_risposte on risposte for select using (
  utente_id = auth.uid() or valutatore_id = auth.uid()
);
create policy responsabile_risposte on risposte for select using (
  exists (select 1 from utenti u where u.id = risposte.utente_id and u.responsabile_id = auth.uid())
);