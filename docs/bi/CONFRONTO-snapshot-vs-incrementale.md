# Snapshot completo o caricamento incrementale — confronto per giovedì

> Preparato il 30 agosto 2026, su misure reali del database.
> **Nessuna modifica applicata.** È materiale per la decisione, non una proposta
> di intervento.

---

## 1. Il fatto che ha aperto la discussione

Ogni notte riscriviamo l'intero contenuto. Misurato su due run consecutivi
(29 agosto, 01:30 → 22:05):

```
ordinato: 17.992 righe · 17.992 identiche · 0 nuove · 0 sparite
```

Il 100%. Una riga d'ordine entrata il 1° gennaio viene riscritta ogni notte
finché non esce dalla finestra della query (`>= 2025`): circa **730 volte**. A
389 byte l'una, una singola riga costa **280 kB all'anno**.

---

## 2. Quanto cambia davvero, in una settimana

Confronto fra il run del 22 e quello del 29 agosto, riga per riga su tutte le
colonne di contenuto.

| Dataset | Righe (22→29) | Identiche | Nuove | Sparite | **Turnover** |
|---|---|---:|---:|---:|---:|
| `consegnato` | 18.309 → 18.483 | 18.309 | 174 | 0 | **0,9%** |
| `fatturato` | 17.889 → 18.062 | 17.889 | 173 | 0 | **1,0%** |
| `controllo_banco` | 3.480 → 3.521 | 3.480 | 41 | 0 | **1,2%** |
| `preventivi_aperti` | 6.391 → 6.476 | 6.375 | 101 | 16 | **1,8%** |
| `ordinato` | 17.722 → 17.992 | 17.577 | 415 | 145 | **3,1%** |
| `portafoglio` | 683 → 767 | 460 | 307 | 223 | **69%** |
| `consegnato_futuro_per_mese` | 683 → 767 | 460 | 307 | 223 | **69%** |
| **Totale** | **65.157 → 66.068** | | **1.518** | **607** | **3,2%** |

**In sette giorni cambiano 2.125 righe su 66.068.** Circa **300 al giorno**.

### Tre osservazioni che contano

**`consegnato`, `fatturato` e `controllo_banco` sono a sola aggiunta**: zero
righe sparite. Una fattura emessa non cambia più. Sono i due terzi del volume ed
è il caso più semplice possibile.

**`ordinato` e `preventivi_aperti` mutano davvero.** Su `preventivi_aperti`, con
una chiave per articolo, in una settimana: 5.819 chiavi comuni, di cui **12
modificate**, 77 nuove, 2 sparite. Le modifiche sono `quantità evasa` e `importo
evaso` che avanzano mentre l'ordine si consuma. Sono lo 0,2%, ma esistono: un
incrementale deve fare *upsert*, non solo *append*.

**`portafoglio` e `consegnato_futuro_per_mese` non sono incrementalizzabili.**
Il 69% di turnover non è attività commerciale: sono **aggregati per mese**, e
ogni notte i totali dei mesi aperti si spostano. Non hanno identità di riga, non
hanno una chiave. Vanno sostituiti per intero, sempre. Per fortuna sono 767
righe, l'1% del volume.

---

## 3. Il prerequisito che V1 non aveva e V2 sì

Un incrementale ha bisogno di sapere **quale riga è quale**. Verificato sul run
V2 del 29 agosto, con la chiave candidata «profilo + numero documento + codice
articolo»:

| Dataset | Righe | Chiavi distinte | **Duplicati** |
|---|---:|---:|---:|
| `fatturato` | 18.062 | 16.747 | **1.315** |
| `ordinato` | 17.992 | 17.284 | **708** |
| `consegnato` | 18.483 | 17.690 | **793** |
| `preventivi_aperti` | 6.476 | 5.896 | **580** |

