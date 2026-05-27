-- Migration 042: hardening pre-beta del Preventivatore
--
-- Risolve 3 punti critici emersi nell'audit pre-deploy del 2026-05-26:
--  (A) Race condition su codice G_YY_NNN auto-incrementale
--  (B) Salvataggio builder non atomico (4 INSERT separati, errori silenziosi)
--  (C) RPC dashboard senza filtro commerciale (commerciale ristretto vedeva tutto)
--
-- Vedi 042_beta_hardening.sql nel DB (applicato via MCP).
-- Sintesi:
--  - SEQUENCE preventivatore.codice_g_seq + funzione next_codice_generato(p_anno)
--    con pg_advisory_xact_lock + check anti-collisione con codici manuali.
--  - RPC preventivatore.crea_documento_dal_builder(p_payload jsonb): tutto in
--    transazione, ROLLBACK automatico se INSERT documenti/blocchi/righe/chunks
--    falliscono. Ritorna {id, codice}. Calcola totali server-side dai blocchi
--    (no fiducia nei totali del client).
--  - RPC dashboard_top_clienti + ai_statistiche_per_cliente accettano
--    p_agente_codice opzionale: se non-null filtrano per
--    cm.agente_codice IN (p_agente_codice, 'AIRFLUID').
--
-- Il file SQL completo è stato applicato via MCP — per riferimento e
-- riproducibilità da zero, vedi storia migrazioni Supabase.
-- (La definizione delle 2 RPC con il nuovo parametro p_agente_codice
-- sostituisce quella della migration 041.)

-- ── A. Sequence + funzione next codice ─────────────────────────────────────
-- (vedi DB)
-- CREATE SEQUENCE IF NOT EXISTS preventivatore.codice_g_seq START 1;
-- CREATE FUNCTION preventivatore.next_codice_generato(p_anno int)
--   RETURNS text ... pg_advisory_xact_lock + retry su collisione.

-- ── B. RPC atomico crea_documento_dal_builder ──────────────────────────────
-- (vedi DB)
-- CREATE FUNCTION preventivatore.crea_documento_dal_builder(p_payload jsonb)
--   RETURNS jsonb LANGUAGE plpgsql ... INSERT documenti+blocchi+righe+chunks
--   in transazione singola, ROLLBACK su qualsiasi errore.

-- ── C. RPC dashboard con filtro p_agente_codice ────────────────────────────
-- (vedi DB)
-- CREATE OR REPLACE FUNCTION preventivatore.dashboard_top_clienti(
--   limit_n int DEFAULT 5, window_months int DEFAULT 12,
--   p_agente_codice text DEFAULT NULL  -- nuovo, retrocompatibile
-- ) ...
-- CREATE OR REPLACE FUNCTION preventivatore.ai_statistiche_per_cliente(
--   p_anno int DEFAULT NULL, p_stato text DEFAULT NULL,
--   p_categoria text DEFAULT NULL, p_limit int DEFAULT 50,
--   p_agente_codice text DEFAULT NULL  -- nuovo, retrocompatibile
-- ) ...

-- File placeholder per tracking nel repo. Il contenuto completo è applicato in DB.
SELECT 1;
