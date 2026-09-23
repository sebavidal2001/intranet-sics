-- 116_fatture_metodo_modello.sql
--
-- «Letta da un modello» non è «letta con il riconoscimento ottico».
--
-- `vettori.fatture.metodo_lettura` distingueva tre provenienze: `testo` (il PDF
-- conteneva il documento), `ocr` (una macchina ha interpretato un'immagine),
-- `manuale` (l'ha trascritta una persona). Da oggi le fatture senza testo le
-- legge un modello multimodale, e registrarle come `ocr` sarebbe comodo ma
-- falso: sono due interpretazioni diverse, con difetti diversi — l'OCR perde
-- righe, un modello può leggere male un numero — e chi rivede una fattura fra
-- sei mesi deve sapere quale delle due ha prodotto quei valori.
--
-- Le fatture già in archivio non si toccano: quelle marcate `ocr` sono state
-- davvero lette con Tesseract.

alter table vettori.fatture
  drop constraint if exists fatture_metodo_lettura_check;

alter table vettori.fatture
  add constraint fatture_metodo_lettura_check
  check (metodo_lettura = any (array['testo'::text, 'ocr'::text, 'modello'::text, 'manuale'::text]));

comment on column vettori.fatture.metodo_lettura is
  'Da dove vengono i numeri: testo del PDF, riconoscimento ottico, modello multimodale, trascrizione a mano.';

notify pgrst, 'reload schema';
