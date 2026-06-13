-- 061_allinea_label_manodopera_template.sql
-- Allinea le etichette manodopera dei template ai nomi canonici del catalogo
-- preventivatore.servizi_manodopera (Title Case), così matching prezzi e report
-- sono coerenti tra servizio aggiunto a mano e servizio da template.
--
-- Mappa SOLO le voci che corrispondono a una voce di catalogo (+ il sinonimo
-- 'LAVORAZIONE' → 'Taglio & Lavorazioni'). Le micro-fasi specifiche del template
-- "Pezzi di Lavorazione" (TAGLIO, PIAZZAMENTO 1-4, FASE 1-4, FINITURA,
-- PRELIEVO MATERIALE, PROGRAMMAZIONE …) NON vengono toccate.
--
-- Catalogo (canonico): Progettazione, Montaggio, Taglio & Lavorazioni, Collaudo,
-- Verniciatura, Manuale.

update preventivatore.template_righe_manodopera
set label = case
  when upper(label) = 'PROGETTAZIONE'                      then 'Progettazione'
  when upper(label) = 'MONTAGGIO'                          then 'Montaggio'
  when upper(label) in ('TAGLIO & LAVORAZIONI', 'LAVORAZIONE') then 'Taglio & Lavorazioni'
  when upper(label) = 'COLLAUDO'                           then 'Collaudo'
  when upper(label) = 'VERNICIATURA'                       then 'Verniciatura'
  when upper(label) = 'MANUALE'                            then 'Manuale'
  else label
end
where upper(label) in (
  'PROGETTAZIONE', 'MONTAGGIO', 'TAGLIO & LAVORAZIONI', 'LAVORAZIONE',
  'COLLAUDO', 'VERNICIATURA', 'MANUALE'
);
