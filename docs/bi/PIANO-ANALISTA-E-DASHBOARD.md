# Analista AI e Dashboard — diagnosi e piano

> Redatto il **13/09/2026**, dopo il rilievo: *«l'analista ha troppe poche feature,
> i report Excel/Word sono iper banali, e a volte le risposte sono sbagliate».*
> Seguito di [`PIANO-PRODUZIONE-BI.md`](PIANO-PRODUZIONE-BI.md).

Le tre cose sono collegate più di quanto sembri, e il filo è uno solo: **l'analista
oggi produce testo, mentre dovrebbe produrre analisi**. Un testo non si verifica,
non si mette in una dashboard e non diventa un report: si legge e si spera.

---

## A. Perché l'analista sbaglia

Cinque cause, tutte lette nel codice. Le prime due producono errori *veri*, le
altre tre producono risposte deboli.

### A1. Il troncamento silenzioso ✅ corretto il 13/09

`analista.ts` restituiva al modello `righe: res.righe.slice(0, 60)` — le prime
sessanta righe **senza dire che erano le prime sessanta**. Su una query che ne
restituisce trecento, il modello vedeva un quinto dei dati e ne parlava come se
fossero tutti.

È la causa più probabile degli errori osservati, ed è insidiosa perché **ogni
singolo numero citato è corretto**: sbagliate sono le affermazioni di completezza —
«il cliente X è il più piccolo», «nessun altro supera Y», «i primi dieci pesano
il Z%». Il modello non stava inventando: stava generalizzando al buio.

Ora il payload dichiara `righe_totali`, `righe_mostrate`, `troncato` e la quota di
totale coperta, con l'istruzione esplicita di non trarre conclusioni su classifiche
complete e di rifare la domanda più stretta.

### A2. Nessuno verifica i numeri della risposta

Le istruzioni dicono «non inventare numeri, usa solo quelli dei risultati». Nessun
controllo lo impone. Il modello scrive un testo libero e quel testo va a video.

**Da fare — verifica numerica post-risposta.** Si estraggono le cifre dal testo
finale e si confrontano con i valori restituiti dagli strumenti in quella
conversazione: ogni numero deve comparire fra i risultati (con tolleranza per gli
arrotondamenti) o essere derivabile da due di essi. Quelli che non si ritrovano
vengono marcati in interfaccia come *non verificati*, e il modello riceve un giro
di correzione. Non è un filtro perfetto, ma trasforma un errore invisibile in un
errore visibile — che è tutta la differenza.

### A3. L'instradamento a parole chiave sbaglia bersaglio

`instrada()` sceglie il modello cercando parole come «perché», «confronta»,
«previsione». *«E i clienti che l'anno scorso compravano e adesso no?»* non contiene
nessuna di quelle parole: finisce su Haiku con pochi passi, e la risposta è debole.

**Da fare**: non un LLM per decidere (costerebbe una chiamata per decidere quanto
spendere nella successiva), ma un criterio strutturale — se la domanda cita due
periodi, due dimensioni o una negazione, sale di livello. Più il permesso esplicito
all'utente di dire «approfondisci», che oggi esiste come parametro `complessita` ma
non è esposto in interfaccia.

### A4. Il modello non dichiara come ha capito la domanda

Se sceglie `preventivi_aperti` dove l'utente intendeva `preventivi_valore`, il
numero è giusto e la risposta è a un'altra domanda. Chi legge non ha modo di
accorgersene: vede le spec nei "passi", ma in forma tecnica.

**Da fare**: la risposta si apre con una riga di interpretazione in chiaro —
*«Leggo: valore dei preventivi creati nel 2026, per business unit»* — che è anche il
punto in cui l'utente corregge il tiro in un click.

### A5. Finire i passi produce una non-risposta

Esaurito `massimoPassi`, l'analista risponde *«Ho raggiunto il numero massimo di
interrogazioni»*. Per l'utente è un fallimento secco.

**Da fare**: all'ultimo passo il modello riceve l'istruzione di concludere con ciò
che ha, dichiarando cosa non ha potuto verificare.

---

## B. Perché i report sono banali

Il Word è un **dump del briefing**: intestazione, le voci una sotto l'altra, le
tabelle delle prove. L'Excel è un foglio per query con le righe grezze. Nessuna
sintesi, nessun grafico, nessun confronto, nessuna gerarchia di lettura. È
esattamente ciò che si ottiene stampando una struttura dati.

Un report che vale il tempo di chi lo legge ha altro:

