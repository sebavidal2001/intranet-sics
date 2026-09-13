-- 107_bi_dashboard_a_pagine.sql
--
-- Una dashboard contiene più PAGINE, ognuna con i suoi riquadri.
--
-- ============================================================================
-- PERCHE' UN LIVELLO IN MEZZO
-- ============================================================================
-- La 104 aveva `dashboard` -> `dashboard_analisi`: una griglia sola per
-- dashboard. Ma un tema vero non sta in una schermata: "Commerciale 2026" vuole
-- una pagina di sintesi, una per agente, una per business unit, una sulla
-- pipeline. Senza il livello in mezzo l'utente crea quattro dashboard scollegate
-- e i filtri li rimette a mano quattro volte.
--
-- ============================================================================
-- I FILTRI STANNO SULLA PAGINA, NON SUL RIQUADRO
-- ============================================================================
-- E' la decisione che distingue una dashboard da una raccolta di grafici: si
-- sceglie periodo, business unit e agente una volta in alto, e tutti i riquadri
-- della pagina si adeguano. `filtri_comuni` era su `dashboard` (104) e scende su
-- `pagina`, perche' pagine diverse dello stesso tema guardano periodi e
-- perimetri diversi — la sintesi annuale e il dettaglio del mese in corso.
--
-- ============================================================================
-- COSA NON CAMBIA
-- ============================================================================
-- Un riquadro resta un puntatore a un'`analisi`, cioe' a una SPEC. Le pagine
-- condivise portano le domande, non le risposte: chi le apre le riesegue sul
-- proprio perimetro e vede i propri numeri. Se qui salvassimo i risultati, una
-- pagina condivisa diventerebbe il modo piu' comodo per far uscire dati dal
-- perimetro di chi l'ha costruita.
--
-- Le tre tabelle della 104 sono VUOTE su entrambi i database (verificato il
-- 13/09/2026): la ristrutturazione non migra dati, e `dashboard_analisi` si puo'
-- ricreare invece di alterarla.
--
-- Rollback: DROP TABLE bi_direzionale.dashboard_pagine CASCADE;
--           e ripristino di dashboard_analisi come da 104.
-- ============================================================================

-- ── 1) Le pagine ────────────────────────────────────────────────────────────
create table if not exists bi_direzionale.dashboard_pagine (
  id            uuid primary key default gen_random_uuid(),
  dashboard_id  uuid not null references bi_direzionale.dashboard(id) on delete cascade,
  titolo        text not null check (length(btrim(titolo)) > 0),
  ordine        int not null default 0,
  -- Periodo, business unit, agente: valgono per tutti i riquadri della pagina.
  filtri        jsonb not null default '{}'::jsonb,
  creato_il     timestamptz not null default now()
);

create index if not exists dashboard_pagine_ordine_idx
  on bi_direzionale.dashboard_pagine (dashboard_id, ordine);

comment on table bi_direzionale.dashboard_pagine is
  'Pagine di una dashboard. I filtri stanno qui e valgono per tutti i riquadri della pagina.';

-- ── 2) I riquadri appesi alla pagina ────────────────────────────────────────
-- Ricreata invece che alterata: era vuota, e una PK diversa su una tabella
-- vuota non merita una ALTER in tre passi.
drop table if exists bi_direzionale.dashboard_analisi;

create table if not exists bi_direzionale.dashboard_riquadri (
  id          uuid primary key default gen_random_uuid(),
  pagina_id   uuid not null references bi_direzionale.dashboard_pagine(id) on delete cascade,
  analisi_id  uuid not null references bi_direzionale.analisi(id) on delete cascade,
  -- Il titolo del riquadro può differire da quello dell'analisi: la stessa
  -- analisi compare in pagine diverse con nomi adatti al contesto.
  titolo      text,
  posizione   int not null default 0,
  larghezza   int not null default 6 check (larghezza between 1 and 12),
  altezza     int not null default 4 check (altezza between 1 and 12),
  -- Sovrascrive il grafico scelto dall'analisi, quando in questa pagina serve
  -- guardare lo stesso dato in un altro modo.
  grafico     text,
  creato_il   timestamptz not null default now(),
  -- La stessa analisi non ha senso due volte nella stessa pagina.
  unique (pagina_id, analisi_id)
);

