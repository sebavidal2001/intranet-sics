# Encoding delle query SQL Anywhere

`PREVENTIVI_APERTI.sql` deve essere distribuito in **Windows-1252**.

Il client `dbisql.com` di SQL Anywhere 16 presente su Windows Server interpreta
gli script con la code page Windows. Se lo script viene salvato in UTF-8,
intestazioni come `Quantità` vengono esportate come `QuantitÃ `, facendo fallire
il confronto esatto con il contratto Linux.

Il CSV prodotto resta invece UTF-8, come dichiarato dalla clausola
`ENCODING 'UTF-8'` della query.

La VM usa `dbisql.com` 11.0.1, che non accetta la clausola
`WITH COLUMN NAMES`. La query esporta quindi le sole righe dati; subito dopo
l'estrazione `Verifica-IntestazioneV2.ps1 -AggiungiSeAssente` antepone in modo
atomico l'intestazione canonica e la confronta carattere per carattere prima
di qualsiasi upload.
