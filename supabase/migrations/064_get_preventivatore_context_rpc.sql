-- 064_get_preventivatore_context_rpc.sql
--
-- [PERFORMANCE / SCALABILITÀ] RPC unica per il contesto permessi Preventivatore.
--
-- Ogni route API faceva 3 round-trip DB seriali per autorizzare la richiesta:
--   1) public.get_portale_livello(user, 'preventivatore')
--   2) ruoli funzionali (preventivatore.utente_ruoli_funzionali + ruoli_funzionali)
--   3) utenti.preventivatore_agente_codice
-- Questa funzione li collassa in una singola query, consumata dall'helper
-- `getPreventivatoreContext` e dal guard `requirePreventivatore`
-- (src/lib/portali/preventivatore/api-guard.ts).
--
-- SECURITY DEFINER: dopo la migration 062 `authenticated` non ha più grant su
-- preventivatore.*, quindi la lettura dei ruoli deve avvenire come definer.
-- Restituisce solo i dati di permesso dell'utente richiesto (nessun leak).
--
-- Applicata al DB di produzione (sics-intranet) il 2026-07-04 via MCP.

create or replace function public.get_preventivatore_context(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'livello', public.get_portale_livello(p_user_id, 'preventivatore'),
    'ruoli', coalesce(
      (select array_agg(rf.slug order by rf.slug)
         from preventivatore.utente_ruoli_funzionali urf
         join preventivatore.ruoli_funzionali rf on rf.id = urf.ruolo_id
        where urf.utente_id = p_user_id),
      array[]::text[]
    ),
    'agente_codice', (
      select u.preventivatore_agente_codice
        from public.utenti u
       where u.id = p_user_id
    )
  );
$$;

revoke all on function public.get_preventivatore_context(uuid) from public, anon;
grant execute on function public.get_preventivatore_context(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