| Elemento | Perché |
|---|---|
| **Sintesi esecutiva** — 5 righe | Chi lo apre deve sapere in dieci secondi se deve preoccuparsi |
| **KPI con confronto** | Un numero senza il suo termine di paragone non è informazione |
| **Grafici** | Oggi non ce n'è nemmeno uno. Sono 19 componenti già scritti: vanno renderizzati lato server come PNG e incorporati |
| **Tabelle con scostamenti** | Non l'elenco: valore, anno precedente, delta, quota, e l'ordinamento che conta |
| **Nota metodologica** | Da quale spec viene ogni numero, e a quale data. È ciò che rende il report difendibile in riunione |
| **Excel: dati + tabella pivot già impostata** | Chi apre l'Excel vuole rimaneggiare, non leggere |

Il pezzo tecnico da risolvere è il rendering dei grafici fuori dal browser. I
componenti sono React/SVG: si possono renderizzare a stringa SVG lato server e
convertire in PNG, senza browser headless — la stessa strada già usata per i PDF
dei certificati con `@react-pdf/renderer`.

---

## C. La dashboard a più pagine

Oggi il cruscotto è a schede fisse decise nel codice. L'obiettivo è che l'utente
crei le proprie pagine.

Il modello dati esiste già a metà: la migration 104 ha `analisi`, `dashboard` e
`dashboard_analisi`. Manca il livello intermedio.

```
dashboard              una per tema ("Commerciale 2026")
  └── pagina           più pagine dentro la stessa dashboard
        └── riquadro   -> analisi (una SpecQuery + un grafico)
```

Serve quindi `bi_direzionale.dashboard_pagine` (id, dashboard_id, titolo, ordine) e
uno spostamento di `dashboard_analisi` da `dashboard_id` a `pagina_id`.

**Due proprietà che vanno decise ora perché cambiano tutto il resto:**

1. **I filtri sono della pagina, non del riquadro.** Si sceglie periodo, business
   unit e agente una volta in alto, e tutti i riquadri della pagina si adeguano.
   È ciò che distingue una dashboard da una raccolta di grafici. Il filtro
   incrociato (clicco una barra → filtro gli altri) è la stessa idea in versione
   interattiva, e nel cruscotto attuale esiste già.

2. **Una pagina condivisa porta le spec, non i dati.** Chi la apre la esegue con il
   proprio perimetro e vede i propri numeri — già deciso nella 104, e vale identico
   per le pagine.

**Il legame con l'analista, che è il punto:** l'AI non risponde con un testo, ma
con *un'analisi* — una `SpecQuery` più il grafico giusto. Sotto la risposta compare
"aggiungi alla dashboard", e il riquadro finisce in una pagina. Da lì l'utente lo
modifica a mano nell'editor, perché è lo stesso oggetto.

> [!info] Metà strada è fatta (13/09/2026)
> `proponi_analisi` produce già l'oggetto giusto, e `/api/prototipo-bi/analisi` lo
> salva. Alla dashboard mancano il livello `pagina` e l'editor manuale: il pulsante
> "Salva" c'è, "aggiungi alla pagina" arriverà con la tabella `dashboard_pagine`.

Questo chiude il cerchio delle tre richieste: **manuale e AI producono la stessa
cosa**, e quella cosa è verificabile, salvabile, condivisibile e stampabile in un
report.

---

## D. Ordine di lavoro proposto

| # | Cosa | Perché in questa posizione |
|---|---|---|
| 1 | ✅ Troncamento dichiarato | Fatto: era la causa degli errori veri |
| 2 | Interpretazione in chiaro + verifica numerica | Rende gli altri errori **visibili**. Senza, ogni miglioria è a occhio |
| 3 | ✅ **Fatto il 13/09** — `scegliGrafico` + `<GraficoDaRisultato>` + strumento `proponi_analisi` + API `/analisi` | È il pezzo che abilita sia la dashboard sia i report |
| 4 | Dashboard a pagine + editor manuale | Il grosso del valore per l'utente |
| 5 | Report Word/Excel con grafici e sintesi | Poggia sul 3: senza analisi strutturate resterebbe un dump più bello |
| 6 | Strumenti nuovi per l'analista (confronti, scomposizioni, coorti) | Ha senso quando le risposte sono già verificabili |

Il 2 prima del resto non è ovvio ma è la scelta che conta: finché un errore non si
vede, ogni intervento sull'analista è basato su impressioni, e la fiducia — che è
il vero motivo per cui uno strumento del genere viene usato o abbandonato — non si
costruisce.
