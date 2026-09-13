# Workflow di analisi e dashboard BI

Questo documento fotografa il percorso osservabile nel codice prima delle correzioni e registra i punti in cui una persona può perdere l'orientamento o non riuscire a completare il lavoro. Il criterio di gravità è l'impatto sul numero di utenti, non il costo tecnico della soluzione.

## Modello mentale e grafo attuale

Il modello dati è gerarchico:

```text
analisi = domanda certificata (SpecQuery) + visualizzazione
dashboard
  └── pagina con filtri comuni
        └── riquadro che usa un'analisi
```

Il Cruscotto storico e il Cruscotto di sistema non sono ancora la stessa implementazione. Il primo combina anche confronti e pannelli compositi non rappresentabili da una singola `SpecQuery`; il secondo è una dashboard condivisa e immutabile che riproduce soltanto i riquadri oggi esprimibili dal modello. La distinzione tecnica è necessaria, ma l'interfaccia iniziale non spiega il rapporto.

```text
Barra BI
├── Briefing (/bi)
├── Cruscotto storico (/bi/cruscotto)
├── Elenco dashboard (/bi/dashboard)
│   └── Dashboard (/bi/dashboard/[id])
│       ├── cambia pagina e filtri
│       ├── duplica
│       └── se modificabile: crea pagina / aggiunge / riordina / rimuove riquadri
│           └── Aggiungi riquadro
│               ├── libreria analisi
│               ├── editor manuale incorporato
│               └── proposte dell'Analista AI
├── Articoli & Acquisti (/bi/articoli)
├── Analista (/bi/analista)
└── Budget & BEP (/bi/configurazione)

Route fuori dalla barra:
└── Editor analisi (/bi/esplora[?analisi=id])
```

## Schermate: ingressi, azioni e destinazioni

| Schermata | Come ci si arriva | Azioni offerte | Dove portano o cosa cambiano |
|---|---|---|---|
| Briefing `/bi` | Prima voce della barra BI | Ricarica, scarica report Word, riscontro utile/non utile, mostra segnali scartati, configura budget quando manca | Aggiorna la stessa vista; download; `POST /api/bi/briefing`; link a `/bi/configurazione` |
| Cruscotto storico `/bi/cruscotto` | Voce “Cruscotto” | Cambia vista, periodo e confronto, filtri incrociati, ricarica, esporta Excel, presentazione, schermo intero, configura budget quando manca | Resta nel Cruscotto; download; link a `/bi/configurazione` |
| Elenco dashboard `/bi/dashboard` | Voce “Dashboard” | Nuova dashboard; apre una dashboard esistente | Form nella stessa pagina, poi `/bi/dashboard/[id]` |
| Dashboard `/bi/dashboard/[id]` | Riga dell'elenco o redirect dopo creazione/duplicazione | Cambia pagina e filtri, duplica; se propria: nuova pagina, aggiunge analisi, riordina/ridimensiona/cambia grafico/rimuove riquadri | Aggiorna la stessa dashboard; la duplicazione apre la copia |
| Pannello Aggiungi riquadro | Pulsante “Aggiungi” dentro una dashboard modificabile | Collega un'analisi dalla libreria, ne costruisce una con `EditorAnalisi`, oppure chiede proposte all'AI e salva/collega quella scelta | Torna alla dashboard con il nuovo riquadro |
| Editor `/bi/esplora` | Solo link diretto noto o `/bi/esplora?analisi=id`; non è in menu | Compone, anteprima e salva un'analisi | Resta nell'editor; il salvataggio usa sempre `POST` |
| Articoli & Acquisti `/bi/articoli` | Voce della barra | Filtra, azzera filtri, aggiorna, espande la coda acquisti e i dettagli | Aggiorna la stessa vista |
| Analista `/bi/analista` | Voce della barra | Invia domanda, sceglie profondità, scarica risultati, salva una proposta come analisi | Resta nella conversazione; l'analisi salvata non ha una destinazione successiva |
| Budget & BEP `/bi/configurazione` | Voce della barra o avvisi da Briefing/Cruscotto | Cambia anno/configurazione, salva, esporta, importa file Excel, elimina serie importate | Aggiorna la stessa vista; download |
| Accesso negato | Qualunque route BI senza autorizzazione | Nessuna | Stato terminale intenzionale; serve l'accesso dal portale |

