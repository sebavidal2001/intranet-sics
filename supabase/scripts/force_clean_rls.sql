-- Script forzato per eliminare TUTTE le policy sulla tabella utenti
-- e risolvere definitivamente l'errore 42P17 (infinite recursion).
DO $$ 
DECLARE 
    pol record;
BEGIN 
    FOR pol IN 
        SELECT policyname 
        FROM pg_policies 
        WHERE tablename = 'utenti' AND schemaname = 'public'
    LOOP 
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol.policyname) || ' ON public.utenti'; 
    END LOOP; 
END $$;

-- Ricrea solo le policy sicure e non ricorsive
CREATE POLICY user_see_self ON public.utenti 
  FOR SELECT 
  USING (id = auth.uid());

CREATE POLICY user_see_team ON public.utenti 
  FOR SELECT 
  USING (responsabile_id = auth.uid());
