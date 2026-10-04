# Controllo vettori: misure, direzioni e Outlook — 6 settembre 2026

## Funzioni implementate

- Calcolo volumetrico: somma di quantità × lunghezza × larghezza × altezza / 1.000.000 × coefficiente kg/m³. Volume totale già disponibile non viene moltiplicato nuovamente per i colli.
- Misure modificabili per riga prima dell'acquisizione, con ricalcolo del costo atteso e dell'anomalia. Possibili gruppi di colli con dimensioni differenti, peso reale e volume totale alternativi alle dimensioni.
- Recupero delle rilevazioni di magazzino per gli arrivi solo con riferimento, controparte e data compatibili e corrispondenza univoca. Fonte delle misure esplicita; il volume dichiarato dal vettore non equivale a una verifica indipendente.
- Trading Post non sovrapponibile: altezza tariffaria minima di 180 cm quando sono disponibili le dimensioni.
- Fatture: viste Arrivi da fornitori, Invii a clienti, Da classificare e Tutte, con righe e riepiloghi distinti. La quadratura e l'acquisizione rimangono sull'intero documento per evitare duplicazioni. Direzione correggibile prima dell'acquisizione.
- Anomalie filtrabili per direzione e periodo. La bozza include la selezione visibile ancora aperta/contestata, per un solo vettore, mese e direzione. Lo stato contestata si aggiorna esplicitamente dopo l'invio manuale.
- Listini: configurazione del modello email generale o specifico per vettore, indirizzi A/Cc, oggetto e corpo con segnaposto.
- Outlook: anteprima, preparazione del collegamento, apertura della mail tramite COM locale; alternativa EML. Nessun invio automatico.

## Riscontro sugli Excel originali

Fonte: `TEST VETTORI.zip`, cartella Download, estrazione temporanea di sole copie dei workbook; originali non modificati.

GLS, foglio PARTENZE e TRIANGOLAZIONI 2026: I16 = F16*G16*H16*3/10000, cioè 13,5 kg per 50×30×30 cm. I18 somma i colli. Trading Post usa lo stesso coefficiente di 300 kg/m³ e riporta la nota sull'altezza 180 cm. I workbook distinguono arrivi/fornitori da partenze/clienti.

Il foglio partenze TNT riporta 300 kg/m³, mentre le fatture e la configurazione contrattuale disponibile usano 250 kg/m³. Il programma conserva il coefficiente del vettore (250 per TNT/FedEx), senza copiare questa incongruenza del foglio.

## Installazione Outlook

In Listini → Email di contestazione → Collegamento a Outlook sul PC, scaricare il file di installazione dal portale di destinazione ed eseguirlo con Windows PowerShell su ciascun PC. L'installer registra il protocollo SICS per l'utente corrente e fissa l'origine del portale. Non modifica la execution policy; eventuali restrizioni aziendali vanno gestite dall'IT.

Serve Outlook classico: il nuovo Outlook non supporta questa integrazione COM. Il controllo locale mostra un errore esplicito quando COM non è disponibile. Sul PC di sviluppo risulta registrato Outlook.Application; l'apertura effettiva di una bozza non è stata collaudata.

Il browser passa solo un token casuale, valido cinque minuti e utilizzabile una volta. Il helper recupera esclusivamente quella bozza tramite HTTPS (HTTP ammesso solo su loopback), poi esegue CreateItem e Display. Non chiama Send. L'installer non è stato eseguito sui PC degli utenti.

Riferimenti Microsoft: https://learn.microsoft.com/en-us/office/vba/api/outlook.application.createitem e https://techcommunity.microsoft.com/blog/outlook/add-ins-in-the-new-outlook-for-windows/3954388.

## Verifiche e ambiente

- 185 test del modulo superati, inclusi formule Excel, quantità, gruppi differenti, abbinamento delle rilevazioni, non sovrapponibilità e salvataggio dei modelli email.
- Collaudo aggiuntivo in sola lettura delle cinque fatture di esempio contro lo sviluppo superato: GLS luglio/agosto, TNT luglio, Trading Post luglio/agosto. Restano esplicitamente non valutabili due righe TNT di giugno senza fuel storico e una riga Trading Post per Rovigo senza tariffa configurata.
- TypeScript e ESLint superati; sintassi PowerShell del helper valida; detector Impeccable senza segnalazioni.
- Migrazione 094 verificata in transazione con rollback (scadenza, consumo monouso, permessi) e applicata al database di sviluppo.
- Verifica visuale autenticata e apertura COM end-to-end ancora da svolgere: il browser disponibile arriva alla pagina di login.
- Produzione non aggiornata. Nessuna email inviata.
