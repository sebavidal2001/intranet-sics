# Prototipo BI Direzionale + Analista AI

> ⛔ **Leggere prima `NON-IN-PRODUZIONE.md`.** Questo modulo non deve andare in
> produzione senza indicazione esplicita di Sebastiano.

Sostituto candidato del PBIX `STATISTICHE SICS.pbix` (13 pagine, 130 visual),
con in più un analista che ogni mattina propone le tre cose che meritano
attenzione.

## Provarlo in locale

```bash
npm run dev
```

Poi `http://localhost:3000/prototipo-bi` (serve un utente con ruolo
`superadmin`, `amministratore`, `responsabile` o `responsabile_intermedio`).

Le quattro schermate:

| Percorso | Cosa fa |
|---|---|
| `/prototipo-bi` | **Briefing** — le tre voci del giorno, con le prove e il riscontro utile/non utile |
| `/prototipo-bi/cruscotto` | **Cruscotto** — Sintesi, Scostamenti, Clienti, Preventivi, Conversione, Back office (filtro incrociato ovunque) |
| `/prototipo-bi/analista` | **Analista** — domande libere sui dati, con le interrogazioni in chiaro |
| `/prototipo-bi/configurazione` | **Budget & BEP** — import degli Excel aziendali, oppure generazione da due numeri |

## Budget: import dei file aziendali

Il prototipo legge i tre Excel realmente in uso e ne riconosce il formato da
solo (si possono trascinare tutti insieme):

| File | Contenuto | Totali letti |
|---|---|---|
| `BUDGET-BEP.xlsx` | area × settimana | 2024–2026 |
| `BUDGET-BEP_GIORNALIERO.xlsx` | area × giorno, 5.844 righe | 2024: 4,0 M / 3,8 M · 2025: 5,0 / 4,6 · 2026: 5,2 / 4,8 |
| `BUDGET-BEP_GIORNALIERO_COMMERCIALI.xlsx` | agente × area × giorno | Valeria 3,0 M · Daniele 1,2 M · Airfluid 1,0 M |

Due trappole gestite esplicitamente:

- **Il foglio GENERALE è già l'unione** degli altri tre. Sommarli
  raddoppierebbe il budget: si legge solo GENERALE quando c'è.
- **Le date sono gg/mm/aaaa.** `07/01/2026` è il 7 gennaio; letto
  all'americana diventerebbe il 1° luglio, spostando il budget di sei mesi.

Il budget importato ha la precedenza su quello generato, ed è interrogabile
**con le stesse dimensioni dei consuntivi** — per business unit, per agente,
per settimana. È ciò che rende possibili i bullet, il waterfall e le colonne
di scostamento.

### Budget a pari periodo

Il cruscotto confronta sempre il consuntivo con il budget **allo stesso giorno
dell'anno**, mai con quello annuo. Sui dati reali la differenza è questa:

```
Ordinato al 2026-08-27      2.823.462 €
Budget anno intero          5.200.000 €  →  54%   ← fuorviante
Budget a pari periodo       3.387.746 €  →  83%   ← il numero giusto
```

## Verifica del motore

```bash
npx vitest run prototipo-bi/
```

77 test sul prototipo, di cui una parte sui **dati reali**. Verificano fra l'altro che il fatturato certificato
sia 6.288.549 € e non i 174.346.834 € che restituirebbe una query ingenua su
`bi_documenti_raw` (28 run sommati), che agosto riceva meno budget perché è
chiuso, che la settimana 3–9 agosto risulti concentrata al 48% su un cliente,
e che i contributi del waterfall ricostruiscano esattamente la variazione
totale.

`integrazione.test.ts` popola anche `prototipo-bi/dati/` con i budget 2024–2026
importati dai file veri: eseguirlo una volta basta perché l'app parta con il
budget già caricato.

## Esito preventivi e carico back office

Dati arrivati per ultimi, e sono quelli che aprono le domande nuove.

**Attenzione alla semantica**: nel gestionale la colonna `importo_evaso` **non
è l'evaso**, è il valore totale della riga — verificato: vale il totale anche
con `riga_evasa='N'` e quantità evasa 0. Il convertito in ordine è quindi
`valore totale − inevaso`. Prenderla per buona come "evaso" raddoppierebbe il
risultato.

Sui dati reali:

```
Valore preventivato   6.454.654 €
Convertito in ordine  2.284.088 €   →  tasso di conversione 35,4%
Ancora aperto         4.180.296 €
```

### Business unit riconciliate