Lo stesso articolo compare più volte sullo stesso documento — righe diverse con
causali o date di consegna diverse. **Con le 17 colonne di V1 una chiave non
esiste**, e senza chiave l'incrementale è impossibile: non si può distinguere
«questa riga è cambiata» da «questa è un'altra riga».

Con V2:

```
preventivi_aperti · id_riga_documento
  6.476 righe · 6.476 valori distinti · 0 duplicati · 0 nulli
```

**È V2 ad aver reso l'incrementale possibile.** Prima non lo era, e non per una
scelta di disegno: mancava il dato.

Nota: le chiavi tecniche sono nel contratto di `ordinato`, `preventivi_aperti`,
`fatturato` e `consegnato`. Gli altri tre dataset restano senza.

---

## 4. Le tre strade, con i numeri

Costo misurato per riga: **389 byte** (321 di dati + 68 di indici).

| | Oggi | A regime | A 3 anni | Storia disponibile |
|---|---:|---:|---:|---|
| **A. Snapshot, nessuna retention** | 725 MB | +9,4 GB/anno | ~28 GB | tutti i run conservati |
| **B. Snapshot + retention 3 run** | 725 MB | **77 MB** | 77 MB | 3 giorni di rollback |
| **B'. Snapshot + retention 7 run** | 725 MB | 180 MB | 180 MB | 7 giorni |
| **C. Incrementale, stato corrente** | — | **26 MB** | 26 MB | **nessuna** |
| **D. Incrementale + storico righe** | — | 26 MB | **~155 MB** | **completa, dal giorno uno** |

Il delta giornaliero è ~300 righe × 389 B = **117 kB al giorno**, cioè 43 MB
l'anno.

### Il risultato che sorprende

**A tre anni, l'incrementale con storico (155 MB) costa il doppio dello
snapshot con retention a 3 run (77 MB).**

Non è un paradosso: la retention butta via la storia, l'incrementale la
accumula. Stanno rispondendo a due domande diverse.

---

## 5. Cosa si guadagna e cosa si perde

### Quello che l'incrementale **non** fa risparmiare

- **L'estrazione su Windows resta identica.** SQL Anywhere produce comunque le
  17.992 righe: non sa quali sono cambiate.
- **Il trasferimento resta identico.** Sempre 19 MB di CSV ogni notte.
- **Il confronto va fatto comunque**, e va fatto contro lo stato precedente:
  serve tenerlo in memoria o rileggerlo dal database.

Il risparmio è **solo in quello che si conserva**, non in quello che si muove.

### Quello che si perde

**L'atomicità dello snapshot.** Oggi `bi_activate_run` sposta un puntatore: o
tutto il run è pubblicato, o niente. Il rollback è un `UPDATE` e si torna a ieri.
Con l'incrementale lo stato è il risultato di *tutti* i delta applicati in
sequenza: se ne salti uno, o ne applichi uno due volte, lo stato diverge — **e
diverge in silenzio**. Il ripristino richiede di riapplicare la catena.

**La riproducibilità.** Oggi, se un report di martedì sembra sbagliato, si
guarda il run di martedì così com'era. Con l'incrementale quel run non esiste
più come oggetto: esiste solo lo stato attuale e il registro delle modifiche.

**Il costo di ogni notte cresce.** Oggi il caricamento è un `INSERT` di massa. Con
l'incrementale ogni riga va confrontata con la precedente: su 66.068 righe è
lavoro in più, ogni notte, su una macchina con 2 vCPU condivise con l'intranet.

### Quello che si guadagna, e che oggi non abbiamo

**La domanda temporale.** «Com'era questo ordine il 15 marzo?» «Quando è stata
evasa questa riga?» «Quanto tempo passa fra preventivo e prima evasione?»

Con lo snapshot + retention 3, quelle domande sono **irrispondibili**: dei dati
di marzo non resta niente. Con lo storico incrementale si risponde sempre.

E non sarebbe una novità in casa: **il Cruscotto lo fa già**. `bi.costi_storico`
e `bi.giacenze_storico` sono esattamente questo — SCD2 con `valid_from` /
`valid_to`, alimentati da `bi.ingest_cruscotto`. Il modello è collaudato, gira
da settimane, e pesa 26 MB in tutto.