create index if not exists dashboard_riquadri_ordine_idx
  on bi_direzionale.dashboard_riquadri (pagina_id, posizione);

-- ── 3) `filtri_comuni` scende dalla dashboard alla pagina ───────────────────
alter table bi_direzionale.dashboard drop column if exists filtri_comuni;

-- Descrizione della dashboard: serve nell'elenco, per capire cosa contiene
-- senza aprirla.
alter table bi_direzionale.dashboard add column if not exists descrizione text;

-- ── 4) Permessi ─────────────────────────────────────────────────────────────
revoke all on bi_direzionale.dashboard_pagine, bi_direzionale.dashboard_riquadri
  from anon, authenticated;
grant all on bi_direzionale.dashboard_pagine, bi_direzionale.dashboard_riquadri
  to service_role;

alter table bi_direzionale.dashboard_pagine    enable row level security;
alter table bi_direzionale.dashboard_riquadri  enable row level security;

-- Seconda cintura: si vede una pagina se si vede la dashboard che la contiene.
drop policy if exists pagine_visibili on bi_direzionale.dashboard_pagine;
create policy pagine_visibili on bi_direzionale.dashboard_pagine
  for select to authenticated
  using (exists (
    select 1 from bi_direzionale.dashboard d
    where d.id = dashboard_id
      and (d.autore_id = auth.uid() or d.visibilita = 'condivisa')
  ));

drop policy if exists riquadri_visibili on bi_direzionale.dashboard_riquadri;
create policy riquadri_visibili on bi_direzionale.dashboard_riquadri
  for select to authenticated
  using (exists (
    select 1
    from bi_direzionale.dashboard_pagine p
    join bi_direzionale.dashboard d on d.id = p.dashboard_id
    where p.id = pagina_id
      and (d.autore_id = auth.uid() or d.visibilita = 'condivisa')
  ));

-- ── 5) Lettura di una dashboard intera in un colpo ──────────────────────────
-- L'alternativa sarebbe una query per la dashboard, una per le pagine e una per
-- i riquadri di ogni pagina: su quattro pagine sono sei viaggi per disegnare una
-- schermata. Qui esce un solo oggetto annidato.
--
-- Restituisce le SPEC, mai i dati: chi apre la pagina esegue le spec con il
-- proprio perimetro.
create or replace function bi_direzionale.dashboard_completa(p_dashboard_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, bi_direzionale
as $$
  select to_jsonb(d) || jsonb_build_object(
    'pagine',
    coalesce((
      select jsonb_agg(
        to_jsonb(p) || jsonb_build_object(
          'riquadri',
          coalesce((
            select jsonb_agg(
              to_jsonb(r) || jsonb_build_object(
                'analisi', to_jsonb(a)
              ) order by r.posizione
            )
            from bi_direzionale.dashboard_riquadri r
            join bi_direzionale.analisi a on a.id = r.analisi_id
            where r.pagina_id = p.id
          ), '[]'::jsonb)
        ) order by p.ordine
      )
      from bi_direzionale.dashboard_pagine p
      where p.dashboard_id = d.id
    ), '[]'::jsonb)
  )
  from bi_direzionale.dashboard d
  where d.id = p_dashboard_id;
$$;

revoke all on function bi_direzionale.dashboard_completa(uuid) from public, anon, authenticated;
grant execute on function bi_direzionale.dashboard_completa(uuid) to service_role;

comment on function bi_direzionale.dashboard_completa is
  'Una dashboard con pagine e riquadri annidati, in una sola lettura. Restituisce le spec, mai i dati.';

notify pgrst, 'reload schema';