Il gestionale conosce solo tre gruppi: `01CO` COMPONENTI, `05IM` IMPIANTI,
`06SI` SISTEMI. L'azienda però ragiona per quattro business unit, perché
SISTEMI si spezza in **COSTRUITO** e **STRUTTURE** in base alla *categoria*
della riga. La regola esiste già in produzione dentro le viste `public.bi_*`:

```sql
CASE WHEN upper(trim(categoria_descrizione)) IN ('COSTRUITO','STRUTTURE')
     THEN upper(trim(categoria_descrizione))
     ELSE gruppo_descrizione END
```

Il prototipo leggeva i preventivi dalla tabella grezza (per avere i campi back
office) e quindi la saltava: mostravano "SISTEMI" mentre ordinato e budget
mostravano "COSTRUITO" e "STRUTTURE".

Per un periodo la regola è stata riscritta in TypeScript. Era un doppione. Ora
esiste **`public.bi_preventivi_backoffice`** (SQL in
`sql/002_vista_preventivi_backoffice.sql`, **applicata in produzione il
29/08/2026 su autorizzazione esplicita**): espone i campi back office E applica
la stessa espressione delle altre viste. Il TypeScript non conosce più né la
partizione delle business unit, né il calcolo dei giorni di risposta, né la
formula del convertito — stanno tutti nel database, scritti una volta sola.

`business-unit.ts` conserva solo ciò che non è regola di business:
l'etichetta per il gruppo `-` e la sentinella `controllaTassonomia`. Un test
verifica che la regola non venga reintrodotta lì per sbaglio.

Cosa emerge dalla riconciliazione, sui preventivi reali:

| Business unit | Righe | Preventivato | Conversione |
|---|---:|---:|---:|
| COSTRUITO | 737 | 3.672.345 € | 29,1% |
| COMPONENTI | 3.627 | 1.320.383 € | 47,8% |
| IMPIANTI | 1.078 | 973.556 € | 48,6% |
| STRUTTURE | 728 | 486.897 € | 22,8% |

**COSTRUITO è la business unit più grande per valore preventivato e ha la
seconda conversione peggiore**: prima della riconciliazione non compariva in
nessun grafico, perché era nascosta dentro "SISTEMI".

La regola sposta anche 6 righe (4.775 €) da COMPONENTI a STRUTTURE su
ordinato, fatturato e consegnato: è il comportamento della produzione e viene
replicato, non corretto.

Una **sentinella** (`controllaTassonomia`) verifica a ogni snapshot che le
business unit prodotte siano quelle attese: se il gestionale introduce un
gruppo o una categoria nuova, il cruscotto lo dice con un avviso invece di
disegnare in silenzio una fetta in più.

Metriche aggiunte: `preventivi_valore`, `preventivi_convertito`,
`tasso_conversione`, `valore_medio_preventivo`, `preventivi_creati`,
`righe_preventivo`, `giorni_risposta`, `quota_stesso_giorno`.
Dimensioni aggiunte: `creatore` (addetto back office) ed `esito`
(convertito / parziale / aperto).

Il tasso di conversione è un **rapporto**, non una media di medie: il totale
si calcola su numeratore e denominatore complessivi. Sui dati veri la
differenza è visibile (35,4% contro il 33,4% della media dei tassi per BU).
Progressivo e cumulate non si applicano a medie e percentuali: il motore lo
segnala invece di produrre numeri crescenti privi di senso.

### Due trappole trovate e chiuse

- **Fuso orario.** Le date arrivano come `timestamp without time zone`
  (`2025-01-08T00:00:00`). Passandole a `new Date()` la mezzanotte italiana
  diventa le 23:00 UTC del giorno prima: la quota di risposte in giornata
  crollava dal **92,3% reale allo 0,9%**. Ora si confrontano le date di
  calendario prese dalla stringa.
- **Date incoerenti.** ~50 documenti su 2.089 hanno la richiesta cliente
  successiva alla registrazione. Vengono esclusi dal calcolo dei tempi invece
  di essere contati: senza la pulizia un'addetta risultava a −496 giorni di
  media.

## Impostazioni dei grafici

Pannello laterale sul cruscotto (icona ingranaggio), con quanto scelto
conservato nel browser:

