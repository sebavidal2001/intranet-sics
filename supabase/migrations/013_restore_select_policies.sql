-- ============================================================
-- Migration 013: Ripristina SELECT policy eliminate dal CASCADE di migration 012
--
-- Il DROP FUNCTION ... CASCADE ha rimosso anche le policy SELECT
-- che includevano is_valutazioni_admin() come condizione OR.
-- Senza queste policy gli utenti non vedono le proprie sessioni/risposte.
-- ============================================================

-- sessioni_utente — SELECT: utente vede le proprie, responsabile vede quelle assegnate, admin vede tutto
DROP POLICY IF EXISTS "sessioni_utente_select" ON sessioni_utente;
CREATE POLICY "sessioni_utente_select" ON sessioni_utente
  FOR SELECT TO authenticated
  USING (
    utente_id = auth.uid()
    OR responsabile_id = auth.uid()
    OR is_valutazioni_admin(auth.uid())
  );

-- risposte_valutazione — SELECT: valutatore vede le proprie, utente/responsabile della sessione, admin vede tutto
DROP POLICY IF EXISTS "risposte_val_select" ON risposte_valutazione;
CREATE POLICY "risposte_val_select" ON risposte_valutazione
  FOR SELECT TO authenticated
  USING (
    valutatore_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM sessioni_utente su
      WHERE su.id = sessione_utente_id
        AND (su.utente_id = auth.uid() OR su.responsabile_id = auth.uid())
    )
    OR is_valutazioni_admin(auth.uid())
  );

-- utente_mansioni — SELECT: utente vede le proprie, admin vede tutto
DROP POLICY IF EXISTS "utente_mansioni_select" ON utente_mansioni;
CREATE POLICY "utente_mansioni_select" ON utente_mansioni
  FOR SELECT TO authenticated
  USING (
    utente_id = auth.uid()
    OR is_valutazioni_admin(auth.uid())
  );

-- sessione_skills — SELECT: utente/responsabile della sessione, admin vede tutto
DROP POLICY IF EXISTS "sessione_skills_select" ON sessione_skills;
CREATE POLICY "sessione_skills_select" ON sessione_skills
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sessioni_utente su
      WHERE su.id = sessione_id
        AND (su.utente_id = auth.uid() OR su.responsabile_id = auth.uid())
    )
    OR is_valutazioni_admin(auth.uid())
  );

-- storico_punteggi — SELECT: utente vede il proprio, admin vede tutto
DROP POLICY IF EXISTS "storico_select" ON storico_punteggi;
CREATE POLICY "storico_select" ON storico_punteggi
  FOR SELECT TO authenticated
  USING (
    utente_id = auth.uid()
    OR is_valutazioni_admin(auth.uid())
  );

-- utenti — SELECT anche self (la policy admin non copre il self-read)
DROP POLICY IF EXISTS "utenti_self_select" ON utenti;
CREATE POLICY "utenti_self_select" ON utenti
  FOR SELECT TO authenticated
  USING (id = auth.uid());
