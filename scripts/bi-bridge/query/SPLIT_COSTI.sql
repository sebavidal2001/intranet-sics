/*
   Split dei costi per articolo — estrazione per il Preventivatore.

   Destinazione sul server SQL Anywhere:
     C:\Impresa\Viste_BI\SPLIT_COSTI.sql

   Fonte: dba.prd_costo_articolo, righe tipo_costo = 'S' (costo STANDARD: Impresa ne
   scrive una fotografia ogni notte, ~55.000 articoli). Le colonne costo_dist_* sono
   il costo CUMULATO lungo la distinta: per un sottogruppo o un gruppo includono i
   componenti, per un particolare coincidono con le colonne dirette. La loro somma
   quadra con costo_articolo su tutti gli articoli (verificato il 26/10/2026).

   Si prende, per ogni articolo, la riga piu' recente degli ultimi 3 giorni: la
   fotografia notturna e' completa, ma durante il giorno compaiono righe parziali
   (ricalcoli puntuali) che sono piu' fresche e vanno preferite.

   Colonne (9, senza intestazione, separate da ';'; i numeri sono testo con il punto
   decimale, perche' dbisql li esporta con la virgola del locale del server):
     codice, descrizione, data_elaborazione, costo_totale, costo_materiale,
     costo_manodopera, costo_lavorazione, costo_lav_esterna, costo_altro
   costo_altro = tutto il resto (attrezzaggio, indiretti, ammortamento, imballo,
   trasporto, scarto, vario): costo_articolo meno le altre quattro, cosi' la
   somma quadra per costruzione.

   Query di sola lettura. Si sincronizza con scripts/preventivatore-sync-split-costi.ps1.
*/

SET TEMPORARY OPTION on_error = 'exit';

SELECT
    t.codice                                                              AS codice,
    REPLACE(REPLACE(ISNULL(t.descrizione, ''), CHAR(13), ' '), CHAR(10), ' ') AS descrizione,
    DATEFORMAT(t.data_elaborazione, 'YYYY-MM-DD HH:NN:SS')                AS data_elaborazione,
    REPLACE(CAST(t.costo_articolo AS VARCHAR(40)), ',', '.')              AS costo_totale,
    REPLACE(CAST(t.costo_dist_materiale AS VARCHAR(40)), ',', '.')        AS costo_materiale,
    REPLACE(CAST(t.costo_dist_manodopera AS VARCHAR(40)), ',', '.')       AS costo_manodopera,
    REPLACE(CAST(t.costo_dist_lavorazione AS VARCHAR(40)), ',', '.')      AS costo_lavorazione,
    REPLACE(CAST(t.costo_dist_lav_esterna AS VARCHAR(40)), ',', '.')      AS costo_lav_esterna,
    REPLACE(CAST(t.costo_articolo - t.costo_dist_materiale - t.costo_dist_manodopera
                 - t.costo_dist_lavorazione - t.costo_dist_lav_esterna AS VARCHAR(40)), ',', '.') AS costo_altro

FROM (
    SELECT a.codice, a.descrizione,
           c.data_elaborazione, c.costo_articolo,
           c.costo_dist_materiale, c.costo_dist_manodopera,
           c.costo_dist_lavorazione, c.costo_dist_lav_esterna,
           ROW_NUMBER() OVER (PARTITION BY c.id_articolo ORDER BY c.data_elaborazione DESC) AS rn
      FROM dba.prd_costo_articolo c
      JOIN dba.articolo a ON a.id_articolo = c.id_articolo
     WHERE c.tipo_costo = 'S'
       AND c.data_elaborazione >= DATEADD(day, -3, NOW())
       AND c.costo_articolo > 0
) t

WHERE t.rn = 1

ORDER BY t.codice;

OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\split_costi.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
