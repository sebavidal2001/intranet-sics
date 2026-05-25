-- Migration 040: collega utenti al loro codice agente del Cruscotto Dinamico.
-- Usato per il filtro "io commerciale vedo solo i miei clienti" (+ sempre AIRFLUID).

ALTER TABLE public.utenti
  ADD COLUMN IF NOT EXISTS preventivatore_agente_codice TEXT;

COMMENT ON COLUMN public.utenti.preventivatore_agente_codice IS
  'Codice agente del Cruscotto (es. AG010035) per il filtro "io commerciale vedo i miei".'
  ' NULL = utente vede tutto (admin/back_office/preventivatore). Match con clienti_master.agente_codice.'
  ' Eccezione: il portfolio "AIRFLUID" è SEMPRE visibile a tutti i commerciali.';

CREATE INDEX IF NOT EXISTS utenti_preventivatore_agente_codice
  ON public.utenti(preventivatore_agente_codice)
  WHERE preventivatore_agente_codice IS NOT NULL;

NOTIFY pgrst, 'reload schema';
