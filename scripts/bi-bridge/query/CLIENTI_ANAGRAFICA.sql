/*
   Anagrafica clienti — estrazione per la pipeline BI (profilo "clienti").

   Destinazione sul server SQL Anywhere:
     C:\Impresa\Viste_BI\CLIENTI_ANAGRAFICA.sql

   Una riga per CLIENTE (codice), non per destinazione. Le categorie sono quelle
   dell'ANAGRAFICA PRINCIPALE (`sog_commerciale`), non delle destinazioni: un
   cliente con una destinazione "UT.FIN." e l'anagrafica "RIV. RIVENDITORI" e' un
   rivenditore (verificato il 06/10/2026 su 05000208, 05004716, 05005422...).
   L'Excel "Cruscotto Dinamico" ha invece una riga per destinazione e la
   categoria di quella destinazione: per questo non e' piu' la fonte.

   tipo: 'C' cliente, 'P' potenziale (codici P@...). Fornitori, agenti, vettori
   ('F','A','V','Z') non servono.
   attivo: 'S'/'N' del gestionale. Si caricano anche i non attivi: il portale li
   nasconde, ma un cliente disattivato con invii storici deve restare leggibile.

   Agente = gruppo agenti del cliente (`id_gruppo_agenti`), lo stesso campo che le
   query ORDINATO/FATTURATO chiamano "Agenti".

   Query di sola lettura. CSV UTF-8 separato da ';', senza intestazione (FORMAT
   ASCII non la scrive): 14 colonne, verificate a valle in
   scripts/bi-ingest-clienti.mjs. ~7.300 righe: si ricarica tutto ogni volta.
*/

SET TEMPORARY OPTION on_error = 'exit';

SELECT
    sc.codice                                            AS codice_cliente,
    ISNULL(an.rag_soc_1, '')                             AS ragione_sociale,
    ISNULL(ca.codice, '')                                AS cat_attivita_codice,
    ISNULL(ca.descrizione, '')                           AS cat_attivita,
    ISNULL(cc.codice, '')                                AS cat_commerciale_codice,
    ISNULL(cc.descrizione, '')                           AS cat_commerciale,
    ISNULL(cz.codice, '')                                AS cat_zona_codice,
    ISNULL(cz.descrizione, '')                           AS cat_zona,
    ISNULL(ga.codice, '')                                AS agente_codice,
    ISNULL(ga.descrizione, '')                           AS agente,
    sc.tipo                                              AS tipo,
    sc.attivo                                            AS attivo,
    DATEFORMAT(sc.data_creazione, 'YYYY-MM-DD HH:NN:SS') AS creato_il,
    DATEFORMAT(sc.data_modifica, 'YYYY-MM-DD HH:NN:SS')  AS modificato_il

FROM dba.sog_commerciale sc
  LEFT OUTER JOIN dba.anagrafica an     ON an.id_anagrafica = sc.id_anagrafica
  LEFT OUTER JOIN dba.cat_attivita ca   ON ca.id_cat_attivita = sc.id_cat_attivita
  LEFT OUTER JOIN dba.cat_com_sc cc     ON cc.id_cat_com_sc = sc.id_cat_com_sc
  LEFT OUTER JOIN dba.cat_zona cz       ON cz.id_cat_zona = sc.id_cat_zona
  LEFT OUTER JOIN dba.gruppo_agenti ga  ON ga.id_gruppo_agenti = sc.id_gruppo_agenti

WHERE sc.tipo IN ('C', 'P')

ORDER BY sc.codice;

OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\clienti_anagrafica.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
