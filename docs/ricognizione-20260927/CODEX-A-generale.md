# Ricognizione Portale Preventivatore — 27/09/2026 — Codex A

## Perimetro e metodo

Analisi statica in sola lettura del perimetro richiesto, confrontata con `docs/ANALISI-PREVENTIVATORE-20260917.md` e con i commit `1bcf5b6`, `2ee962d`, `f0fab43`.

Sono stati verificati con `rg`:

- tutti gli export di `src/lib/portali/preventivatore/**`;
- tutti i componenti di `src/components/portali/preventivatore/**`;
- i chiamanti delle 35 route sotto `src/app/api/portali/preventivatore/**`;
- i residui degli stati, ruoli e campi rimossi dal workflow;
- le migration pertinenti, in particolare 110, 111 e 115;
- i percorsi del flusso creazione → salvataggio → archivio → dettaglio → duplicazione → Word/scheda tecnica.

Non è stato interrogato né scritto alcun database. Non è stato modificato alcun file.

Legenda:

- **VERIFICATO**: il comportamento deriva da un percorso di codice letto o da un controllo meccanico dei riferimenti.
- **IPOTESI**: impatto plausibile che richiede browser, carico o database reale per essere misurato.

## 1. Stato dei punti della vecchia analisi

| Punto | Stato | Evidenza attuale |
|---|---|---|
| B1 — KPI dashboard su stati errati | **PARZIALE** | **VERIFICATO.** La migration 110 allinea i conteggi alle due generazioni di stati (`supabase/migrations/110_dashboard_stati_allineati.sql:106-108`), ma continua a contare stati del workflow eliminato. La UI invita ancora a marcare i preventivi come ordinati/rifiutati (`src/components/portali/preventivatore/dashboard-view.tsx:516-526`, `src/components/portali/preventivatore/dashboard-view.tsx:606-627`). |
| B2 — Archivio fermo alla V2 | **PARZIALE** | **VERIFICATO.** Badge e filtro usano ora la fonte comune (`src/components/portali/preventivatore/archivio-view.tsx:87-98`, `src/components/portali/preventivatore/archivio-view.tsx:562`), ma il menu propone ancora “Offerta inviata”, “Ordinato” e “Rifiutato”, stati non più producibili dal flusso (`src/components/portali/preventivatore/archivio-view.tsx:94-96`). |
| B3 — SVG sparkline non valido | **RISOLTO** | **VERIFICATO.** L’attributo `points` non contiene più il comando `Z` (`src/components/portali/preventivatore/dashboard-view.tsx:133-138`). |
| B4 — anno numerico nel select BI | **RISOLTO** | **VERIFICATO.** Il valore passa da `valoreFiltro` e le option sono convertite in stringhe (`src/components/portali/preventivatore/bi-dashboard-view.tsx:306-310`). |
| B5 — “Ore preventivazione” mostrava il numero dei documenti | **RISOLTO** | **VERIFICATO.** Il widget è stato rimosso dai default; la configurazione passa direttamente dal KPI dell’importo medio al grafico mensile (`src/lib/portali/preventivatore/bi/defaults.ts:48-60`). |
| B6 — etichetta ricarico opposta alla formula | **RISOLTO** | **VERIFICATO.** UI e tooltip mostrano entrambi la divisione per il coefficiente (`src/components/portali/preventivatore/nuovo-view.tsx:919-921`, `src/components/portali/preventivatore/nuovo-view.tsx:943-948`). |
| B7 — race autocomplete cliente | **RISOLTO** | **VERIFICATO.** Sono presenti soglia minima a tre caratteri e annullamento delle richieste tramite `AbortController` (`src/components/portali/preventivatore/autocomplete-cliente.tsx:91-128`). |
| B8 — sidebar: contenitore non relativo e divisore errato | **RISOLTO** | **VERIFICATO.** Il link che contiene l’indicatore è ora `relative` (`src/components/portali/preventivatore/sidebar-nav.tsx:100-127`) e la vecchia coda divisoria dopo le voci amministrative non è più presente (`src/components/portali/preventivatore/sidebar-nav.tsx:134-140`). |
| I1 — guard condiviso quasi inutilizzato | **PARZIALE** | **VERIFICATO.** Il guard comprime autenticazione e contesto in una RPC (`src/lib/portali/preventivatore/api-guard.ts:28-52`), ma è importato soltanto da sette file route: `bi/filters-options`, `clienti`, `dashboard`, `documenti`, `listini`, `listini/[id]`, `prodotti`. Le altre route continuano con `getUser` + `getPortaleAccesso` e spesso ulteriori query; esempio: `src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:96-127`. |
| I2 — latenze e vuoto dopo Salva | **PARZIALE** | **VERIFICATO** il miglioramento del feedback: esiste un overlay distinto per “salvataggio” e “apertura” (`src/components/portali/preventivatore/nuovo-view.tsx:653-670`). **IPOTESI** sulle latenze assolute: non rimisurate; POST e navigazione restano seriali (`src/components/portali/preventivatore/nuovo-view.tsx:182-203`). |
| I3 — chat fissa e builder non responsive | **PARZIALE** | **VERIFICATO.** Le griglie principali hanno ora breakpoint responsive (`src/components/portali/preventivatore/nuovo-view.tsx:701`, `src/components/portali/preventivatore/nuovo-view.tsx:730`, `src/components/portali/preventivatore/nuovo-view.tsx:747`), ma placeholder e chat restano larghi 320 px (`src/components/portali/preventivatore/nuovo-view.tsx:42-50`, `src/components/portali/preventivatore/chat-ai.tsx:1255`) e non esiste un vero stato collassato. |
| I4 — `/nuovo` interamente client-side | **ANCORA APERTO** | **VERIFICATO.** La page monta soltanto il client component (`src/app/(intranet)/(portale-preventivatore)/preventivatore/nuovo/page.tsx:1-12`); servizi e template vengono richiesti dopo il mount (`src/components/portali/preventivatore/nuovo-view.tsx:450-466`). |
| I5 — tre select da centinaia di modelli | **PARZIALE** | **VERIFICATO.** È stato aggiunto un filtro testuale (`src/components/portali/preventivatore/impostazioni-view.tsx:530-543`, `src/components/portali/preventivatore/impostazioni-view.tsx:572-596`), ma ogni istanza conserva tutte le option filtrate e il payload modelli viene ancora scaricato separatamente (`src/components/portali/preventivatore/impostazioni-view.tsx:152`, `src/app/api/portali/preventivatore/config/models/route.ts:78`). |
| I6 — dettagli UX/accessibilità | **PARZIALE** | **VERIFICATO.** “Definitivo” è ora reversibile (`src/components/portali/preventivatore/conferma-definitivo.tsx:80`) e varie label hanno `htmlFor` (`src/components/portali/preventivatore/impostazioni-view.tsx:549-580`). Resta il refuso “non e disponibile” (`src/components/portali/preventivatore/impostazioni-view.tsx:556`) e il builder non applica ancora in modo uniforme l’associazione label/input. |
| C1 — fuga anagrafica nei filtri BI | **RISOLTO** | **VERIFICATO.** La route usa guard e scope, restituisce liste vuote con portfolio vuoto e filtra tutte le query per `cliente_master_id` (`src/app/api/portali/preventivatore/bi/filters-options/route.ts:29-63`). |
| C2 — documento inviato riscrivibile | **RISOLTO** | **VERIFICATO.** La PUT legge lo stato e blocca gli stati non modificabili (`src/app/api/portali/preventivatore/documenti/[id]/route.ts:270-296`; elenco in `src/lib/portali/preventivatore/stati.ts:117-119`). |
| C3 — cambio stato non atomico | **ANCORA APERTO** | **VERIFICATO.** Lettura dello stato (`src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:111-122`) e update (`src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:207-212`) sono separati; l’update filtra soltanto per `id`, non per lo stato letto. |
| C4 — salvataggio builder last-write-wins | **ANCORA APERTO** | **VERIFICATO.** La PUT legge il record (`src/app/api/portali/preventivatore/documenti/[id]/route.ts:270-288`) e invoca l’RPC senza `updated_at` o versione attesa (`src/app/api/portali/preventivatore/documenti/[id]/route.ts:312-315`). Due schede possono sovrascriversi. |
| C5 — BI tronca dataset in memoria | **ANCORA APERTO** | **VERIFICATO.** Rimangono i limiti di 5.000 documenti e 12.000 righe (`src/lib/portali/preventivatore/bi/query-engine.ts:62-63`), la selezione dei record più recenti (`src/lib/portali/preventivatore/bi/query-engine.ts:260-288`) e il calcolo locale (`src/lib/portali/preventivatore/bi/query-engine.ts:315-333`). L’avviso non rende corretti KPI e aggregati. |
| C6 — route/export orfani, campi write-only, errori inghiottiti | **PARZIALE** | **VERIFICATO.** La route orfana `genera-descrizione` è stata eliminata nel commit `2ee962d`; non risultano oggi file route totalmente senza chiamante. Restano export pubblici non importati, colonne prive di writer e persistenze best-effort (`src/app/api/portali/preventivatore/chat/route.ts:244-248`). |

