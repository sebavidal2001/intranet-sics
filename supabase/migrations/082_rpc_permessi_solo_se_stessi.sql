-- Migration 082: le RPC dei permessi rispondono solo su se stessi
--
-- `get_portale_livello`, `get_portali_utente` e `is_valutazioni_admin` sono
-- SECURITY DEFINER, accettano `p_user_id` e avevano EXECUTE per PUBLIC: erano
-- quindi interrogabili **senza login** via `/rest/v1/rpc/...` per QUALSIASI
-- utente, permettendo di mappare chi ha accesso a cosa.
--
-- La 081 revocava `anon`, ma senza effetto: il permesso arrivava da PUBLIC.
-- Qui si revoca da PUBLIC e si concede esplicitamente a `authenticated` (che
-- serve davvero: `getPortaleAccesso` gira sul client utente) e a
-- `service_role`. In più le funzioni rispondono solo se il chiamante chiede di
-- sé, salvo che sia il service role — che è come gira la pagina admin dei
-- permessi, l'unico punto che legge i livelli altrui.

-- ── get_portale_livello ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_portale_livello(p_user_id uuid, p_slug text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    -- Blocco solo le richieste che arrivano via API con un'identità utente:
    -- un utente autenticato può interrogare SOLO se stesso. Il service role
    -- (app server-side) e le connessioni dirette al DB (migrazioni, script,
    -- psql: `auth.role()` nullo) restano libere — senza la condizione su NULL
    -- ogni script server-side riceverebbe NULL in silenzio.
    WHEN auth.role() IS NOT NULL
         AND auth.role() <> 'service_role'
         AND p_user_id IS DISTINCT FROM auth.uid()
      THEN NULL

    WHEN EXISTS (
      SELECT 1 FROM utenti WHERE id = p_user_id AND ruolo = 'superadmin'
    ) THEN 'superadmin'

    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id AND p.slug = p_slug AND p.is_attivo = true
        AND coalesce(pu.is_portal_admin, false) = true
    ) THEN 'admin'

    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id AND p.slug = p_slug AND p.is_attivo = true
        AND coalesce(pu.override_export, false) = true
        AND coalesce(pu.is_portal_admin, false) = false
    ) THEN 'exporter'

    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id AND p.slug = p_slug AND p.is_attivo = true
        AND coalesce(pu.override_access, false) = true
        AND coalesce(pu.override_export, false) = false
        AND coalesce(pu.is_portal_admin, false) = false
    ) THEN 'viewer'

    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id AND p.slug = p_slug AND p.is_attivo = true
        AND coalesce(pu.override_access, false) = false
        AND coalesce(pu.is_portal_admin, false) = false
    ) THEN NULL

    WHEN EXISTS (
      SELECT 1 FROM utenti u JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id AND p.slug = p_slug AND pp.can_approve = true AND p.is_attivo = true
    ) THEN 'admin'

    WHEN EXISTS (
      SELECT 1 FROM utenti u JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id AND p.slug = p_slug AND pp.can_export = true AND p.is_attivo = true
    ) THEN 'exporter'

    WHEN EXISTS (
      SELECT 1 FROM utenti u JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id AND p.slug = p_slug AND pp.can_access = true AND p.is_attivo = true
    ) THEN 'viewer'

    ELSE NULL
  END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_portale_livello(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_portale_livello(uuid, text) TO authenticated, service_role;

-- ── is_valutazioni_admin ─────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.is_valutazioni_admin(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_valutazioni_admin(uuid) TO authenticated, service_role;

-- ── get_portali_utente ───────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_portali_utente(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_portali_utente(uuid) TO authenticated, service_role;

-- ── get_preventivatore_context ───────────────────────────────────────────────
-- Chiamata solo server-side con la service role key (`ruoli.ts`): niente
-- EXECUTE per gli utenti finali.
REVOKE EXECUTE ON FUNCTION public.get_preventivatore_context(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_preventivatore_context(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
