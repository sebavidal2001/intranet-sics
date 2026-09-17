-- Migration 111: via il ruolo `back_office`, il portale fa solo preventivi.
--
-- ============================================================================
-- PERCHE'
-- ============================================================================
-- Il ciclo offerta→esito (`inviata` → `ordinata` / `fallita`) e' stato rimosso
-- dal codice il 17/09/2026. Non era mai entrato in servizio:
--
--   * zero documenti negli stati `inviata`, `ordinata`, `fallita` (0 su 385,
--     verificato sul PostgreSQL della VM, cioe' la produzione);
--   * `importo_ordinato`, `importo_offerta`, `note_offerta` e
--     `motivo_rifiuto_id` valorizzati su ZERO documenti;
--   * nessun pulsante per entrare in `presa_in_carico`: la transizione era
--     ammessa dall'API e irraggiungibile dall'interfaccia.
--
-- E soprattutto: conversione, giorni di risposta e carico back office li
-- produce gia' il gestionale, attraverso `public.bi_preventivi_backoffice`
-- (migration 105) che legge `bi_documenti_raw`, non `preventivatore.documenti`.
-- Il workflow del portale era una seconda contabilita' manuale degli stessi
-- fatti, che nessuno compilava.
--
-- Restano DUE stati vivi: `aperta` (bozza) e `completato` (definitivo).
--
-- ============================================================================
-- COSA FA QUESTA MIGRATION, E COSA NON FA
-- ============================================================================
-- FA: toglie il ruolo funzionale `back_office` e le sue assegnazioni. Serviva
--     solo per tre pulsanti che non esistono piu'.
--
-- NON FA: non tocca le COLONNE del ciclo offerta
--     (`numero_preventivo`, `importo_offerta`, `note_offerta`,
--      `motivo_rifiuto_id`, `importo_ordinato`) ne' la tabella
--     `motivi_rifiuto`. Tre documenti storici hanno un `numero_preventivo`
--     valorizzato dall'import V2 e `motivi_rifiuto` ha 7 righe di anagrafica:
--     cancellarle sarebbe una perdita di dati a fronte di nessun guadagno.
--     Le colonne restano leggibili (la scheda mostra ancora il motivo di
--     rifiuto se c'e'), semplicemente nessuno le scrive piu'.
--
-- > [!warning] Chi aveva questo ruolo resta senza ruolo funzionale
-- > In produzione era **una persona sola** (j.gordini@s-ics.com). Mantiene
-- > l'accesso al portale (dipende dal `livello`), ma non ha piu' un ruolo che
-- > la autorizzi a scrivere. Se deve continuare a lavorare sui preventivi va
-- > assegnato `preventivatore` dall'area superadmin. E' una decisione
-- > organizzativa, non tecnica: qui non la si prende.

BEGIN;

-- Le assegnazioni prima del ruolo: c'e' una FK su ruolo_id.
DELETE FROM preventivatore.utente_ruoli_funzionali urf
USING preventivatore.ruoli_funzionali rf
WHERE rf.id = urf.ruolo_id
  AND rf.slug = 'back_office';

DELETE FROM preventivatore.ruoli_funzionali
WHERE slug = 'back_office';

COMMIT;