## 2. Bug nuovi

### N1 — Un commerciale può riassumere documenti senza cliente master `[grave]`

**VERIFICATO.**

La route `riassumi` usa l’admin client, che bypassa RLS (`src/app/api/portali/preventivatore/[id]/riassumi/route.ts:124-131`), ma applica lo scope commerciale soltanto quando `docRow.cliente_master_id` è valorizzato (`src/app/api/portali/preventivatore/[id]/riassumi/route.ts:135-144`).

Questo comportamento è incoerente con la pagina dettaglio, che per un commerciale ristretto tratta un `cliente_master_id` nullo come documento non visibile (`src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:84-92`).

Scenario concreto di fallimento:

1. Esiste un documento storico senza collegamento a `clienti_master`.
2. Un utente col solo ruolo commerciale conosce o riceve l’UUID.
3. Non può aprire normalmente la scheda.
4. Invoca direttamente `POST /api/portali/preventivatore/<id>/riassumi`.
5. L’AI riceve chunk Word, note e nome cliente (`src/app/api/portali/preventivatore/[id]/riassumi/route.ts:146-181`) e restituisce il contenuto riassunto.

Fix proposto:

- se lo scope è ristretto, negare sempre l’accesso quando `cliente_master_id` è nullo;
- introdurre un helper unico `requireDocumentoVisibile` da usare prima di qualsiasi lettura con service role;
- applicare lo stesso fail-closed anche al cambio stato, che presenta la medesima condizione (`src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:124-131`).

### N2 — Il superadmin può reintrodurre stati rimossi `[medio]`

**VERIFICATO.**

Il body della route stato continua ad accettare tutti gli stati legacy e del vecchio workflow (`src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:74-85`).

Per i documenti in `storico`, `pending`, `ordinato` o `rifiutato`, il ramo `isUnlock` salta la verifica delle transizioni e permette al superadmin qualsiasi target compreso nell’enum (`src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:145-169`). Il controllo successivo lascia passare admin e superadmin anche quando il target non è mappato (`src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:176-191`).

