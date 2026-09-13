# Dashboard unica, builder per tipologia, analista che analizza

> Redatto il **13/09/2026** dopo la prova sul campo. Seguito di
> [`PIANO-ANALISTA-E-DASHBOARD.md`](PIANO-ANALISTA-E-DASHBOARD.md).

---

## A. Il fallimento nello screenshot, spiegato

Domanda: *«quali sono degli andamenti anomali, ed in quale periodo, che trovi per
l'ordinato per vari clienti?»*
Risposta: *«Ho raggiunto il numero massimo di interrogazioni»*. Haiku, livello
semplice, 1 interrogazione, 3,6 centesimi buttati.

Tre cause in fila, e la terza è quella che fa più rabbia.

### A1. L'instradamento ha perso per una desinenza

`SEGNALI_ANALITICI` contiene `"andamento"` e `"anomalia"`. La domanda dice
**«andamenti»** e **«anomali»**. Il confronto è su sottostringa esatta, quindi
nessuno dei due scatta: domanda classificata *semplice* → Haiku, 4 passi.

Una domanda che chiede anomalie su più clienti **è** il caso analitico per
eccellenza, e ci è passata accanto per due lettere.

### A2. Finiti i passi, l'utente riceve un muro

Esauriti i `massimoPassi`, l'analista risponde che ha esaurito i passi. Per chi
legge è un fallimento secco: ha pagato, aspettato, e non ha niente — nemmeno i
risultati parziali che intanto aveva raccolto.

### A3. Gli strumenti per rispondere **esistono già e nessuno glieli ha dati**

`rilevatori.ts`, 714 righe, contiene:

| Funzione | Cosa trova |
|---|---|
| `rilevaRotturaSerie` | cambi di ritmo in una serie temporale |
| `rilevaConcentrazione` | quando pochi soggetti pesano troppo |
| `rilevaClientiDormienti` | chi comprava e ha smesso |
| `rilevaScostamentoBudget` | dove il budget non tiene |
| `rilevaPipeline`, `rilevaPortafoglio`, `rilevaQualitaDato` | il resto |

Sono esattamente la domanda dello screenshot. Ma sono cablati nel **briefing
mattutino** e l'analista non li ha fra gli strumenti: può solo sommare metriche e
guardarle. Gli si chiede di trovare anomalie avendogli tolto il rilevatore di
anomalie.

### Cosa si fa

1. **Instradamento per radice, non per parola**: `andament`, `anomal`, `confront`,
   `scostament`, `variazion`, `concentr`, `client`… più segnali strutturali (due
   periodi citati, una negazione, un superlativo) che nessun elenco di parole
   coglie.
2. **All'ultimo passo si conclude**: il modello riceve l'istruzione di rispondere
   con quello che ha, dichiarando cosa non ha potuto verificare. Mai un muro.
3. **Quattro strumenti nuovi**, che sono il grosso del valore:
   - `rileva_anomalie(metrica, dimensione?, periodo?)` → espone i rilevatori
     esistenti su richiesta, non solo all'alba
   - `confronta_periodi(metrica, a, b, raggruppa?)` → due periodi affiancati con
     delta assoluto e percentuale, già ordinati per impatto
   - `scomponi_variazione(metrica, da, a, dimensione)` → chi ha causato la
     differenza, in euro: è il waterfall, ed è la risposta a «perché è sceso»
     che si può dare senza inventare cause
   - `classifica(metrica, dimensione, verso, quanti)` → top/bottom con la quota
     cumulata, che è il Pareto

---

## B. Dashboard e Cruscotto sono la stessa cosa

Oggi il Cruscotto è un insieme di schede scritte nel codice, e la Dashboard è un
contenitore vuoto che l'utente riempie. Sono lo stesso oggetto visto da due parti,
e vanno unificati: **il Cruscotto diventa una dashboard predefinita**, fatta delle
stesse analisi che l'utente può creare, spostare e copiare.

Conseguenze concrete:

- le sei schede attuali (Sintesi, Scostamenti, Clienti, Preventivi, Conversione,
  Back office) diventano **pagine** di una dashboard di sistema
- quella dashboard è **duplicabile**: chi vuole la sua versione la copia e la
  modifica, senza toccare l'originale
