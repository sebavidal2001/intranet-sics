/*
  Dataset trasporti_documenti - variante live incrementale a 68 colonne.

  ULTIMO_ID_SOGLIA (racchiuso fra doppie graffe nel predicato) e' un
  segnaposto obbligatorio. Il launcher
  Invoke-BIPipeline-Trasporti.ps1 crea una copia temporanea della query e lo
  sostituisce con (ultimo_id_visto - 50) prima di invocare dbisql. Non
  sostituire questo predicato con un filtro sulle date: id_documento e' la
  chiave primaria indicizzata usata per la scansione di intervallo.
*/
SELECT d.id_documento,
       CASE WHEN d.tipo_registro='DA' THEN 'ENTRATA' ELSE 'USCITA' END AS direzione,
       d.tipo_registro,
       d.codice_profilo,
       d.descrizione_profilo,
       TRIM(CAST(d.num_progressivo AS VARCHAR(30))) AS numero_progressivo,
       TRIM(d.num_documento) AS numero_documento,
       DATEFORMAT(d.data_documento,'yyyy-mm-dd') AS data_documento,
       DATEFORMAT(d.data_registrazione,'yyyy-mm-dd') AS data_registrazione,
       DATEFORMAT(d.data_creazione,'yyyy-mm-dd hh:nn:ss') AS data_creazione,
       d.stampato,
       d.contabilizzato,
       d.sospeso,
       d.bloccato,
       sc.id_sog_commerciale,
       sc.codice AS codice_soggetto,
       an.rag_soc_1 AS soggetto,
       an.par_iva AS soggetto_piva,
       an.indirizzo AS soggetto_indirizzo,
       an.cap AS soggetto_cap,
       an.localita AS soggetto_localita,
       an.provincia AS soggetto_provincia,
       d.id_destinazione,
       de.rag_soc_1 AS destinazione_codificata,
       de.indirizzo AS dest_indirizzo_cod,
       de.cap AS dest_cap_cod,
       de.localita AS dest_localita_cod,
       de.provincia AS dest_provincia_cod,
       d.dest_rag_soc,
       d.dest_indirizzo,
       d.dest_cap,
       d.dest_localita,
       d.dest_provincia,
       d.provincia_destinazione,
       CASE WHEN d.tipo_registro='DA' THEN an.cap
            ELSE COALESCE(NULLIF(TRIM(de.cap),''),NULLIF(TRIM(d.dest_cap),''),an.cap)
       END AS zona_cap,
       CASE WHEN d.tipo_registro='DA' THEN an.provincia
            ELSE COALESCE(NULLIF(TRIM(de.provincia),''),NULLIF(TRIM(d.dest_provincia),''),
                          NULLIF(TRIM(d.provincia_destinazione),''),an.provincia)
       END AS zona_provincia,
       CASE WHEN d.tipo_registro='DA' THEN 'CONTROPARTE_FORNITORE'
            WHEN de.cap IS NOT NULL AND TRIM(de.cap)<>'' THEN 'DESTINAZIONE_CODIFICATA'
            WHEN d.dest_cap IS NOT NULL AND TRIM(d.dest_cap)<>'' THEN 'DESTINAZIONE_TESTATA'
            ELSE 'CONTROPARTE_CLIENTE'
       END AS fonte_zona,
       d.id_tipo_trasporto,
       tt.codice AS tipo_trasporto_codice,
       tt.descrizione AS tipo_trasporto,
       d.id_caus_trasporto,
       ct.codice AS causale_trasporto_codice,
       ct.descrizione AS causale_trasporto,
       d.tras_mezzo,
       d.asp_beni,
       d.id_sog_commerciale_vettore,
       v.codice AS vettore_codice,
       av.rag_soc_1 AS vettore,
       CASE WHEN d.num_colli IS NULL THEN NULL ELSE REPLACE(CAST(d.num_colli AS VARCHAR(40)),',','.') END AS num_colli,
       CASE WHEN d.num_pallet IS NULL THEN NULL ELSE REPLACE(CAST(d.num_pallet AS VARCHAR(40)),',','.') END AS num_pallet,
       CASE WHEN d.peso_netto IS NULL THEN NULL ELSE REPLACE(CAST(d.peso_netto AS VARCHAR(40)),',','.') END AS peso_netto,
       CASE WHEN d.peso_lordo IS NULL THEN NULL ELSE REPLACE(CAST(d.peso_lordo AS VARCHAR(40)),',','.') END AS peso_lordo,
       CASE WHEN d.volume IS NULL THEN NULL ELSE REPLACE(CAST(d.volume AS VARCHAR(40)),',','.') END AS volume,
       d.id_unita_misura_peso,
       ump.simbolo AS um_peso,
       d.id_unita_misura_volume,
       umv.simbolo AS um_volume,
       CASE WHEN d.val_spese IS NULL THEN NULL ELSE REPLACE(CAST(d.val_spese AS VARCHAR(40)),',','.') END AS val_spese,
       DATEFORMAT(d.data_trasporto,'yyyy-mm-dd') AS data_trasporto,
       DATEFORMAT(d.data_prev_consegna,'yyyy-mm-dd') AS data_prev_consegna,
       DATEFORMAT(d.data_consegna_cliente,'yyyy-mm-dd') AS data_consegna_cliente,
       LEFT(REPLACE(REPLACE(REPLACE(CAST(d.note_spedizione AS VARCHAR(2000)),';',','),CHAR(13),' '),CHAR(10),' '),200) AS note_spedizione,
       d.id_utente_crea,
       u.ut_utente AS codice_utente_creatore,
       u.ut_descrizione AS utente_creatore,
       d.id_utente_modifica,
       DATEFORMAT(d.data_modifica,'yyyy-mm-dd hh:nn:ss') AS data_modifica,
       d.generato_da
FROM dba.documento d
LEFT OUTER JOIN dba.sog_commerciale sc ON sc.id_sog_commerciale=d.id_sog_commerciale
LEFT OUTER JOIN dba.anagrafica an ON an.id_anagrafica=sc.id_anagrafica
LEFT OUTER JOIN dba.destinazione de ON de.id_destinazione=d.id_destinazione
LEFT OUTER JOIN dba.tipo_trasporto tt ON tt.id_tipo_trasporto=d.id_tipo_trasporto
LEFT OUTER JOIN dba.caus_trasporto ct ON ct.id_caus_trasporto=d.id_caus_trasporto
LEFT OUTER JOIN dba.sog_commerciale v ON v.id_sog_commerciale=d.id_sog_commerciale_vettore
LEFT OUTER JOIN dba.anagrafica av ON av.id_anagrafica=v.id_anagrafica
LEFT OUTER JOIN dba.unita_misura ump ON ump.id_unita_misura=d.id_unita_misura_peso
LEFT OUTER JOIN dba.unita_misura umv ON umv.id_unita_misura=d.id_unita_misura_volume
LEFT OUTER JOIN dba.utenti u ON u.id_utenti=d.id_utente_crea
WHERE d.id_documento > {{ULTIMO_ID_SOGLIA}}
  AND d.tipo_registro IN ('DV','DA')
ORDER BY d.data_registrazione,d.id_documento;
OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\Live\trasporti_documenti_live.csv'
-- Niente WITH COLUMN NAMES: il client SQL Anywhere 11 installato su
-- SRVWOA non la supporta e risponde "Syntax error: 'WITH' was not
-- expected here". Il CSV esce quindi SENZA intestazione, come quello
-- del cruscotto. L'ordine delle 68 colonne resta il contratto, ed e'
-- verificato per posizione a valle.
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