Scenario concreto di fallimento:

```http
PATCH /api/portali/preventivatore/documenti/<id>/stato
Content-Type: application/json

{"stato":"inviata"}
```

Se il documento corrente è `storico` e il chiamante è superadmin, l’API può rispondere con successo e creare un documento nello stato `inviata`, benché la migration 111 dichiari che il portale mantiene soltanto `aperta` e `completato` (`supabase/migrations/111_rimozione_workflow_backoffice.sql:22`).

Fix proposto:

- lo schema del body deve accettare come target soltanto `aperta | completato`;
- lo sblocco di uno storico deve permettere esclusivamente `aperta`;
- gli stati legacy possono restare riconosciuti come stati correnti senza essere target validi;
- aggiungere un test esplicito per impedire `storico → inviata|ordinata|fallita|presa_in_carico`.

### N3 — Il cambio stato perde aggiornamenti concorrenti `[medio]`

**VERIFICATO.**

È il punto C3 ora confermato dal percorso completo. La route:

1. legge lo stato corrente (`src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:111-122`);
2. valida la transizione in memoria (`src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:143-191`);
3. aggiorna il record filtrando solo per `id` (`src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:207-212`).

Scenario concreto di fallimento:

- due richieste leggono entrambe `aperta`;
- entrambe superano il controllo;
- la prima salva stato, note e codici;
- la seconda aggiorna la stessa riga senza verificare che lo stato sia ancora quello letto;
- l’ultima richiesta sovrascrive silenziosamente parte del lavoro della prima.

Fix proposto:

- usare una RPC transazionale;
- aggiornare con `WHERE id = p_id AND stato = p_stato_atteso`;
- restituire `409 Conflict` se vengono aggiornate zero righe;
- includere `updated_at` o una versione numerica se si vuole proteggere anche dalle modifiche non relative allo stato.

### N4 — Salvataggio permessi superadmin non atomico `[medio]`

**VERIFICATO.**

La route dei permessi:

1. aggiorna il codice agente (`src/app/api/superadmin/preventivatore/permessi-utente/[utenteId]/route.ts:89-99`);
2. cancella tutte le associazioni di ruolo (`src/app/api/superadmin/preventivatore/permessi-utente/[utenteId]/route.ts:116-125`);
3. reinserisce le nuove associazioni (`src/app/api/superadmin/preventivatore/permessi-utente/[utenteId]/route.ts:127-141`).

Le tre operazioni sono indipendenti.

Scenario concreto di fallimento:

- l’update dell’agente riesce;
- la delete dei ruoli riesce;
- l’insert fallisce per errore temporaneo, vincolo o concorrenza;
- l’utente rimane con il nuovo agente ma senza alcun ruolo funzionale.

Due salvataggi contemporanei possono inoltre intercalare delete e insert, producendo una combinazione diversa da entrambe le richieste.

Fix proposto:

- RPC transazionale che validi UUID, utente e slug;
- update del codice agente e sostituzione delle associazioni nella stessa transazione;
- validazione Zod del body: oggi viene effettuato soltanto un cast TypeScript (`src/app/api/superadmin/preventivatore/permessi-utente/[utenteId]/route.ts:82-87`).

### N5 — La persistenza della chat è fire-and-forget `[medio]`

**VERIFICATO.**

Dopo aver ottenuto la risposta AI, la route invoca `saveMessages` e `saveUsageEvent` con `void` senza attendere le promise (`src/app/api/portali/preventivatore/chat/route.ts:244-250`).

Scenario concreto di fallimento:

- l’utente riceve correttamente la risposta;
- il runtime termina o congela l’esecuzione dopo la restituzione della response;
- il turno non viene inserito in `chat_messaggi`, oppure il costo non viene registrato;
- ricaricando la sessione manca l’ultimo scambio, mentre il consumo esterno è già avvenuto.

Fix proposto:

```ts
await Promise.allSettled([
  saveMessages(...),
  saveUsageEvent(...),
])
```

In alternativa, utilizzare una coda persistente. Il fallimento del logging può restare non bloccante, ma deve essere completato o affidato a un meccanismo durevole prima della chiusura dell’invocazione.

### N6 — La UI continua a promettere un workflow eliminato `[medio]`

**VERIFICATO.**

I residui sono presenti in più livelli:

- l’archivio offre i filtri “Offerta inviata”, “Ordinato” e “Rifiutato” (`src/components/portali/preventivatore/archivio-view.tsx:91-98`);
- la dashboard invita a marcare gli stati ordinato/rifiutato (`src/components/portali/preventivatore/dashboard-view.tsx:516-529`);
- la dashboard continua a mostrare “Tasso ordinato” e istruzioni relative al vecchio processo (`src/components/portali/preventivatore/dashboard-view.tsx:606-627`);
- la chat descrive al modello gli stati `pending/ordinato/rifiutato` (`src/app/api/portali/preventivatore/chat/route.ts:185-205`);
- vari tool accettano come filtro soltanto i tre stati legacy (`src/lib/portali/preventivatore/chat/tool-handlers.ts:76-116`, `src/lib/portali/preventivatore/chat/tool-handlers.ts:499-567`);
- le definizioni degli strumenti continuano a pubblicizzare metriche di esito commerciale (`src/lib/portali/preventivatore/chat/tool-definitions.ts:211-228`);
- la migration 110 continua a classificare `presa_in_carico`, `inviata`, `ordinata` e `fallita` (`supabase/migrations/110_dashboard_stati_allineati.sql:106-108`).

Scenario concreto di fallimento:

