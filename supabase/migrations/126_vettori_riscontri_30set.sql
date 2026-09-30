-- 126_vettori_riscontri_30set.sql
--
-- Risposte dell'amministrazione del 30/09/2026 (mail di Francesca Odorici).
-- Va applicata PRIMA del deploy: la sincronizzazione delle bolle legge
-- `codici_gestionale.nascondi_bolle`.
--
-- 1. Trascoop: «Bolle con Trascoop puoi nasconderle». Nuova colonna
--    `nascondi_bolle` su `codici_gestionale`: le spedizioni con quel vettore
--    nascono `ignorata` (la sincronizzazione lo legge) e quelle gia' presenti
--    passano a `ignorata`. Amadei resta visibile finche' non lo confermano.
--
-- 2. Resi a fornitore (RF) precedenti al 29/09: «per il pregresso lasciamo
--    stare, puoi toglierle»: in Impresa il trasporto dei resi non veniva
--    compilato, quindi il porto non e' affidabile. Da ieri lo compilano.
--
-- 3. Reso visione da cliente (RVC): e' un'ENTRATA, ma sta nel registro vendite
--    e il programma lo leggeva come uscita (corretto in `direzioneDi`). Le tre
--    spedizioni gia' create col verso sbagliato si eliminano: nessuna ha
--    controlli, misure o congelamento, e la prossima fusione le ricrea giuste.
--
-- 4. Assicurazione GLS 10/10: «non e' sempre, ma solo per le spedizioni con
--    peso da 10 kg in su». La soglia era 10,001 (da oltre 10 kg): diventa 10.
--
-- Nessuna di queste righe tocca spedizioni congelate o gia' controllate.

ALTER TABLE vettori.codici_gestionale
  ADD COLUMN IF NOT EXISTS nascondi_bolle boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN vettori.codici_gestionale.nascondi_bolle IS
  'Le bolle con questo vettore nascono ignorate: l''amministrazione non ne controlla le fatture.';

UPDATE vettori.codici_gestionale
   SET nascondi_bolle = true,
       note = concat_ws(E'\n', nullif(note, ''), 'Bolle nascoste su richiesta dell''amministrazione (30/09/2026).'),
       aggiornato_il = now()
 WHERE codice_gestionale = 'VT010002';

UPDATE vettori.spedizioni s
   SET stato = 'ignorata',
       note = concat_ws(E'\n', nullif(s.note, ''), 'Trascoop: vettore di cui non si controllano le fatture (30/09/2026).'),
       aggiornata_il = now()
 WHERE s.stato <> 'ignorata'
   AND NOT s.congelata
   AND NOT EXISTS (SELECT 1 FROM vettori.controlli c WHERE c.spedizione_id = s.id)
   AND EXISTS (
     SELECT 1 FROM vettori.spedizioni_documenti x
       JOIN bi.trasporti_documenti t ON t.id_documento = x.id_documento
      WHERE x.spedizione_id = s.id AND upper(trim(t.vettore_codice)) = 'VT010002'
   );

UPDATE vettori.spedizioni s
   SET stato = 'ignorata',
       note = concat_ws(E'\n', nullif(s.note, ''), 'Reso a fornitore precedente al 29/09/2026: porto non compilato in Impresa, escluso su richiesta dell''amministrazione.'),
       aggiornata_il = now()
 WHERE s.stato <> 'ignorata'
   AND s.data_documento < DATE '2026-09-29'
   AND NOT s.congelata
   AND NOT EXISTS (SELECT 1 FROM vettori.controlli c WHERE c.spedizione_id = s.id)
   AND EXISTS (
     SELECT 1 FROM vettori.spedizioni_documenti x
      WHERE x.spedizione_id = s.id AND x.codice_profilo = 'RF'
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
      WHERE x.spedizione_id = s.id AND x.codice_profilo = 'RVC'
   );

UPDATE vettori.listini_supplementi ls
   SET soglia_kg_da = 10
  FROM vettori.listini l
  JOIN vettori.vettori v ON v.id = l.vettore_id
 WHERE ls.listino_id = l.id
   AND v.codice = 'gls'
   AND ls.codice = 'assicurazione'
   AND ls.soglia_kg_da = 10.001;
