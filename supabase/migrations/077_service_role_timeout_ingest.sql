-- ============================================================================
-- 077 — Tempo sufficiente all'ingest del Cruscotto
--
-- service_role non aveva impostazioni proprie ed ereditava da authenticator:
-- statement_timeout = 8s, lock_timeout = 8s. L'ingest atomico del Cruscotto è
-- una sola transazione che carica 26.000 righe, apre il baseline storico
-- (24.000 costi + 36.000 giacenze) e riallinea anagrafica e giacenze.
--
-- Misurato sul primo run reale: 33 secondi. Otto non bastavano, e il primo
-- tentativo moriva con "canceling statement due to statement timeout" — senza
-- scrivere nulla, perché la transazione veniva annullata per intero.
--
-- I run successivi scrivono solo i cambiamenti e sono molto più rapidi: il
-- baseline si costruisce una volta sola.
--
-- 300 secondi non è "nessun limite": una query patologica viene comunque
-- fermata. anon (3s) e authenticated (8s) restano invariati, quindi le
-- chiamate dal browser mantengono i loro limiti stretti.
--
-- lock_timeout a 60s: bi_activate_cruscotto fa
--   lock table bi.cruscotto_runs in exclusive mode
-- e deve poter attendere un ingest concorrente invece di fallire subito.
-- ============================================================================

alter role service_role set statement_timeout = '300s';
alter role service_role set lock_timeout = '60s';

-- PostgREST rilegge la configurazione dei ruoli solo su richiesta.
notify pgrst, 'reload config';