- l’utente vede “Tasso ordinato” e un invito a marcare preventivi come ordinati/rifiutati;
- nessun pulsante permette più di farlo;
- chiedendo alla chat i preventivi “completati”, alcuni tool non applicano il filtro perché whitelistano soltanto stati legacy.

Fix proposto:

- decidere se i dati storici di esito devono restare consultabili;
- mantenere eventualmente la lettura storica, ma rimuovere call-to-action e target non più scrivibili;
- centralizzare anche BI, dashboard e tool AI sulle definizioni di `stati.ts`;
- sostituire il KPI commerciale con metriche coerenti col portale “solo preventivi”, ad esempio bozze, definitivi, valore preventivato e tempo medio di preventivazione.

### N7 — La BI calcola risultati semanticamente falsi oltre i tetti `[medio]`

**VERIFICATO.**

È C5 confermato. Il server carica al massimo:

- 5.000 documenti;
- 12.000 righe di distinta.

I limiti sono definiti in `src/lib/portali/preventivatore/bi/query-engine.ts:62-63`.

La selezione usa i record più recenti (`src/lib/portali/preventivatore/bi/query-engine.ts:249-304`) e count, sum, avg e raggruppamenti vengono calcolati sul sottoinsieme (`src/lib/portali/preventivatore/bi/query-engine.ts:315-333`).

La UI mostra un warning quando il dataset è troncato (`src/components/portali/preventivatore/bi-dashboard-view.tsx:338-340`), ma continua a presentare i numeri come KPI.

Scenario concreto di fallimento:

- il database contiene 13.000 righe;
- il totale o la media ignora le 1.000 più vecchie;
- un filtro per un anno escluso dal campione può restituire zero;
- il risultato è deterministico, ma non corretto.

Fix proposto:

- spostare aggregazioni e filtri in RPC SQL;
- paginare soltanto le tabelle di dettaglio;
- nell’attesa, non mostrare un KPI troncato come valore valido: sostituirlo con “dato incompleto” o impedirne il calcolo.

### N8 — Config BI e chat non hanno validazione strutturale completa `[minore]`

**VERIFICATO.**

`bi/data` controlla soltanto la versione e che `widgets` sia un array (`src/app/api/portali/preventivatore/bi/data/route.ts:21-24`).

La route `bi` applica una sanitizzazione superficiale e salva il titolo senza limite esplicito (`src/app/api/portali/preventivatore/bi/route.ts:15-22`, `src/app/api/portali/preventivatore/bi/route.ts:85-105`).

La chat limita numero e lunghezza dei messaggi, ma non valida né limita strutturalmente `builder_state` (`src/app/api/portali/preventivatore/chat/route.ts:147-159`, `src/app/api/portali/preventivatore/chat/route.ts:214-219`).

Scenario concreto di fallimento:

- un utente autenticato invia migliaia di widget o uno snapshot builder molto grande;
- aumenta il consumo di memoria, CPU e token;
- una configurazione formalmente accettata ma malformata può essere persistita e rompere il rendering successivo.

Fix proposto:

- Zod condiviso per configurazioni BI;
- massimo numero di widget e filtri;
- limiti alle stringhe, dimensioni e profondità;
- limite esplicito in byte al body;
- schema e dimensione massima per `builder_state`.

### N9 — Errori dei provider AI esposti al client nella route riassunto `[minore]`

**VERIFICATO.**

Le funzioni provider costruiscono eccezioni includendo parte della risposta esterna (`src/app/api/portali/preventivatore/[id]/riassumi/route.ts:55-58`, `src/app/api/portali/preventivatore/[id]/riassumi/route.ts:94-98`). Il catch finale restituisce direttamente `err.message` al client (`src/app/api/portali/preventivatore/[id]/riassumi/route.ts:202-205`).

Scenario concreto di fallimento:

- OpenRouter o Gemini restituiscono un messaggio diagnostico interno;
- il testo viene inoltrato integralmente all’utente;
- possono essere esposti identificatori del provider, nomi di modelli, dettagli di configurazione o informazioni non destinate alla UI.

Fix proposto:

- registrare il dettaglio completo soltanto lato server;
- restituire al client un errore stabile e neutro;
- associare un request ID per la diagnosi.

## 3. Codice morto

### Route e componenti

**VERIFICATO.**

Tutti i 35 file `route.ts` sotto `src/app/api/portali/preventivatore/**` hanno almeno un chiamante nel repository. Non risultano route interamente orfane.

Anche tutti i componenti sotto `src/components/portali/preventivatore/**` hanno almeno un import.

La vecchia route `genera-descrizione` e il componente `workflow-actions.tsx` non esistono più, rimossi rispettivamente nei commit `2ee962d` e `f0fab43`.

