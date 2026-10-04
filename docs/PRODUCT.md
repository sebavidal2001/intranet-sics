# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Il prototipo BI è destinato alla direzione e ai responsabili SICS che devono leggere ogni giorno andamento commerciale, portafoglio, preventivi, articoli, scorte e fabbisogni di acquisto. Gli utenti lavorano nell'intranet aziendale e devono poter passare rapidamente dal dato aggregato al documento o articolo che lo compone.

## Product Purpose

Trasformare le viste BI e il Cruscotto articoli già alimentati dal gestionale in uno strumento direzionale interrogabile, verificabile ed esportabile. Il risultato atteso è ridurre il tempo necessario per capire scostamenti, rischi di portafoglio, criticità di disponibilità e priorità di acquisto.

## Positioning

Ogni numero operativo passa da metriche certificate o da query SQL di sola lettura limitate alle sorgenti BI autorizzate; l'Analista mostra il percorso seguito e può trasformare l'analisi in un report scaricabile.

## Operating Context

- Il prototipo vive esclusivamente sotto `/prototipo-bi` ed è esplicitamente non destinato alla produzione finché non viene approvato.
- Le sorgenti commerciali sono le viste `public.bi_*` del run corrente.
- Il mondo articoli e acquisti deriva da `preventivatore.prodotti`, `preventivatore.prodotti_giacenze` e dallo storico BI dei costi e delle giacenze.
- Budget e BEP possono provenire da configurazione o importazione Excel.
- I report vengono prodotti in Excel o Word con dati ricalcolati al momento del download.

## Capabilities and Constraints

- Accesso riservato ai ruoli direzionali già riconosciuti dall'intranet.
- Le letture devono rispettare il perimetro del prototipo e non devono modificare dati aziendali.
- L'Analista può affrontare richieste SQL anche complesse, ma esclusivamente in modalità `SELECT`/`WITH`, con timeout, limite righe e allowlist di viste BI.
- Le interrogazioni certificate restano il percorso preferito per KPI e report ricorrenti.
- Il portafoglio e le consegne future condividono la stessa origine e non devono essere sommati.
- Gli articoli senza ultimo costo devono restare esplicitamente non valorizzati: non si deve inventare o ereditare un costo.

## Brand Commitments

Nome e terminologia SICS in italiano. Il prototipo conserva il sistema visivo dell'intranet e l'etichetta permanente “PROTOTIPO — NON IN PRODUZIONE”. Le interfacce privilegiano chiarezza direzionale, densità controllata e trasparenza sulla qualità del dato.

## Evidence on Hand

- `src/lib/prototipo-bi/semantico.ts`: catalogo delle metriche certificate.
- `src/lib/prototipo-bi/sorgente.ts`: snapshot delle viste commerciali.
- `supabase/migrations/070_cruscotto_colonne_complete.sql`: quantità di magazzino e acquisto disponibili.
- `supabase/migrations/073_bi_cruscotto_articoli.sql`: storico change-only di costi e giacenze.
- `supabase/migrations/074_powerbi_viste_cruscotto.sql`: viste controllate per articoli, costi, disponibilità e marginalità.
- `docs/CRUSCOTTO_ARTICOLI.md`: tracciato e consistenza del Cruscotto articoli.

## Product Principles

- Mostrare sempre dati reali oppure uno stato vuoto esplicito, mai KPI apparentemente compilati con zero di fallback.
- Rendere visibile la provenienza, la copertura e la freschezza di ogni analisi.
- Portare l'utente dall'eccezione aggregata al documento o articolo responsabile.
- Separare nettamente dati certificati, query SQL esplorative e interpretazione dell'AI.
- Proteggere il database: analisi potenti, scritture impossibili.

## Accessibility & Inclusion

L'interfaccia web deve restare navigabile da tastiera, leggibile a contrasto elevato e comprensibile senza affidarsi al solo colore.
