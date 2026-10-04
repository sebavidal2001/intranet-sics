# Guida pratica al Preventivatore

## Parte 1 — Prima di cominciare

### Cos'è, in due righe

Il Preventivatore è il programma che sostituisce i file Excel dei preventivi. Fa tre cose: **ti aiuta a costruire un preventivo** (calcola lui i prezzi), **conserva tutto quello che abbiamo già fatto** (così non riparti mai da zero) e **risponde alle tue domande** sui lavori passati.

Non serve saper usare Excel. Non serve ricordare formule. I conti li fa il programma.

### Come si entra

Apri il browser e vai all'indirizzo dell'intranet. Ti chiede utente e password: sono le stesse dell'intranet aziendale.

![La pagina di accesso](screenshots/01-pagina-accesso.png)

Dalla home dell'intranet scegli il portale **Preventivatore**.

### Come è fatta la schermata

A sinistra c'è sempre la stessa barra scura: da lì ti sposti tra le cinque zone del programma. Ovunque tu sia, quella barra resta.

![La barra a sinistra](screenshots/04-menu-laterale.png)

| Voce | A cosa serve |
|---|---|
| **Dashboard** | La panoramica: quanti preventivi, quanto valgono, chi sono i clienti principali |
| **BI** | I grafici che ti costruisci tu |
| **Nuovo preventivo** | Dove si crea un preventivo |
| **Archivio** | Tutti i preventivi, da cercare e consultare |
| **Impostazioni** | Solo per i responsabili: tariffe, template, configurazioni |

> Se non vedi la voce **Impostazioni**, è normale: compare solo a chi ha i permessi da responsabile. Tutto il resto del programma funziona uguale.

In fondo alla barra trovi il tuo nome e il tuo livello di accesso.

### Cinque parole che troverai ovunque

Imparale adesso e il resto viene da sé.

| Parola | Cosa vuol dire davvero |
|---|---|
| **Blocco** | Un pezzo del progetto. Se devi preventivare un nastro e una scala, fai due blocchi. Se è tutto una cosa sola, ne basta uno |
| **Codice commessa** | Il numero con cui identifichiamo il lavoro. Lo scrivi tu e non può essere ripetuto |
| **Ult. costo** | Quanto ci costa l'articolo, preso in automatico dal gestionale |
| **Coefficiente** | Il numero che trasforma il costo in prezzo di vendita. Più è **basso**, più il prezzo è **alto** |
| **Stato** | A che punto è l'offerta: aperta, inviata, ordinata, persa |

---

## Parte 2 — Le cose che dovrai fare

Questa parte è organizzata per **attività**: cerca quella che ti serve e segui i passi.

| Devo… | Vai a |
|---|---|
| Fare un preventivo da zero | Attività 1 |
| Rifare qualcosa di simile a un lavoro già fatto | Attività 2 |
| Mandare la descrizione tecnica al cliente | Attività 3 |
| Segnare che il cliente ha ordinato (o ha detto no) | Attività 4 |
| Sapere quanto costava un articolo, chi è il fornitore, cosa abbiamo fatto per un cliente | Attività 5 |
| Capire come sta andando il lavoro | Attività 6 |

---

## Attività 1 — Fare un preventivo nuovo

Tempo: dai 10 ai 40 minuti, a seconda di quanto è complesso.

### Passo 1 — Apri la pagina

Clicca **Nuovo preventivo** nella barra a sinistra. Ti trovi davanti una pagina vuota con un blocco già pronto.

![La pagina appena aperta](screenshots/05-nuovo-preventivo-vuoto.png)

In alto a destra c'è un **cronometro**. Premi *Avvia*: serve a capire quanto tempo ci vuole a fare i preventivi, non a controllare le persone. Se ti interrompi, metti in pausa.

### Passo 2 — Compila l'intestazione

Sono i dati generali del lavoro.

- **Codice commessa** — obbligatorio. Scrivi il numero della commessa, per esempio `2026-0142`. Se esiste già, il programma te lo dice quando salvi.
- **Titolo** — a cosa serve il lavoro, in parole tue: *Scale accesso linea 3*.
- **Consegna stimata** — da quante a quante settimane, per esempio da `6` a `8`.
- **Margine trattativa** — la percentuale che vuoi tenerti per trattare. Se non sai, lascia `0`.

