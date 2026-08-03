-- Migration 081: hardening permessi — NULL-safety, revoca EXECUTE ad anon, RLS mancante
--
-- Tre interventi indipendenti, tutti sul lato permessi.

-- ── A. get_portale_livello: NULL-safety sugli override ───────────────────────
--
-- BUG: i rami usavano `override_export = false` e `override_access = false`.
-- In `permessi_utente` quelle colonne sono nullable e 4 utenti su 5 avevano
-- `override_access = true, override_export = NULL`. Con la logica a tre valori
-- `true AND NULL` → NULL, quindi il ramo 'viewer' NON matchava, si cadeva nel
-- fallback per ruolo, e per `collaboratore` non esiste riga in
-- `permessi_portale` per il preventivatore → livello NULL = accesso negato.
--
-- Effetto pratico: Valeria Battelani, Daniele Boni, Jessica Gordini e Gregor
-- Sacchi risultavano SENZA accesso al Preventivatore pur avendo
-- `override_access = true` esplicito. Ora un NULL su `override_export` viene
-- letto come `false` (= nessun export), quindi l'intento "questo utente accede"
-- viene rispettato al livello minimo.
CREATE OR REPLACE FUNCTION public.get_portale_livello(p_user_id uuid, p_slug text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM utenti
      WHERE id = p_user_id AND ruolo = 'superadmin'
    ) THEN 'superadmin'

    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND p.is_attivo = true
        AND coalesce(pu.is_portal_admin, false) = true
    ) THEN 'admin'

    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND p.is_attivo = true
        AND coalesce(pu.override_export, false) = true
        AND coalesce(pu.is_portal_admin, false) = false
    ) THEN 'exporter'

    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND p.is_attivo = true
        AND coalesce(pu.override_access, false) = true
        AND coalesce(pu.override_export, false) = false
        AND coalesce(pu.is_portal_admin, false) = false
    ) THEN 'viewer'

    -- Override esplicito di NEGAZIONE: batte il permesso di ruolo.
    WHEN EXISTS (
      SELECT 1 FROM permessi_utente pu
      JOIN portali p ON p.id = pu.portale_id
      WHERE pu.utente_id = p_user_id
        AND p.slug = p_slug
        AND p.is_attivo = true
        AND coalesce(pu.override_access, false) = false
        AND coalesce(pu.is_portal_admin, false) = false
    ) THEN NULL

    WHEN EXISTS (
      SELECT 1 FROM utenti u
      JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id
        AND p.slug = p_slug
        AND pp.can_approve = true
        AND p.is_attivo = true
    ) THEN 'admin'

    WHEN EXISTS (
      SELECT 1 FROM utenti u
      JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id
        AND p.slug = p_slug
        AND pp.can_export = true
        AND p.is_attivo = true
    ) THEN 'exporter'

    WHEN EXISTS (
      SELECT 1 FROM utenti u
      JOIN permessi_portale pp ON pp.ruolo = u.ruolo
      JOIN portali p ON p.id = pp.portale_id
      WHERE u.id = p_user_id
        AND p.slug = p_slug
        AND pp.can_access = true
        AND p.is_attivo = true
    ) THEN 'viewer'

    ELSE NULL
  END;
$function$;

-- ── B. Revoca EXECUTE ad `anon` sulle funzioni permessi ──────────────────────
--
-- NOTA: questi REVOKE da soli NON bastano — il permesso arriva da PUBLIC, non
-- da un grant diretto ad `anon`. La revoca efficace (`FROM PUBLIC`) e il
-- controllo "solo su se stessi" sono nella migration 082.
--
-- Erano invocabili SENZA login via `/rest/v1/rpc/...` e accettano `p_user_id`
-- come parametro: un non autenticato poteva enumerare il livello di accesso di
-- qualunque utente. Nessun uso legittimo da anon — l'app le chiama sempre
-- server-side con la service role key.
REVOKE EXECUTE ON FUNCTION public.get_portale_livello(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_portali_utente(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_valutazioni_admin(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_preventivatore_context(uuid) FROM anon;

-- `get_preventivatore_context` restava interrogabile da QUALSIASI utente
-- autenticato per QUALSIASI p_user_id (lettura di ruoli e codice agente altrui).
REVOKE EXECUTE ON FUNCTION public.get_preventivatore_context(uuid) FROM authenticated;

-- ── C. schede_approvate: RLS attiva ma nessuna policy ────────────────────────
-- Con RLS attiva e zero policy la tabella è di fatto accessibile solo via
-- service role. È il comportamento voluto (le schede si leggono dalle route),
-- ma va reso esplicito: senza policy il linter la segnala come sospetta e non
-- si capisce se sia una dimenticanza.
DROP POLICY IF EXISTS "service_role_only" ON preventivatore.schede_approvate;
CREATE POLICY "service_role_only" ON preventivatore.schede_approvate
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

NOTIFY pgrst, 'reload schema';