| File/export o residuo | Prova che è morto o sovraesposto | Azione proposta |
|---|---|---|
| `PreventivatoreGuardResult` | Export mai importato; serve soltanto come tipo di ritorno locale (`src/lib/portali/preventivatore/api-guard.ts:24-30`). | Rimuovere `export`. |
| `BuilderPayload` | Nessun import esterno rilevato (`src/lib/portali/preventivatore/documenti-schema.ts:65`). | Rendere il tipo locale o rimuoverlo se non necessario. |
| `TracciatoListino`, `VoceListino`, `GravitaProblema` | Nessun import esterno (`src/lib/portali/preventivatore/listini.ts:17`, `src/lib/portali/preventivatore/listini.ts:64`, `src/lib/portali/preventivatore/listini.ts:72`). | Rendere locali; eliminare solo ciò che non è usato internamente. |
| `PreventivatoreRuoloSlug` | Nessun import esterno (`src/lib/portali/preventivatore/ruoli.ts:13`). | Rendere locale. |
| `PreventivatoreLivello` | Nessun import esterno; viene usato soltanto nello stesso file (`src/lib/portali/preventivatore/ruoli.ts:62-76`). | Rendere locale finché non esiste un consumatore. |
| `PreventivatoreScope` | Nessun import esterno; è soltanto il tipo di ritorno dell’helper (`src/lib/portali/preventivatore/ruoli.ts:209-223`). | Rendere locale oppure esportare insieme a un’API pubblica formalizzata. |
| `STATI_LEGACY`, `STATI_WORKFLOW`, `STATI_TUTTI` | Nessun import esterno (`src/lib/portali/preventivatore/stati.ts:16-43`). Alcune costanti alimentano altre definizioni nello stesso file. | Ridurre la superficie export senza eliminare ciò che serve internamente. |
| `GRUPPI_STATO`, `GruppoStato` | Nessun import esterno (`src/lib/portali/preventivatore/stati.ts:49-61`). | Rendere locali. |
| `BADGE_STATO` | Nessun import esterno; viene consumato da `badgeStato` nello stesso file (`src/lib/portali/preventivatore/stati.ts:84-104`). | Esportare soltanto `badgeStato` se non serve accesso diretto alla mappa. |
| `validateWidgetConfig` | Nessun import esterno; usata internamente dal motore (`src/lib/portali/preventivatore/bi/query-engine.ts:65`, `src/lib/portali/preventivatore/bi/query-engine.ts:322`). | Rendere locale. |
| `loadBiRows`, `LoadedDataset` | Nessun import esterno; dettagli interni del motore (`src/lib/portali/preventivatore/bi/query-engine.ts:242-249`, `src/lib/portali/preventivatore/bi/query-engine.ts:329-333`). | Rendere locali. |
| `ComputeBiResult` | Nessun import esterno (`src/lib/portali/preventivatore/bi/query-engine.ts:307-315`). | Rendere locale o spostare nei tipi BI solo se serve davvero fuori dal modulo. |
| Funzioni tool singole e `variantiCodice` | Nessun import esterno; vengono chiamate soltanto da `dispatchTool` nello stesso file (`src/lib/portali/preventivatore/chat/tool-handlers.ts:35-52`, `src/lib/portali/preventivatore/chat/tool-handlers.ts:979-1001`). | Esportare soltanto `dispatchTool` e i tipi realmente necessari. |
| `UsageAI`, `ModalitaUsage`, `EsempioScheda` | Nessun import esterno (`src/lib/portali/preventivatore/scheda-tecnica/ai.ts:12-20`, `src/lib/portali/preventivatore/scheda-tecnica/ai.ts:118`). | Rendere locali. |
| `ParametroTipo`, `UnitaTempo`, `ModalitaManodopera` | Nessun import esterno (`src/lib/portali/preventivatore/template/types.ts:4-8`). | Rendere locali se usati soltanto nel file. |
| `scopeParametri`, `ArticoloCalcolato`, `ServizioCalcolato` | Nessun import esterno; `scopeParametri` è usata soltanto internamente (`src/lib/portali/preventivatore/template/types.ts:81-122`, `src/lib/portali/preventivatore/template/types.ts:158-162`). | Rendere locali o rimuovere l’export. |
| `getPreventivatoreScope` | Non morto, ma usato soltanto da chat e BI data (`src/lib/portali/preventivatore/ruoli.ts:215-223`; chiamanti `src/app/api/portali/preventivatore/chat/route.ts:222`, `src/app/api/portali/preventivatore/bi/data/route.ts:27`). | Portare qui tutte le route di lettura invece di duplicare la logica. |
| Stati post-offerta | Restano nello schema/check (`supabase/migrations/039_workflow_preventivi.sql:24-39`), nella migration 110 (`supabase/migrations/110_dashboard_stati_allineati.sql:106-108`) e in `stati.ts` (`src/lib/portali/preventivatore/stati.ts:25-32`), benché la migration 111 dichiari vivi solo `aperta/completato` (`supabase/migrations/111_rimozione_workflow_backoffice.sql:22`). | Nuova migration: conservare compatibilità di lettura per lo storico, ma impedire nuovi valori e rimuovere i rami UI/API irraggiungibili. |
| `validazione_tecnica_il`, `validazione_tecnica_da`, `validazione_economica_il`, `validazione_economica_da` | Create dalla migration 039 (`supabase/migrations/039_workflow_preventivi.sql:63-66`); nessun reader o writer nel perimetro applicativo. | Documentare come deprecate e, dopo verifica dei dati e dei consumer esterni, rimuovere con migration separata. |
| `audit_hash` | Creato dalla migration 027 (`supabase/migrations/027_preventivatore_v2_metadata.sql:16`); nessun reader o writer nel perimetro. | Verificare eventuali script d’ingest esterni, poi rimuovere se realmente inutilizzato. |
| `importo_offerta`, `note_offerta`, `motivo_rifiuto_id`, `importo_ordinato` | Nessun writer applicativo dopo `f0fab43`; la migration 111 lo dichiara espressamente (`supabase/migrations/111_rimozione_workflow_backoffice.sql:30-37`). Alcuni campi restano letti per compatibilità storica (`src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:50`, `src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:95-103`). | Non droppare alla cieca; distinguere compatibilità storica read-only da campi sempre vuoti, poi eliminare UI e indici inutili. |
| `incluso_offerta` | Colonna nata per la scelta dei blocchi del back office (`supabase/migrations/039_workflow_preventivi.sql:54-56`); il workflow che la alimentava è stato eliminato. Il dettaglio continua a leggerla (`src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:72`). | Verificare se ha valori storici non default; in caso contrario rimuovere lettura e colonna. |
| Ruolo `back_office` | Eliminato correttamente dalle assegnazioni e dall’anagrafica (`supabase/migrations/111_rimozione_workflow_backoffice.sql:46-55`). Non risulta più nel codice dei ruoli vivi (`src/lib/portali/preventivatore/ruoli.ts:8-11`). | Nessuna azione sul ruolo; completare la pulizia dei concetti collegati. |
| Feature flag `ai_cost_counter_enabled` | **Non morto.** Letto dall’API usage (`src/app/api/portali/preventivatore/usage/route.ts:34-41`) e usato nelle UI (`src/components/portali/preventivatore/chat-ai.tsx:982`, `src/components/portali/preventivatore/scheda-tecnica-dialog.tsx:285-286`). | Nessuna azione. |
| Migration 115 `public.ai_config` | **Non è un residuo del Preventivatore.** Configura il caso `vettori.lettura_fattura` (`supabase/migrations/115_ai_config.sql:65-73`). La chat Preventivatore continua a usare `preventivatore.ai_config` (`src/lib/portali/preventivatore/chat/config-cache.ts:8-13`). | Non unificare automaticamente le due tabelle: hanno schema e finalità differenti. Documentare chiaramente la distinzione. |

