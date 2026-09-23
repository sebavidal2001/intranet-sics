# Mail all'amministrazione — Portale Controllo Vettori

> Bozza pronta da incollare. Destinatarie: Valeria Argentesi, Francesca Odorici.
> Da rileggere e firmare prima dell'invio.

**Oggetto:** Portale Controllo Vettori — come funziona, come calcola, e alcune domande

---

Buongiorno Valeria, buongiorno Francesca,

il portale per il controllo delle fatture dei corrieri è in funzione e ha
elaborato tutto il 2026. Prima di mettervelo in mano vorrei spiegarvi come
lavora — soprattutto **come fa i conti**, perché è lì che dovete potermi
correggere — e chiedervi alcune cose che dai documenti non si capiscono.

Il programma non sostituisce il controllo che fate voi: fa la parte meccanica
(leggere la fattura, ritrovare la bolla, rifare il conto riga per riga) e vi
lascia le decisioni, cioè cosa contestare e cosa no.

---

## 1. Cosa fa, in breve

Sostituisce i tre fogli di calcolo con cui controllate GLS, TNT/FedEx e Trading
Post. Rispetto al foglio cambiano tre cose:

- le **bolle arrivano da sole** dal gestionale, ogni notte, senza ricopiarle;
- la **fattura si carica in PDF** e viene letta riga per riga, senza digitare
  nulla;
- il **confronto è per singola spedizione**, non per totale di fattura: si vede
  subito quale riga scosta e di quanto.

Ad oggi ci sono dentro **tutte le fatture del 2026** che ci avete dato: 28
documenti — 8 GLS, 8 TNT, 8 Trading Post, 4 FedEx — per **866 spedizioni** e
**16.495,38 €**. Ogni corriere è coperto per tutti i mesi in cui ha fatturato,
comprese le tre fatture che arrivano come immagine e che fino a pochi giorni fa
nessun programma riusciva a leggere.

## 2. Come si usa

**Caricare una fattura.** Nella pagina *Fatture* si trascina il PDF. Il
programma riconosce da solo il corriere e legge le righe. Prima di salvare
mostra un'anteprima con quello che ha capito: spedizioni, pesi, importi.

**La quadratura è il semaforo.** Prima di archiviare, il programma somma le
righe che ha letto e le confronta con i totali stampati in fondo alla fattura.
Se i due numeri non coincidono, **la fattura non si salva**: vuol dire che
qualche riga non è stata letta, e archiviare un controllo fatto su metà fattura
sarebbe peggio che non farlo. In quel caso ce lo segnalate e lo sistemiamo.

**Guardare i risultati.** Nella pagina *Spedizioni* c'è l'elenco riga per riga
con fatturato, atteso e differenza. In *Anomalie* solo quelle che scostano,
filtrabili per corriere e per mese, da cui si prepara la bozza di contestazione
da mandare al corriere (la mail si apre in Outlook già scritta: nessuna mail
parte da sola).

**Misurare i colli.** Nella pagina *Bolle* il magazzino può inserire le misure
dei colli (lunghezza, larghezza, altezza). Serve per una cosa sola ma
importante: **verificare il peso volumetrico**. Oggi, quando il corriere fattura
a volume, noi possiamo solo prendere per buono il suo numero — con le misure
diventa un dato nostro. È l'unica parte che richiede lavoro manuale, e si può
fare solo sulle spedizioni che contano.

**Le fatture che sono solo un'immagine.** GLS, TNT e Trading Post arrivano come
documenti, e il programma li legge direttamente. Alcune no: la Trading Post di
gennaio è una scansione storta, le FedEx sono disegni senza una riga di testo
dentro. Quelle vengono lette da un sistema di riconoscimento automatico, e il
risultato passa **per lo stesso identico controllo**: se la somma delle righe
non torna con i totali stampati, la fattura non si archivia. Funziona: la FedEx
di luglio, che prima nessuno riusciva a leggere per intero, ora entra con tutte
e sei le spedizioni al primo tentativo.

> Su questo vi devo un'informazione, non una rassicurazione: per leggerle, le
> pagine di quelle fatture vengono inviate a un fornitore esterno di servizi di
> riconoscimento. Contengono nomi di clienti e fornitori, indirizzi e importi.
> Riguarda solo le fatture-immagine, che nel 2026 sono state tre su ventotto;
> tutte le altre restano sui nostri server. Se preferite che non esca nulla, si
> può spegnere: quelle tre fatture andranno battute a mano.

**Simulare prima di spedire.** Nella pagina *Simulazione* si mette peso, misure
e destinazione e si vede quanto costerebbe con ciascun corriere. Serve per
decidere, non per controllare.

## 3. Come vengono fatti i calcoli

Questa è la parte su cui vi chiedo di essere severe: se un passaggio non
corrisponde a come ragionate voi, è il programma che va corretto.

