# Ricognizione Preventivatore — 27/09/2026

Seconda ricognizione dopo quella del 17/09 (`docs/ANALISI-PREVENTIVATORE-20260917.md`).
Fatta con due job Codex in parallelo (A: codice, rotte, flusso — B: indicizzazione,
chat, schede tecniche) più verifiche di Claude sul codice e sul database.

I referti integrali di Codex sono allegati:
`docs/ricognizione-20260927/CODEX-A-generale.md` e `docs/ricognizione-20260927/CODEX-B-rag-chat-schede.md`.
Questo documento è la sintesi **verificata**: ogni punto grave è stato riletto sul codice.

> [!warning] Da dove vengono i numeri
> I conteggi sono del **DB di sviluppo** (Supabase `sowzewrfkoxernnvhzgg`), fermo al 29/08.
> La produzione (PostgreSQL sulla VM) non era raggiungibile: VPN spenta. Le query
> per rifare i conteggi in produzione sono in fondo (§6).

> [!info] Scartato un falso positivo di Codex
> Codex segnalava `sessioni/[id]/route.ts` come incompatibile con Next 15 (`params` non
> atteso). Il progetto è su **Next 14.2.35**: lì `params` è un oggetto sincrono, la route è corretta.

---

## 1. La domanda principale: i preventivi nuovi arrivano alla chat?

**No, non nella ricerca semantica.** Quattro cause indipendenti, tutte verificate.

### 1.1 Nascono senza vettore, e nessuno glielo dà

`crea_documento_dal_builder` (ultima versione: `supabase/migrations/071_manodopera_lotto_complessivo.sql:211`)
inserisce **un solo** chunk con `embedding` NULL. Lo riempie soltanto
`scripts/genera-embeddings-mancanti.cjs`, che si lancia a mano: non c'è cron, trigger,
coda, né riferimento in `package.json`.

`match_chunks` confronta `embedding <=> query`: con embedding NULL la riga è esclusa.

| DB sviluppo | documenti | chunk | con embedding |
|---|---:|---:|---:|
| `generato` (G, dal builder) | 3 | 3 | **0** |
| `storico` C | 38 | 43 | 43 |
| `storico` S | 344 | 1.152 | 1.152 |

### 1.2 Ogni modifica lo riazzera

`aggiorna_documento_dal_builder` fa `DELETE FROM preventivatore.chunks WHERE documento_id = p_id`
(`071:328`) e ricrea il chunk con embedding NULL (`071:412`). Anche lanciando il backfill,
la prima modifica rende di nuovo invisibile il preventivo.

### 1.3 Anche con il vettore, il testo non dice niente

Il testo indicizzato è (`071:207`):

```text
Preventivo <codice>. Cliente: <cliente>. Prezzo <n> EUR (costo <n>). <N> blocchi.
```

Niente titolo, niente nomi o tipi di blocco, niente codici o descrizioni articolo,
niente lavorazioni. Una ricerca «nastro modulare 3 m con motoriduttore» non può
trovarlo. Gli storici invece hanno un chunk **per blocco**, ricco (`scripts/ingest-scale.mjs:403-574`).

Conseguenze a cascata:

- `cerca_articolo` cerca con `ILIKE` dentro `chunks.contenuto` (`tool-handlers.ts:259-300`): i
  codici dei preventivi nuovi non ci sono, quindi non li trova.
- Il filtro `codice_preventivo` di `cerca_articolo` usa `metadata->>codice_progetto`, che il
  builder non scrive.
- `cerca_simili` legge `sheet_name`/`codice_blocco` dal metadata: per i nuovi è sempre nullo.

> [!success] Cosa invece funziona
> I tool che leggono via SQL (`list_preventivi`, `dettaglio_preventivo`, `query_righe_distinta`,
> `top_articoli`, `aggrega_preventivi`, le RPC di analisi) **vedono** i preventivi nuovi
> subito. Il buco è solo nella parte semantica/testuale: «trovami qualcosa di simile».

### 1.4 La ricerca filtra dopo aver già tagliato