| Impostazione | Effetto |
|---|---|
| **Palette** | SICS, Direzione, Oceano, Tramonto, Alto contrasto (Okabe-Ito, leggibile con daltonismo) |
| **Tema** | chiaro o scuro — il tema scuro ridefinisce i token solo dentro il cruscotto |
| **Densità** | comoda o compatta |
| **Elementi** | griglia, etichette dei valori, legenda |
| **Numeri** | compatti (1,3 M€) o estesi (1.267.923 €) |
| **Voci mostrate** | da 5 a 30 per grafico |
| **Aspetto** | sfumature, bagliore, arrotondamento angoli |
| **Animazioni** | attivabili o disattivabili |

**Modalità presentazione**: schermo intero con rotazione automatica delle sei
schermate ogni 20 secondi, per il monitor in sala riunioni. Esc per uscire.

## Confronto periodo su periodo (YTD)

Interruttore in barra comandi, **acceso di default**. Confrontare un anno in
corso con l'anno precedente intero è falso per costruzione: mostra un calo che
è solo il tempo che manca. Sui dati reali la differenza ribalta la lettura:

```
Ordinato 2026 al 28/08        2.830.358 €
  contro 2025 intero          3.709.226 €  →  -23,7%   ← fuorviante
  contro 2025 al 28/08        2.610.886 €  →   +8,4%   ← il numero vero
```

Con l'interruttore spento compare un avviso in chiaro che il delta è falsato.

## Dettaglio dei documenti

Da qualsiasi tabella o grafico si scende all'elenco dei documenti e da lì alle
singole righe: articolo, descrizione, quantità, valore, inevaso. È la risposta
a «cosa ha chiesto quel cliente» senza riaprire il gestionale.

Nessuna query nuova: si legge lo stesso snapshot dei grafici, e i filtri attivi
si propagano al pannello. Rotta `POST /api/prototipo-bi/dettaglio`, con lo
stesso perimetro chiuso delle metriche.

## Anzianità dei preventivi

Quanto restano aperti, in media e nel dettaglio. Si contano i giorni dalla data
del documento all'ultimo giorno di dati, **solo sulle righe che hanno ancora
inevaso**: una riga già convertita non è "aperta da" nessun tempo. Non risente
del filtro anno, perché riguarda ciò che è fermo adesso.

| Fascia | Righe | Inevaso |
|---|---:|---:|
| 0-30 giorni | 78 | 146.846 € |
| 31-60 giorni | 117 | 261.307 € |
| 61-90 giorni | 96 | 153.976 € |
| 91-180 giorni | 356 | 623.933 € |
| 6-12 mesi | 757 | 1.644.252 € |
| **oltre 1 anno** | **1.339** | **1.351.323 €** |

Età media **338 giorni**, il più vecchio **598**. L'**87% dell'inevaso ha più
di 90 giorni**: è pipeline che difficilmente si chiude da sola.

## Prestazioni

Misurato prima di intervenire, non a intuito:

| | Prima | Dopo |
|---|---:|---:|
| Costruzione snapshot (66.068 righe) | 4.358 ms | ~3.100 ms |
| Spec ripetuta (cambio filtro e ritorno) | ~14 ms | 0 ms (cache) |
| Ritorno su una vista già aperta | rifetch completo | istantaneo |

Tre interventi:

1. **Paginazione parallela.** PostgREST tappa a 1.000 righe per risposta
   (verificato chiedendone 5.000 e 20.000: torna sempre 1.000), quindi
   servono 66 richieste. Un primo tentativo con 8 pagine parallele *per
   dataset* peggiorò le cose (5,4 s): i 7 dataset partono insieme, quindi si
   arrivava a 56 richieste contemporanee che si facevano concorrenza. Con un
   semaforo **globale** a 10 si scende a ~3,1 s.
2. **Cache dei risultati lato server**, con chiave che comprende il run
   pubblicato: un caricamento nuovo rende irraggiungibili le voci precedenti,
   quindi non si servono mai numeri vecchi.
3. **Cache lato browser**: tornare su una vista già aperta ridisegna subito,
   senza scheletri di caricamento.

## Grafici

Oltre a barre, linee, torte e combo:

| Grafico | Domanda a cui risponde |
|---|---|
| **Waterfall** | da dove viene la differenza fra due anni |
| **Pareto** | quante voci fanno l'80% (sui dati reali: 73 clienti su 499) |
| **Bullet** | consuntivo contro budget e BEP, otto BU nello spazio di un gauge |
| **Heatmap** | scostamento % dal budget, business unit per mese |
| **Quadranti** | clienti grandi in calo contro piccoli in crescita |
| **Multipli** | tutte le BU a scala comune, in un colpo d'occhio |
| **Barre di scostamento** | positivo/negativo attorno allo zero |
| **Sparkline** | l'andamento dentro la cella di una tabella |
| **Imbuto** | quanto si perde fra preventivo e ordine (larghezza proporzionale) |
| **Radiale** | un numero contro il suo obiettivo, in grande |
| **Treemap** | composizione in un colpo d'occhio |
| **Calendario** | il ritmo di lavoro giorno per giorno, stile griglia contributi |
| **Aree impilate** | distribuzione del carico fra le persone, in volumi o in quote % |
| **Anelli** | confronto compatto di più percentuali |

