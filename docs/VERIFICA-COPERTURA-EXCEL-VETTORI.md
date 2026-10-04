# Verifica dei tre Excel — 6 settembre 2026

**Esito: copertura dei calcoli principali, non equivalenza completa certificata.** Il superamento dei test del programma non dimostra che tutte le regole dei workbook siano state trasferite. Questa verifica inventaria tutte le celle con formula e confronta le famiglie di operazioni con il codice; non è un ricalcolo automatico di ogni riga storica di Excel.

## Perimetro verificato

Originali in TEST VETTORI.zip: 2026 GLS.xlsx, TNT-FEDEX 2026.xlsx, TRADING POST2026.xls. Ispezionati tutti gli 8 fogli, compresi il GLS superato e il test borderò: **11.806 celle con formula, 167 gruppi normalizzati per riferimenti relativi**. Le somme manuali di numeri sono incluse. Inventario riproducibile con `scripts/vettori/inventario-formule.cjs`, risultato in `docs/vettori-formule-excel.json`. Esaminati anche intestazioni, note e valori delle tabelle di riaddebito. Verificati in sola lettura i supplementi presenti nel DB di sviluppo.

| Operazione / fonte Excel | Programma | Riscontro e limite |
|---|---|---|
| Volumetrico: GLS partenze I16; TNT partenze I18; TP clienti I18 | Presente | L×P×H×quantità/1.000.000×kg/m³, somma dei gruppi di colli. GLS/TP 300, TNT/FedEx 250: differenza dal 300 scritto nel foglio TNT. |
| Somme di pesi e volumi: GLS I18; TP I25, E45, E57, I57 | Presente | Gruppi di colli e bolle aggregate. Le righe di subtotale Excel non vanno importate come spedizioni aggiuntive. |
| Confronto reale/volumetrico: GLS O16, TNT L28/L191, TP L18 | Presente | Il programma seleziona il peso maggiore, applica minimi/arrotondamenti e poi la tariffa. Equivalente al massimo dei prezzi con un listino monotono; non copia riferimenti errati dei fogli. |
| Fasce: GLS J16/H19/L19; TNT J28/K28; TP J18/K18 | Presente | Listini per data e zona. Le soglie TNT/FedEx sono distinte. Importi e copertura geografica devono corrispondere agli accordi. |
| Scatti oltre 100 kg, annotazioni GLS/TNT e somme manuali GLS J26/L24 | Presente | Scatti configurabili; TP tariffazione al quintale. Il limite TNT di 1.000 kg annotato nel workbook non è imposto dal motore: oltre tale limite manca una regola contrattuale verificata. |
| Handling, autostrade, fuori provincia: GLS H3/F2 e tabella iniziale | Presente con differenze | Il programma calcola handling sul peso effettivo tassabile, mentre il foglio usa valori preaggregati per fascia. Fuori provincia è condizionale, nel foglio appare incluso nella tabella. Nessuna equivalenza al centesimo garantita senza confronto contrattuale. |
| Assicurazione GLS K16/I19/M19 | Presente | 0,50 sopra 10 kg, fuori dalla base fuel. Soglia DB 10,001 contro 10,01 del foglio: differenza da verificare per pesi intermedi. |
| Supplementi inseriti a mano GLS L16/J19 | Parziale | Sono gestite le voci configurate; non esiste una maggiorazione arbitraria per riga equivalente alla cella libera Excel. Aggiunta la selezione delle condizioni nel controllo fattura, anche per gli invii. |
| Triangolazione / etichetta manuale, note GLS R2 e seguenti | Presente con differenze | DB: triangolazione 7,25, Excel 8; etichetta 5. Gli importi sono configurabili ma la divergenza non va risolta assumendo che la fattura abbia ragione rispetto all'accordo. |
| Fuel: GLS M/T/V, TNT C3/D3 | Presente | Percentuale valida alla data con mantenimento dell'ultima disponibile. Base nolo + adeguamento; diversi fogli GLS usano basi/percentuali differenti tra righe. |
| ISTAT effettivo GLS R4=Q4/P4, S19 | Parziale | Adeguamento atteso configurabile e ripartizione degli oneri fatturati. Non c'è una funzione dedicata per proporre/salvare automaticamente l'ISTAT mensile ricavato dal rapporto in fattura. Non si deve usare il tasso fatturato come tasso atteso senza controllo. |
| Addizionale TP C3/D3, C11/D11 | Presente con differenze | Configurato 11%; Excel fornitori 6%, clienti 11% fino a 100 kg e 6% oltre. Per lo storico serve il listino valido del periodo: non è dimostrata l'equivalenza di tutti i mesi. |
| TP non sovrapponibile, nota A15 | Presente con limite | Altezza tariffaria minima 180 cm applicata alle dimensioni note. Con il solo volume mancano base e altezza per ricostruirla indipendentemente. |
| Pallet 80×60 +10, non sovrapponibile +30, note TNT | Parziale | Voci configurate e selezionabili. Non viene verificato automaticamente il formato 80×60 o il divieto annotato per 120×80; il flag bancale è generico. |
| Importi fatturati come somme numeriche (es. TNT N19, TP N25/N175) | Acquisizione | Sono registrazioni manuali di importi del documento, non nuove formule tariffarie. Il parser legge i totali e verifica la quadratura; la semantica di ogni extra non si deduce dalla sola somma. |
| Scostamenti GLS X/V, TNT O18, TP O18 | Presente con differenze | Confronto omogeneo fra totali completi. Diversi fogli confrontano nolo con totale o usano solo il prezzo sul peso reale; il programma non riproduce quelle basi incoerenti. |
| Riaddebito al cliente, tabelle dei tre fogli partenze/clienti | Assente | Valori 16,50 / 22,50 / 31 / 49 presenti come costanti. Mancano listino di riaddebito, ricavo atteso e margine della spedizione. La vista Invii riguarda il costo del vettore. |
| Confronto fra tariffe TP clienti O3: (N3-B3)/B3 | Assente come strumento dedicato | Il motore confronta fatturato e atteso per spedizione, non due offerte tariffarie. |
| Simulatore TP clienti L5/L7 | Presente nella simulazione, non identico | Peso volumetrico e costo simulabili. Non viene copiata la formula che restituisce zero da E8 vuota o un valore sentinella moltiplicato per 999999. |

