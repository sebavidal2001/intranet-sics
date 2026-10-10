/*
   Scadenzario aperto — estrazione per la pipeline BI
   (profilo "acquisti", dataset "scadenzario").

   Destinazione sul server SQL Anywhere:
     C:\Impresa\Viste_BI\SCADENZARIO.sql

   Una riga per ogni SCADENZA con saldo diverso da zero: gli incassi attesi dai
   clienti (tipo A, attive) e i pagamenti dovuti ai fornitori (tipo P,
   passive). E' la fotografia di oggi, non lo storico: ogni notte si sostituisce
   per intero.

   Serve al calendario di copertura: per settimana o mese, quanto entra e
   quanto esce, e dove il netto cumulato va sotto zero. Non richiede di sapere
   quale ordine finanzia quale acquisto.

   Origine delle scadenze (`profilo`): FC/FF per le fatture registrate; OC e OF
   per le scadenze che il gestionale genera gia' sulle righe d'ordine (poche:
   il 3-5% degli ordini); altri profili (note di credito, spese) restano
   perche' muovono la cassa. `profilo` vuoto = scadenza senza documento
   (~6%): ha importo e data ma non un soggetto.

   SEGNO: `saldo` e' negativo per le scadenze passive (da pagare). `importo` e'
   sempre positivo.

   Query di sola lettura. CSV UTF-8 separato da ';', senza intestazione, 13
   colonne, verificate a valle in scripts/bi-ingest-fornitori.mjs.
*/

SET TEMPORARY OPTION on_error = 'exit';

SELECT
    s.id_scadenza                                        AS id_scadenza,
    s.tipo_scadenza                                      AS tipo,
    DATEFORMAT(s.data_scadenza, 'YYYY-MM-DD')            AS data_scadenza,
    ISNULL(DATEFORMAT(s.data_documento, 'YYYY-MM-DD'), '') AS data_documento,
    ISNULL(s.dare, 0) + ISNULL(s.avere, 0)               AS importo,
    ISNULL(s.saldo, 0)                                   AS saldo,
    ISNULL(d.codice_profilo, '')                         AS profilo,
    REPLACE(REPLACE(ISNULL(s.num_documento, ''), CHAR(13), ' '), CHAR(10), ' ') AS numero_documento,
    ISNULL(d.id_documento, 0)                            AS id_documento,
    ISNULL(sc.codice, '')                                AS codice_soggetto,
    ISNULL(an.rag_soc_1, '')                             AS soggetto,
    ISNULL(cp.codice, '')                                AS condizione_codice,
    ISNULL(s.esito_pagamento, '')                        AS esito_pagamento

FROM dba.scadenza s
  LEFT OUTER JOIN dba.documento d        ON d.id_documento = s.id_documento
  LEFT OUTER JOIN dba.sog_commerciale sc ON sc.id_sog_commerciale = d.id_sog_commerciale
  LEFT OUTER JOIN dba.anagrafica an      ON an.id_anagrafica = sc.id_anagrafica
  LEFT OUTER JOIN dba.con_pagamento cp   ON cp.id_con_pagamento = d.id_con_pagamento

WHERE s.tipo_scadenza IN ('A', 'P')
  AND ISNULL(s.saldo, 0) <> 0

ORDER BY s.data_scadenza, s.id_scadenza;

OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\scadenzario.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