- ogni riquadro che oggi è cablato diventa un'`analisi` con la sua spec, quindi
  apribile nell'editor

### Esplora sparisce come voce di menu

Non è una destinazione: è **come si aggiunge un riquadro**. Dentro una pagina,
"Aggiungi" offre tre strade per la stessa cosa:

| Strada | Quando serve |
|---|---|
| **Dalla libreria** | l'analisi esiste già, propria o condivisa |
| **Costruiscila** | il builder (sezione C) |
| **Chiedila all'AI** | chatbox: si descrive a parole, l'AI propone il riquadro |

Le tre producono lo stesso oggetto — una `SpecQuery` più un grafico — e portano
allo stesso riquadro. È la ragione per cui possono convivere senza confondere.

---

## C. Il builder a due livelli

La tendina unica con ventidue metriche è dispersiva: mette sullo stesso piano
«Ordinato» e «Quota stesso giorno», che non sono la stessa specie di cosa.

**Primo livello: la tipologia.** Sei schede, che è il modo in cui in azienda si
parla dei dati:

| Tipologia | Metriche |
|---|---|
| **Ordinato** | ordinato, n_ordini, ordine_medio |
| **Fatturato** | fatturato |
| **Consegnato** | consegnato, portafoglio, consegnato_futuro |
| **Preventivi** | preventivi_valore, preventivi_convertito, tasso_conversione, valore_medio_preventivo, n_preventivi, preventivi_aperti |
| **Back office** | preventivi_creati, righe_preventivo, giorni_risposta, quota_stesso_giorno, giorni_apertura, preventivi_aperti_oltre_90, eta_massima_apertura |
| **Banco** | banco |
| **Budget** | budget, bep |

**Secondo livello: i parametri di quella tipologia.** Scelta la tipologia,
compaiono solo le metriche e le dimensioni che hanno senso lì.

### «Come lo spezzo» deve essere dinamico, e oggi non lo è

`DIMENSIONI` è un elenco globale: l'editor le offre tutte per qualunque metrica.
Ma `creatore`, `esito` e `fascia_eta` esistono **solo sui preventivi**, e
`causale` solo sui movimenti di magazzino. Sceglierle altrove produce un
raggruppamento con una sola riga vuota — e l'utente non capisce perché.

Serve una mappa dichiarata **metrica → dimensioni ammesse**, esposta dal
vocabolario, e l'editor mostra solo quelle. Con l'etichetta cambiata: non «come
lo spezzo» ma **«Raggruppa per»**, che è come si chiama in ogni strumento che
queste persone hanno già usato.

---

## D. Il periodo appartiene alla dashboard

Hai ragione, e il disegno attuale è ambiguo: il builder mostra un selettore di
periodo, ma poi in una pagina vince il filtro della pagina. L'utente imposta una
cosa che viene ignorata, e non gliene viene detto niente.

**La regola giusta:** il periodo di un riquadro è **ereditato dalla pagina**. Nel
builder il campo non è un selettore di date ma una scelta fra:

- **Eredita dalla dashboard** (default, e nel 95% dei casi giusto)
- **Fissa un periodo**, con una motivazione visibile sul riquadro («sempre 2025»)

La seconda serve davvero in un caso: un riquadro di confronto storico che deve
restare fermo mentre il resto della pagina si muove. Ma dev'essere una scelta
deliberata e **dichiarata sul riquadro**, non il default silenzioso.

Nell'anteprima del builder il periodo ereditato si simula con quello della pagina
corrente, così si vede subito cosa si otterrà.

---

## E. Ordine di lavoro

| # | Cosa | Perché qui |
|---|---|---|
| 1 | Instradamento, ultimo passo, 4 strumenti di analisi | L'analista oggi **fallisce** su una domanda legittima: è l'unica cosa rotta |
| 2 | Builder a due livelli, dimensioni per metrica, periodo ereditato | Il feedback più circostanziato, e non dipende dal resto |
| 3 | Dashboard unica: cruscotto come dashboard di sistema, Esplora come pannello, chatbox | Il più grosso, e poggia sul 2 |
| 4 | Report con grafici e sintesi | Restava già in coda |
