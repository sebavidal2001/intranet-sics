-- 149_bi_misure_personalizzate.sql
--
-- "Statistiche BI": catalogo delle MISURE PERSONALIZZATE.
--
-- ============================================================================
-- COSA E' UNA MISURA
-- ============================================================================
-- Una definizione DICHIARATIVA composta da metriche gia' certificate (rapporto,
-- differenza, somma, quota, metrica con filtri incorporati). Mai una formula
-- libera: `definizione` e' validata dall'applicazione (`validaMisura` in
-- src/lib/prototipo-bi/misure.ts) a ogni lettura e a ogni esecuzione, e un
-- operatore o una metrica che non esistono vengono rifiutati, non interpretati.
--
-- ============================================================================
-- PERCHE' IL CATALOGO NON E' L'UNICA COPIA
-- ============================================================================
-- Quando un riquadro usa una misura, la sua DEFINIZIONE viene copiata dentro la
-- spec del riquadro (con id e versione di provenienza). Il catalogo serve a
-- trovare e riusare le misure, non a calcolarle: cosi' una dashboard assegnata
-- non cambia numeri da sola se qualcuno modifica la misura, e il motore non
-- consulta il database per eseguire un riquadro.
--
-- ============================================================================
-- IMMUTABILITA'
-- ============================================================================
-- Una riga non si modifica: "cambiare" una misura crea una riga nuova con
-- `versione` + 1 e `sostituisce_id` che punta alla vecchia, e archivia questa.
-- Resta cosi' tracciabile quale definizione ha prodotto un numero.
--
-- Additivo. Rollback: DROP TABLE bi_direzionale.misure;
-- ============================================================================

create table if not exists bi_direzionale.misure (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null check (char_length(btrim(nome)) between 3 and 80),
  -- La definizione in parole, generata al salvataggio: e' cio' che l'utente ha
  -- letto e approvato prima di salvare.
  descrizione    text,
  -- EspressioneMisura (src/lib/prototipo-bi/tipi.ts), validata dall'applicazione.
  definizione    jsonb not null check (jsonb_typeof(definizione) = 'object'),
  versione       int not null default 1 check (versione > 0),
  sostituisce_id uuid references bi_direzionale.misure(id) on delete set null,
  autore_id      uuid not null references public.utenti(id) on delete cascade,
  archiviata_il  timestamptz,
  creato_il      timestamptz not null default now()
);

-- Un nome per misura attiva, senza distinguere maiuscole e spazi ai bordi: due
-- «Margine componenti» nel catalogo non si distinguerebbero nell'elenco.
create unique index if not exists misure_nome_attive_uq
  on bi_direzionale.misure (lower(btrim(nome)))
  where archiviata_il is null;

create index if not exists misure_autore_idx
  on bi_direzionale.misure (autore_id, creato_il desc);

comment on table bi_direzionale.misure is
  'Catalogo delle misure personalizzate del BI. Immutabile: cambiare una misura crea una versione nuova.';
comment on column bi_direzionale.misure.definizione is
  'EspressioneMisura validata dall''applicazione; la spec di un riquadro ne porta una COPIA.';

revoke all on bi_direzionale.misure from anon, authenticated;
grant all on bi_direzionale.misure to service_role;

alter table bi_direzionale.misure enable row level security;

-- Seconda cintura: l'applicazione legge con la service role; questa policy
-- serve solo a chi dovesse interrogare via API con la propria identita'.
-- Il catalogo e' condiviso fra chi puo' costruire dashboard (non fra gli
-- operativi, che ricevono dashboard gia' fatte).
drop policy if exists misure_leggibili on bi_direzionale.misure;
create policy misure_leggibili on bi_direzionale.misure
  for select to authenticated
  using (public.get_portale_livello(auth.uid(), 'bi') in ('superadmin', 'admin', 'exporter'));

notify pgrst, 'reload schema';
