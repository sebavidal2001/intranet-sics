-- 155 — Controllo Vettori: ruolo funzionale «Listini».
--
-- L'amministrazione (16/10/2026) ha chiesto che listini e analisi siano gestiti
-- da una sola persona, quella che tiene i rapporti con i vettori (Claudio),
-- "al fine di non creare confusione". Fino a oggi tariffe, supplementi e
-- carburante li poteva cambiare chiunque avesse il ruolo amministrazione o il
-- livello admin di portale.
--
-- Da questa migration in poi il codice (`puoModificareListini`) apre la modifica
-- dei listini SOLO a chi ha questo ruolo, oppure al superadmin. Il livello admin
-- di portale non basta più: l'amministrazione vede i listini in consultazione.
-- Il carburante letto dalle fatture all'acquisizione resta automatico.
--
-- Il ruolo da solo non apre il portale: serve anche un livello (es. viewer in
-- public.permessi_utente con override_access), come per Erika e Jessica.

INSERT INTO vettori.ruoli_funzionali (slug, nome, descrizione, colore, ordine) VALUES
  ('listini', 'Listini',
   'Aggiorna tariffe, supplementi e percentuali carburante; consulta analisi e spedizioni. Unico ruolo che modifica i listini',
   '#8b5cf6', 40)
ON CONFLICT (slug) DO NOTHING;

-- La descrizione dell'amministrazione diceva «aggiorna i listini»: non è più vero.
UPDATE vettori.ruoli_funzionali
   SET descrizione = 'Carica le fatture, decide le anomalie e chiude i mesi. Consulta i listini senza modificarli'
 WHERE slug = 'amministrazione';
