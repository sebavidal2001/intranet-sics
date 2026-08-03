-- Migration 083: `avanza_sessione_su_config` non è invocabile via API
--
-- È una funzione di TRIGGER (migration 066), agganciata alla tabella di
-- configurazione sessioni. Aveva EXECUTE per PUBLIC, quindi era chiamabile
-- via `/rest/v1/rpc/avanza_sessione_su_config` **senza login**: chiunque
-- conoscesse l'URL del progetto poteva farne avanzare lo stato.
--
-- I trigger continuano a funzionare: girano come owner della tabella e non
-- passano dal grant EXECUTE.
REVOKE EXECUTE ON FUNCTION public.avanza_sessione_su_config() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
