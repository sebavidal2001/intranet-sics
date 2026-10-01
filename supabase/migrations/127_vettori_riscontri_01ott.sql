-- 127_vettori_riscontri_01ott.sql
--
-- Risposte dell'amministrazione dell'01/10/2026 (mail di Francesca Odorici).
--
-- 1. Amadei: «puoi nasconderlo». Come Trascoop nella 126: le bolle nascono
--    ignorate e quelle presenti passano a `ignorata`.
--
-- 2. CARDEP3 e RESDEP3 (carico e reso deposito cliente DEP 3): «puoi
--    escluderli». Il codice non li fonde piu' (`profiloControllabile`); quelle
--    gia' create passano a `ignorata`.
--
-- 3. CLAVCL (conto lavoro da cliente): e' un'ENTRATA, anche se sta nel registro
--    vendite (`direzioneDi`). Le spedizioni create come uscite si eliminano —
--    nessuna ha controlli, misure o congelamenti — e la fusione completa del
--    grezzo le ricrea col verso giusto. Sul pregresso il porto e' spesso
--    sbagliato, ma l'amministrazione chiede di lasciarlo com'e'.
--
-- Nessuna riga tocca spedizioni congelate o gia' controllate.

UPDATE vettori.codici_gestionale
   SET nascondi_bolle = true,
       note = concat_ws(E'\n', nullif(note, ''), 'Bolle nascoste su richiesta dell''amministrazione (01/10/2026).'),
       aggiornato_il = now()
 WHERE codice_gestionale = 'VT000030';

UPDATE vettori.spedizioni s
   SET stato = 'ignorata',
       note = concat_ws(E'\n', nullif(s.note, ''), 'Amadei: vettore di cui non si controllano le fatture (01/10/2026).'),
       aggiornata_il = now()
 WHERE s.stato <> 'ignorata'
   AND NOT s.congelata
   AND NOT EXISTS (SELECT 1 FROM vettori.controlli c WHERE c.spedizione_id = s.id)
   AND EXISTS (
     SELECT 1 FROM vettori.spedizioni_documenti x
       JOIN bi.trasporti_documenti t ON t.id_documento = x.id_documento
      WHERE x.spedizione_id = s.id AND upper(trim(t.vettore_codice)) = 'VT000030'
   );

UPDATE vettori.spedizioni s
   SET stato = 'ignorata',
       note = concat_ws(E'\n', nullif(s.note, ''), 'Deposito cliente DEP 3: profilo escluso dall''amministrazione (01/10/2026).'),
       aggiornata_il = now()
 WHERE s.stato <> 'ignorata'
   AND NOT s.congelata
   AND NOT EXISTS (SELECT 1 FROM vettori.controlli c WHERE c.spedizione_id = s.id)
   AND EXISTS (
     SELECT 1 FROM vettori.spedizioni_documenti x
      WHERE x.spedizione_id = s.id AND x.codice_profilo IN ('CARDEP3', 'RESDEP3')
   );

DELETE FROM vettori.spedizioni s
 WHERE s.direzione = 'uscita'
   AND NOT s.congelata
   AND NOT EXISTS (SELECT 1 FROM vettori.controlli c WHERE c.spedizione_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM vettori.bolla_misure m WHERE m.spedizione_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM vettori.spedizioni_congelamenti k WHERE k.spedizione_id = s.id)
   AND NOT EXISTS (SELECT 1 FROM vettori.spedizioni_scostamenti k WHERE k.spedizione_id = s.id)
   AND EXISTS (
     SELECT 1 FROM vettori.spedizioni_documenti x
      WHERE x.spedizione_id = s.id AND x.codice_profilo = 'CLAVCL'
   );