Nota: “export mai importato” non equivale sempre a “codice ineseguito”. Diversi simboli sono usati internamente nello stesso file. La tabella distingue la superficie pubblica inutile dai rami e dalle colonne realmente orfani.

## 4. Ottimizzazioni

| Intervento | Evidenza | Impatto stimato |
|---|---|---|
| Migrare tutte le route a `requirePreventivatore` e a uno scope comune | Solo sette file route usano il guard; la vecchia catena compie più round-trip (`src/lib/portali/preventivatore/api-guard.ts:10-14`; esempio legacy `src/app/api/portali/preventivatore/documenti/[id]/stato/route.ts:96-127`). | **Alto** sulle route frequenti: uno-tre round-trip auth/permessi in meno per richiesta e meno divergenze di sicurezza. |
| Aggregazioni BI in SQL/RPC | Due dataset fino a 5.000/12.000 righe vengono trasferiti e ricalcolati (`src/lib/portali/preventivatore/bi/query-engine.ts:249-333`). | **Alto**: payload, memoria e CPU inferiori; soprattutto risultati completi. |
| Precaricare servizi e template nel Server Component | `/nuovo` è una shell vuota (`src/app/(intranet)/(portale-preventivatore)/preventivatore/nuovo/page.tsx:1-12`) e fa fetch dopo l’idratazione (`src/components/portali/preventivatore/nuovo-view.tsx:450-466`). | **Medio**: elimina due richieste post-mount e migliora il first useful paint. |
| Spezzare i componenti monolitici | `chat-ai.tsx` ha 1.467 righe, `dettaglio-view.tsx` 1.145, `nuovo-view.tsx` 1.107 e `blocco-card.tsx` 1.028. Il builder importa `BloccoCard` staticamente (`src/components/portali/preventivatore/nuovo-view.tsx:9-13`), mentre chat e scheda sono dynamic (`src/components/portali/preventivatore/nuovo-view.tsx:42-58`). | **Medio** sulla manutenibilità; **basso-medio** sul bundle se vengono caricati dinamicamente pannelli e modali rari. |
| Cache server dei modelli OpenRouter | Ogni mount delle impostazioni chiama `/config/models` (`src/components/portali/preventivatore/impostazioni-view.tsx:152`), che interroga OpenRouter (`src/app/api/portali/preventivatore/config/models/route.ts:78`). | **Medio**: evita circa 120 KB e una dipendenza esterna a ogni apertura. TTL suggerito: una-sei ore. |
| Autorizzare il dettaglio prima delle query secondarie | Il dettaglio avvia quattro query parallele prima di verificare lo scope (`src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:43-76`); lo scope viene verificato dopo (`src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:84-92`). | **Medio** per richieste negate: evitare il caricamento di chunk, righe e blocchi non restituibili. |
| Unire la query del motivo rifiuto | Dopo le quattro query principali parte una quinta query condizionale (`src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:95-103`). | **Basso**: usare embed/join nella query documento per eliminare il round-trip residuo. |
| Rendere transazionale il caricamento listini | Gli insert avvengono in chunk sequenziali e il cleanup è manuale in caso d’errore (`src/app/api/portali/preventivatore/listini/route.ts:237-261`). | **Medio** sui caricamenti grandi: RPC o import transazionale elimina round-trip e stati intermedi. |
| Riutilizzare o raggruppare il recupero prezzi nei template | Il manager chiama `/prodotti/costo` per singolo codice (`src/components/portali/preventivatore/template-manager.tsx:335`). | **Basso oggi**, potenzialmente **alto** durante editing ripetuto; usare debounce, cache locale o endpoint batch già supportato dal builder. |
| Integrare il tempo di preventivazione nella RPC di salvataggio | Dopo la creazione e la modifica viene eseguito un secondo update best-effort (`src/app/api/portali/preventivatore/documenti/route.ts:267-275`, `src/app/api/portali/preventivatore/documenti/[id]/route.ts:326-333`). | **Basso-medio**: un round-trip in meno e nessuna divergenza tra preventivo salvato e tempo non salvato. |
| Centralizzare i controlli documento | Dettaglio, modifica, duplicazione, stato e riassunto implementano separatamente lo scope (`src/app/api/portali/preventivatore/documenti/[id]/route.ts:80-87`, `src/app/api/portali/preventivatore/documenti/[id]/duplica/route.ts:73-80`, `src/app/api/portali/preventivatore/[id]/riassumi/route.ts:135-144`). | **Alto** sulla correttezza: elimina differenze fail-open/fail-closed. |