**Passo 1 — il peso che fa prezzo.** Si calcola il peso volumetrico
(lunghezza × larghezza × altezza × numero di colli ÷ 1.000.000, moltiplicato per
il coefficiente del corriere: **300 kg/m³ per GLS e Trading Post, 250 kg/m³ per
TNT e FedEx**) e si confronta con il peso reale. **Vince il maggiore.** Per
Trading Post si applicano anche il minimo di 3 kg e l'arrotondamento al quintale
sopra i 100 kg.

**Passo 2 — la tariffa.** Con il peso che fa prezzo si cerca la fascia nel
listino del corriere, **valido alla data della spedizione** e per la zona di
destinazione. I listini sono versionati: una tariffa che cambia a metà mese vale
solo dalla sua data in avanti, e i controlli già fatti non si riscrivono.

**Passo 3 — i supplementi.** Si aggiungono quelli previsti dal listino. Per GLS
oggi sono configurati: handling 0,03 €/kg, adeguamento autostrade 0,20 €,
Safety & Energy 0,20 €, assicurazione 0,50 € sopra i 10 kg, inoltro fuori
provincia 0,60 €, oversized 9,00 € a collo, ZTL 1,50 €, triangolazione 7,25 €,
bollettazione manuale 5,00 €, riconsegna da giacenza 3,10 €. Per Trading Post
l'addizionale di gestione dell'11%. Per TNT e FedEx pallet 80×60 e merce non
sovrapponibile.

I supplementi **condizionati** (fuori provincia, oversized, ZTL…) si applicano
solo se sappiamo che quella condizione c'è: se il dato non c'è, il programma
**non li applica** invece di indovinare. È il motivo di una delle domande più
sotto.

**Passo 4 — carburante e adeguamento.** Si applica la percentuale carburante
del mese della spedizione, prendendo l'ultima comunicazione **non successiva**
alla data: quella di luglio vale anche in agosto finché non ne arriva una nuova,
e una comunicazione nuova non si applica mai a una spedizione già partita. Per
GLS si aggiunge l'adeguamento annuale, oggi configurato al 7,21% dal 1° gennaio
2026.

**Passo 5 — il confronto.** Fatturato e atteso si confrontano **su grandezze
omogenee**: dove la fattura espone carburante e adeguamento in fondo al
documento, il programma li ripartisce sulle righe in proporzione al nolo, così
si confrontano due totali completi e non un totale con un pezzo di totale.
L'esito dipende dallo scostamento: **fino al 5% in linea, dal 5 al 10% da
verificare, oltre il 10% anomalia**. Le soglie si possono cambiare.

**Passo 6 — l'aggancio alla bolla.** La riga di fattura si lega al documento di
trasporto tramite il numero di bolla, e qui il programma tiene conto di una cosa
che ci avete insegnato i documenti stessi: **sulle partenze la fattura cita il
nostro numero di bolla, sugli arrivi quello del fornitore**. Cercare dalla parte
sbagliata significherebbe non agganciare mai nulla. Su 866 righe, 844 hanno
trovato la loro bolla.

**Quando un conto non si può fare, il programma lo dice.** Se manca il listino
di quel periodo, o la percentuale carburante di quel mese, la riga risulta *non
valutabile*: non viene confrontata con l'ultima tariffa disponibile, perché
sarebbe un confronto inventato.

## 4. Cosa dicono i numeri del 2026

Sulle 866 righe controllate: **264 in linea, 95 da verificare, 275 anomalie,
232 non valutabili**. La bolla è stata ritrovata su 844 righe su 866.

Le 275 anomalie non sono 275 casi diversi: **247 sono GLS**, e sono lo stesso
fenomeno ripetuto. Sugli altri tre corrieri il conto torna. Su TNT e Trading
Post il costo che calcoliamo coincide **al centesimo** con quello fatturato
nella metà delle righe. Su FedEx c'è il riscontro più netto: sulla fattura di
luglio, l'unica che abbiamo letto per intero con il sistema nuovo, l'importo
calcolato coincide **esattamente su tutte e sei le spedizioni**, perché le
tariffe applicate sono quelle della tabella che abbiamo, fascia per fascia.

Vale la pena dirlo chiaro, perché è la prova che il metodo di calcolo regge: se
sbagliasse in sé, sbaglierebbe anche lì. Le poche differenze che restano sulle
altre FedEx — tre righe in tutto, meno di dieci euro — non sono sovrapprezzi:
sono spedizioni in cui non eravamo riusciti a leggere il **peso fatturato a
volume**, così il conto è partito dal peso della merce e ha pescato la fascia
sbagliata. Le rileggeremo con il sistema nuovo e spariranno.