## Superficie API e raggiungibilità iniziale

| API | Metodi | Interfaccia iniziale |
|---|---|---|
| `/api/bi/analisi` | `GET`, `POST`, `DELETE` | `GET` e `POST` usati da editor/dashboard/Analista; `DELETE` senza interfaccia |
| `/api/bi/dashboard` | `GET`, `POST` | Elenco e creazione dashboard |
| `/api/bi/dashboard/[id]` | `GET`, `PATCH`, `DELETE` | Solo `GET` usato; rinomina/modifica ed eliminazione senza interfaccia |
| `/api/bi/dashboard/[id]/duplica` | `POST` | Pulsante generico “Duplica” nella dashboard |
| `/api/bi/dashboard/[id]/pagine` | `POST`, `PATCH` | Creazione pagina e salvataggio filtri; il `PATCH` supporta anche titolo/ordine ma non ha controlli dedicati |
| `/api/bi/dashboard/pagine/[pagina]/riquadri` | `POST`, `PATCH`, `DELETE` | Tutti usati nella dashboard |
| `/api/bi/query` | `GET`, `POST` | Vocabolario, anteprime e calcolo dei riquadri |
| `/api/bi/analista` | `POST` | Analista e pannello Aggiungi |
| `/api/bi/briefing`, `/api/bi/articoli`, `/api/bi/configurazione`, `/api/bi/importa-budget`, `/api/bi/esporta`, `/api/bi/dettaglio` | vari | Usati dalle schermate corrispondenti |
| `/api/bi/snapshot` | `GET`, `POST` | Nessun componente; endpoint operativo/diagnostico |
| `/api/bi/sql` | `GET`, `POST` | Nessun componente; endpoint tecnico protetto per SQL libero |

## Problemi ordinati per gravità