Non è stato trovato un classico N+1 DB nel rendering del flusso principale: dettaglio e duplicazione caricano blocchi e righe in batch (`src/app/api/portali/preventivatore/documenti/[id]/route.ts:89-106`, `src/app/api/portali/preventivatore/documenti/[id]/duplica/route.ts:82-96`).

## 5. Valutazione del flusso utente end-to-end

### Creazione

**VERIFICATO.**

Il client richiede:

- cliente;
- codice commessa in creazione;
- almeno una voce materiale o servizio.

I controlli sono in `src/components/portali/preventivatore/nuovo-view.tsx:129-143`.

Il server replica i vincoli con Zod (`src/lib/portali/preventivatore/documenti-schema.ts:39-63`) e limita la creazione al ruolo funzionale `preventivatore`, con bypass per admin/superadmin attraverso l’helper (`src/app/api/portali/preventivatore/documenti/route.ts:200-214`).

Aspetti positivi:

- validazione client e server;
- limite a stringhe, quantità, prezzi e percentuali;
- creazione tramite RPC atomica (`src/app/api/portali/preventivatore/documenti/route.ts:244-265`);
- conflitto sul codice commessa restituito come 409 (`src/app/api/portali/preventivatore/documenti/route.ts:252-258`).

Attriti:

- pagina interamente client;
- servizi e template arrivano dopo l’idratazione (`src/components/portali/preventivatore/nuovo-view.tsx:450-466`);
- chat fissa larga 320 px (`src/components/portali/preventivatore/chat-ai.tsx:1255`);
- quattro componenti oltre 1.000 righe rendono fragile l’evoluzione del builder;
- la scheda tecnica AI è collocata nel builder (`src/components/portali/preventivatore/nuovo-view.tsx:1044`, `src/components/portali/preventivatore/nuovo-view.tsx:1097-1107`) anziché come fase chiaramente successiva al salvataggio.

### Salvataggio

**VERIFICATO.**

Il salvataggio:

1. disabilita i tentativi ripetuti tramite `savingPreventivo` (`src/components/portali/preventivatore/nuovo-view.tsx:129-145`);
2. mostra una fase distinta di salvataggio;
3. dopo la risposta mostra la fase “Apro la scheda del preventivo” (`src/components/portali/preventivatore/nuovo-view.tsx:653-670`);
4. naviga al dettaglio (`src/components/portali/preventivatore/nuovo-view.tsx:194-203`).

La creazione principale è atomica tramite RPC (`src/app/api/portali/preventivatore/documenti/route.ts:244-265`).

Problemi residui:

- il tempo di preventivazione è scritto in un secondo update best-effort (`src/app/api/portali/preventivatore/documenti/route.ts:267-275`);
- lo stesso accade in modifica (`src/app/api/portali/preventivatore/documenti/[id]/route.ts:326-333`);
- la PUT non ha optimistic locking (`src/app/api/portali/preventivatore/documenti/[id]/route.ts:312-315`);
- due tab aperti sullo stesso preventivo possono sovrascriversi senza avviso.

### Archivio

**VERIFICATO.**

La lista è paginata e applica lo scope commerciale lato API (`src/app/api/portali/preventivatore/documenti/route.ts:34-154`).

La ricerca AI:

- autentica l’utente;
- controlla l’accesso al portale;
- applica rate limit;
- applica portfolio e filtri al recupero dei documenti (`src/app/api/portali/preventivatore/search/route.ts:23-55`, `src/app/api/portali/preventivatore/search/route.ts:89-124`).

Aspetti positivi:

- archivio e ricerca non dipendono soltanto dai filtri UI;
- i documenti vengono aperti per ID mediante routing esplicito (`src/components/portali/preventivatore/archivio-view.tsx:568-572`);
- l’autocomplete cliente ha ora cancellazione e soglia minima.

Attrito principale:

- tre filtri descrivono un workflow rimosso (`src/components/portali/preventivatore/archivio-view.tsx:91-98`);
- il portale dice “solo preventivi”, ma l’archivio continua a comunicare un ciclo offerta/esito;
- i campi storici di esito restano visualizzati soltanto in condizioni legacy, rendendo il modello mentale non uniforme (`src/components/portali/preventivatore/archivio-view.tsx:599-600`).

### Dettaglio

**VERIFICATO.**

Il Server Component:

- richiede utente;
- controlla l’accesso al portale;
- applica il portfolio commerciale (`src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:35-43`, `src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:84-92`).

La UI mostra “Modifica” soltanto per documenti generati e modificabili (`src/components/portali/preventivatore/dettaglio-view.tsx:269-282`).

La duplicazione è sempre disponibile (`src/components/portali/preventivatore/dettaglio-view.tsx:283-294`), scelta coerente per storici e definitivi.

Attriti:

- “Correggi totali” viene mostrato a tutti e l’autorizzazione è comunicata solo nel tooltip (`src/components/portali/preventivatore/dettaglio-view.tsx:295-304`);
- dopo il salvataggio delle correzioni viene forzato `window.location.reload()` (`src/components/portali/preventivatore/dettaglio-view.tsx:307-315`);
- le quattro query di dettaglio partono prima del controllo portfolio (`src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:43-92`);
- il dettaglio mantiene campi e motivi del workflow eliminato (`src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:50`, `src/app/(intranet)/(portale-preventivatore)/preventivatore/archivio/[id]/page.tsx:95-103`).

### Duplica

**VERIFICATO.**