Su GLS invece, dentro la colonna *Nolo*, troviamo **costantemente 1,15 € o
1,75 € in più** della tariffa di fascia, su tutte le fasce di peso; e circa
**9,00 € in più** sulle righe che portano il codice `TI`. Sono cifre che
somigliano molto a voci che il vostro listino già prevede: la differenza fra
1,15 e 1,75 è esattamente **0,60 €**, come l'inoltro fuori provincia, e i 9,00 €
sono esattamente l'oversized a collo. Tolte le voci che riconosciamo, resta un
residuo di circa **0,75 € a spedizione** che non sappiamo a cosa attribuire.

In totale, sul 2026, la differenza fra fatturato e atteso vale **1.342 € su GLS**
(a fronte di 9.520 € di fatturato confrontabile), 174 € su Trading Post e 109 €
su TNT. Su FedEx, dove la lettura è completa, la differenza è zero.

Vale la pena dire che **questa differenza la vedevate già voi**: nei vostri fogli
degli arrivi GLS il «costo previsto» sta a quello fatturato come 2.791 € a
3.778 €. Il programma trova la stessa cosa, misurata riga per riga.

---

## 5. Le domande

### Sulle tariffe GLS

1. **Su ogni spedizione in arrivo GLS c'è 1,15 € o 1,75 € oltre la tariffa di
   fascia.** Ci confermate che la differenza di 0,60 € è l'inoltro fuori
   provincia? E sapete dirci cos'è il residuo di circa 0,75 € che resta anche
   togliendo autostrade, Safety & Energy e assicurazione?
2. **Il codice `TI` sulle righe GLS porta circa 9 € in più**: è il supplemento
   oversized? Se sì, esiste un modo per sapere in anticipo quali spedizioni sono
   oversized, o lo si scopre solo a fattura arrivata?
3. **Le tariffe GLS che stiamo usando sono quelle della vostra tabella** (8,04 €
   per 0–3 kg, 8,68 € per 3–5, e così via). Sono ancora quelle in vigore nel
   2026, o c'è stato un adeguamento che non abbiamo?

### Sui dati che mancano

4. **Listino Trading Post prima dell'11 maggio 2026**: ci servirebbero le
   tariffe in vigore da gennaio ad aprile. Senza, 83 righe di fattura restano
   senza confronto.
5. **Percentuale carburante TNT di gennaio, febbraio e marzo 2026**: stessa
   cosa, sono 75 righe non confrontate. Da aprile in poi le abbiamo.
6. **Tariffa GLS per i primi 18 giorni di gennaio**: il listino che abbiamo
   parte dal 19 gennaio.

### Su come vengono registrate le spedizioni

7. **Sugli arrivi il vettore non viene indicato nel gestionale.** Lo capiamo —
   la bolla è del fornitore e il trasporto lo organizza lui. Dai vostri fogli ne
   abbiamo recuperati 131, perché i fogli sono divisi per corriere e quindi il
   dato ce l'avete voi; ma restano **326 spedizioni che paghiamo noi senza
   sapere con chi sono viaggiate**. Sarebbe possibile compilare il campo vettore
   anche sui DDT di acquisto? È un campo solo, sul documento che già
   registrate, e chiuderebbe il problema alla radice invece che a valle.
8. **Nel foglio ARRIVI TNT-FEDEX** le due colonne non sono distinte. Ci sono
   davvero spedizioni FedEx là dentro, o di fatto sono tutte TNT? Da questo
   dipendono 83 bolle a cui oggi non sappiamo attribuire il corriere.
9. **I codici vettore del gestionale che descrivono una regola** — per esempio
   «TNT per scatole - GLS per pallet» o «GLS fino a 30 Kg - FEDEX oltre» — non
   possiamo applicarli: il campo pallet non risulta compilato e sugli arrivi
   manca il peso. Come fate voi a sapere, in quei casi, chi ha trasportato?

### Sui documenti

10. **Tre fatture arrivano come immagine** e non come documento: la Trading
    Post di gennaio (una scansione storta) e le FedEx di giugno e luglio. Ora il
    programma le legge lo stesso, e bene — ma resta il modo peggiore di leggere
    una fattura, perché su un'immagine si interpreta, mentre su un documento si
    legge e basta. **Si può chiedere ai corrieri il file originale** invece
    della scansione? FedEx lo mette a disposizione sul suo portale di
    fatturazione; a Trading Post basta probabilmente chiederlo.
11. **Le note di credito** (abbiamo trovato due storni da 9,88 € di Trading
    Post): oggi il portale non le archivia. Come le gestite voi sul foglio —
    le scalate dal mese o le tenete a parte?

---

Se una di queste risposte è «quel dato non ce l'abbiamo», va benissimo saperlo:
serve a decidere cosa il programma può controllare davvero e cosa no. E se
leggendo i criteri di calcolo qualcosa vi sembra diverso da come lo fate voi,
ditemelo: correggere il programma è veloce, correggere un controllo sbagliato
fatto per mesi molto meno.

La cosa più utile, se avete un'ora, è vederlo insieme davanti allo schermo
partendo da una fattura vera: le domande qui sopra vengono molto meglio
guardando le righe.

Un caro saluto,
Sebastiano
