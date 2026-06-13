-- 057_clienti_service_view.sql
-- View di compatibilità per l'app esterna sics_service.
-- sics_service si aspetta un'anagrafica clienti con campi fissi; i clienti reali
-- vivono in preventivatore.clienti_master (preventivatore.clienti e' vuota).
-- Questa view NON e' distruttiva: legge clienti_master, non la modifica.
--
-- Granularita': UNA RIGA PER DESTINAZIONE/SEDE (clienti_master e' gia' a quel livello).
--   Un cliente con N sedi appare N volte -> coerente con un'app di field service
--   (l'intervento avviene su una sede specifica). id = PK reale (uuid) -> stabile.
--
-- Mapping (clienti_master -> clienti_service):
--   id              <- id (uuid, PK reale, stabile)
--   ragione_sociale <- ragione_sociale
--   piva            <- NULL (assente in clienti_master)
--   codice_fiscale  <- NULL (assente)
--   sede            <- destinazione (nome sede/cantiere)
--   citta           <- localita
--   provincia       <- NULL (assente)
--   cap             <- cap
--   telefono        <- NULL (assente)
--   email           <- NULL (assente)
--   referente       <- NULL (in clienti_master c'e' solo l'agente commerciale, semantica diversa)
--   note            <- note
--   is_attivo       <- attivo
--   created_at      <- created_at
--   updated_at      <- ultimo_import_il (timestamp di aggiornamento piu' vicino)
--
-- Sicurezza: security_invoker=true -> la view rispetta la RLS di clienti_master
--   (policy auth_read: auth.role()='authenticated'). GRANT SELECT solo ad authenticated.

create or replace view preventivatore.clienti_service
with (security_invoker = true) as
select
  cm.id                       as id,
  cm.ragione_sociale          as ragione_sociale,
  null::text                  as piva,
  null::text                  as codice_fiscale,
  cm.destinazione             as sede,
  cm.localita                 as citta,
  null::text                  as provincia,
  cm.cap                      as cap,
  null::text                  as telefono,
  null::text                  as email,
  null::text                  as referente,
  cm.note                     as note,
  coalesce(cm.attivo, true)   as is_attivo,
  cm.created_at               as created_at,
  cm.ultimo_import_il         as updated_at
from preventivatore.clienti_master cm
where cm.ragione_sociale is not null
  and btrim(cm.ragione_sociale) <> ''
  and coalesce(cm.attivo, true) = true;

comment on view preventivatore.clienti_service is
  'Vista di compatibilita read-only per sics_service su clienti_master (una riga per destinazione/sede). Vedi migration 057.';

-- Permessi: sola lettura per authenticated; nessuna scrittura; revoke difensivo da anon.
grant select on preventivatore.clienti_service to authenticated;
revoke all on preventivatore.clienti_service from anon;

-- Ricarica la cache schema di PostgREST cosi' la view e' subito esposta via API.
notify pgrst, 'reload schema';
