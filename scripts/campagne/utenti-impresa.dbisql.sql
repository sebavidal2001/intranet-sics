/*
   Chi ha inserito la riga DOCUMENTAZIONE negli ordini di Impresa (SRVWOA, SQL Anywhere 11).
   Una riga per riga d'ordine: profilo, numero, anno, cliente, login utente (riga_documento.id_utente_crea,
   NON documento.id_operatore), data di creazione della riga, descrizione.

   Uso (da SRVWOA, via WinRM con Start-Process):
     dbisql -datasource airfluid90 -nogui utenti-impresa.dbisql.sql
   Poi copiare C:\Windows\Temp\camp_utenti.csv sulla VM e lanciare attribuisci-utenti-impresa.sql.
*/
SET TEMPORARY OPTION on_error = 'exit';
SELECT d.codice_profilo AS profilo,
       d.num_progressivo AS numero,
       YEAR(d.data_registrazione) AS anno,
       sc.codice AS cliente,
       ISNULL(u.ut_utente, '') AS utente,
       DATEFORMAT(r.data_creazione, 'YYYY-MM-DD HH:NN:SS') AS creata_il,
       REPLACE(REPLACE(ISNULL(r.descrizione, ''), CHAR(13), ' '), CHAR(10), ' ') AS descrizione
  FROM dba.documento d
  JOIN dba.riga_documento r ON r.id_documento = d.id_documento
  JOIN dba.articolo a ON a.id_articolo = r.id_articolo
  LEFT OUTER JOIN dba.sog_commerciale sc ON sc.id_sog_commerciale = d.id_sog_commerciale
  LEFT OUTER JOIN dba.utenti u ON u.id_utenti = r.id_utente_crea
 WHERE a.codice = 'DOCUMENTAZIONE'
   AND d.codice_profilo IN ('OC', 'OCA', 'OCB')
   AND d.data_registrazione >= '2025-01-01'
 ORDER BY d.data_registrazione, r.id_riga_documento;
OUTPUT TO 'C:\Windows\Temp\camp_utenti.csv' FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
