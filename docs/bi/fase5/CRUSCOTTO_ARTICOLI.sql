/*
   Cruscotto articoli — estrazione per la pipeline BI.

   Destinazione sul server SQL Anywhere:
     C:\Impresa\Viste_BI\Query\CRUSCOTTO_ARTICOLI.sql

   Identica alla query fornita: 40 colonne, stesso ordine, stessa semantica.
   L'ORDER BY rende l'output deterministico, e quindi stabile il confronto
   change-only a valle.

   Ult_Costo e data_Ult_Costo provengono dal listino ultimo costo aziendale:
     dba.vs_listino_ultimo_costo.prezzo
     dba.vs_listino_ultimo_costo.data_inizio
   Gli articoli senza costo restano VUOTI: il valore non va mai ereditato
   dall'ultimo costo storico conosciuto.

   Query di sola lettura. Genera un CSV UTF-8 separato da ';'.
*/

SELECT
    vs_riepilogo_magazzino.codice,
    vs_riepilogo_magazzino.descrizione,
    unita_confezione.codice AS codice_uc,

    dba.cat_com_articolo.codice      AS cat_com_articolo_codice,
    dba.cat_com_articolo.descrizione AS cat_com_articolo_descrizione,
    dba.cat_merceologica.codice      AS cat_merceologica_codice,
    dba.cat_merceologica.descrizione AS cat_merceologica_descrizione,
    dba.gruppo_articoli.codice       AS gruppo_articoli_codice,
    dba.gruppo_articoli.descrizione  AS gruppo_articoli_descrizione,
    dba.reparto.codice               AS reparto_codice,
    dba.reparto.descrizione          AS reparto_descrizione,
    dba.cat_fiscale.codice           AS cat_fiscale_codice,
    dba.cat_fiscale.descrizione      AS cat_fiscale_descrizione,
    dba.cat_esposizione.codice       AS cat_esposizione_codice,
    dba.cat_esposizione.descrizione  AS cat_esposizione_descrizione,

    dba.vs_listino_ultimo_costo.prezzo      AS Ult_Costo,
    dba.vs_listino_ultimo_costo.data_inizio AS data_Ult_Costo,

    vs_riepilogo_magazzino.magazzino,
    vs_riepilogo_magazzino.qta_rim_iniziale,
    vs_riepilogo_magazzino.qta_caricata,
    vs_riepilogo_magazzino.qta_scaricata,
    vs_riepilogo_magazzino.qta_altri_carichi,
    vs_riepilogo_magazzino.qta_altri_scarichi,
    vs_riepilogo_magazzino.qta_imp_produzione,
    vs_riepilogo_magazzino.qta_ord_clienti,
    vs_riepilogo_magazzino.qta_ord_fornitori,
    vs_riepilogo_magazzino.qta_vis_clienti,
    vs_riepilogo_magazzino.qta_vis_fornitori,
    vs_riepilogo_magazzino.qta_reso_clienti,
    vs_riepilogo_magazzino.qta_reso_fornitori,
    vs_riepilogo_magazzino.qta_ord_produzione,
    vs_riepilogo_magazzino.qta_cl_clienti,
    vs_riepilogo_magazzino.qta_cl_fornitori,
    vs_riepilogo_magazzino.qta_cl_terzi,
    vs_riepilogo_magazzino.qta_gruppo_lib_1,
    vs_riepilogo_magazzino.qta_gruppo_lib_2,
    vs_riepilogo_magazzino.qta_gruppo_lib_3,
    vs_riepilogo_magazzino.qta_gruppo_lib_4,
    vs_riepilogo_magazzino.esistenza,
    vs_riepilogo_magazzino.disponibilita

FROM dba.vs_riepilogo_magazzino
JOIN dba.articolo
  ON articolo.id_articolo = vs_riepilogo_magazzino.id_articolo
JOIN dba.magazzino
  ON magazzino.id_magazzino = vs_riepilogo_magazzino.id_magazzino
JOIN dba.par_sistema
  ON par_sistema.id_azienda = articolo.id_azienda
LEFT OUTER JOIN dba.unita_confezione
  ON unita_confezione.id_articolo = articolo.id_articolo
 AND unita_confezione.unita_base = 'S'
LEFT OUTER JOIN dba.cat_com_articolo
  ON articolo.id_cat_com_articolo = cat_com_articolo.id_cat_com_articolo
LEFT OUTER JOIN dba.cat_merceologica
  ON articolo.id_cat_merceologica = cat_merceologica.id_cat_merceologica
LEFT OUTER JOIN dba.cat_fiscale
  ON articolo.id_cat_fiscale = cat_fiscale.id_cat_fiscale
LEFT OUTER JOIN dba.cat_esposizione
  ON articolo.id_cat_esposizione = cat_esposizione.id_cat_esposizione
LEFT OUTER JOIN dba.gruppo_articoli
  ON articolo.id_gruppo_articoli = gruppo_articoli.id_gruppo_articoli
LEFT OUTER JOIN dba.reparto
  ON articolo.id_reparto = reparto.id_reparto
LEFT OUTER JOIN dba.vs_listino_ultimo_costo
  ON vs_listino_ultimo_costo.id_listino = par_sistema.id_listino_ultimo_costo
 AND vs_listino_ultimo_costo.id_unita_confezione = unita_confezione.id_unita_confezione

WHERE articolo.utilizzabile = 'S'
  AND magazzino.utilizzabile = 'S'

ORDER BY articolo.codice,
         vs_riepilogo_magazzino.magazzino;

OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\cruscotto_articoli.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
