/*
   Storico costi — estrazione per la pipeline BI.

   Destinazione sul server SQL Anywhere:
     C:\Impresa\Viste_BI\STORICO_COSTI.sql

   Lo storico del listino "Ultimo Costo" aziendale, versionato per data:
     dba.listino          id 331, codice 'UC', puntato da
                          dba.par_sistema.id_listino_ultimo_costo
     dba.variazione       la versione del listino (data_inizio)
     dba.prezzo           il costo dell'articolo in quella versione
     dba.unita_confezione l'unita' base ('S') a cui il costo e' agganciato

   Il costo valido a una data e' quello della variazione con data_inizio piu'
   recente fra quelle <= alla data. Su questo listino `data_fine` e' SEMPRE
   NULL: il versionamento e' per sola data_inizio.

   Tre colonne: codice_articolo; valido_dal; costo.

   ── FINESTRA ──────────────────────────────────────────────────────────────
   Questo file e' la versione NOTTURNA: estrae solo l'anno corrente (~11.000
   righe), e il 1 gennaio si sposta da solo senza che nessuno debba ricordarsi
   di cambiarlo.

   Verificato sul gestionale il 17/09/2026: un anno si assesta entro il 31
   marzo dell'anno successivo, poi la deriva e' di ~4 righe su 19.000. Per
   questo la notte si ricarica solo l'anno corrente e gli anni chiusi non si
   toccano piu'.

   Per il BACKFILL una tantum si sostituisce la riga della finestra con

       WHERE v.data_inizio >= '1999-01-01'

   (~402.000 righe) e si carica con `--anno-da` assente: vedi
   scripts/bi-ingest-costi.mjs.

   Query di sola lettura. Genera un CSV UTF-8 separato da ';'.
*/

SET TEMPORARY OPTION on_error = 'exit';

SELECT
    a.codice                                AS codice_articolo,
    DATEFORMAT(v.data_inizio, 'YYYY-MM-DD') AS valido_dal,
    p.prezzo                                AS costo

FROM dba.prezzo p
  JOIN dba.variazione v        ON p.id_variazione = v.id_variazione
  JOIN dba.par_sistema ps      ON v.id_listino = ps.id_listino_ultimo_costo
  JOIN dba.unita_confezione uc ON uc.id_unita_confezione = p.id_unita_confezione
                              AND uc.unita_base = 'S'
  JOIN dba.articolo a          ON a.id_articolo = uc.id_articolo

-- Costo <= 0 e' un campo non compilato, non un costo: caricarlo come zero
-- darebbe margine 100% su quella riga.
WHERE v.data_inizio >= DATEFORMAT(getdate(), 'YYYY-01-01')
  AND p.prezzo > 0

ORDER BY a.codice, v.data_inizio;

-- FORMAT ASCII non scrive la riga di intestazione, come per il cruscotto:
-- il tracciato e' verificato a valle, in scripts/lib/costi-parser.mjs.
OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\storico_costi.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
