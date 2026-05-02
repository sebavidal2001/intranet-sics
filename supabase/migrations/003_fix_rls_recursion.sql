-- Fix: Rimuovi la policy ricorsiva e semplifica

-- Drop tutte le policy esistenti
drop policy if exists admin_full_utenti on utenti;
drop policy if exists user_see_self on utenti;

-- Policy semplice: ogni utente può vedere solo se stesso
create policy user_see_self on utenti
  for select
  using (id = auth.uid());

-- Policy: ogni utente può vedere i propri diretti collaboratori
create policy user_see_team on utenti
  for select
  using (responsabile_id = auth.uid());

-- Per le operazioni admin (insert, update, delete), useremo service_role
-- quindi non servono policy RLS per quelle operazioni.
-- Le policy saranno gestite a livello applicativo.