`toolCercaSimili` chiede a `match_chunks` i primi 40 chunk dell'**intero archivio**, poi
applica portfolio commerciale e filtro cliente (`tool-handlers.ts:173-201`). Se i primi 40
sono di altri clienti, il risultato è vuoto anche quando il 41° era pertinente.
Stesso difetto nella ricerca dell'archivio (`search/route.ts:66-124`, soglia 0,40 e 20 candidati
fissi, diversi da quelli della chat). `match_chunks` ha già i parametri `filter_cliente`:
non vengono usati.

### 1.5 Contorno

| Problema | Dove | Effetto |
|---|---|---|
| `modello_embedding` modificabile in Impostazioni ma ignorato | `embedding-cache.ts:13`, `search/route.ts:59` hard-coded | Se qualcuno lo cambia, pensa di aver cambiato modello e non è vero; se lo cambia anche lo script (`EMBEDDING_MODEL`), vettori di archivio e query diventano incomparabili |
| Nessun controllo `length === 3072` | backfill e ingest | Un cambio di modello del provider si scopre solo da un errore Postgres |
| Drift DB ↔ migration | DB: `match_chunks` e `idx_chunks_embedding` usano `halfvec(3072)`; migration `021`: `vector(3072)` diretto | Ricostruire il DB dalle migration fallisce sull'indice (HNSW max 2000 dim su `vector`) e produce una `match_chunks` senza indice |
| Nessun `embedded_at`, modello o hash sul chunk | schema `chunks` | Non si sa quando e con cosa è stato calcolato un vettore |

### 1.6 Correzione proposta

1. **Chunk per blocco anche per i preventivi del builder**, generati nella RPC: titolo del
   preventivo, nome/tipo/note del blocco, codici e descrizioni degli articoli, lavorazioni con ore.
   Più un chunk-documento di sintesi. Metadata allineati agli storici (`codice_progetto`,
   `cliente`, `sheet_name`, `codice_blocco`, `source_type='builder'`).
2. **Embedding subito dopo il salvataggio**, nella route (best-effort, non blocca il salvataggio)
   + backfill dello script su **timer systemd sulla VM** ogni 10 minuti come rete di sicurezza.
   Idempotenza con `contenuto_hash`: la modifica ricalcola solo i blocchi cambiati invece di
   cancellare tutto.
3. **Nuova `match_chunks_scoped`**: filtri (portfolio, cliente, tipo, stato, esclusione del
   documento corrente) **dentro** la query, prima di `ORDER BY … LIMIT`.
4. Un solo servizio embedding che legge `modello_embedding`, valida la dimensione e scrive
   `embedding_modello` ed `embedded_at`.
5. Migration che versiona lo stato reale del DB (`halfvec`) per chiudere il drift.

---

## 2. Chat AI

Uso reale in sviluppo: **8 sessioni, 44 messaggi**, ultimo il 30/07. Modello configurato:
`openrouter:anthropic/claude-haiku-4.5`, con Gemini 2.5 Flash come riserva.

### 2.1 Bug gravi (verificati)

**C1 — Le chiamate parallele ai tool rompono OpenRouter.**
`openrouter-handler.ts:224-245` copia nel messaggio assistant **tutte** le `tool_calls`, ma
esegue e risponde solo alla prima. I modelli Anthropic emettono spesso più tool call nello
stesso turno (es. due `list_preventivi` per due anni): la richiesta successiva contiene un
`tool_use` senza `tool_result`, e l'API la rifiuta. Il catch in `chat/route.ts:228-242`
passa allora a Gemini **senza dirlo**: l'utente riceve una risposta da un altro modello, e
il costo del tentativo OpenRouter si perde.

**C2 — Gemini fa un solo giro di tool.** `gemini-handler.ts:183-207`: esegue la prima
function call e restituisce `result2.response.text()`. Se Gemini ne chiede una seconda, la
risposta è vuota o monca. Poiché Gemini è la riserva di C1, i due difetti si sommano: le
domande che richiedono più passi sono proprio quelle che finiscono male.

**C3 — Il giro «finale» può chiedere ancora tool.** Dopo 6 round (`openrouter-handler.ts:248-259`)
la chiamata di chiusura passa ancora `tools` + `tool_choice: auto`: il modello può rispondere
con un'altra tool call e `content` nullo → risposta vuota.

