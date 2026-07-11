-- 063_harden_public_auth_functions.sql
--
-- [SICUREZZA] Hardening delle funzioni auth SECURITY DEFINER in `public`
-- segnalate dal database linter Supabase (0028/0029/0011):
--   get_portale_livello, get_portali_utente, is_valutazioni_admin.
--
--  1) EXECUTE revocato ad `anon`: l'app le invoca sempre come `authenticated`
--     lato server; non c'è motivo per cui un client non autenticato le chiami.
--  2) search_path fissato: una SECURITY DEFINER con search_path mutabile è
--     vulnerabile a hijacking (una funzione/tabella omonima in uno schema
--     nel search_path del chiamante potrebbe essere risolta al posto di quella
--     attesa). Lo blocchiamo su `public, pg_temp`.
--
-- Applicata al DB di produzione (sics-intranet) il 2026-07-04 via MCP.

revoke execute on function public.get_portale_livello(uuid, text) from anon;
revoke execute on function public.get_portali_utente(uuid)        from anon;
revoke execute on function public.is_valutazioni_admin(uuid)      from anon;

alter function public.get_portale_livello(uuid, text) set search_path = public, pg_temp;
alter function public.get_portali_utente(uuid)        set search_path = public, pg_temp;
alter function public.is_valutazioni_admin(uuid)      set search_path = public, pg_temp;

notify pgrst, 'reload schema';