| Gravità | Problema iniziale | Tipo | Impatto sulla persona | Correzione prevista |
|---|---|---|---|---|
| Bloccante | Le analisi create non hanno un elenco e diventano irraggiungibili | Oggetto irraggiungibile | Tutti coloro che salvano non possono ritrovare, modificare o eliminare il lavoro | Libreria Analisi in barra con proprie/condivise, utilizzi, apri, duplica ed elimina |
| Bloccante | `/bi/esplora` è fuori menu e le viste non offrono una creazione analisi globale | Pulsante sparito | Da quasi tutte le schermate non si può iniziare una nuova analisi senza conoscere l'URL | Voce “Analisi” sempre visibile; nuova analisi in due click al massimo |
| Bloccante | Nel Cruscotto di sistema “Aggiungi” scompare senza spiegazione | Pulsante sparito / stato senza uscita | Chi apre il modello condiviso interpreta i grafici come definitivamente non modificabili | Sostituire “Aggiungi” con “Duplica per modificare” e aprire la copia |
| Bloccante | Cruscotto storico e dashboard di sistema appaiono indipendenti | Passaggio non spiegato | Tutti vedono due prodotti e non sanno quale usare o copiare | Marcare il Cruscotto nell'elenco e collegare chiaramente le due versioni in entrambe le direzioni |
| Alta | Riaprire un'analisi nell'editor e salvarla esegue sempre `POST` | Azione incoerente | Si accumulano copie e l'originale non è modificabile | Aggiungere aggiornamento esplicito per le proprie analisi; le condivise restano duplicabili |
| Alta | L'eliminazione analisi esiste solo come endpoint | Azione senza interfaccia | Nessuno può correggere o ripulire la libreria | Collegare `DELETE /api/bi/analisi?id=` con conferma |
| Alta | Non si vede dove un'analisi è usata | Passaggio non spiegato | L'eliminazione può rimuovere silenziosamente riquadri per il `ON DELETE CASCADE` | Restituire e mostrare dashboard/pagine d'uso; conferma specifica prima dell'eliminazione |
| Alta | Dashboard rinominabili/eliminabili via API ma non via UI | Azione senza interfaccia | Le dashboard di prova restano per sempre e non si correggono i metadati | Azioni per dashboard propria, con conferma per l'eliminazione |
| Alta | Lo stato vuoto dell'elenco dashboard non contiene il pulsante promesso dal testo | Stato vuoto incompleto | L'utente deve risalire all'header e indovinare il passo | CTA “Crea la prima dashboard” dentro lo stato vuoto |
| Alta | Pagina vuota di dashboard condivisa: testo “Aggiungi” ma nessuna azione disponibile | Pulsante sparito / passaggio non spiegato | Il testo indica un'azione impossibile | Proporre la duplicazione quando la pagina non è modificabile |
| Media | Apertura dashboard fallita mostra solo un errore | Stato senza uscita | L'utente non può riprovare né tornare all'elenco dal contenuto | Aggiungere retry e ritorno alle dashboard |
| Media | Libreria vuota nel pannello Aggiungi dice soltanto “Nessuna analisi disponibile” | Stato vuoto incompleto | Il percorso si interrompe proprio al primo utilizzo | Spiegare e offrire “Costruisci” e “Chiedi all'AI” nello stesso stato |
| Media | Rimozione di un riquadro senza conferma | Azione distruttiva non protetta | Un click elimina il collegamento e il layout della pagina | Conferma prima del `DELETE` |
| Media | Eliminazione di una serie budget senza conferma | Azione distruttiva non protetta | Un click rimuove dati importati | Conferma prima del `DELETE` |
| Media | Le pagine si possono creare ma non eliminare; il titolo è aggiornabile solo dall'API generica | Oggetto non gestibile | Errori e pagine di prova rimangono nella dashboard | Aggiungere rinomina e rimozione protetta mantenendo almeno una pagina |
| Bassa | Gli endpoint `snapshot` e `sql` non hanno una UI | Azione senza interfaccia tecnica | Non blocca il workflow dashboard; sono strumenti operativi/protetti | Documentarli, senza esporli nel flusso utente |

## Obiettivo del percorso corretto

- Da ogni schermata: `Analisi` → `Nuova analisi`, oppure `Dashboard` → `Nuova dashboard` (massimo due click).
- Dopo il salvataggio: l'oggetto resta nella libreria, è riapribile e dichiara dove viene usato.
- Su contenuti condivisi o di sistema: nessun comando semplicemente scompare; viene proposta la duplicazione modificabile.
- Ogni stato vuoto include spiegazione e azione immediata.
- Ogni eliminazione persistente richiede conferma; duplicazioni, filtri e altre azioni reversibili no.

## Esito dell'intervento

Le correzioni previste nella tabella sono state applicate, incluse quelle emerse oltre al feedback iniziale: modifica delle analisi esistenti, rinomina/eliminazione delle dashboard, rinomina/eliminazione delle pagine, recupero dagli errori di apertura, guida nella libreria vuota e conferme per riquadri e budget importati. Non è stata necessaria alcuna migration.

Restano volutamente fuori dall'interfaccia utente `/api/bi/snapshot` e `/api/bi/sql`: sono endpoint tecnici protetti e non fanno parte del percorso di creazione dashboard. Resta inoltre la separazione implementativa tra Cruscotto storico e dashboard di sistema finché il modello dei riquadri non supporterà pannelli compositi; l'interfaccia ora ne spiega il rapporto e consente apertura e duplicazione dirette.
