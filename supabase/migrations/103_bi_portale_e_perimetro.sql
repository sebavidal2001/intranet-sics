-- 103_bi_portale_e_perimetro.sql
--
-- Fase 1 del passaggio in produzione del BI Direzionale — secondo pezzo.
-- Piano: docs/bi/PIANO-PRODUZIONE-BI.md, sezioni 2 e 3.
--
-- Qui si accende il modello permessi. Due assi separati, come sul
-- Preventivatore, dove tenerli distinti ha evitato il bug del codice
-- irraggiungibile (il gate era su `livello >= admin` e il controllo sui ruoli
-- funzionali non veniva mai raggiunto):
--
--   1) LIVELLO DI PORTALE  — *se* entri e cosa puoi fare        -> portale 'bi'
--   2) PERIMETRO           — *quali righe* vedi                 -> perimetro_utente
--
-- ============================================================================
-- PERCHE' IL PERIMETRO E' UNA TABELLA E NON UNA COLONNA SU `utenti`
-- ============================================================================
-- Perche' un utente puo' avere piu' di un codice agente (un capo area che
-- segue due portafogli), e perche' il perimetro puo' essere per business unit
-- invece che per agente. Una colonna avrebbe retto il caso semplice e sarebbe
-- stata rifatta al primo caso vero.
--
-- Additivo. Rollback:
--   DROP TABLE bi_direzionale.perimetro_utente, bi_direzionale.registro_query;
--   DELETE FROM public.portali WHERE slug = 'bi';
-- ============================================================================

-- ── 1) Il portale ───────────────────────────────────────────────────────────
-- Da qui `get_portale_livello(utente, 'bi')` comincia a rispondere, e con esso
-- `getPortaliUtente()`, quindi il BI compare nella griglia dei portali della
-- home per chi ha accesso.
insert into public.portali (slug, nome, descrizione, icona, colore, ordine, is_attivo, labels_livelli)
values (
  'bi',
  'BI Direzionale',
  'Cruscotto direzionale, analisi autonome e analista AI sui dati commerciali.',
  'LineChart',
  '#00a1be',
  30,
  -- Nasce SPENTO. Il rollout e' per gruppi (Fase 5) e si apre quando i numeri
  -- sono stati confrontati con il PBIX, non quando la migration viene
  -- applicata. Accendere qui significherebbe pubblicarlo a tutti i ruoli che
  -- hanno gia' can_access, senza che nessuno lo abbia deciso.
  false,
  jsonb_build_object(
    'admin',    'Direzione',
    'exporter', 'Responsabile',
    'viewer',   'Operativo'
  )
)
on conflict (slug) do nothing;

-- Chi accede tramite ruolo. La direzione e' `can_approve` (diventa livello
-- 'admin' in get_portale_livello, quindi SQL libero e configurazione budget).
insert into public.permessi_portale (portale_id, ruolo, can_access, can_export, can_approve)
select p.id, v.ruolo, v.can_access, v.can_export, v.can_approve
from public.portali p
cross join (values
  ('superadmin',              true, true, true),
  ('amministratore',          true, true, true),
  ('responsabile',            true, true, false),
  ('responsabile_intermedio', true, false, false)
) as v(ruolo, can_access, can_export, can_approve)
where p.slug = 'bi'
on conflict do nothing;

-- ── 2) Perimetro dei dati ───────────────────────────────────────────────────
create table if not exists bi_direzionale.perimetro_utente (
  utente_id  uuid primary key references public.utenti(id) on delete cascade,
  tipo       text not null check (tipo in ('tutto', 'agente', 'business_unit', 'nessuno')),
  -- Codici agente oppure nomi di business unit, secondo `tipo`. Ignorato per
  -- 'tutto' e 'nessuno'.
  valori     text[] not null default '{}',
  nota       text,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid references public.utenti(id) on delete set null,

  -- Un perimetro 'agente' senza codici non vuol dire niente: o e' 'tutto', o
  -- e' 'nessuno'. Meglio rifiutarlo alla scrittura che scoprirlo a runtime,
  -- quando l'applicazione lo tratterebbe (correttamente) come "nessun dato" e
  -- l'utente vedrebbe un cruscotto vuoto senza spiegazione.
  constraint perimetro_valori_coerenti check (
    (tipo in ('tutto', 'nessuno') ) or
    (tipo in ('agente', 'business_unit') and array_length(valori, 1) >= 1)
  )
);

comment on table bi_direzionale.perimetro_utente is
  'Quali righe vede ogni utente nel BI. ASSENZA DI RIGA = nessun dato, non tutti i dati: il default silenzioso deve essere restrittivo.';

-- ── 3) Mappatura utente -> codice agente ────────────────────────────────────
-- `public.utenti` NON ha una colonna codice agente: verificato, i campi sono
-- nome, cognome, email, username, ruolo, reparto, responsabile_id, stato,
-- data_assunzione, ruoli_aggiuntivi. Il legame fra la persona che fa login e
-- il codice che compare sui documenti del gestionale non esiste da nessuna
-- parte, ed e' esattamente cio' che serve per dare a un commerciale il proprio
-- perimetro.
--
-- Sta qui e non su `utenti` perche' e' un fatto del BI: `utenti` e' condivisa
-- da tutti i portali e non deve crescere di una colonna ogni volta che un
-- portale ha bisogno di una chiave esterna sua.
create table if not exists bi_direzionale.utente_agente (
  utente_id     uuid not null references public.utenti(id) on delete cascade,
  codice_agente text not null,
  primary key (utente_id, codice_agente)
);

