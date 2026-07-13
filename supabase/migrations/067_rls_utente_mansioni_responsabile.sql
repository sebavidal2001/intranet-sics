-- 067_rls_utente_mansioni_responsabile.sql
--
-- [BUGFIX] Il responsabile vede le skill ma NON le mansioni del collaboratore
-- nella scheda di valutazione.
--
-- Causa: la pagina responsabile (valutazioni/responsabile/[id]/page.tsx) legge
-- `utente_mansioni` e `sessione_skills` con il client utente (RLS attiva). Le due
-- policy SELECT erano incoerenti:
--   - `sessione_skills_select`  → consente la lettura anche al `responsabile_id`
--   - `utente_mansioni_select`  → consentiva SOLO `utente_id = auth.uid()` o admin
-- Quindi il responsabile vedeva le skill della sessione ma NON le mansioni del
-- collaboratore (che appartengono all'utente valutato, non a lui). I dati c'erano,
-- mancava il permesso di lettura → form incompleto (solo skill).
--
-- Fix: allinea `utente_mansioni_select` alla logica di `sessione_skills_select`,
-- consentendo la lettura anche al responsabile di una sessione dell'utente.
-- Nessun reset dati necessario.
--
-- Verificato (transazione, ROLLBACK): mansioni di un collaboratore viste dal suo
-- responsabile passano da 0 a 15.

drop policy if exists utente_mansioni_select on public.utente_mansioni;

create policy utente_mansioni_select on public.utente_mansioni
  for select using (
    utente_id = auth.uid()
    or is_valutazioni_admin(auth.uid())
    or exists (
      select 1 from public.sessioni_utente su
      where su.utente_id = utente_mansioni.utente_id
        and su.responsabile_id = auth.uid()
    )
  );
