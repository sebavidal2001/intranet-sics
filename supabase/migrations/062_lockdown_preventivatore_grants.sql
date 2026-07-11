-- 062_lockdown_preventivatore_grants.sql
--
-- [SICUREZZA — CRITICO] Chiude il data-leak dello schema `preventivatore`.
--
-- Problema:
--   Le policy RLS di migration 021 concedono `SELECT` a QUALSIASI utente
--   autenticato su documenti, clienti, clienti_master, prodotti, chunks,
--   chat, template, ecc. (33 tabelle) + `anon` su articoli_service. Inoltre
--   le RPC di scope commerciale (dashboard_*, ai_*, info_cliente, ...) sono
--   GRANT EXECUTE TO authenticated con `p_agente_codice` scelto dal chiamante
--   (NULL = tutti i clienti).
--
--   Conseguenza: un qualunque utente con account intranet — anche SENZA
--   accesso al portale Preventivatore — può leggere tutti i preventivi,
--   clienti e prezzi (incluso `prodotti.ult_costo`) chiamando direttamente
--   PostgREST (`/rest/v1/...` o `/rest/v1/rpc/...`) con il proprio JWT,
--   bypassando lo scope commerciale "vedo solo i miei clienti" implementato
--   SOLO nel layer applicativo.
--
-- Fix (chirurgico — preserva l'integrazione esterna sics_service):
--   L'app intranet accede ai dati `preventivatore` ESCLUSIVAMENTE lato server
--   con il client service_role (createAdminClient), che bypassa RLS e ha i
--   propri grant. L'UNICO consumatore legittimo via JWT `authenticated`/`anon`
--   è l'app esterna **sics_service**, che usa un contratto ristretto:
--     - viste `articoli_service` (giacenze+anagrafica prodotti) e
--       `clienti_service` (anagrafica clienti minimale)
--     - RPC `movimenta_giacenza(...)` (scarico/reintegro magazzino)
--     - lettura audit `movimenti_giacenza` (RLS: solo superadmin/amministratore)
--
--   Quindi: revochiamo OGNI privilegio diretto a `authenticated`/`anon` su
--   tutte le tabelle e funzioni dello schema, MA manteniamo USAGE sullo schema
--   e ri-concediamo il solo contratto service.
--
--   `clienti_service` era `security_invoker = true` (dipendeva dal grant su
--   `clienti_master`, che ora blocchiamo). La convertiamo a security-definer
--   come `articoli_service`, così la vista continua a funzionare col solo
--   grant sulla vista senza esporre la tabella `clienti_master`. Il set di
--   righe restituito NON cambia (la vista già filtra `attivo AND ragione_
--   sociale IS NOT NULL`, senza scoping per-utente).
--
-- Verificato in transazione (ROLLBACK) prima dell'applicazione:
--   articoli_service e clienti_service restituiscono righe come `authenticated`;
--   `documenti` diventa `permission denied` per `authenticated`.
--
-- Reversibilità: ri-eseguire i GRANT originali di 021/038/057. Applicare con
--   ruolo owner/postgres.

-- ── 1) La vista clienti_service passa a security-definer ──────────────────────
alter view preventivatore.clienti_service set (security_invoker = false);

-- ── 2) Revoca ogni privilegio diretto a authenticated/anon ────────────────────
revoke all privileges on all tables    in schema preventivatore from authenticated, anon;
revoke all privileges on all sequences in schema preventivatore from authenticated, anon;
revoke all privileges on all functions in schema preventivatore from authenticated, anon;

-- ── 3) Default privileges: nuovi oggetti NON ri-concedono al JWT ──────────────
alter default privileges in schema preventivatore
  revoke all on tables    from authenticated, anon;
alter default privileges in schema preventivatore
  revoke all on sequences from authenticated, anon;
alter default privileges in schema preventivatore
  revoke all on functions from authenticated, anon;

-- ── 4) Ripristina il SOLO contratto service esterno (sics_service) ────────────
-- USAGE sullo schema è necessario per raggiungere le viste/RPC service.
grant usage on schema preventivatore to authenticated, anon;
grant select on preventivatore.articoli_service to authenticated, anon;
grant select on preventivatore.clienti_service  to authenticated;
-- Audit ledger: la policy RLS (mig. 058) limita comunque le righe a
-- superadmin/amministratore, quindi il grant non è un leak.
grant select on preventivatore.movimenti_giacenza to authenticated;
-- RPC di movimentazione giacenze usata da sics_service (guard interna su ruolo).
grant execute on function preventivatore.movimenta_giacenza(text, text, numeric, text, uuid)
  to authenticated;

-- ── 5) service_role mantiene pieno accesso (usato dall'app lato server) ───────
grant usage on schema preventivatore to service_role;
grant all privileges on all tables    in schema preventivatore to service_role;
grant all privileges on all sequences in schema preventivatore to service_role;
grant all privileges on all functions in schema preventivatore to service_role;

-- Le policy RLS "auth_read" (mig. 021) restano innocue: senza GRANT SELECT
-- sulle tabelle, `authenticated` non le raggiunge comunque.

-- Ricarica la cache schema di PostgREST.
notify pgrst, 'reload schema';
