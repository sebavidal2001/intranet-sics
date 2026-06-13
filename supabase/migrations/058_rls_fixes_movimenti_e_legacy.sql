-- 058_rls_fixes_movimenti_e_legacy.sql
-- Due fix di sicurezza segnalati dal database linter Supabase:
--
--  1) [ERROR] rls_disabled_in_public — `ai_presales.knowledge_base` è esposta a
--     PostgREST ma SENZA RLS abilitata. È lo schema AI legacy (precedente a
--     `preventivatore`), non più usato dall'app. Abilitiamo la RLS senza alcuna
--     policy: anon/authenticated non possono leggerla, solo il service_role
--     (lato server) la bypassa. Questo è il warning che genera la mail ricorrente
--     di Supabase ("RLS disabled in public").
--
--  2) [INFO] rls_enabled_no_policy — `preventivatore.movimenti_giacenza` (migration
--     056) ha RLS abilitata ma nessuna policy: corretto per bloccare le scritture
--     dirette (solo la RPC SECURITY DEFINER scrive), ma così NESSUNO può nemmeno
--     leggere lo storico movimenti. Aggiungiamo una policy SELECT per
--     superadmin/amministratore così l'audit log è consultabile.
--
-- Da applicare con ruolo owner/service_role (anche via Supabase SQL Editor).

-- ── 1) Lock-down dello schema AI legacy ──────────────────────────────────────
alter table if exists ai_presales.knowledge_base enable row level security;

-- ── 2) Audit read sui movimenti di giacenza ──────────────────────────────────
drop policy if exists movimenti_giacenza_read on preventivatore.movimenti_giacenza;

create policy movimenti_giacenza_read
  on preventivatore.movimenti_giacenza
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.utenti u
      where u.id = auth.uid()
        and u.ruolo in ('superadmin', 'amministratore')
    )
  );

-- Ricarica la cache schema di PostgREST.
notify pgrst, 'reload schema';