Il percorso `?base=` chiama la route di duplicazione (`src/components/portali/preventivatore/nuovo-view.tsx:221-287`).

Il server:

- verifica autenticazione e portale;
- verifica il portfolio;
- nega a un commerciale ristretto gli storici senza master (`src/app/api/portali/preventivatore/documenti/[id]/duplica/route.ts:63-80`);
- carica blocchi e righe in batch (`src/app/api/portali/preventivatore/documenti/[id]/duplica/route.ts:82-96`);
- aggiorna i prezzi materiali in batch (`src/app/api/portali/preventivatore/documenti/[id]/duplica/route.ts:106-124`).

Aspetti positivi:

- la route non scrive sul database;
- il nuovo documento nasce soltanto al successivo POST;
- il percorso distingue correttamente “modifica a prezzi congelati” e “duplica a prezzi correnti”.

Attriti:

- la duplicazione utilizza `GET` per un’operazione di preparazione non mutante: tecnicamente corretto, ma il nome della route può suggerire una mutazione;
- l’ordine dei blocchi nella duplicazione usa `created_at` (`src/app/api/portali/preventivatore/documenti/[id]/duplica/route.ts:87-95`), mentre la modifica usa prima la colonna `ordine` (`src/app/api/portali/preventivatore/documenti/[id]/route.ts:89-105`). **IPOTESI:** per documenti in cui ordine logico e creazione divergono, il duplicato può ricostruire i blocchi in ordine diverso.

Fix proposto per quest’ultimo punto: allineare la query di duplicazione alla query di modifica, ordinando prima per `ordine` e usando `created_at` come fallback.

### Word e scheda tecnica

**VERIFICATO.**

Il dettaglio espone i documenti Word soltanto quando esistono chunk Word (`src/components/portali/preventivatore/dettaglio-view.tsx:445-507`) e apre il formatter in un dialog (`src/components/portali/preventivatore/dettaglio-view.tsx:502-513`).

Il riassunto AI è disponibile nella stessa sezione (`src/components/portali/preventivatore/dettaglio-view.tsx:453-488`).

La scheda tecnica AI è invece legata al builder prima o durante la modifica (`src/components/portali/preventivatore/nuovo-view.tsx:1044`, `src/components/portali/preventivatore/nuovo-view.tsx:1097-1107`).

Attrito concreto:

- dal dettaglio salvato non esiste un comando diretto “Scheda tecnica”;
- per riaprire la scheda tecnica bisogna entrare in “Modifica”;
- “Modifica” è nascosto quando lo stato è considerato non modificabile (`src/components/portali/preventivatore/dettaglio-view.tsx:269-282`);
- per i preventivi generati senza chunk con `source_type=word`, la sezione Word non appare.

**IPOTESI:** il finale Word/scheda è poco scopribile e differente tra preventivi storici e generati. Il comportamento va validato con un utente reale: la posizione più naturale della scheda tecnica potrebbe essere il dettaglio salvato, non soltanto il builder.

### Giudizio complessivo

Il nucleo creazione → salvataggio → dettaglio → duplicazione è coerente e più robusto rispetto al 17/09/2026.

I miglioramenti verificati includono:

- validazione condivisa del payload;
- autorizzazione per il ruolo preventivatore;
- creazione atomica;
- feedback durante salvataggio e navigazione;
- autocomplete senza race;
- modifica bloccata sugli stati non modificabili;
- scope BI corretto;
- duplicazione senza scritture anticipate.

Il principale debito non è più il builder, ma la mancata conclusione della rimozione del workflow. Dashboard, archivio, BI, chat, route stato e schema raccontano ancora modelli differenti.

La priorità consigliata è:

1. chiudere la fuga della route `riassumi`;
2. impedire definitivamente la creazione di stati rimossi;
3. rendere atomici stato e permessi;
4. introdurre optimistic locking sulla PUT;
5. ripulire dashboard, archivio, BI e chat dai concetti post-offerta;
6. spostare le aggregazioni BI nel database;
7. centralizzare autenticazione e scope documento.

## 6. Esito type-check, lint e test

| Comando | Esito | Dettaglio |
|---|---|---|
| `npm run type-check -- --incremental false` | **PASS** | Exit code 0; nessun errore, incluso il perimetro. È stato aggiunto `--incremental false` per evitare scritture a `tsconfig.tsbuildinfo`. |
| `npm run lint -- --no-cache` | **NON ESEGUIBILE NELLA SANDBOX** | Next lint ha tentato di cancellare `.next/cache/eslint/.cache_lkfzy1` ed è terminato con `EPERM`. |
| ESLint diretto `--no-cache` sull’intero perimetro | **PASS** | Exit code 0, nessun errore nelle route, pagine, componenti, librerie, superadmin e test del Preventivatore. È il controllo sostitutivo del comando Next bloccato dalla sandbox. |
| `npx vitest run src/tests/preventivatore-*` | **NESSUN FILE TROVATO** | PowerShell ha passato il glob letteralmente a Vitest: exit code 1, “No test files found”. Nel repository esiste un solo match: `src/tests/preventivatore-autorizzazione.test.ts`. |
| `npx vitest run src/tests/preventivatore-autorizzazione.test.ts` | **BLOCCATO DALLA SANDBOX** | Vitest/jsdom ha tentato `mkdir` in `%LOCALAPPDATA%/Temp/.../client` ed è terminato con `EPERM` prima di importare la suite: zero test eseguiti. Non è un fallimento del codice applicativo. |

Non sono stati rilevati errori TypeScript o ESLint nel perimetro. L’esito dei test Vitest rimane indeterminato per un blocco ambientale precedente all’esecuzione della suite.