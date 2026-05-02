-- Script per inserire manualmente l'utente admin nella tabella utenti
-- IMPORTANTE: Sostituisci 'your-auth-user-id' con l'ID reale dell'utente da auth.users

-- 1. Prima trova l'ID dell'utente admin da auth.users
-- Esegui questa query per vedere gli utenti esistenti:
-- SELECT id, email FROM auth.users;

-- 2. Poi inserisci il record nella tabella utenti usando l'ID trovato
INSERT INTO public.utenti (id, email, nome, cognome, ruolo, reparto)
VALUES (
  'your-auth-user-id'::uuid,  -- <-- SOSTITUISCI CON L'ID REALE
  'admin@sics.it',             -- <-- Email dell'admin
  'Admin',                     -- <-- Nome
  'SICS',                      -- <-- Cognome
  'admin',                     -- <-- Ruolo
  'Direzione'                  -- <-- Reparto (opzionale)
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  nome = EXCLUDED.nome,
  cognome = EXCLUDED.cognome,
  ruolo = EXCLUDED.ruolo,
  reparto = EXCLUDED.reparto;

-- Verifica che il record sia stato creato:
-- SELECT * FROM utenti WHERE ruolo = 'admin';