**Filtro incrociato**: un click su qualsiasi barra, fetta, cella, riga di
tabella o punto dello scatter aggiunge un filtro che si propaga a tutta la
pagina. I filtri attivi restano visibili come etichette rimovibili.

**Tabelle analitiche**: ogni riga porta valore, anno precedente, Δ €, Δ %,
quota sul totale, budget, scostamento, raggiungimento e sparkline. Ordinabili
per qualsiasi colonna, con riga dei totali e ricerca.

Ogni colonna dichiara **la propria unità** e **come si calcola il totale**.
Prima era tutto euro e tutto somma, con due errori visibili: il conteggio dei
preventivi stampato come «418 €», e le righe medie per preventivo che nel
totale diventavano 23 invece di 3. Ora il totale può essere una somma, un
rapporto fra due colonne o una media pesata.

**Spiegazione dei grafici**: ogni riquadro ha una «i» accanto al titolo che, al
passaggio del mouse o al tocco, spiega cosa mostra il grafico, come è
calcolato e quali trappole di lettura evitare.

## Architettura

```
src/lib/prototipo-bi/
├── guardia.ts        blocco in produzione
├── accesso.ts        chi può entrare e con che perimetro
├── sorgente.ts       snapshot in sola lettura dalle viste public.bi_*
├── calendario.ts     giorni lavorativi, festività, chiusure
├── budget.ts         distribuzione Budget/BEP → giorni, BU, commerciali
├── semantico.ts      ⭐ vocabolario di metriche + compilatore di query
├── rilevatori.ts     stadio 1 e 2 dell'analista (deterministici)
├── analista.ts       stadio 3 e 4 + loop conversazionale con strumenti
├── archivio.ts       persistenza su FILE (in produzione → Postgres)
└── documenti/        generazione Excel e Word
```

Il pezzo che regge tutto è `semantico.ts`. Ogni grafico, ogni rilevatore, ogni
risposta dell'AI e ogni export descrivono cosa vogliono con una `SpecQuery` e
non scrivono mai SQL. Due conseguenze:

- **niente anni cablati** — il PBIX ha `Ordinato 2026`, `Fatturato 2025`,
  `BUDGET Progressivo 2026`: ogni gennaio si riscrivono ~30 misure DAX e si
  ricontrollano 130 visual. Qui c'è una metrica e un modificatore;
- **perimetro chiuso** — una spec che nomina una metrica inesistente viene
  rifiutata, non interpretata. È ciò che rende sicuro farle comporre all'AI.

## Dati

**Lettura**: viste `public.bi_*` già esistenti, le stesse che legge Power BI.
Solo il run corrente, ~66.000 righe in tutto (non 1,8 milioni), scaricate una
volta e tenute in `prototipo-bi/dati/cache/snapshot.json`.

**Scrittura**: nessuna sul database. Configurazione, briefing e riscontri
stanno in `prototipo-bi/dati/*.json`.

Lo schema Postgres per la futura produzione è in `sql/001_schema.sql`, **non
applicato**.

## L'analista conversazionale

### Modello e costi

Prezzi dal listino OpenRouter (dollari per milione di token, ingresso/uscita),
riletti da `aggiornaPrezzi()`:

| Modello | Ingresso | Uscita | Quando |
|---|---:|---:|---|
| Haiku 4.5 | 1,00 | 5,00 | letture dirette, briefing |
| Sonnet 4.5 | 3,00 | 15,00 | confronti, previsioni, documenti |
| Gemini 2.5 Flash | 0,30 | 2,50 | alternativa economica |

**L'instradamento è automatico**, per parole chiave e non affidato a un
modello: farlo decidere a un LLM significherebbe pagare una chiamata per
decidere quanto spendere in quella dopo. Nel dubbio sale di livello — sbagliare
verso il modello piccolo produce un'analisi debole, sbagliare verso quello
grande costa qualche centesimo. L'utente può forzare il livello.

Costi misurati dal vivo (04/09/2026):

