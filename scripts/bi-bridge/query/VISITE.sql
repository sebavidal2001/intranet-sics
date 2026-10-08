/*
   Visite dei commerciali — estrazione per la pipeline BI (profilo "clienti").

   Destinazione sul server SQL Anywhere:
     C:\Impresa\Viste_BI\VISITE.sql

   Una riga per VISITA (dba.visita) dal 01/01/2024. Si ricarica tutta la finestra
   a ogni giro (fotografia): una visita cancellata o corretta in Impresa sparisce
   o cambia anche qui. ~700 righe al 10/2026.

   Cosa NON c'e' nel gestionale (verificato l'08/10/2026): `ora_visita` e'
   sempre vuota e `id_utente` sempre nullo, quindi dentro una giornata l'ordine
   delle tappe non e' noto (si usa id_visita = ordine di registrazione) e il
   commerciale e' il GRUPPO AGENTI della visita, non l'utente che l'ha inserita.
   `id_destinazione` e' valorizzato solo in una visita su 250: la chiave verso il
   cliente e' id_cliente = sog_commerciale.id_sog_commerciale.

   Il CAP e' quello della destinazione se la visita ne ha una e ne ha uno, altrimenti
   quello dell'anagrafica principale. Le coordinate NON sono nel gestionale
   (latitudine/longitudine sono vuote su tutti i clienti): la mappa usa il CAP.

   Le note libere (note, note_azienda, memo) non si estraggono: non servono ai
   grafici e contengono testo del commerciale su aziende terze.

   Query di sola lettura. CSV UTF-8 separato da ';', senza intestazione: 15 colonne,
   verificate a valle in scripts/bi-ingest-visite.mjs.
*/

SET TEMPORARY OPTION on_error = 'exit';

SELECT
    v.id_visita                                          AS id_visita,
    DATEFORMAT(v.data_visita, 'YYYY-MM-DD')              AS data_visita,
    ISNULL(sc.codice, '')                                AS codice_cliente,
    ISNULL(an.rag_soc_1, '')                             AS ragione_sociale,
    ISNULL(ga.codice, '')                                AS agente_codice,
    ISNULL(ga.descrizione, '')                           AS agente,
    ISNULL(v.grado_visita, '')                           AS grado_codice,
    ISNULL(gv.descrizione, '')                           AS grado,
    ISNULL(v.tipo_visita, '')                            AS tipo_codice,
    ISNULL(tv.descrizione, '')                           AS tipo,
    ISNULL(v.esito, '')                                  AS esito,
    ISNULL(DATEFORMAT(v.data_prox_visita, 'YYYY-MM-DD'), '') AS data_prox_visita,
    ISNULL(NULLIF(TRIM(de.cap), ''), ISNULL(an.cap, ''))             AS cap,
    ISNULL(NULLIF(TRIM(de.localita), ''), ISNULL(an.localita, ''))   AS localita,
    ISNULL(NULLIF(TRIM(de.provincia), ''), ISNULL(an.provincia, '')) AS provincia

FROM dba.visita v
  LEFT OUTER JOIN dba.sog_commerciale sc ON sc.id_sog_commerciale = v.id_cliente
  LEFT OUTER JOIN dba.anagrafica an      ON an.id_anagrafica = sc.id_anagrafica
  LEFT OUTER JOIN dba.destinazione de    ON de.id_destinazione = v.id_destinazione
  LEFT OUTER JOIN dba.gruppo_agenti ga   ON ga.id_gruppo_agenti = v.id_gruppo_agenti
  LEFT OUTER JOIN dba.grado_visita gv    ON gv.codice = v.grado_visita
  LEFT OUTER JOIN dba.tipo_visita tv     ON tv.codice = v.tipo_visita

WHERE v.data_visita >= '2024-01-01'

ORDER BY v.data_visita, v.id_visita;

OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\visite.csv'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