### Passo 3 — Scegli il cliente

Scrivi le prime lettere del nome. Il programma cerca da solo.

![Cerchi il cliente per nome](screenshots/06-nuovo-ricerca-cliente.png)

Poi succede una cosa importante: molti clienti hanno **più sedi**. Dopo aver scelto il nome ti compare l'elenco delle sedi: scegli quella giusta.

![Scegli la sede giusta](screenshots/07-nuovo-scelta-sede.png)

> **Attenzione.** La sede non è un dettaglio: determina a quale commerciale viene attribuito il lavoro. Se il cliente ha una sola sede, il programma la sceglie da solo e non ti chiede niente.

A questo punto l'intestazione è completa:

![Intestazione compilata](screenshots/08-nuovo-intestazione.png)

Sotto ai campi vedi già quattro numeri che si aggiornano da soli mentre lavori: quanti blocchi, quanti articoli, quante ore, il totale.

### Passo 4 — Dai un nome al blocco e di' quanti pezzi sono

Nella riga grigia del blocco:
- scegli il **tipo** dal menù (Scala, Nastro Principale, Protezioni…);
- scrivi un **nome** riconoscibile: *Scala accesso quadro elettrico*;
- nella casella **Pz** scrivi quanti pezzi identici devi produrre. Se è uno solo, lascia `1`.

### Passo 5 — Aggiungi i materiali

Nella riga **Cerca codice o descrizione articolo** scrivi il codice o una parola della descrizione.

