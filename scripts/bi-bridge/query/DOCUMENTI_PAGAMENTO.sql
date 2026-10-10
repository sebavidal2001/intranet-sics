/*
   Condizioni di pagamento dei documenti — estrazione per la pipeline BI
   (profilo "acquisti", dataset "documenti_pagamento").

   Destinazione sul server SQL Anywhere:
     C:\Impresa\Viste_BI\DOCUMENTI_PAGAMENTO.sql

   Una riga per DOCUMENTO (non per riga) dal 2024:
     PC PCA                    preventivi
     OC OCB OCINT OCT          ordini cliente
     FC FCA FCT                fatture cliente
     OF OFT OFR                ordini fornitore
     FF FFCEE                  fatture fornitore

   Serve all'analisi dei tempi di incasso e di pagamento. Tre informazioni:
   - la CONDIZIONE scritta sul documento (id_con_pagamento): un codice e un
     testo del tipo "RB 60/90 ggfm" o "30% BB all'ordine + 70% RB 60 ggfm".
     Sono 196 condizioni, molte a piu' rate e con anticipi: leggerle come testo
     e' inaffidabile;
   - i GIORNI EFFETTIVI: per fatture cliente e fornitore le scadenze vere
     (dba.scadenza) dicono quando si incassa o si paga. `giorni_medi` e' la
     media dei giorni fra la data documento e ogni scadenza, pesata
     sull'importo di ciascuna rata. E' il dato su cui fare i conti;
   - quante rate e fra quando e quando (`n_scadenze`, `prima_scadenza`,
     `ultima_scadenza`).
   Le scadenze esistono per quasi tutte le fatture (FC 100%, FF 99,9%) e solo
   per il 3-5% degli ordini: per gli ordini resta la sola condizione.

   L'IMPORTO di una scadenza e' dare (clienti) o avere (fornitori), IVA
   compresa; `importo_documento` e' l'imponibile del documento.

   Query di sola lettura. CSV UTF-8 separato da ';', senza intestazione, 18
   colonne, verificate a valle in scripts/bi-ingest-fornitori.mjs.
*/

SET TEMPORARY OPTION on_error = 'exit';

SELECT
    d.id_documento                                       AS id_documento,
    d.codice_profilo                                     AS profilo,
    d.num_progressivo                                    AS numero_registrazione,
    REPLACE(REPLACE(ISNULL(d.num_documento, ''), CHAR(13), ' '), CHAR(10), ' ') AS numero_documento,
    DATEFORMAT(ISNULL(d.data_documento, d.data_registrazione), 'YYYY-MM-DD') AS data_documento,
    DATEFORMAT(d.data_registrazione, 'YYYY-MM-DD')       AS data_registrazione,
    ISNULL(sc.codice, '')                                AS codice_soggetto,
    ISNULL(an.rag_soc_1, '')                             AS soggetto,
    ISNULL(cp.codice, '')                                AS condizione_codice,
    ISNULL(cp.descrizione, '')                           AS condizione_descrizione,
    ISNULL(d.val_imponibile, 0)                          AS importo_documento,
    ISNULL(sd.n_scadenze, 0)                             AS n_scadenze,
    ISNULL(DATEFORMAT(sd.prima_scadenza, 'YYYY-MM-DD'), '')  AS prima_scadenza,
    ISNULL(DATEFORMAT(sd.ultima_scadenza, 'YYYY-MM-DD'), '') AS ultima_scadenza,
    CASE WHEN ISNULL(sd.importo, 0) > 0
         THEN ROUND(sd.pesato / sd.importo, 1) ELSE NULL END  AS giorni_medi,
    ISNULL(sd.importo, 0)                                AS importo_scadenze,
    ISNULL(sd.aperto, 0)                                 AS saldo_aperto,
    ISNULL(cp.sconto_cassa, 0)                           AS sconto_cassa

FROM dba.documento d
  LEFT OUTER JOIN dba.sog_commerciale sc ON sc.id_sog_commerciale = d.id_sog_commerciale
  LEFT OUTER JOIN dba.anagrafica an      ON an.id_anagrafica = sc.id_anagrafica
  LEFT OUTER JOIN dba.con_pagamento cp   ON cp.id_con_pagamento = d.id_con_pagamento
  LEFT OUTER JOIN (
      SELECT s.id_documento,
             COUNT(*)                                                   AS n_scadenze,
             MIN(s.data_scadenza)                                       AS prima_scadenza,
             MAX(s.data_scadenza)                                       AS ultima_scadenza,
             SUM(ISNULL(s.dare, 0) + ISNULL(s.avere, 0))                AS importo,
             SUM((ISNULL(s.dare, 0) + ISNULL(s.avere, 0))
                 * DATEDIFF(day, ISNULL(dd.data_documento, dd.data_registrazione), s.data_scadenza)) AS pesato,
             SUM(ABS(ISNULL(s.saldo, 0)))                               AS aperto
        FROM dba.scadenza s
        JOIN dba.documento dd ON dd.id_documento = s.id_documento
       WHERE dd.data_registrazione >= '2024-01-01'
         AND dd.codice_profilo IN ('FC', 'FCA', 'FCT', 'FF', 'FFCEE', 'OC', 'OCB', 'OCINT', 'OCT', 'OF', 'OFT', 'OFR')
       GROUP BY s.id_documento
  ) sd ON sd.id_documento = d.id_documento

WHERE d.codice_profilo IN ('PC', 'PCA', 'OC', 'OCB', 'OCINT', 'OCT', 'FC', 'FCA', 'FCT',
                           'OF', 'OFT', 'OFR', 'FF', 'FFCEE')
  AND d.data_registrazione >= '2024-01-01'

ORDER BY d.data_registrazione, d.id_documento;

OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\documenti_pagamento.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
