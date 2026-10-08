-- 144_bi_dashboard_assegnazioni.sql
--
-- "Statistiche BI": la direzione costruisce le dashboard e le ASSEGNA ai
-- dipendenti, che vedono solo quelle.
--
-- ============================================================================
-- PERCHE' UNA TABELLA E NON UN TERZO VALORE DI `visibilita`
-- ============================================================================
-- `visibilita` ('privata' | 'condivisa') risponde a "chi fra gli abilitati al
-- BI puo' aprirla": o nessuno o tutti. Non sa dire "queste cinque persone". Una
-- dashboard assegnata a Mario resta privata per tutti gli altri: l'assegnazione
-- e' un'ALTRA dimensione, e la sua assenza non cambia niente di quanto c'era.
--
-- Chi riceve una dashboard la esegue sul PROPRIO perimetro (le dashboard
-- portano le domande, non le risposte): assegnare non fa uscire dati dal
-- perimetro di nessuno. Per questo l'assegnazione va accompagnata da un
-- perimetro in `perimetro_utente`: senza riga il BI e' fail-closed e il
-- dipendente vedrebbe una dashboard vuota.
--
-- Additivo. Rollback: DROP TABLE bi_direzionale.dashboard_assegnazioni;
-- ============================================================================

create table if not exists bi_direzionale.dashboard_assegnazioni (
  dashboard_id uuid not null references bi_direzionale.dashboard(id) on delete cascade,
  utente_id    uuid not null references public.utenti(id) on delete cascade,
  assegnata_da uuid references public.utenti(id) on delete set null,
  assegnata_il timestamptz not null default now(),
  primary key (dashboard_id, utente_id)
);

-- La domanda frequente e' "quali dashboard ha questo utente".
create index if not exists dashboard_assegnazioni_utente_idx
  on bi_direzionale.dashboard_assegnazioni (utente_id);

comment on table bi_direzionale.dashboard_assegnazioni is
  'Dashboard assegnate a un utente dalla direzione. Chi non e'' direzione vede solo queste.';

revoke all on bi_direzionale.dashboard_assegnazioni from anon, authenticated;
grant all on bi_direzionale.dashboard_assegnazioni to service_role;

alter table bi_direzionale.dashboard_assegnazioni enable row level security;

-- Seconda cintura: l'applicazione legge con la service role; questa policy
-- serve solo a chi dovesse interrogare via API con la propria identita'.
drop policy if exists assegnazioni_proprie on bi_direzionale.dashboard_assegnazioni;
create policy assegnazioni_proprie on bi_direzionale.dashboard_assegnazioni
  for select to authenticated
  using (utente_id = auth.uid()
         or public.get_portale_livello(auth.uid(), 'bi') in ('superadmin','admin'));

-- ── Il nome che vede l'utente ───────────────────────────────────────────────
-- Il codice interno resta `bi` (e' la chiave di permessi_utente e dei link): si
-- cambia solo l'etichetta.
update public.portali
set nome = 'Statistiche BI',
    descrizione = 'Dashboard e statistiche sui dati commerciali: ognuno vede quelle che la direzione gli ha assegnato.',
    labels_livelli = jsonb_build_object(
      'admin',    'Direzione',
      'exporter', 'Responsabile',
      'viewer',   'Dashboard assegnate'
    )
where slug = 'bi';

notify pgrst, 'reload schema';
