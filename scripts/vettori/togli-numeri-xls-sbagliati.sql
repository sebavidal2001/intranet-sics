-- Toglie le spedizioni del foglio con il numero di bolla letto male.
--
-- Il foglio Trading Post e' un .xls: xlrd restituisce le celle numeriche come
-- float, e l'estrattore scriveva «2373.0». La normalizzazione toglieva il punto
-- e ne faceva «23730», un numero che nessuna bolla ha: le righe non si sono mai
-- unite alle BC del gestionale, e le misure dei colli scritte
-- dall'amministrazione (224 partenze) non sono mai arrivate sulle bolle vere.
--
-- Corretto l'estrattore (`numero_documento` in estrai-storico-excel.py). Qui si
-- tolgono le righe vecchie, che poi `storico-excel-sql.py` ricarica con il
-- numero giusto e `unisci-doppioni-excel.sql` unisce alle bolle.
--
-- Al momento dell'esecuzione (01/10/2026) le 269 righe non avevano controlli,
-- anomalie, riaddebiti, congelamenti ne' campi forzati: la condizione qui sotto
-- le esclude comunque, se nel frattempo ne avessero.

delete from vettori.bolla_misure m
 using vettori.spedizioni s
 where m.spedizione_id = s.id
   and s.origine = 'excel_storico'
   and s.numero_riferimento like '%.0'
   and not s.congelata
   and not exists (select 1 from vettori.controlli c where c.spedizione_id = s.id);

delete from vettori.spedizioni s
 where s.origine = 'excel_storico'
   and s.numero_riferimento like '%.0'
   and not s.congelata
   and not exists (select 1 from vettori.controlli c where c.spedizione_id = s.id)
   and not exists (select 1 from vettori.anomalie a where a.spedizione_id = s.id)
   and not exists (select 1 from vettori.riaddebiti a where a.spedizione_id = s.id)
   and not exists (select 1 from vettori.bolla_misure m where m.spedizione_id = s.id);
