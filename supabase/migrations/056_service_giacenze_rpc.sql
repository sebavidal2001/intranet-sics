-- 056_service_giacenze_rpc.sql
-- RPC per movimentare preventivatore.prodotti_giacenze da sics_service.
-- Da applicare nel progetto Supabase intranet-sics con ruolo owner/service_role.
-- Non concede UPDATE diretto al client: gli utenti authenticated possono solo eseguire la RPC.
--
-- Note di verifica (2026-05-30):
--   * preventivatore.prodotti_giacenze.aggiornato_il ESISTE (timestamptz) -> l'UPDATE la valorizza.
--   * PK prodotti_giacenze = (codice, magazzino): il lookup/lock usa entrambe le chiavi.
--   * Guard autorizzazione: solo superadmin/amministratore OPPURE operatori abilitati (service.operatori_abilitati).
--   * search_path fissato (preventivatore, service, public) -> niente search_path mutable.
--   * movimenti_giacenza ha RLS attiva senza policy: scrivibile solo dalla RPC SECURITY DEFINER (owner).

create table if not exists preventivatore.movimenti_giacenza (
  id uuid primary key default gen_random_uuid(),
  codice text not null,
  magazzino text not null,
  delta numeric not null,
  causale text,
  rif_attivita uuid,
  eseguito_da uuid default auth.uid(),
  creato_il timestamptz not null default now()
);

alter table preventivatore.movimenti_giacenza enable row level security;

create or replace function preventivatore.movimenta_giacenza(
  p_codice text,
  p_magazzino text,
  p_delta numeric,
  p_causale text default null,
  p_rif_attivita uuid default null
)
returns table(codice text, magazzino text, esistenza numeric, disponibilita numeric)
language plpgsql
security definer
set search_path = preventivatore, service, public
as $$
declare
  v_disp numeric;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Utente non autenticato' using errcode = '28000';
  end if;

  v_role := service.current_user_ruolo();

  if v_role not in ('superadmin', 'amministratore')
     and not exists (
       select 1
       from service.operatori_abilitati oa
       where oa.utente_id = auth.uid()
     ) then
    raise exception 'Utente non autorizzato alla movimentazione magazzino' using errcode = '42501';
  end if;

  if p_delta is null or p_delta = 0 then
    raise exception 'Delta non valido' using errcode = '22023';
  end if;

  select g.disponibilita
    into v_disp
  from preventivatore.prodotti_giacenze g
  where g.codice = p_codice
    and g.magazzino = p_magazzino
  for update;

  if not found then
    raise exception 'Giacenza inesistente: % / %', p_codice, p_magazzino using errcode = 'P0002';
  end if;

  if p_delta < 0 and (v_disp + p_delta) < 0 then
    raise exception 'Disponibilita insufficiente: % disponibili, richiesti %', v_disp, -p_delta using errcode = 'P0001';
  end if;

  update preventivatore.prodotti_giacenze g
     set esistenza = g.esistenza + p_delta,
         disponibilita = g.disponibilita + p_delta,
         aggiornato_il = now()
   where g.codice = p_codice
     and g.magazzino = p_magazzino;

  insert into preventivatore.movimenti_giacenza(codice, magazzino, delta, causale, rif_attivita)
  values (p_codice, p_magazzino, p_delta, p_causale, p_rif_attivita);

  return query
    select g.codice, g.magazzino, g.esistenza, g.disponibilita
    from preventivatore.prodotti_giacenze g
    where g.codice = p_codice
      and g.magazzino = p_magazzino;
end;
$$;

revoke all on function preventivatore.movimenta_giacenza(text, text, numeric, text, uuid) from public, anon;
grant execute on function preventivatore.movimenta_giacenza(text, text, numeric, text, uuid) to authenticated;
