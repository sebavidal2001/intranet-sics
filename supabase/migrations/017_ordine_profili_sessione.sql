-- Migration 017: Aggiunge ordine_profili a sessioni_utente
-- Permette di definire l'ordine dei profili professionali nel questionario per ogni dipendente

ALTER TABLE sessioni_utente
  ADD COLUMN IF NOT EXISTS ordine_profili jsonb DEFAULT '[]'::jsonb;