**C4 — `JSON.parse` degli argomenti fuori dal try** (`openrouter-handler.ts:224`): un JSON
malformato fa fallire l'intero provider (→ fallback silenzioso a Gemini).

**C5 — I booleani diventano stringhe per Gemini.** `toGeminiProps` (`gemini-handler.ts:27-35`)
conosce solo `number` e `string`: `count_only`, `solo_attivi` arrivano come `"false"`, che in
JavaScript è vero.

### 2.2 Problemi medi

- **Tool e prompt parlano ancora del workflow rimosso**: la chat descrive gli stati
  `pending/ordinato/rifiutato` (`chat/route.ts:185-205`), i filtri accettano solo quelli
  (`tool-handlers.ts:76-116`), il tool `hit_rate` misura un esito che il portale non registra più.
- **Si conserva solo l'ultimo tool**: `lastToolName`/`lastRisultati` (`openrouter-handler.ts:209-238`).
  In una risposta costruita su ricerca + dettaglio + listino, le card e lo storico mostrano solo
  l'ultima fonte. `ToolName` in `types.ts` elenca 8 tool su 17; la UI ha card per 7.
- **`list_preventivi` promette date di consegna che non seleziona** (`tool-definitions.ts:5-20`
  vs `tool-handlers.ts:100-130`): il modello conclude «dato non disponibile».
- **Aggregazioni in memoria su 1.000-2.000 righe** senza ordinamento deterministico
  (`tool-handlers.ts:317-575`): oltre la soglia i numeri dipendono da cosa restituisce PostgREST.
- **Persistenza fire-and-forget** (`chat/route.ts:244-250`): messaggi e costi salvati con `void`.
  Con pm2 (processo lungo) il rischio è basso, ma un errore resta invisibile, e il client mostra
  «salvata» appena esiste la sessione.
- **Costi**: Gemini non è mai contabilizzato; `cost || null` scarta i costi zero; i round
  OpenRouter falliti prima del fallback non vengono registrati.
- **Contesto non governato**: fino a 50 messaggi × 8.000 caratteri + builder state senza limite,
  nessun troncamento per token, nessuna sintesi dei turni vecchi.
- **Prompt caching probabilmente inefficace**: `cache_control` è messo accanto a `content`
  stringa (`openrouter-handler.ts:139-145`) invece che su un content block. Da verificare
  nei log OpenRouter (voce `cache_read`).
- **Timeout Gemini non annulla la chiamata** (`Promise.race`, `gemini-handler.ts:167-175`).
- **Niente streaming, niente «Interrompi»**: la risposta arriva tutta insieme dopo fino a 30 s.

### 2.3 Sicurezza

- Testo dei documenti storici e delle schede approvate entra nel contesto come testo fidato:
  un contenuto con istruzioni («ignora…») viene letto come istruzione. Serve delimitarlo come
  dato e dichiararlo nel system prompt.
- Lo scope commerciale è applicato ai tool, ma **dopo** la top-K vettoriale (§1.4): nessuna fuga
  di dati, ma perdita di risultati per gli utenti con portfolio ristretto.

### 2.4 Miglioramenti, in ordine

| # | Intervento | Impatto | Sforzo |
|---|---|---|---|
| 1 | Un solo orchestratore di tool per entrambi i provider: tutte le call del turno, risultati per ogni `tool_call_id`, chiusura con `tool_choice: "none"`, argomenti validati con Zod | Molto alto | Medio |
| 2 | Indicizzazione corretta dei preventivi nuovi (§1.6) | Molto alto | Medio |
| 3 | Ricerca ibrida: full-text/trigram su codici e descrizioni (anche su `righe_distinta`) + vettore, fusione dei ranking | Alto | Medio |
| 4 | Citazioni obbligatorie: ogni cifra con codice preventivo e link al dettaglio; conservare tutte le fonti del turno | Alto | Medio |
| 5 | Allineare prompt e tool al portale «solo preventivi» (via `stati.ts`), togliere `hit_rate` o riformularlo | Medio | Basso |
| 6 | Mostrare quando si è passati al modello di riserva; contabilizzare anche Gemini | Medio | Basso |
| 7 | Streaming SSE con eventi «sto cercando…» e pulsante Interrompi | Medio | Medio |
| 8 | Set di 20-30 domande reali con risposta attesa, da rilanciare a ogni modifica di prompt/tool | Alto | Medio |