---

## 6. La cosa da dire chiaramente

**Lo spazio ha smesso di essere il problema.**

Sul PostgreSQL locale ci sono **177 GB liberi**. Anche lo scenario peggiore —
snapshot senza alcuna retention — occuperebbe 28 GB in tre anni: il 16% del
disco. La retention a 3 run lo porta a 77 MB, cioè lo 0,04%.

Quindi la scelta **non è più fra risparmiare e non risparmiare**. È fra:

- **B — snapshot + retention**: semplice, atomico, già funzionante, zero lavoro.
  Nessuna storia oltre i 3 giorni.
- **D — incrementale + storico**: sblocca l'analisi temporale, costa il doppio in
  spazio (irrilevante), e costa lavoro e fragilità (non irrilevanti).

**C non ha senso**: lo stato corrente senza storia dà gli stessi risultati di B
con più complessità e meno robustezza.

**A va escluso comunque**: è quello che ci ha portati a 861 MB su un piano da 500.

---

## 7. La mia raccomandazione

**Fare B adesso e valutare D come progetto separato, non come alternativa.**

La retention è decisa, non richiede codice, e chiude il problema che ha aperto la
discussione. Va fatta giovedì insieme allo spostamento della pipeline.

L'incrementale è una funzionalità nuova travestita da ottimizzazione. La domanda
giusta non è «quanto spazio risparmia» — la risposta è «meno di quanto pensi, e
lo spazio non manca». È **«volete poter rispondere a domande sul passato?»**

Se la risposta è sì, allora il modo giusto non è convertire la pipeline
esistente, ma **affiancare uno storico** che si alimenta dallo snapshot:

- lo snapshot resta come è, atomico e affidabile, con la sua retention a 3 run;
- una funzione confronta il run corrente col precedente e scrive **solo i
  cambiamenti** in una tabella di storia, sullo stile di `bi.giacenze_storico`;
- se lo storico si rompe, la pipeline continua a funzionare;
- se la pipeline si ferma, lo storico non si corrompe.

Si ottiene la storia **senza rinunciare all'atomicità**, e i due meccanismi
falliscono separatamente invece che insieme. Costa più spazio di entrambi presi
singolarmente — circa 230 MB a tre anni — e su 177 GB non è una cifra che
meriti una discussione.

Il prerequisito, in ogni caso, è **avere le chiavi tecniche su tutti e quattro i
dataset documentali**: oggi le ha solo `preventivi_aperti`. È un altro motivo per
completare i contratti V2 prima di aprire questo capitolo.

---

## 8. Domande a cui serve una risposta prima di decidere

| # | Domanda | Perché conta |
|---|---|---|
| 1 | Qualcuno ha mai avuto bisogno di sapere com'era un dato in una data passata? | Se no, D è una soluzione in cerca di un problema |
| 2 | Quanto indietro dovrebbe arrivare la storia? | Un anno costa 43 MB, dieci ne costano 430 |
| 3 | Serve su tutti e sette i dataset o solo su ordinato e preventivi? | I due aggregati non possono averla; gli altri costerebbero molto meno |
| 4 | Chi manterrebbe la logica di confronto? | È codice che va capito da qualcuno anche fra due anni |

Alla 1 si può rispondere anche guardando indietro: in cinque mesi di pipeline,
è mai stata posta una domanda a cui i dati di ieri non bastavano?

---

## Collegato a

- [`REVISIONE-PIANO-BI-V2.md`](REVISIONE-PIANO-BI-V2.md) — retention a 3 run
- [`ESITO-run-v2-verificato.md`](ESITO-run-v2-verificato.md) — le chiavi tecniche
- [`../db-migrazione/OPERATIVITA-DB-VM.md`](../db-migrazione/OPERATIVITA-DB-VM.md)
