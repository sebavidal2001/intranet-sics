-- Script completo per rimuovere tutte le policy RLS problematiche

-- 1. Vediamo quali policy esistono attualmente
SELECT schemaname, tablename, policyname
FROM pg_policies
WHERE tablename = 'utenti';

-- 2. Rimuoviamo TUTTE le policy esistenti sulla tabella utenti
DROP POLICY IF EXISTS admin_full_utenti ON utenti;
DROP POLICY IF EXISTS user_see_self ON utenti;
DROP POLICY IF EXISTS admin_see_all ON utenti;
DROP POLICY IF EXISTS admin_insert_utenti ON utenti;
DROP POLICY IF EXISTS admin_update_utenti ON utenti;
DROP POLICY IF EXISTS admin_delete_utenti ON utenti;
DROP POLICY IF EXISTS direttore_see_addetti ON utenti;
DROP POLICY IF EXISTS user_see_team ON utenti;
DROP POLICY IF EXISTS responsabile_mansionari ON utenti;
DROP POLICY IF EXISTS responsabile_risposte ON utenti;

-- 3. Ricrea SOLO la policy sicura per vedere se stessi
CREATE POLICY user_see_self ON utenti
  FOR SELECT
  USING (id = auth.uid());

-- 4. Policy per vedere i propri collaboratori (se sei responsabile)
CREATE POLICY user_see_team ON utenti
  FOR SELECT
  USING (responsabile_id = auth.uid());

-- 5. Verifica le nuove policy
SELECT schemaname, tablename, policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'utenti';