---

## 3. Schede tecniche

In sviluppo `schede_approvate` ha **0 righe**: il ciclo di apprendimento non è mai
stato usato. Modello: `openrouter:anthropic/claude-sonnet-5`.

### 3.1 Gravi (verificati)

**S1 — Chiunque abbia accesso al portale può scrivere nella memoria.**
`scheda-tecnica/approva/route.ts:35-95` accetta `contenuto_md` arbitrario, anche senza
`scheda_id`, e lo inserisce in `schede_approvate`: diventa un esempio **prioritario** per tutte
le generazioni future (metà dei posti, `ai.ts:148-226`). Nessun ruolo di curatore.

**S2 — Nessun controllo di proprietà.** `approva` e `revisiona` (`revisiona/route.ts:125-147`)
aggiornano `schede_generate` con l'admin client filtrando solo per `scheda_id`: conoscendo
l'UUID si riscrive la scheda di un altro.

**S3 — Esempi fuori portfolio.** `recuperaEsempi` cerca in tutti i chunk e in tutte le schede
approvate senza scope: a un commerciale ristretto finiscono nel prompt testi di clienti non suoi.

**S4 — Il prompt versionato è l'opposto di quello in uso.** La migration `034` chiede tabelle,
codici articolo e lavorazioni; la route li vieta (`scheda-tecnica/route.ts:169-188`). Nel DB c'è
un prompt diverso, aggiornato a mano e mai versionato. Un DB ricostruito dalle migration
genererebbe schede nel formato sbagliato.

**S5 — Se le domande falliscono, genera lo stesso.** Se il JSON delle domande non è
leggibile (`route.ts:134-169`), il codice passa alla generazione: proprio nel caso in cui il
modello voleva chiedere informazioni mancanti.

**S6 — Rischio concreto di specifiche prese da altri lavori.** Il builder porta codici,
descrizioni troncate a 50 caratteri e prezzi, ma non geometrie, materiali, ambiente o
normative. Gli esempi le contengono per altri clienti, e il prompt dice di imitarli
fedelmente. Serve un'istruzione esplicita («gli esempi valgono per stile, mai per dati») e una
verifica a valle dei valori tecnici non presenti nel builder o nelle risposte.

### 3.2 Medi

- `finish_reason` ignorato (`ai.ts:56-60`): una scheda troncata per limite di token viene
  salvata e può diventare esempio.
- Approvazione al download **senza `await`** (`scheda-tecnica-dialog.tsx:225-252`): errori
  silenziosi; e se l'embedding fallisce la scheda resta con `embedding` NULL per sempre, senza backfill.
- Audit incompleto: `domande` salvato sempre NULL (`route.ts:200-205`); le revisioni salvano il
  segnaposto «(scheda riscritta)» invece della versione.
- Costo «Questa scheda» nel dialog non include la fase domande.
- `registraUsage` non controlla `error` dell'insert (`ai.ts:68-91`).
- Nessun limite di dimensione su `builder_state`, risposte e scheda corrente.
- La scheda si genera solo dentro il builder: dal dettaglio di un preventivo salvato non c'è
  il comando, e per i preventivi non più modificabili non c'è proprio modo.

### 3.3 Word (md → docx)

`md-to-docx.ts`: liste annidate appiattite (tutte `level: 0`), liste numerate perse, ogni `_`
può accendere il corsivo (codici tipo `NASTRO_3M` si rompono), immagini forzate a 460×300
senza proporzioni. Il footer ha **telefono ed email diversi** da quelli del profilo aziendale
della chat (`md-to-docx.ts:43-49` vs `tool-definitions.ts:281-288`): uno dei due è sbagliato.

### 3.4 Miglioramenti, in ordine

1. `approva` solo con `scheda_id` di proprietà dell'utente, e ingresso tra gli esempi
   globali solo dopo la conferma di un admin (stato `proposta → approvata`).
