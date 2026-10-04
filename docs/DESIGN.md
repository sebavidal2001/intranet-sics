# Design del prototipo BI

## Direzione

Il prototipo BI è un tavolo operativo direzionale: poche superfici, gerarchia netta, numeri leggibili e decisioni prima dei dettagli. Mantiene il linguaggio visivo SICS già presente — azzurro primario, fondi chiari, `font-tenorite` per titoli e KPI — con rosso e ambra riservati a criticità reali.

## Principi

- Le KPI mostrano il dato reale appena disponibile; durante il caricamento usano un trattino, mai uno zero fittizio.
- Il portafoglio è una fotografia degli ordini acquisiti ancora da evadere e non si somma alle consegne future.
- Nella pagina Acquisti vengono prima fabbisogno scoperto e coda di presidio, poi qualità, magazzini, fornitori e categorie.
- Le tabelle operative mostrano un primo insieme prioritario e rendono esplicita l'espansione completa.
- Metriche certificate e SQL esplorativo restano visivamente e semanticamente distinti.
- Il layout deve restare utilizzabile a 390 px senza overflow della pagina; navigazioni e tabelle possono avere scorrimento orizzontale locale.

## Componenti distintivi

- Fascia KPI scura del cruscotto: sei indicatori, incluso il portafoglio.
- Superficie decisionale Acquisti: fabbisogno scoperto in evidenza, quattro misure di contesto e coda espandibile.
- Analista: esempi categorizzati, controllo della profondità, risultati SQL etichettati come non certificati, download Word/Excel.

## Vincoli

- Il modulo resta esclusivamente sotto `/prototipo-bi` e non è disponibile in produzione.
- Nessuna azione di scrittura sui dati aziendali.
- L'SQL accetta una sola `SELECT`/`WITH`, solo viste e funzioni autorizzate, massimo 500 righe e timeout database di 8 secondi.
- La barra rossa “PROTOTIPO — NON IN PRODUZIONE” resta presente in ogni schermata.

## Verifica visuale

Screenshot di riferimento:

- `docs/screenshots/prototipo-bi-articoli-desktop.png`
- `docs/screenshots/prototipo-bi-articoli-mobile.png`
- `docs/screenshots/prototipo-bi-analista-desktop.png`
- `docs/screenshots/prototipo-bi-analista-mobile.png`