```
domanda semplice   Haiku 4.5    1 interrogazione   0,91 ¢
previsione         Sonnet 4.5   strumento + tabella 3,25 ¢
report Excel       Sonnet 4.5   2 tabelle           3,16 ¢
```

A 50 domande al giorno siamo sotto i 2 $ giornalieri. Il costo compare sotto
ogni risposta: senza, non si può decidere se l'analista conviene.

### Previsione

Non la fa il modello. `previsione.ts` calcola tre stime deterministiche e ne
restituisce l'intervallo; l'AI sceglie il metodo, legge il risultato e lo
spiega. Sui dati reali:

```
Ordinato 2026 al 28/08          2.830.358 €
  Ritmo sui giorni lavorativi   4.304.855 €
  Stagionalità anno precedente  4.021.024 €
  Tendenza dei mesi chiusi      4.415.293 €
  → stima 4.247.057 €, intervallo 4.021.024 – 4.415.293 (±9,3%)
```

Se i metodi divergono oltre il 15% l'analista lo dice: lo scarto è esso stesso
l'informazione. I metodi non applicabili vengono dichiarati, non sostituiti da
un numero inventato.

### Documenti

Lo strumento `prepara_documento` fa comparire un pulsante di download sotto la
risposta. I dati vengono **ricalcolati al momento del download** dalle stesse
spec certificate, quindi il file non può divergere da ciò che è a schermo.
Excel e Word funzionano; il PDF passa oggi dal Word.

### Formattazione della chat

Renderer Markdown scritto a mano (`markdown.tsx`): titoli, grassetto, elenchi,
tabelle, citazioni, codice. Non si è installato `react-markdown` perché
aggiungere una dipendenza modificherebbe `package.json`, che è tracciato da
git, e il prototipo deve restare invisibile al repository. Nessun HTML grezzo
viene interpretato.

### Verifica dal vivo

`manuale-analista-dal-vivo.ts` chiama davvero OpenRouter. Non è nella suite
automatica (costa ~7 centesimi a esecuzione):

```bash
npx vitest run prototipo-bi/manuale-analista-dal-vivo.ts
```

### I quattro stadi del briefing

Il briefing mattutino resta separato, e l'AI entra solo al terzo stadio:

1. **Rilevamento** — sette famiglie di rilevatori in TypeScript puro. L'AI non
   cerca le anomalie: se le cercasse ne troverebbe sempre.
2. **Rilevanza** — punteggio = magnitudine in euro (log) × persistenza ×
   azionabilità × novità × peso appreso dai riscontri. Taglio a tre.
3. **Spiegazione** — l'AI *scompone*: chi genera lo scostamento, da quando,
   concentrato o diffuso. **Non ipotizza le cause**: se le chiedi "perché è
   sceso" produce sempre una spiegazione plausibile e non verificabile.
4. **Redazione** — tre frasi in italiano. Senza chiave OpenRouter il briefing
   esce comunque, in prosa più secca: il valore sta nei rilevatori.

Regole anti-rumore attive: massimo 3 voci, soglia minima di 15.000 €, cooldown
sui segnali già usciti, il silenzio come risultato valido, e la lista dei
segnali scartati visibile in fondo alla pagina per tarare le soglie.

## Cosa manca per essere completo

- **Visite e obiettivi** — restano fuori: `Cruscotto Dinamico.xlsx` non ha una
  dimensione tempo (`Visite n` è una colonna di snapshot, non un fatto datato),
  quindi il rilevatore "agente sotto ritmo visite" non è implementabile senza
  prima rimodellare quel dato.
- **BEP per commerciale** — il file dei commerciali non ha la colonna BEP:
  per agente esiste solo il budget. Il prototipo lo dichiara invece di
  mostrare zero.
- ~~La riconciliazione delle BU è replicata~~ — **risolto** con la vista
  `bi_preventivi_backoffice`: la regola vive solo in SQL.
- **Drill-down gerarchico** (BU → agente → cliente in un solo grafico) — al
  momento si ottiene combinando i filtri incrociati.
- **Anagrafica clienti-agenti completa** — il prototipo usa gli agenti presenti
  nei movimenti (9); `clienti_agenti.xlsx` ne mappa 4.163 di clienti.
- **Perimetro per singolo agente** — l'infrastruttura c'è (`agenteScope`), manca
  la mappatura utente intranet → codice agente.
- **Schedulazione** — voluta: il briefing si genera a richiesta.
- **Mappa visite, gauge, treemap** — non ancora portati dal PBIX.