2. Ownership su `revisiona`; scope portfolio sugli esempi.
3. Migration che versiona il prompt reale; prompt che separa «stile dagli esempi» da «fatti
   solo dal preventivo».
4. Domande: se il JSON non è valido, riprova una volta o restituisci errore — mai generare alla cieca.
5. Rifiutare output con `finish_reason = length`; salvare versioni complete e domande.
6. Comando «Scheda tecnica» anche nel dettaglio del preventivo salvato.
7. Convertitore Word basato su un parser Markdown vero (liste, numerazione, underscore).

---

## 4. Ricognizione generale (codice, rotte, flusso)

### 4.1 Punti del 17/09

| Punto | Stato |
|---|---|
| B3 SVG, B4 anno BI, B5 ore, B6 ricarico, B7 autocomplete, B8 sidebar, C1 fuga BI, C2 inviata riscrivibile | **Risolti** |
| B1 KPI dashboard, B2 archivio | Parziali: contano/offrono ancora stati del workflow rimosso |
| I1 guard condiviso | Parziale: usato da 7 route su 35 |
| I2 feedback salvataggio, I3 responsive, I5 select modelli, I6 dettagli UX | Parziali |
| I4 `/nuovo` tutto client, C3 cambio stato non atomico, C4 salvataggio senza lock, C5 BI troncata | **Aperti** |

### 4.2 Bug nuovi

| Sev. | Problema | Dove |
|---|---|---|
| **grave** | `riassumi` applica lo scope commerciale solo se `cliente_master_id` c'è: sui documenti senza cliente master un commerciale ristretto ottiene il riassunto AI di documenti che non può aprire (la pagina di dettaglio invece li nega) | `[id]/riassumi/route.ts:135-144` |
| medio | Il superadmin può ancora portare un documento a `inviata`/`ordinata`/`fallita` dallo sblocco di uno storico | `documenti/[id]/stato/route.ts:74-191` |
| medio | Cambio stato e salvataggio: ultimo che scrive vince, nessun controllo di concorrenza | `stato/route.ts:111-212`, `documenti/[id]/route.ts:312` |
| medio | Salvataggio permessi superadmin in tre passi non atomici: se l'insert fallisce l'utente resta senza ruoli | `superadmin/preventivatore/permessi-utente/[utenteId]/route.ts:89-141` |
| medio | Dashboard e archivio promettono ancora il workflow («Tasso ordinato», inviti a marcare ordinato/rifiutato, filtri che non producono nulla) | `dashboard-view.tsx:516-627`, `archivio-view.tsx:91-98` |
| medio | Duplica ordina i blocchi per `created_at`, la modifica per `ordine`: il duplicato può avere i blocchi in ordine diverso (ipotesi) | `duplica/route.ts:87-95` |
| minore | `riassumi` restituisce al client il messaggio d'errore grezzo del provider | `riassumi/route.ts:202-205` |
| minore | Configurazione BI e `builder_state` della chat senza schema né limiti di dimensione | `bi/data/route.ts:21-24`, `chat/route.ts:147-219` |

### 4.3 Codice morto

Nessuna route e nessun componente interamente orfano (le 35 route hanno tutte un chiamante).
Resta:

- **tabella `preventivatore.query_log`**: 0 righe, nessun writer nel codice → da eliminare;
- **colonne senza writer**: `validazione_tecnica_*`, `validazione_economica_*`, `audit_hash`,
  `importo_offerta`, `note_offerta`, `motivo_rifiuto_id`, `importo_ordinato`, `incluso_offerta`
  (le ultime lette solo per lo storico);
- **stati** `presa_in_carico/inviata/ordinata/fallita` ancora nel CHECK, in `stati.ts` e nella migration 110;
- **~25 export inutilmente pubblici** (tipi e helper usati solo nel proprio file): elenco completo
  nel referto A §3.

### 4.4 Ottimizzazioni