comment on table bi_direzionale.utente_agente is
  'Legame fra utente applicativo e codice agente del gestionale. Un utente puo'' averne piu'' di uno.';

-- Vista di comodo: il perimetro effettivo, con i codici agente gia' risolti.
-- L'applicazione legge questa, non le due tabelle separate.
create or replace view bi_direzionale.perimetro_effettivo as
select
  u.id as utente_id,
  coalesce(p.tipo, 'nessuno') as tipo,
  case
    when p.tipo = 'agente' and coalesce(array_length(p.valori, 1), 0) = 0
      -- Perimetro 'agente' senza elenco esplicito: si usano i codici associati
      -- all'utente. E' il caso normale di un commerciale.
      then coalesce(array_agg(ua.codice_agente) filter (where ua.codice_agente is not null), '{}')
    else coalesce(p.valori, '{}')
  end as valori
from public.utenti u
left join bi_direzionale.perimetro_utente p on p.utente_id = u.id
left join bi_direzionale.utente_agente ua on ua.utente_id = u.id
group by u.id, p.tipo, p.valori;

-- ── 4) Registro delle interrogazioni ────────────────────────────────────────
-- Risponde alla domanda che arriva sempre e sempre troppo tardi: «chi ha visto
-- questo numero?».
--
-- Si registra l'INTENZIONE (la spec, l'SQL, la domanda) e l'ESITO (righe,
-- tempo, errore). MAI i dati restituiti: un registro che contiene i risultati
-- e' una seconda copia degli stessi dati riservati, con gli stessi problemi di
-- accesso e nessuna delle protezioni.
create table if not exists bi_direzionale.registro_query (
  id            bigserial primary key,
  momento       timestamptz not null default now(),
  utente_id     uuid references public.utenti(id) on delete set null,
  livello       text not null,
  perimetro     text not null,
  canale        text not null check (canale in ('spec', 'sql', 'analista', 'export')),
  spec          jsonb,
  sql_testo     text,
  domanda       text,
  righe         int,
  millisecondi  int,
  esito         text not null check (esito in ('ok', 'errore', 'negato')),
  errore        text
);

create index if not exists registro_query_momento_idx
  on bi_direzionale.registro_query (momento desc);
create index if not exists registro_query_utente_idx
  on bi_direzionale.registro_query (utente_id, momento desc);
-- I tentativi negati sono pochi e sono quelli che si vanno a cercare: indice
-- parziale, cosi' costa quasi nulla.
create index if not exists registro_query_negati_idx
  on bi_direzionale.registro_query (momento desc) where esito = 'negato';

comment on table bi_direzionale.registro_query is
  'Audit delle interrogazioni BI. Contiene la domanda e l''esito, mai i dati restituiti.';

-- ── 5) Permessi ─────────────────────────────────────────────────────────────
revoke all on bi_direzionale.perimetro_utente, bi_direzionale.utente_agente,
              bi_direzionale.registro_query
  from anon, authenticated;
revoke all on bi_direzionale.perimetro_effettivo from anon, authenticated;

grant all on bi_direzionale.perimetro_utente, bi_direzionale.utente_agente,
             bi_direzionale.registro_query
  to service_role;
grant select on bi_direzionale.perimetro_effettivo to service_role;
grant usage, select on sequence bi_direzionale.registro_query_id_seq to service_role;

alter table bi_direzionale.perimetro_utente enable row level security;
alter table bi_direzionale.utente_agente     enable row level security;
alter table bi_direzionale.registro_query    enable row level security;

-- Seconda cintura. Il perimetro proprio si puo' leggere (serve all'interfaccia
-- per dire «stai vedendo solo i tuoi dati»); quello altrui no.
drop policy if exists perimetro_proprio on bi_direzionale.perimetro_utente;
create policy perimetro_proprio on bi_direzionale.perimetro_utente
  for select to authenticated
  using (utente_id = auth.uid()
         or public.get_portale_livello(auth.uid(), 'bi') in ('superadmin','admin'));

drop policy if exists utente_agente_proprio on bi_direzionale.utente_agente;
create policy utente_agente_proprio on bi_direzionale.utente_agente
  for select to authenticated
  using (utente_id = auth.uid()
         or public.get_portale_livello(auth.uid(), 'bi') in ('superadmin','admin'));

-- Il registro lo legge solo la direzione: e' l'elenco di cosa ha guardato
-- ciascuno, ed e' a sua volta un dato sensibile.
drop policy if exists registro_solo_direzione on bi_direzionale.registro_query;
create policy registro_solo_direzione on bi_direzionale.registro_query
  for select to authenticated
  using (public.get_portale_livello(auth.uid(), 'bi') in ('superadmin','admin'));

-- ── 6) Retention del registro ───────────────────────────────────────────────
-- Un audit che cresce senza fine diventa il motivo per cui qualcuno lo spegne.
create or replace function bi_direzionale.pulisci_registro(p_giorni int default 365)
returns int
language plpgsql
security definer
set search_path = pg_catalog, bi_direzionale
as $$
declare v_tolte int;
begin
  delete from bi_direzionale.registro_query
  where momento < now() - make_interval(days => greatest(p_giorni, 30));
  get diagnostics v_tolte = row_count;
  return v_tolte;
end $$;

revoke all on function bi_direzionale.pulisci_registro(int) from public, anon, authenticated;
grant execute on function bi_direzionale.pulisci_registro(int) to service_role;

comment on function bi_direzionale.pulisci_registro is
  'Cancella le voci di registro piu'' vecchie di N giorni (minimo 30). Da schedulare accanto ai backup.';

notify pgrst, 'reload schema';
