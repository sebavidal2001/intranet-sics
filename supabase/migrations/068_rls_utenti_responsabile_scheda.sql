-- 068_rls_utenti_responsabile_scheda.sql
--
-- [BUGFIX latente — stessa classe del 067] La pagina responsabile legge la riga
-- `utenti` del COLLABORATORE valutato con il client utente (RLS). Le policy di
-- `utenti` permettono la lettura di un'altra persona solo a:
--   - se stessi (`user_see_self` / `utenti_self_select`: id = auth.uid())
--   - il proprio team in ORGANIGRAMMA (`user_see_team`: responsabile_id = auth.uid())
--   - admin valutazioni
-- Ma il responsabile di una SCHEDA è definito da `sessioni_utente.responsabile_id`,
-- che puo differire dal `utenti.responsabile_id` (manager organizzativo). Se l'admin
-- assegna una scheda a un responsabile non-admin che NON e il manager del valutato,
-- il read di `utenti` torna vuoto → la pagina fa redirect e la valutazione e
-- impossibile. Oggi i 3 casi di mismatch sono tutti admin/auto-valutazione (coperti),
-- quindi il bug e latente ma reale: si manifesta al primo responsabile "trasversale".
--
-- Fix: aggiunge una policy che consente al responsabile di una scheda di leggere la
-- riga `utenti` del collaboratore valutato. Coerente con le policy gia in essere su
-- `sessioni_utente`/`sessione_skills`/`risposte_valutazione`/`utente_mansioni` (067),
-- che tutte riconoscono `sessioni_utente.responsabile_id = auth.uid()`.

drop policy if exists utenti_resp_scheda_select on public.utenti;

create policy utenti_resp_scheda_select on public.utenti
  for select using (
    exists (
      select 1 from public.sessioni_utente su
      where su.utente_id = utenti.id
        and su.responsabile_id = auth.uid()
    )
  );