![Cerchi l'articolo](screenshots/09-nuovo-ricerca-articolo.png)

Clicca sul risultato giusto: il programma inserisce da solo codice, descrizione e **costo aggiornato dal gestionale**. Tu metti solo la quantità.

Se l'articolo **non esiste** in anagrafica, il programma ti propone *Aggiungi come articolo manuale*: scrivi tu descrizione e costo.

> **La casella gialla.** Se il costo di un articolo è più vecchio di 9 mesi, la casella diventa gialla. Non è un errore: è un promemoria per verificare il prezzo prima di fare l'offerta.

### Passo 6 — Aggiungi le lavorazioni

Clicca **Aggiungi lavorazione** e scegli dall'elenco: le tariffe sono già quelle aziendali.

![L'elenco delle lavorazioni](screenshots/10-nuovo-elenco-lavorazioni.png)

Per ogni lavorazione scrivi le **ore**. Poi guarda la colonna **Tipo**: è la cosa che si sbaglia più spesso.

| Se vedi | Vuol dire | Usalo per |
|---|---|---|
| **÷Q** | Le ore che hai scritto valgono per **tutto il lotto** e vengono divise per il numero di pezzi | Montaggio, lavorazione, collaudo |
| **1×** | Le ore si contano **una volta sola**, qualunque sia il numero di pezzi | Progettazione, manuale, documentazione |

Si cambia cliccandoci sopra.

> **Perché conta.** Se lasci la Progettazione su ÷Q e i pezzi sono 10, il costo della progettazione viene diviso per 10 e il preventivo esce troppo basso.

### Passo 7 — Controlla il blocco

Ecco come si presenta un blocco compilato:

![Un blocco completo](screenshots/11-nuovo-blocco-compilato.png)

Leggiamolo insieme, perché qui c'è tutto:

- L'articolo costa **20 €**, ne servono **4**, quindi il prezzo di vendita è **160,00 €**. La casella del costo è gialla: prezzo da verificare.
- Il **Montaggio** è 10 ore a 23,88 €/h, ed è marcato **÷Q**: costa 477,60 €, ma essendo 2 pezzi diventa **238,80 € a pezzo** (te lo scrive in verde sotto).
- La **Progettazione** è 3 ore a 33,61 €/h, marcata **1×**: si conta una volta sola, 201,66 €.
- In fondo il riepilogo: **839,26 €** per un pezzo, **760,46 €** per due.

> **Non è un errore.** Due pezzi costano meno di uno *sommato due volte* perché i materiali raddoppiano ma il montaggio si divide. È esattamente il vantaggio di produrre in serie.

### Passo 8 — Guarda la barra in basso

La barra colorata resta sempre visibile in fondo allo schermo e si aggiorna mentre lavori.

![La barra dei totali](screenshots/12-nuovo-barra-totali.png)

| Riquadro | Cosa ti dice |
|---|---|
| **Materiali** | Quanto vendi di materiale, e sotto quanto ti costa |
| **Servizi** | Quanto vendi di manodopera, e sotto quanto ti costa |
| **Totale** | Il prezzo finale, con il dettaglio di cosa ci è stato aggiunto |
| **Margine** | Quanto ci guadagni, in euro e in percentuale |

Il **Margine** è il numero da guardare prima di salvare.

### Passo 9 — Salva

Premi **Salva Preventivo**. Il programma controlla tre cose: che ci sia il cliente, che ci sia il codice commessa, che ci sia almeno un articolo o una lavorazione.

Se qualcosa manca te lo dice. Se il codice commessa esiste già, te lo dice.

Dopo il salvataggio ti porta direttamente sulla scheda del preventivo appena creato, e il cronometro si azzera.

### Il preventivo finito

![Il preventivo completo](screenshots/13-nuovo-preventivo-intero.png)

---

## Attività 2 — Riusare un lavoro già fatto

**È la cosa che ti farà risparmiare più tempo in assoluto.** Prima di costruire qualcosa da zero, controlla sempre se l'abbiamo già fatto.

### Passo 1 — Cerca in Archivio

Clicca **Archivio**. Trovi tutti i preventivi, i più recenti in cima.

![L'archivio](screenshots/16-archivio.png)

Hai due modi di cercare, e fanno cose diverse:

| Modo | Come si usa | Quando |
|---|---|---|
| **Ricerca normale** | Scrivi nella barra e aspetta | Sai il codice, il numero d'offerta o il nome del cliente |
| **Cerca con AI** | Scrivi a parole tue e premi il pulsante | Non ricordi il codice ma sai *com'era fatto* |

Esempio di ricerca a parole: *«scala con ballatoio e balaustra in alluminio»*. Il programma capisce il senso e ti mostra i lavori più somiglianti, con una percentuale di somiglianza.

Puoi anche restringere con i filtri: stato, cliente, tipo, importo minimo e massimo.

### Passo 2 — Apri il preventivo

Clicca sulla scheda. Vedi tutto: prezzo, blocchi, materiali, lavorazioni.

![La scheda di un preventivo](screenshots/20-dettaglio-preventivo.png)

Il riquadro **Riepilogo economico complessivo** ti spiega come si è formato il prezzo, riga per riga: si parte dal costo, si aggiungono imballaggio, tempi e spese, e si arriva al prezzo finale. A destra, in verde, quanto ci abbiamo guadagnato.

### Passo 3 — Riusalo

In alto a destra hai due pulsanti diversi. **Non sono la stessa cosa.**

| Pulsante | Cosa fa | Quando usarlo |
|---|---|---|
| **Crea preventivo da questa base** | Fa una **copia nuova** con gli stessi materiali, ma **con i prezzi di oggi** | Nuovo lavoro simile a uno vecchio |
| **Modifica** | Riapre **quello stesso** preventivo, con i prezzi **congelati** come li avevi salvati | Devi correggere un preventivo tuo |

Quando usi *Crea da questa base*, il programma ti avvisa in verde cosa è cambiato: «12 prezzi articolo aggiornati · 2 tariffe aggiornate · 1 codice non più in anagrafica».

> **Modifica** compare solo sui preventivi fatti col programma. Quelli vecchi importati da Excel si possono consultare e copiare, ma non modificare.

---

## Attività 3 — Preparare la descrizione per il cliente

Il programma scrive per te la **descrizione di fornitura** da mandare al cliente, copiando lo stile delle offerte che abbiamo già inviato.

### Passo 1 — Avvia

Nel preventivo, in basso a destra, premi **Scheda tecnica**.

![Generazione della scheda tecnica](screenshots/15-scheda-tecnica-avvio.png)

### Passo 2 — Rispondi alle domande

Quasi sempre il programma ti fa qualche domanda prima di scrivere: dimensioni, finiture, cosa è compreso e cosa no. Sono le informazioni che nella distinta materiali non ci sono.

Compila e premi **Invia risposte e genera**. Se hai fretta, **Genera comunque** salta le domande (ma il testo sarà più generico).

### Passo 3 — Rileggi e correggi

Il testo compare in un riquadro **modificabile**: puoi correggerlo lì prima di scaricarlo.

Poi scegli:
- **Scarica Word** — il file da allegare alla mail;
- **Copia testo** — per incollarlo direttamente in un messaggio;
- **Rigenera** — se non ti piace, ne scrive un'altra versione.

> **Rileggila sempre.** Il testo è una bozza professionale, non un documento approvato. Non contiene mai prezzi né codici interni, ma le caratteristiche tecniche vanno confermate da te.

---

## Attività 4 — Aggiornare lo stato dell'offerta

**Questa è l'attività più trascurata e la più importante.** Se nessuno aggiorna gli stati, il programma non può dire quanti lavori vinciamo, e metà dei numeri restano vuoti.

### Il percorso di un'offerta

```
Aperta  →  Presa in carico  →  Pronto per offerta  →  Offerta inviata  →  Ordinata
                                                                       ↘  Persa
```

| Stato | Vuol dire | Chi lo mette |
|---|---|---|
| **Aperta** | Richiesta arrivata, non ancora lavorata | Commerciale |
| **Presa in carico** | Ci stiamo lavorando | Preventivatore |
| **Pronto per offerta** | Il preventivo è finito e verificato | Preventivatore |
| **Offerta inviata** | Mandata al cliente | Back office |
| **Ordinata** / **Persa** | Il cliente ha deciso | Back office |

### Come si cambia

Apri il preventivo dall'Archivio: sotto i dati trovi **solo i pulsanti validi in quel momento**. Se sei in *Pronto per offerta*, vedi **Invia offerta**; se sei in *Offerta inviata*, vedi **Marca ordinata** e **Marca fallita**.

Quando invii l'offerta ti chiede il **numero offerta (PC N°)**, l'importo e, se vuoi, una nota sullo scostamento («trattativa −5%»).
Quando marchi un'offerta come persa ti chiede **il motivo**: sceglilo dall'elenco, è il dato che ci dice perché perdiamo.

> Da *Ordinata* e da *Persa* non si torna indietro. Prima di confermare, assicurati.

### Scorciatoia dall'elenco

Sull'elenco dell'archivio, ogni scheda ha un pulsante **Azioni** per segnare rapidamente ordinato o rifiutato.

![Il menu Azioni](screenshots/17-archivio-menu-azioni.png)

---

## Attività 5 — Chiedere all'assistente

L'assistente è la finestra scura sulla destra, presente in **Archivio** e in **Nuovo preventivo**. Gli scrivi una domanda in italiano e lui cerca nei dati veri: prezzi, articoli, clienti, offerte vinte e perse.

![L'assistente nel preventivo](screenshots/14-assistente-nel-builder.png)

### Come si usa

Scrivi la domanda e premi Invio.

![Una domanda](screenshots/18-assistente-domanda.png)

La risposta arriva in pochi secondi, con le tabelle dei dati veri.

![La risposta](screenshots/19-assistente-risposta.png)

Con il pulsante di ingrandimento la chat si apre a tutta pagina: si legge molto meglio, e a sinistra hai l'elenco delle conversazioni passate.

![La chat a schermo intero](screenshots/30-assistente-schermo-intero.png)

### Precisa o Creativa?

In alto c'è un interruttore. Cambia parecchio.

| Modalità | Cosa fa | Usala per |
|---|---|---|
| **Precisa** | Risponde **solo** con i dati che trova. Se un dato non c'è, te lo dice | Numeri, prezzi, date, quantità |
| **Creativa** | Parte dai dati e aggiunge ragionamenti commerciali | Consigli, posizionamento di prezzo, pareri |

> Regola semplice: **Precisa per i numeri, Creativa per le idee.** Quello che esce in Creativa va sempre verificato prima di finire in un'offerta.

### Trenta domande già pronte

Copiale così come sono.

**Sui prezzi e sugli articoli**
```
Quanto costa oggi il codice AFD.00.1.11191.0?
Come è cambiato il costo di quel codice negli ultimi 5 anni?
Chi è il fornitore del codice 4505000?
Cosa compriamo da WURTH?
Qual è l'articolo con il prezzo unitario più alto?
Quali sono i 10 articoli più usati nelle scale?
Cosa mettiamo di solito insieme al codice AFD.00.3.20792.0?
Cerca articoli con descrizione "profilato alluminio 170x40"
Qual è la tariffa a listino del MONTAGGIO?
Quali lavorazioni abbiamo a listino?
```

**Sui clienti**
```
Parlami del cliente ALPHAMAC
Chi è il commerciale che segue CURTI?
Quanti preventivi abbiamo fatto per SORMA?
Qual è il nostro tasso di conversione su IMA negli ultimi 24 mesi?
Su quali categorie ordinano di più i nostri clienti?
Quali sono le ultime commesse di TECNA?
Quanto sconto applichiamo mediamente a questo cliente?
```

**Sui preventivi**
```
Quali sono i 5 preventivi di importo più alto e in che stato sono?
Quanti preventivi abbiamo sopra i 50.000 € nel 2026?
Dammi la distinta completa del preventivo S_25_128
Quanti preventivi per cliente nell'ultimo anno?
Qual è il valore totale per stato?
In quale mese facciamo più preventivi?
Confronta il 2025 con il 2026 per categoria
Quali preventivi sono molto sopra la media del cliente?
Quali preventivi sono incompleti o da sistemare?
```

**Mentre stai costruendo un preventivo**
```
Guarda il preventivo che sto costruendo: il margine è in linea con lavori simili?
Cerca preventivi storici con una configurazione simile a questo blocco
Mi manca qualcosa di tipico rispetto agli storici?
Questo cliente in passato ha accettato preventivi di questo importo?
```

### Come farsi capire meglio

| Fai così | Invece che |
|---|---|
| Scrivi il **codice esatto** quando ce l'hai | «quel codice del nastro» |
| Indica il **periodo**: «nel 2026», «ultimi 12 mesi» | domande senza tempo |
| **Una domanda per volta** | tre domande in una frase |
| **Controlla** i numeri nelle tabelle della risposta | copiare e incollare senza guardare |

> Le conversazioni si salvano da sole. Le ritrovi con l'icona dell'orologio; **Nuova chat** ne comincia una pulita.

---

## Attività 6 — Vedere come stiamo andando

### La Dashboard

È la prima pagina: la fotografia degli ultimi 12 mesi.

![La Dashboard](screenshots/02-dashboard.png)

| Riquadro | Come si legge |
|---|---|
| **Preventivi totali** | Quanti ne abbiamo fatti, e se sono più o meno del periodo prima |
| **Valore totale** | Quanto valgono in euro |
| **Clienti attivi** | Quanti clienti distinti |
| **Tasso ordinato** | La percentuale di offerte vinte |
| **Top Clienti** | I cinque clienti che pesano di più |
| **Preventivi mensili** | Il ritmo mese per mese, con i colori delle categorie |
| **Attività recente** | Gli ultimi preventivi toccati |

> Se il **Tasso ordinato** dice «In arrivo» e vedi una striscia arancione, vuol dire che nessuno sta aggiornando gli stati delle offerte. Vedi l'Attività 4.

I numeri che vedi sono **i tuoi**: se sei un commerciale con un portafoglio assegnato, la Dashboard conta solo i tuoi clienti.

### I grafici su misura (BI)

Nella pagina **BI** ti costruisci i grafici che vuoi.

![La pagina BI](screenshots/22-bi-dashboard.png)

In alto scegli:
- **Personale** o **Team** — la tua dashboard oppure quella condivisa;
- **Vista** o **Modifica** — guardare oppure cambiare;
- i **filtri**: anno, cliente, categoria, validi per tutti i grafici.

Per aggiungere un grafico passa a **Modifica** e premi **+ Widget**: a destra compare il pannello dove scegli titolo, tipo di grafico, cosa misurare e come raggrupparlo. I riquadri si spostano trascinandoli e si ridimensionano dall'angolo.

![Modalità modifica](screenshots/24-bi-modalita-modifica.png)

**Il modo più veloce:** nel riquadro *AI proposta grafico* scrivi a parole cosa vuoi vedere — per esempio «mostrami il valore dei nastri per cliente» — e premi **Genera proposta**. Il grafico compare già impostato, tu lo sistemi e salvi.

Tre esempi da provare:

| Cosa voglio vedere | Tipo | Misura | Raggruppa per |
|---|---|---|---|
| Quanto ha ordinato ogni cliente | barre | somma di *Importo ordinato* | Cliente |
| Quali articoli pesano di più | tabella | somma di *Totale riga* | Codice articolo |
| L'andamento mese per mese | barre impilate | conteggio | Mese, impilato per Categoria |

> **Attenzione al salvataggio Team:** sovrascrive la dashboard di tutti. Prova sempre prima sulla tua **Personale**.

---

## Parte 3 — Capire i numeri

Non servono formule: bastano tre idee.

### Idea 1 — Il coefficiente

Il prezzo di vendita si ottiene **dividendo** il costo per il coefficiente.

| Coefficiente | Il prezzo diventa |
|---|---|
| **0,50** | il doppio del costo |
| **0,65** | circa una volta e mezza |
| **0,70** | circa il 43% in più |
| **1,00** | uguale al costo (nessun ricarico) |

**Più il numero è basso, più il prezzo è alto.** Il valore normale è `0,50`.

Se devi cambiarlo su tutte le righe del blocco, usa **Coeff. blocco** in alto a destra e premi *applica a tutti*.

### Idea 2 — I pezzi

I **materiali** si moltiplicano per il numero di pezzi: 4 pezzi costano 4 volte tanto.
Le **lavorazioni** dipendono dall'interruttore ÷Q / 1× visto nell'Attività 1.

### Idea 3 — Cosa si aggiunge alla fine

Al prezzo dei materiali e delle lavorazioni il programma aggiunge sempre tre voci, e solo alla fine il tuo margine di trattativa:

| Voce | Quanto |
|---|---|
| Imballaggio | 1% |
| Tempi accessori di produzione | 2,8% |
| Spese generali aziendali | 24,2% |

Ecco un caso reale, letto dalla scheda di un preventivo vero:

| Voce | Importo |
|---|---|
| Costo complessivo (quello che spendiamo) | 1.987,04 € |
| Prezzo di vendita base | 3.181,60 € |
| Imballaggio | 31,82 € |
| Tempi accessori | 55,64 € |
| Spese generali | 480,86 € |
| **Prezzo finale** | **4.124,90 €** |
| **Margine** | **2.137,86 €** (+107,6%) |

Il **margine** è la differenza tra quello che incassi e quello che spendi. La percentuale è calcolata sul costo: +107,6% vuol dire che vendi a poco più del doppio di quanto spendi.

---

## Parte 4 — Per i responsabili

Queste due pagine sono nascoste a chi non ha i permessi.

### Tariffe delle lavorazioni

**Impostazioni → Servizi e Lavorazioni.** Qui si decidono le tariffe orarie che tutti vedono nel builder.

![Impostazioni](screenshots/25-impostazioni.png)

Le modifiche restano **in bozza** finché non premi *Salva modifiche* (compare un avviso giallo con quante righe hai toccato). L'interruttore **Attivo** invece agisce subito: spegnerlo toglie la lavorazione dall'elenco senza cancellare lo storico.

> Cambiare una tariffa **non tocca i preventivi già salvati**: quelli hanno i prezzi congelati.

### Template dei prodotti

**Impostazioni → Template prodotti.** Un template è una distinta già pronta: scegli il prodotto, inserisci le misure e il programma genera materiali e lavorazioni.

![Elenco template](screenshots/27-template-elenco.png)

![Un template aperto](screenshots/28-template-aperto.png)

Dentro un template imposti le domande da fare all'operatore (larghezza, numero di gradini…), le righe di materiale con le quantità che si calcolano da sole, e le lavorazioni.

In fondo c'è un riquadro azzurro di **anteprima**: inserisci dei valori di prova e vedi subito costo e prezzo finale. Provalo con almeno tre combinazioni prima di attivare un template.

C'è anche un **assistente**: descrivi a parole il template e lui propone una bozza da rivedere e salvare.

### Configurazione dell'assistente

Sempre in Impostazioni si regolano il comportamento dell'assistente e i testi che gli dicono come rispondere.

> Se tocchi questi testi: **copiali prima da qualche parte**, cambia **una cosa per volta** e **prova subito**. Le modifiche valgono immediatamente per tutti e non c'è una cronologia da cui tornare indietro.

---

## Parte 5 — Gli errori che si fanno più spesso

| # | L'errore | Come te ne accorgi | Rimedio |
|---|---|---|---|
| 1 | Progettazione lasciata su **÷Q** | Il prezzo cala all'aumentare dei pezzi | Clicca su ÷Q e portalo a 1× |
| 2 | **Sede sbagliata** del cliente | Il lavoro risulta di un altro commerciale | Rifai la scelta della sede |
| 3 | Costo con la **casella gialla** ignorato | Prezzo vecchio di oltre 9 mesi | Verifica con gli acquisti prima di offrire |
| 4 | **Stato mai aggiornato** | Dashboard con «In arrivo» | Aggiorna gli stati (Attività 4) |
| 5 | **Codice commessa doppio** | Errore al salvataggio | Usa un codice nuovo |
| 6 | **Coefficiente** cambiato solo su una riga | Margine più basso del previsto | Usa *Coeff. blocco → applica a tutti* |
| 7 | Preventivo rifatto da zero | Tempo buttato | Cerca prima in Archivio (Attività 2) |
| 8 | **Scheda tecnica** inviata senza rileggerla | Caratteristiche non confermate | Rileggi e correggi sempre |
| 9 | Template applicato **dopo** aver inserito i materiali | Le tue righe spariscono | Applica il template per primo |
| 10 | Dashboard **Team** salvata per sbaglio | Cambia a tutti | Lavora sulla **Personale** |

---

## Parte 6 — Pronto soccorso

**«Non trovo un preventivo che so che esiste.»**
Probabilmente è di un cliente non tuo: ognuno vede i propri. Se dovrebbe essere tuo, fallo verificare a un responsabile.

**«Non riesco a salvare.»**
Controlla che ci siano cliente, codice commessa e almeno una riga in un blocco. Il messaggio rosso ti dice cosa manca.

**«Ho sbagliato il codice commessa.»**
Non si può cambiare dopo. Crea un preventivo nuovo con il codice giusto.

**«Ho aggiornato le tariffe ma il preventivo non cambia.»**
È voluto: i preventivi salvati hanno prezzi congelati. Riaprilo in **Modifica** e premi **Aggiorna prezzi**, oppure usa *Crea da questa base*.

**«L'assistente mi dà un numero: mi posso fidare?»**
In **Precisa** i numeri arrivano dai dati veri e li vedi nelle tabelle: controllali lì. In **Creativa** i commenti sono ragionamenti, non dati.

**«Non vedo la voce Impostazioni.»**
Serve il permesso da responsabile. Non è un guasto.

**«Il grafico dice "dataset troncato".»**
Stai chiedendo troppi dati insieme: restringi con i filtri, per esempio un anno alla volta.

**«Ho modificato un preventivo di un collega.»**
Se aveva già lo stato *Ordinata* o *Persa* non era modificabile. Negli altri casi avvisa chi lo seguiva.

---

## Il riassunto in dieci righe

1. Prima di fare un preventivo nuovo, **cerca in Archivio** se l'abbiamo già fatto.
2. Il **codice commessa** è obbligatorio e unico.
3. Scegli sempre la **sede giusta** del cliente.
4. Un **blocco** per ogni parte del progetto.
5. I **materiali** si prendono dalla ricerca: costo e descrizione arrivano da soli.
6. Occhio alla **casella gialla**: prezzo da verificare.
7. Sulle lavorazioni controlla sempre **÷Q oppure 1×**.
8. Prima di salvare guarda il **Margine** nella barra in basso.
9. La **scheda tecnica** si rilegge sempre prima di mandarla.
10. **Aggiorna lo stato** appena il cliente risponde: è quello che fa funzionare tutto il resto.
