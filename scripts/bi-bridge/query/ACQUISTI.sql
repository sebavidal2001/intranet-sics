/*
   Ordini di acquisto — estrazione per la pipeline BI (profilo "acquisti").

   Destinazione sul server SQL Anywhere:
     C:\Impresa\Viste_BI\ACQUISTI.sql

   Una riga per ogni riga d'ordine a fornitore con articolo, dal 2024:
     OF   ordine acquisto fornitore      (~2.000 ordini l'anno)
     OFT  ordine fornitore per triangolazione
     OFR  ordine fornitore riparazione

   Gli ARRIVI sono i DDT d'acquisto (BF) le cui righe puntano alla riga
   d'ordine con `riga_documento.id_riga_doc_provenienza`. Verificato il
   24/09/2026: 16.318 righe BF su 16.643 del 2025-2026 hanno la provenienza, e
   per tutte e' un OF (le altre sono conto lavoro, resi, visione). Si prende la
   data del DOCUMENTO del fornitore (`data_documento`), non quella di
   registrazione: e' il giorno in cui la merce e' partita/arrivata, non quello
   in cui qualcuno l'ha caricata.

   Il BUYER e' l'utente che ha creato l'ordine (`documento.id_utente_crea` ->
   `dba.utenti`). "produzione" e' l'utente di Daniele Mandrioli, "acquisti" un
   utente condiviso: il gestionale non dice chi c'e' dietro.

   Le righe d'ordine NON sono collegate agli ordini cliente (nessuna
   provenienza, nessuna commessa): l'urgenza rispetto a una consegna al cliente
   non si ricava da qui.

   ── FINESTRA ──────────────────────────────────────────────────────────────
   Tutto dal 1 gennaio 2024 (~25.000 righe): un ordine resta vivo per mesi
   (arrivi parziali, chiusure forzate), quindi si ricarica l'intera finestra
   ogni notte e l'ingest sostituisce tutto dalla data minima del file in avanti.

   Query di sola lettura. Genera un CSV UTF-8 separato da ';', senza
   intestazione (FORMAT ASCII non la scrive): 24 colonne, verificate a valle in
   scripts/bi-ingest-acquisti.mjs.
*/

SET TEMPORARY OPTION on_error = 'exit';

SELECT
    r.id_riga_documento                                  AS id_riga,
    d.codice_profilo                                     AS profilo,
    d.num_progressivo                                    AS numero_ordine,
    DATEFORMAT(d.data_registrazione, 'YYYY-MM-DD')       AS data_ordine,
    DATEFORMAT(d.data_creazione, 'YYYY-MM-DD HH:NN:SS')  AS creato_il,
    ISNULL(sc.codice, '')                                AS codice_fornitore,
    ISNULL(an.rag_soc_1, '')                             AS fornitore,
    ISNULL(u.ut_utente, '')                              AS buyer_utente,
    ISNULL(u.ut_descrizione, '')                         AS buyer,
    a.codice                                             AS codice_articolo,
    REPLACE(REPLACE(ISNULL(r.descrizione, ''), CHAR(13), ' '), CHAR(10), ' ') AS descrizione,
    ISNULL(ga.descrizione, '-')                          AS gruppo_articoli,
    r.quantita                                           AS quantita,
    ISNULL(r.qta_evasa, 0)                               AS qta_evasa,
    ISNULL(r.prezzo_netto, 0)                            AS prezzo_netto,
    ISNULL(r.tot_riga_val_az, 0)                         AS valore,
    DATEFORMAT(r.data_prevista_consegna, 'YYYY-MM-DD')   AS data_prevista,
    DATEFORMAT(r.data_confermata, 'YYYY-MM-DD')          AS data_confermata,
    DATEFORMAT(r.data_richiesta_consegna, 'YYYY-MM-DD')  AS data_richiesta,
    ISNULL(r.riga_evasa, 'N')                            AS riga_evasa,
    ISNULL(r.chiude_a_forza, 'N')                        AS chiusa_forzata,
    DATEFORMAT(arr.primo_arrivo, 'YYYY-MM-DD')           AS primo_arrivo,
    DATEFORMAT(arr.ultimo_arrivo, 'YYYY-MM-DD')          AS ultimo_arrivo,
    ISNULL(arr.qta_arrivata, 0)                          AS qta_arrivata

FROM dba.documento d
  JOIN dba.riga_documento r        ON r.id_documento = d.id_documento
  JOIN dba.articolo a              ON a.id_articolo = r.id_articolo
  LEFT OUTER JOIN dba.gruppo_articoli ga ON ga.id_gruppo_articoli = a.id_gruppo_articoli
  LEFT OUTER JOIN dba.sog_commerciale sc ON sc.id_sog_commerciale = d.id_sog_commerciale
  LEFT OUTER JOIN dba.anagrafica an      ON an.id_anagrafica = sc.id_anagrafica
  LEFT OUTER JOIN dba.utenti u           ON u.id_utenti = d.id_utente_crea
  LEFT OUTER JOIN (
      SELECT rb.id_riga_doc_provenienza AS id_riga_ordine,
             MIN(db.data_documento)     AS primo_arrivo,
             MAX(db.data_documento)     AS ultimo_arrivo,
             SUM(rb.quantita)           AS qta_arrivata
        FROM dba.riga_documento rb
        JOIN dba.documento db ON db.id_documento = rb.id_documento
       WHERE db.codice_profilo = 'BF'
         AND db.data_registrazione >= '2024-01-01'
         AND rb.id_riga_doc_provenienza IS NOT NULL
       GROUP BY rb.id_riga_doc_provenienza
  ) arr ON arr.id_riga_ordine = r.id_riga_documento

WHERE d.codice_profilo IN ('OF', 'OFT', 'OFR')
  AND d.data_registrazione >= '2024-01-01'

ORDER BY d.data_registrazione, r.id_riga_documento;

OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\acquisti_righe.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