## Difetti dei workbook da non replicare

- GLS partenze N16 legge G3:G9, vuote, invece della colonna totale H: il costo volumetrico può risultare nullo o pari al solo supplemento.
- GLS arrivi F9 somma B9:F9 includendo se stessa; G130 contiene `#REF!`. Diverse celle G rimandano a pesi di altre righe (G39=E83, G59=E104).
- Il foglio GLS superato e il test borderò contengono copie del peso reale nella colonna volumetrico. Una copia non è una misura indipendente.
- Le percentuali fuel e ISTAT e le basi dei confronti cambiano all'interno di alcuni fogli. I valori memorizzati nel file non certificano che le formule siano state ricalcolate correttamente.

## Interfaccia semplificata

La vista fattura ora mostra spedizione, fatturato, atteso e differenza. Esito leggibile accanto alla spedizione. Pesi, formula, scomposizione del costo, condizioni e abbinamento bolla sono nei dettagli della singola riga. La quadratura è chiusa quando torna e aperta quando richiede intervento. Arrivi e invii mantengono viste distinte.

Restano necessari per dichiarare piena copertura: gestione riaddebito clienti; verifica degli accordi sulle divergenze numeriche; regole per formati/limiti e supplementi non codificati; confronto dello storico con i listini effettivi di ciascun periodo. Nessuna modifica automatica ai prezzi è stata effettuata durante questa verifica.

## Collaudo delle modifiche
187 test superati; TypeScript ed ESLint senza errori. Vista desktop e a 390 px verificata nel browser su una fixture dimostrativa che usa il componente reale: righe leggibili senza la tabella larga, dettagli espandibili e direzioni separate. Non è un collaudo autenticato del portale di produzione. Fixture riproducibile con node scripts/vettori/anteprima-ui.mjs (solo localhost, dati inventati).