| Intervento | Impatto |
|---|---|
| Portare tutte le route su `requirePreventivatore` + un `requireDocumentoVisibile` unico (chiude anche il bug di `riassumi`) | Alto: 1-3 round-trip in meno per richiesta e regole di visibilità uguali ovunque |
| Aggregazioni BI in SQL invece che su 5.000/12.000 righe in memoria | Alto: numeri completi, payload molto più piccoli |
| Precaricare servizi e template di `/nuovo` nel server component | Medio |
| Cache server (1-6 h) dell'elenco modelli OpenRouter | Medio: ~120 KB e una chiamata esterna in meno a ogni apertura delle Impostazioni |
| Controllare lo scope nel dettaglio **prima** delle 4 query secondarie | Medio |
| Spezzare i 4 componenti oltre le 1.000 righe (`chat-ai`, `dettaglio-view`, `nuovo-view`, `blocco-card`) | Manutenibilità |

### 4.5 Controlli

Type-check: **passa**. ESLint sul perimetro: **passa**. Vitest: **non eseguito** — la sandbox di
Codex non poteva creare la cartella temporanea (errore d'ambiente, non dei test).

---

## 5. Ordine di intervento consigliato

1. **Indicizzazione dei preventivi nuovi** (§1.6) — è la ragione per cui la chat «non conosce»
   il lavoro recente.
2. **Orchestratore tool della chat** (C1-C5) — oggi le domande a più passi finiscono
   silenziosamente sul modello di riserva.
3. **Sicurezza schede** (S1-S3) e `riassumi` (§4.2).
4. Versionare in migration ciò che esiste solo nel DB: `match_chunks` con halfvec, indice, prompt scheda.
5. Chiudere la rimozione del workflow in dashboard, archivio, chat e schema.
6. Qualità: ricerca ibrida, citazioni, set di valutazione, streaming.

---

## 6. Query per la produzione (da lanciare sulla VM)

```sql
-- Copertura embedding per tipo
select d.tipo, d.tipo_cartella, count(distinct d.id) docs, count(c.id) chunks,
       count(c.embedding) con_emb, max(d.created_at)::date ultimo
from preventivatore.documenti d left join preventivatore.chunks c on c.documento_id = d.id
group by 1,2 order by 1,2;

-- Stato reale di funzione e indice
select indexdef from pg_indexes where schemaname='preventivatore' and indexdef ilike '%embedding%';
select pg_get_functiondef('preventivatore.match_chunks'::regproc);

-- Memoria delle schede e uso della chat
select count(*), count(embedding) from preventivatore.schede_approvate;
select count(*), max(created_at) from preventivatore.chat_messaggi;
select count(*) from preventivatore.query_log;
```

---

## 7. Correzioni del 27/09/2026

Fatte lo stesso giorno: quattro job Codex in parallelo, fermati a metà dal **limite di utilizzo** di Codex; il lavoro è stato completato da Claude. Codice **non ancora committato né deployato**; migration applicate solo al Supabase di sviluppo.

### Migration

| File | Cosa |
|---|---|
| `120_preventivatore_indicizzazione.sql` | chunk per blocco, embedding conservati in modifica, `match_chunks_scoped`, blocco ottimistico `PT409`, halfvec versionato |
| `121_preventivatore_schede_sicure.sql` | `verificata` + `cliente_master_id` sulle schede approvate, prompt reali versionati, contatti corretti |
| `122_preventivatore_stati_permessi.sql` | CHECK sui 3 stati, `query_log` eliminata, `salva_permessi_utente`, `dashboard_kpi` su definitivi/bozze, costi Gemini ammessi |

> [!warning] Numerazione
> 117-119 erano già usate su `main` (vettori e BI): per questo 120-122.

### Codice (file principali)

| Area | File | Cosa cambia |
|---|---|---|
| Indicizzazione | `src/lib/portali/preventivatore/embedding.ts`, `indicizzazione.ts`, `chat/embedding-cache.ts`, `scripts/genera-embeddings-mancanti.cjs` | servizio embedding unico che legge `modello_embedding` e valida 3072 dimensioni; indicizzazione subito dopo POST/PUT (3 chunk in parallelo, max 8 s, mai bloccante); cache LRU; script con `--schede` e tracciamento modello/data |
| Ricerca | `search/route.ts`, `chat/tool-handlers.ts` | filtri dentro `match_chunks_scoped`; `cerca_articolo` cerca anche in `righe_distinta` e mostra prima i più recenti; `top_articoli` conta sui codici veri di `righe_distinta` (prima: regex sul testo, su una sola pagina da 1.000); id a lotti da 150; codici commessa con trattino trovati dal dettaglio |
| Chat | `chat/orchestratore.ts` (nuovo), `chat/tool-args.ts` (nuovo), `openrouter-handler.ts`, `gemini-handler.ts`, `chat/route.ts`, `chat-ai.tsx` | vedi [[Preventivatore - Chat AI]]; body validato con Zod, storia troncata a 60.000 caratteri e sempre aperta da un messaggio utente, persistenza attesa, costi Gemini registrati, prompt caching su content block |
| Schede | `scheda-tecnica/*.ts`, `scheda-tecnica/ai.ts`, `md-to-docx.ts`, `scheda-tecnica-dialog.tsx`, `dettaglio-view.tsx`, `template/ai-genera` | ownership e ruolo; domande illeggibili → riprova e poi 502; `finish_reason = length` → 502; domande e versioni salvate; approvazione attesa al download; Word con liste annidate/numerate, underscore, proporzioni; comando «Scheda tecnica» nel dettaglio; bozza template validata |
| Permessi e flusso | `documento-visibile.ts` (nuovo), `[id]/riassumi`, `documenti/*`, `stato`, `archivio/[id]/page.tsx`, superadmin permessi | visibilità fail-closed e verificata prima delle query; stati solo aperta/completato; update di stato condizionato (409); blocco di versione nel builder; permessi in una transazione |
| UI | `dashboard-view.tsx`, `archivio-view.tsx`, `bi-dashboard-view.tsx`, `nuovo/page.tsx`, `nuovo-view.tsx`, `template-manager.tsx` | niente più «Tasso ordinato» ma definitivi/bozze; filtri archivio dagli stati reali; KPI BI «dato incompleto» oltre il tetto; `/nuovo` precaricato dal server; cache costi nei template |

### Verifiche

- `npm run type-check` e ESLint sul perimetro: puliti.
- Vitest: **54 test in 9 file**, tutti verdi (nuovi: `preventivatore-chat-orchestratore`, `preventivatore-visibilita-e-lotti`, `preventivatore-scheda-route`, `preventivatore-stato-route`, `md-to-docx`, più i due di Codex su embedding e indicizzazione).
- Migration 120 collaudata anche sul PostgreSQL della VM **dentro una transazione annullata** (nessuna traccia rimasta).
- **Simulazione end-to-end** su Supabase di sviluppo con AI vera (poi cancellata, dati di prova rimossi): 11 scenari su 11 — preventivo nuovo indicizzato in ~3,5 s e primo nella ricerca simile (0,775); scope applicato prima della top-K; versione obsoleta respinta in 409 e vettore del blocco invariato conservato; chat OpenRouter con chiamate parallele (2024: 141, 2025: 162); Gemini a due giri (cerca_simili → dettaglio); scheda completa senza codici né prezzi (0,02-0,03 $); le 3 dashboard BI salvate superano la nuova validazione.

> [!warning] Scoperto durante le verifiche: URL troppo lunghe in produzione (preesistente)
> I due commerciali con portafoglio ristretto (AG000010 = 461 clienti, AG010035 = 382) generano filtri `.in("cliente_master_id", …)` da ~17 KB: **nginx risponde 414** (verificato sulla VM: 461 id → 414, 200 id → passa; PostgREST diretto accetta). Per loro archivio, dashboard, BI e chat falliscono. Correzione proposta: `large_client_header_buffers 4 32k;` nel server nginx dell'intranet — **richiede autorizzazione** (configurazione di produzione).

> [!todo] Da fare
> - Applicare 120-122 al PostgreSQL della VM, commit + merge su `main` + `deploy.sh`.
> - Installare il timer `preventivatore-embeddings` (file in `docs/ricognizione-20260927/systemd/`) e lanciare il backfill in produzione.
> - Correzione nginx per i commerciali (sopra).
> - Resta: 18 route su 35 non usano ancora `requirePreventivatore` (stessa regola, 1-2 round-trip in più); componenti oltre le 1.000 righe da spezzare; import listini non transazionale; le liste numerate separate nel Word non ripartono da 1; UI admin per verificare le schede approvate dai preventivatori.
