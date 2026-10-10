/*
   Fatture e note di credito fornitore — estrazione per la pipeline BI
   (profilo "acquisti", dataset "fatture_fornitore").

   Destinazione sul server SQL Anywhere:
     C:\Impresa\Viste_BI\FATTURE_FORNITORE.sql

   Una riga per ogni riga di fattura fornitore dal 2024:
     FF, FFCEE        fatture fornitore (nazionali, CEE)
     NAF, NAFCEE      note di credito fornitore (importo positivo: il segno si
                      applica a valle, dal profilo)

   LA CATENA: FF -> BF (DDT acquisto) -> OF (ordine fornitore). Verificato il
   10/10/2026: 16.512 righe FF su 18.790 (2025-2026) puntano a una riga BF, e le
   BF puntano a una riga OF per 17.167 righe su 17.551. Il resto sono reclami di
   lavorazione esterna (RECLAVES), righe senza provenienza (spese, servizi) e
   FF collegate direttamente a un ordine. `profilo_ordine` dice a cosa punta la
   riga ("OF", "OFT", "RECLAVES"...): vuoto = nessun legame.

   NON esiste, invece, un legame fra ordine fornitore e ordine cliente (le
   righe OF non hanno ne' provenienza ne' commessa): non lo si cerca qui.

   La CONDIZIONE DI PAGAMENTO e' quella scritta sul documento
   (documento.id_con_pagamento), non quella anagrafica: e' la condizione
   effettivamente applicata a quella fattura.

   Le righe senza articolo (spese, servizi: ~4% delle righe) restano, con
   codice articolo vuoto: servono perche' la somma torni col totale fattura.

   Query di sola lettura. CSV UTF-8 separato da ';', senza intestazione, 20
   colonne, verificate a valle in scripts/bi-ingest-fornitori.mjs.
*/

SET TEMPORARY OPTION on_error = 'exit';

SELECT
    r.id_riga_documento                                  AS id_riga,
    d.codice_profilo                                     AS profilo,
    d.num_progressivo                                    AS numero_registrazione,
    REPLACE(REPLACE(ISNULL(d.num_documento, ''), CHAR(13), ' '), CHAR(10), ' ') AS numero_fattura,
    DATEFORMAT(ISNULL(d.data_documento, d.data_registrazione), 'YYYY-MM-DD') AS data_fattura,
    DATEFORMAT(d.data_registrazione, 'YYYY-MM-DD')       AS data_registrazione,
    ISNULL(sc.codice, '')                                AS codice_fornitore,
    ISNULL(an.rag_soc_1, '')                             AS fornitore,
    ISNULL(a.codice, '')                                 AS codice_articolo,
    REPLACE(REPLACE(ISNULL(r.descrizione, ''), CHAR(13), ' '), CHAR(10), ' ') AS descrizione,
    ISNULL(ga.descrizione, '-')                          AS gruppo_articoli,
    ISNULL(r.quantita, 0)                                AS quantita,
    ISNULL(r.tot_riga_val_az, 0)                         AS valore,
    ISNULL(CASE WHEN drb.codice_profilo = 'BF' THEN ro.id_riga_documento ELSE rb.id_riga_documento END, 0) AS id_riga_ordine,
    ISNULL(CASE WHEN drb.codice_profilo = 'BF' THEN dor.codice_profilo ELSE drb.codice_profilo END, '')   AS profilo_ordine,
    ISNULL(CASE WHEN drb.codice_profilo = 'BF' THEN dor.num_progressivo ELSE drb.num_progressivo END, 0)  AS numero_ordine,
    ISNULL(DATEFORMAT(CASE WHEN drb.codice_profilo = 'BF' THEN dor.data_registrazione ELSE drb.data_registrazione END, 'YYYY-MM-DD'), '') AS data_ordine,
    ISNULL(cp.codice, '')                                AS condizione_codice,
    ISNULL(cp.descrizione, '')                           AS condizione_descrizione,
    d.id_documento                                       AS id_documento

FROM dba.documento d
  JOIN dba.riga_documento r        ON r.id_documento = d.id_documento
  LEFT OUTER JOIN dba.articolo a   ON a.id_articolo = r.id_articolo
  LEFT OUTER JOIN dba.gruppo_articoli ga ON ga.id_gruppo_articoli = a.id_gruppo_articoli
  LEFT OUTER JOIN dba.sog_commerciale sc ON sc.id_sog_commerciale = d.id_sog_commerciale
  LEFT OUTER JOIN dba.anagrafica an      ON an.id_anagrafica = sc.id_anagrafica
  LEFT OUTER JOIN dba.con_pagamento cp   ON cp.id_con_pagamento = d.id_con_pagamento
  LEFT OUTER JOIN dba.riga_documento rb  ON rb.id_riga_documento = r.id_riga_doc_provenienza
  LEFT OUTER JOIN dba.documento drb      ON drb.id_documento = rb.id_documento
  LEFT OUTER JOIN dba.riga_documento ro  ON ro.id_riga_documento = rb.id_riga_doc_provenienza
  LEFT OUTER JOIN dba.documento dor      ON dor.id_documento = ro.id_documento

WHERE d.codice_profilo IN ('FF', 'FFCEE', 'NAF', 'NAFCEE')
  AND d.data_registrazione >= '2024-01-01'

ORDER BY d.data_registrazione, r.id_riga_documento;

OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\fatture_fornitore.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
