/*
   Documenti per utente creatore — estrazione per la pipeline BI
   (profilo "acquisti", dataset "documenti_utente").

   Destinazione sul server SQL Anywhere:
     C:\Impresa\Viste_BI\DOCUMENTI_UTENTE.sql

   Una riga per DOCUMENTO dal 2024, con l'utente del gestionale che lo ha
   creato (documento.id_utente_crea -> dba.utenti) e la data/ora di creazione.
   Serve a misurare il carico di lavoro vero di ogni persona e di ogni ufficio:
   non solo i preventivi (che il BI conosceva gia'), ma ordini, bolle, fatture,
   ordini e fatture fornitore.

   PROFILI:
     PC PCA                       preventivi
     OC OCB OCINT OCT             ordini cliente
     BC                           bolle (DDT) di vendita
     FC FCA FCT NAC               fatture e note di credito cliente
     OF OFT OFR                   ordini fornitore
     BF                           DDT di acquisto
     FF FFCEE NAF NAFCEE          fatture e note di credito fornitore

   Verificato il 10/10/2026: tutti i documenti hanno l'utente creatore (8.853
   su 8.853 nel 2026). ATTENZIONE: alcuni utenti sono CONDIVISI («vendite»,
   «segreteria», «amministrazione», «acquisti», «magazzino1», «magazzino2»):
   vanno letti come ruoli, non come persone.

   `n_righe` e' il numero di righe del documento (il lavoro di inserimento),
   `importo_documento` l'imponibile.

   Query di sola lettura. CSV UTF-8 separato da ';', senza intestazione, 11
   colonne, verificate a valle in scripts/bi-ingest-fornitori.mjs.
*/

SET TEMPORARY OPTION on_error = 'exit';

SELECT
    d.id_documento                                       AS id_documento,
    d.codice_profilo                                     AS profilo,
    d.num_progressivo                                    AS numero_registrazione,
    DATEFORMAT(d.data_registrazione, 'YYYY-MM-DD')       AS data_registrazione,
    ISNULL(DATEFORMAT(d.data_creazione, 'YYYY-MM-DD HH:NN:SS'), '') AS data_creazione,
    ISNULL(u.ut_utente, '')                              AS codice_utente,
    ISNULL(u.ut_descrizione, '')                         AS utente,
    ISNULL(r.n_righe, 0)                                 AS n_righe,
    ISNULL(d.val_imponibile, 0)                          AS importo_documento,
    ISNULL(sc.codice, '')                                AS codice_soggetto,
    ISNULL(an.rag_soc_1, '')                             AS soggetto

FROM dba.documento d
  LEFT OUTER JOIN dba.utenti u           ON u.id_utenti = d.id_utente_crea
  LEFT OUTER JOIN dba.sog_commerciale sc ON sc.id_sog_commerciale = d.id_sog_commerciale
  LEFT OUTER JOIN dba.anagrafica an      ON an.id_anagrafica = sc.id_anagrafica
  LEFT OUTER JOIN (
      SELECT rd.id_documento, COUNT(*) AS n_righe
        FROM dba.riga_documento rd
        JOIN dba.documento dd ON dd.id_documento = rd.id_documento
       WHERE dd.data_registrazione >= '2024-01-01'
         AND dd.codice_profilo IN ('PC', 'PCA', 'OC', 'OCB', 'OCINT', 'OCT', 'BC', 'FC', 'FCA', 'FCT', 'NAC',
                                   'OF', 'OFT', 'OFR', 'BF', 'FF', 'FFCEE', 'NAF', 'NAFCEE')
       GROUP BY rd.id_documento
  ) r ON r.id_documento = d.id_documento

WHERE d.codice_profilo IN ('PC', 'PCA', 'OC', 'OCB', 'OCINT', 'OCT', 'BC', 'FC', 'FCA', 'FCT', 'NAC',
                           'OF', 'OFT', 'OFR', 'BF', 'FF', 'FFCEE', 'NAF', 'NAFCEE')
  AND d.data_registrazione >= '2024-01-01'

ORDER BY d.data_registrazione, d.id_documento;

OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\documenti_utente.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
