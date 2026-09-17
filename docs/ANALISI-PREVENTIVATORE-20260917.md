# Analisi completa del Portale Preventivatore — 17/09/2026

Simulazione d'uso reale nel browser + lettura del codice + verifica sul database.
Il report gemello di Codex (audit statico esaustivo) è in
`docs/AUDIT-PREVENTIVATORE-CODEX.md`.

> [!success] Misure confermate in produzione (17/09/2026)
> I conteggi erano stati presi sull'ambiente di **sviluppo** (Supabase
> `sowzewrfkoxernnvhzgg`). Sono stati poi **riverificati sul PostgreSQL della
> VM**, che è la produzione, e risultano **identici**: 385 documenti
> (382 `storico` + 2 `completato` + 1 `aperta`), 144 storici senza
> `data_offerta`, 3 generati senza `data_offerta`, 9.494 righe di distinta,
> 6 ruoli funzionali assegnati, e **zero** valori su `importo_ordinato`,
> `motivo_rifiuto_id`, `validazione_*`, `audit_hash`.
>
> Il DB della VM è il clone del 29/08 e da allora **non si è mosso**: vedi §8,
> il portale non riesce a leggere il proprio schema.

> [!warning] Le latenze restano di sviluppo
> Misurate in `npm run dev` (non ottimizzato) verso un Supabase remoto: il
> valore assoluto è pessimistico, il **rapporto fra le chiamate** no.

---

## 1. Il flusso, com'è davvero

```
/preventivatore  →  redirect  →  /dashboard
                                  ├── /bi            dashboard configurabile
                                  ├── /nuovo         IL BUILDER (client component, 1015 righe)
                                  ├── /archivio      elenco + /archivio/[id] scheda
                                  └── /impostazioni  (solo livello admin) + /impostazioni/template
```

**Il percorso di un preventivo**, verificato facendolo davvero:

1. `/nuovo` — codice commessa (obbligatorio) → cliente (autocomplete a 2 passi:
   ragione sociale, poi sede) → blocchi → per ogni blocco articoli dal catalogo e
   lavorazioni a ore → totali calcolati nel client.
2. `POST /api/portali/preventivatore/documenti` → riga in `preventivatore.documenti`
   con `stato = 'aperta'`, `tipo = 'generato'`, `fonte = 'builder_v3'`.
3. `router.push('/preventivatore/archivio/<id>')` → scheda dettaglio.
4. Da lì il **workflow**: `aperta → completato → inviata → ordinata | fallita`.

**Due assi di permessi, non uno** (già documentato, confermato leggendo il codice):

| Asse | Dove | Cosa decide |
|---|---|---|
| `livello` portale | RPC `get_portale_livello` | **se** vedi il portale |
| ruolo funzionale | `preventivatore.utente_ruoli_funzionali` | **cosa** puoi farci |

I ruoli funzionali sono tre — `commerciale`, `preventivatore`, `back_office` — e
**non pesano uguale**:

- `preventivatore` → può creare e modificare documenti (`documenti/route.ts:194`,
  `documenti/[id]/route.ts:248`) e portarli a `completato`.
- `back_office` → serve **solo** per tre pulsanti: «Invia offerta», «Marca
  ordinata», «Marca fallita» (`documenti/[id]/stato/route.ts:38-40`).
- `commerciale` → non è un pulsante, è un **filtro di sicurezza**: «vedo solo i
  miei clienti». È cablato in ~10 route (`clienti`, `clienti/destinazioni`,
  `documenti`, `documenti/clienti`, `documenti/destinazioni`, `documenti/[id]`,
  `documenti/[id]/duplica`, `documenti/[id]/stato`, `dashboard`, `bi/data`,
  `chat`), oltre che nelle RPC (`p_agente_codice`, migration 053/055).

Questa asimmetria è il punto centrale della decisione (§4).

---

## 2. Bug verificati

### B1 — La dashboard conta stati che non esistono più `[grave]`

`dashboard_kpi` (migration `053`, l'ultima che la definisce) filtra
`stato = 'ordinato' / 'rifiutato' / 'pending'`: i nomi **legacy**. Il workflow
introdotto dalla migration 039 usa `ordinata` / `fallita`.

Le altre RPC sono state aggiornate, questa no:

| Consumatore | Migration | Filtro |
|---|---|---|
| Dashboard | `053` | `stato = 'ordinato'` |
| BI preventivatore | `041` | `stato IN ('ordinato','ordinata')` |
| Tool chat AI | `055` | `stato IN ('ordinato','ordinata','rifiutato','fallita')` |

Chiamata dal vivo (`dashboard_kpi(60)`):
`tot_preventivi: 238`, `tot_ordinati: 0`, `tot_rifiutati: 0`, `tot_pending: 0`.

Conseguenza: **nel portale convivono due hit-rate diversi**, e quello della
dashboard è strutturalmente zero. La UI lo maschera con un placeholder («Tasso
ordinato — non disponibile / In arrivo», `dashboard-view.tsx:598`), che fa
sembrare "non ancora implementato" ciò che invece è "implementato e rotto".

### B2 — L'Archivio è rimasto alla V2 `[grave]`

`archivio-view.tsx:39` — `type StatoDocumento = "pending" | "ordinato" | "rifiutato"`.
I sette stati della migration 039 non esistono in questo file. Due effetti, entrambi
osservati navigando:

1. `archivio-view.tsx:642` — `STATO_BADGE[r.stato] ?? STATO_BADGE.pending`: ogni
   stato non mappato ricade su «In attesa». In archivio **tutti e 386 i documenti
   mostrano «In attesa»**, compresi i 382 `storico` e quelli appena creati.
2. Il filtro «Tutti gli stati» offre le tre opzioni legacy. Verificato via API:

   ```
   ?stato=pending   → 0 di 386
   ?stato=ordinato  → 0 di 386
   ?stato=rifiutato → 0 di 386
   ```

   Il filtro di stato dell'archivio **non può restituire nulla**, qualunque cosa si scelga.

### B3 — SVG non valido su ogni pagina con sparkline `[medio]`

`dashboard-view.tsx:130`

```ts
const area = `${pad},${h} ${polyline} ${w - pad},${h} Z`
```

`Z` è un comando di `path`, non è ammesso in `<polygon points>`: il browser
rifiuta l'intero attributo e logga
`<polygon> attribute points: Expected number, "…,26 78,26 78,28 Z"`.
L'area di riempimento sotto la sparkline non viene disegnata. Fix: togliere ` Z`.

### B4 — Il filtro anno della BI passa un numero a un `<select>` `[medio]`

`bi-dashboard-view.tsx:302` — `value={(globalFilterValue("anno") as string) ?? ""}`.
Il valore salvato è un `number`: il cast `as string` non converte niente e `??`
non scatta (non è null). React logga
*«The value prop supplied to `<select>` must be a scalar value»*.
È lo stesso confine number/string che aveva già rotto `matchesFilter` a luglio:
lì è stato corretto il confronto, qui è rimasto il cast che lo nasconde.

### B5 — Il widget «Ore preventivazione» mostra il numero di documenti `[medio]`

`lib/portali/preventivatore/bi/defaults.ts:58-68`

```ts
{ id: "kpi-ore", title: "Ore preventivazione", metric: { op: "count", label: "Da tracciare" } }
```

`op: "count"` sul dataset `documenti`. A schermo: **«Ore preventivazione — 386 —
Da tracciare»**, dove 386 è il numero di preventivi. Un segnaposto che sembra un dato.

### B6 — L'etichetta del ricarico dice l'opposto della matematica `[medio]`

`nuovo-view.tsx:844` mostra `x{coeffRicaricoMedio.toFixed(2)}`, ma il tooltip
accanto dichiara *«prezzo = costo ÷ coeff»*. Con coefficiente 0,50 la card mostra
**`x0.50`** su un articolo il cui prezzo è il **doppio** del costo
(7,85 € → 15,70 €). Scrivere `÷0,50` o `×2` costa una riga.

### B7 — Autocomplete cliente senza cancellazione delle richieste `[medio]`

`autocomplete-cliente.tsx:93-105`: c'è il debounce (300 ms) ma **nessun
`AbortController` e nessun controllo che la risposta appartenga alla query
corrente**. Con la chiamata a ~1,4 s (§3) basta che la risposta di «SO» arrivi
dopo quella di «SORM» per mostrare la lista sbagliata. La soglia è
`q.length < 1`: si parte da **un solo carattere**, cioè una `ILIKE '%s%'`
sull'intera anagrafica.

### B8 — Due difetti di layout nella sidebar `[minore]`

`sidebar-nav.tsx`: la barretta di «voce attiva» è `absolute` dentro un `Link` che
non è `relative` — si posiziona rispetto a un antenato qualsiasi. E il divisore
della sezione admin è renderizzato **dopo** le voci admin (riga 141), quindi
separa l'ultima voce dal nulla invece di aprire la sezione.

---

## 3. Attriti d'uso e inefficienze (dalla navigazione reale)

### I1 — 31 route su 37 ignorano il guard che era stato scritto per loro `[grave]`

`lib/portali/preventivatore/api-guard.ts` esiste apposta: `requirePreventivatore()`
collassa `getUser` + livello + ruoli + agente in **una** RPC
(`get_preventivatore_context`, migration 064).

Lo usano 6 route: `dashboard`, `documenti`, `listini`, `listini/[id]`,
`motivi-rifiuto`, `prodotti`.

Le altre 31 fanno ancora la catena seriale. `clienti/route.ts` — quella
dell'autocomplete, la più chiamata di tutte — fa `getUser()` → `getPortaleAccesso()`
→ `getFiltroCommerciale()` (che dentro fa altre 1-2 query) → query vera:
**4-5 round-trip in serie verso Supabase per ogni tasto premuto.**

### I2 — Tempi misurati

| Chiamata | Tempo | Nota |
|---|---|---|
| `GET /clienti?q=SORMA` | **1.444 ms** | a ogni battuta (debounce 300 ms, da 1 carattere) |
| `GET /prodotti?q=profilato` | 918 ms | 20 risultati |
| `GET /documenti?limit=50` | 2.306 ms | 14 KB, paginato correttamente |
| `POST /documenti` (salva) | **3.037 ms** | |
| click «Salva» → scheda a schermo | **> 8 s** | 3 s POST + navigazione RSC |
| `GET /config/models` | 536 ms | **120 KB**, 354 modelli |

Sul salvataggio: `nuovo-view.tsx:161` fa `router.push(...)` verso una pagina server.
Fra il POST completato e la scheda che appare **non succede niente a schermo**
oltre allo spinner del bottone. Otto secondi senza feedback sono il punto in cui
l'utente riclicca.

### I3 — Il pannello chat non si chiude mai, e sotto ~1100 px il builder si rompe `[grave]`

`nuovo-view.tsx:48` — la chat AI è `w-80 shrink-0`: **320 px fissi a qualunque
larghezza**, nessun breakpoint, nessun modo di collassarla.
Sommando: sidebar 220 + padding 48 + chat 320 + gap 24 = **612 px di cornice**.

E l'header del builder non si adatta: `grid-cols-[minmax(0,220px)_1fr]` (riga 624),
`grid-cols-2` (righe 653 e 670) — nessun prefisso `md:`/`lg:`.

Risultato osservato a 800 px di viewport: **le etichette si sovrappongono e
diventano illeggibili** («CODICE COMMESSA» e «TITOLO PREVENTIVO» stampate una
sopra l'altra). Su un 1366×768 il builder resta con ~750 px utili; su 1280, ~670.
Chi lavora in split screen o con lo zoom del browser al 125% ci finisce dentro.

### I4 — `/nuovo` è interamente client-side

`nuovo/page.tsx` è tre righe che montano `<NuovoView>`, un client component da
1015 righe. Nessun dato precaricato dal server: al mount partono `servizi`,
`template` e `usage` in cascata dopo l'idratazione. Tutto ciò che serve per
disegnare la pagina vuota potrebbe arrivare già risolto dal Server Component.

### I5 — Tre select da 355 opzioni nelle Impostazioni

`/impostazioni` renderizza **1.065 nodi `<option>`** (3 × 355) dai 120 KB di
`config/models`, senza campo di ricerca. Scegliere un modello significa scorrere
una tendina nativa di 354 voci.

### I6 — Dettagli che si notano usando

- L'input del costo articolo mostra **`7.849325`** — sei decimali grezzi in un campo modificabile.
- Il coefficiente è scritto **`0.50`** col punto, mentre tutti gli importi usano la virgola italiana.
- **Nessun campo del builder ha `id`, `htmlFor` o `aria-label`**: cliccare
  un'etichetta non porta il focus nel campo, e da tastiera/screen reader i campi
  sono anonimi.
- «Conferma definitivo» cambia stato **al primo clic, senza conferma**, e in UI
  **non esiste il ritorno** — anche se l'API ammette `completato → presa_in_carico`
  (`stato/route.ts:23`). Il preventivo resta modificabile, ma il pulsante è a senso unico.
- Refuso in `/impostazioni`: «Se OpenRouter non **e** disponibile».

---

## 4. La domanda vera: togliere backoffice e commerciale

### Quanto è vivo oggi il workflow

| Verifica | Esito |
|---|---|
| Documenti in `presa_in_carico`, `inviata`, `ordinata`, `fallita` | **0** (su 385, DB di sviluppo) |
| Pulsante UI per entrare in `presa_in_carico` | **non esiste** — transizione ammessa dall'API, irraggiungibile |
| File frontend che conoscono gli stati nuovi | **3**: `workflow-actions.tsx`, il badge in `dettaglio-view.tsx:131`, `dettaglio-view-types.ts:7` |
| Utenti con ruolo `back_office` | **1** (j.gordini) |
| Utenti con ruolo `commerciale` | **2** (v.battelani AG000010, d.boni AG010035) |

Il ciclo offerta→esito **non è mai stato usato**. È codice scritto, mai entrato in servizio.

### Il dato di back office esiste già, e non viene da qui

> [!info] Nel progetto ci sono **due BI diverse**, da non confondere
> - **BI del Preventivatore** (`/preventivatore/bi`, `lib/portali/preventivatore/bi/`)
>   → legge `preventivatore.documenti`, cioè i 386 preventivi del portale.
> - **BI Direzionale** (viste `public.bi_*`, consumate da Power BI)
>   → legge `public.bi_documenti_raw`, cioè l'estrazione notturna dal **gestionale**.
>
> `bi_preventivi_backoffice` appartiene alla seconda.

La catena, verificata nel repo:

```
SRVWOA (192.168.1.110, SQL Anywhere — il gestionale, script in C:\Impresa\BI_Bridge)
   │  scheduled task notturno, export CSV via dbisql
   ▼
receiver.py sulla VM  (valida n° colonne e intestazione)
   │
   ▼
public.bi_documenti_raw + public.bi_runs        (1.887.280 righe)
   │  where r.status='current' and d.dataset='preventivi_aperti'
   ▼
public.bi_preventivi_backoffice  (migration 105)  →  grant select to powerbi_reader
```

`bi_preventivi_backoffice` **non nomina mai lo schema `preventivatore`**. Le sue
colonne di back office — «Convertito In Ordine», «Giorni Risposta», «Creato da»,
«Data Richiesta Cliente» — nascono tutte dalla riga del documento nel gestionale.
Il dataset `preventivi_aperti` sono ~6.500 righe / ~2.100 documenti.

> [!warning] Precisazione: **non sono gli stessi record**
> Il gestionale conosce l'esito dei preventivi **registrati nel gestionale**. Un
> preventivo che resta solo nel portale non compare lì. L'argomento «il dato c'è
> già» vale quindi finché l'offerta al cliente la emette comunque il gestionale (Impresa, su SRVWOA) — che è il
> flusso naturale, ma va confermato da te.

Resta comunque il fatto che **oggi quell'esito non lo registra nessuno**, in
nessuno dei due posti, lato portale:

| Colonna di `preventivatore.documenti` | Documenti valorizzati (su 385) |
|---|---|
| `importo_ordinato` | **0** |
| `motivo_rifiuto_id` | **0** |
| `numero_preventivo` | **3** (su 382 storici) |
| `importo_offerta`, `note_offerta` | **0** |

Il workflow del Preventivatore è quindi una **seconda contabilità manuale degli
stessi fatti**, che nessuno alimenta. Togliendola non si perde un dato: si smette
di chiedere due volte lo stesso dato ottenendolo, nel migliore dei casi, una volta
sola.

**Bonus dallo stesso controllo** — nella tabella `documenti` ci sono anche
`validazione_tecnica_il/_da` e `validazione_economica_il/_da`: un secondo
workflow di validazione che **non compare in nessuna UI né in nessuna route**.
Da passare a Codex per conferma, ma ha tutta l'aria di codice morto a livello di
schema.

### Raccomandazione

**Togliere il workflow post-preventivo. Tenere il filtro commerciale.**

Sono due cose diverse e vanno decise separatamente:

**(a) Da rimuovere — il ciclo offerta/esito e il ruolo `back_office`**
- `workflow-actions.tsx` (260 righe) — intero
- in `stato/route.ts`: gli stati `inviata`/`ordinata`/`fallita` e la mappa
  `RUOLI_PER_STATO_TARGET` che li riguarda
- il ruolo `back_office` da `ruoli.ts` e da `utente_ruoli_funzionali`
- `motivi-rifiuto/route.ts` + tabella `motivi_rifiuto` (servono solo a «Marca fallita»)
- colonne `documenti`: `numero_preventivo`, `importo_offerta`, `note_offerta`,
  `motivo_rifiuto_id` — da **deprecare, non droppare**: i 382 storici potrebbero
  averle valorizzate dall'import V2 (da verificare prima)
- **Cosa resta acceso**: `aperta → completato`, cioè «bozza» e «definitivo».
  Due stati, un pulsante, nessun ruolo aggiuntivo.

**(b) Da tenere — il ruolo `commerciale`**
Non è un pezzo di workflow, è la regola «vedo solo i miei clienti», con la logica
fail-closed di `getFiltroCommerciale` (un commerciale senza codice agente vede
**zero**, non tutto). Toglierlo significa aprire l'intero archivio preventivi a
chiunque abbia accesso al portale. Tenerlo non costa niente al flusso «solo
preventivi»: è ortogonale.

**(c) Da correggere in ogni caso, prima o dopo la rimozione**
B1 e B2 non sono conseguenze del workflow: sono disallineamenti fra tre
generazioni di stati. Anche riducendo a due stati vanno riscritti
`dashboard_kpi` e `archivio-view.tsx`, altrimenti l'archivio continuerà a dire
«In attesa» a tutti e la dashboard continuerà a mostrare zero.

---

## 5. Ordine di intervento suggerito

| # | Intervento | Perché prima | Costo |
|---|---|---|---|
| 1 | B2 — stati veri in `archivio-view.tsx` | il filtro oggi non restituisce mai nulla e 386 righe mentono | basso |
| 2 | B1 — riscrivere `dashboard_kpi` sugli stati nuovi (o sui due che restano) | due hit-rate diversi nello stesso portale | basso |
| 3 | I3 — chat collassabile + breakpoint nell'header del builder | sotto 1100 px il builder è inutilizzabile | medio |
| 4 | I1 — `requirePreventivatore` su `clienti` e `prodotti` | sono le due route più chiamate, 4-5 round-trip ciascuna | basso |
| 5 | B7 + soglia a 2-3 caratteri sull'autocomplete | race condition visibile con 1,4 s di latenza | basso |
| 6 | I2 — feedback fra POST e navigazione al salvataggio | 8 s muti = doppio clic = doppio preventivo | basso |
| 7 | §4(a) — rimozione del workflow post-preventivo | decisione tua, non urgenza tecnica | medio |
| 8 | B3, B4, B5, B6, B8, I6 | difetti isolati, fix di poche righe | basso |

---

## 6. Dall'audit statico di Codex

Codex (`gpt-5.6-sol`, 23 min) ha girato in parallelo. **Non è riuscito a scrivere
il suo file** — sandbox in sola lettura, `apply_patch` rifiutato — quindi resta
la sintesi. Sessione recuperabile con `codex resume 01a0ae9a-6407-7800-8013-b4b6d615038c`.

Ha **confermato** B1 e B2 (stati legacy in dashboard, archivio e tool chat) e la
mia raccomandazione di non toccare il ruolo `commerciale`. Ha aggiunto sei punti;
i due più gravi li ho **riverificati io**, gli altri restano da controllare.

### C1 — Fuga dell'anagrafica clienti nella BI `[grave, verificato]`

`bi/filters-options/route.ts` controlla solo `livello !== null`, poi usa
`createAdminClient()` (bypassa RLS) **senza applicare lo scope commerciale**.
Restituisce l'elenco distinto di **tutti** i clienti di tutti i documenti.

È esattamente l'enumerazione che `documenti/clienti/route.ts` e
`documenti/destinazioni/route.ts` si preoccupano di impedire, con tanto di
commento: *«un commerciale ristretto non deve poter enumerare le destinazioni»*.
Aprendo `/preventivatore/bi` ho visto la tendina «Cliente» con ~100 ragioni
sociali: un commerciale ristretto le vede tutte.
In più fa tre `select` senza `limit` sull'intera tabella per calcolare tre liste
di valori distinti.

### C2 — Un preventivo già inviato resta riscrivibile `[grave, verificato]`

`documenti/[id]/route.ts:267-277` — la PUT legge `id, tipo, cliente_master_id` e
**non guarda mai `stato`**. Un documento in `inviata`, `ordinata` o `fallita` può
essere riscritto per intero dal builder: distinta, ore e totali cambiano mentre
`numero_preventivo` e `importo_offerta` restano quelli dell'offerta già mandata
al cliente. Il link «Modifica» resta visibile anche a workflow avanzato
(osservato sul documento portato a `completato`).

### C3-C6 — Da verificare

| # | Segnalazione di Codex | Stato |
|---|---|---|
| C3 | Cambio stato non atomico: `select` e `update` separati, due utenti in parallelo si sovrascrivono | da verificare |
| C4 | Salvataggio builder last-write-wins: nessuna versione, nessun controllo di concorrenza | da verificare |
| C5 | Il motore BI trasferisce fino a 5.000 documenti / 12.000 righe e tronca i calcoli in memoria | da verificare |
| C6 | Una route senza alcun consumer, due export orfani, campi DB write-only, errori frontend inghiottiti | da verificare |

Su C4: coerente con quanto ho visto — il builder tiene tutto lo stato nel client
e fa una PUT integrale, quindi due schede aperte sullo stesso preventivo si
sovrascrivono senza accorgersene.

---

## 7. Come ho verificato

- Dev server `npm run dev` su `:3000`, login reale, navigazione con browser
  (dashboard → nuovo → archivio → dettaglio → BI → impostazioni).
- **Preventivo creato davvero** (`TEST-CLAUDE-001`, cliente SORMA spa, 1 articolo
  `D.3981.181593`, 1 ora di Montaggio, totale 72,66 €), portato da `aperta` a
  `completato`, e poi **cancellato** a fine test: `preventivatore.documenti` è
  tornata a 385 righe.
- Latenze misurate con `performance.now()` nella pagina; conteggi per stato e
  `dashboard_kpi` interrogati direttamente col service role.
- Nessun file di progetto modificato.

---

## 8. In produzione il Preventivatore non legge il proprio schema

Verificato sulla VM il 17/09/2026, dopo che l'utente ha ricordato che la
produzione gira sul PostgreSQL locale e non più su Supabase.

### Il fatto

PostgREST (`postgrest.service`, unico processo, `/etc/postgrest/intranet.conf`)
espone **quattro schemi**, e `preventivatore` non è fra questi:

```
$ curl -H "Accept-Profile: preventivatore" .../rest/v1/documenti?select=stato&limit=2
HTTP 406
{"code":"PGRST106","message":"Invalid schema: preventivatore",
 "hint":"Only the following schemas are exposed: public, vettori, bi, bi_direzionale"}
```

Identico sulla porta locale `127.0.0.1:3001` e sull'endpoint pubblico
`https://intranet.s-ics.com`, con la **service role key di produzione**. È
esattamente l'header che manda `createAdminClient().schema("preventivatore")`.

Nel codice ci sono **133 chiamate** `.schema("preventivatore")`: in produzione
falliscono tutte.

### Perché

| | |
|---|---|
| Avvio del processo PostgREST | **29/08/2026 17:00** |
| Ultima modifica di `/etc/postgrest/intranet.conf` | **09/09/2026 20:52** |

Il file è stato modificato **11 giorni dopo** l'avvio e il processo non è mai
stato riavviato: gira ancora con la configurazione del 29 agosto. Da qui anche
il fatto che il DB della VM sia fermo al clone di quel giorno — il portale non
può scriverci.

> [!danger] Il riavvio così com'è **romperebbe la BI Direzionale**
> Il file su disco dice `db-schemas = "public,preventivatore,service,bi,vettori"`:
> **non contiene `bi_direzionale`**, che il processo in esecuzione invece espone
> e che il codice usa in **24 punti**. Riavviare senza toccare il file
> scambierebbe un guasto con un altro.
>
> Gli schemi usati davvero dal codice sono quattro:
> `preventivatore` (133), `vettori` (55), `bi_direzionale` (24), `bi` (3).
> La riga corretta è quindi:
> `db-schemas = "public,preventivatore,service,bi,bi_direzionale,vettori"`

### Altre due cose che un riavvio porterebbe con sé

- `db-aggregates-enabled = true` è nel file ma non è attivo nel processo:
  dopo il riavvio gli aggregati PostgREST si accendono. È un cambio di
  comportamento per il prototipo BI, che era stato scritto per aggirarli.
- `systemctl reload` **non basta**: l'`ExecReload` dell'unit manda `SIGUSR1`,
  che in PostgREST ricarica solo la cache dello schema. La configurazione si
  rilegge con `SIGUSR2` o con un `restart`.

### Cosa è stato fatto (17/09/2026, con nessuno collegato)

**Il file non era la fonte.** Corretto `db-schemas` nel file e riavviato il
servizio: il log diceva «Config reloaded» ma l'elenco esposto era **identico**.
Il motivo è che `db-config` è attivo e la chiave `pgrst.db_schemas` impostata
sul ruolo `authenticator` **vince sul file**:

```
authenticator | pgrst.db_schemas=public, vettori, bi, bi_direzionale
```

La correzione vera, sul DB della VM:

```sql
ALTER ROLE authenticator
  SET pgrst.db_schemas = 'public, preventivatore, service, bi, bi_direzionale, vettori';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
```

> [!warning] Servono entrambe le NOTIFY
> Con solo `reload config` lo schema viene accettato ma le sue tabelle non sono
> nella cache: la risposta passa da 406 `PGRST106 Invalid schema` a 404
> `PGRST205 Could not find the table`. Sembra un errore diverso e si va a
> cercare un problema di nomi.

Il file è stato comunque allineato (con `bi_direzionale` aggiunto) e ne resta
il backup `intranet.conf.bak-20260917`, così non restano due verità diverse.

**Verifiche dopo l'intervento** — tutte dall'endpoint pubblico, con la service
role key di produzione e gli header che manda l'app:

| Controllo | Esito |
|---|---|
| `preventivatore.documenti` | **200**, restituisce i dati |
| `vettori.vettori`, `bi.cruscotto_runs`, `public.utenti` | 200 |
| `bi_direzionale.dashboard` / `.analisi` / `.configurazione_anno` | 200 |
| `rpc/dashboard_kpi` come la chiama l'app | 200 → 96 preventivi, 3 pending |
| `rpc/dashboard_top_clienti` come la chiama l'app | 200 → SORMA, CM3, IMA |

**Migration `110` applicata al PostgreSQL della VM** (`psql -v ON_ERROR_STOP=1`,
snapshot delle funzioni precedenti in `/tmp/rollback-110.sql`). Verificata sui
dati veri: `dashboard_kpi(12)` → 96 preventivi / 3 pending, e la serie mensile
mostra i 2 preventivi del builder a luglio, che prima non comparivano.

> [!info] `dashboard_top_clienti` ha due overload e resta ambiguo da psql
> `select ... from dashboard_top_clienti(3)` → *«function is not unique»*.
> **L'app non è toccata**: chiama con i tre argomenti nominati e risolve
> correttamente (verificato, 200). L'ambiguità è preesistente — la 041 ha creato
> la versione a 2 argomenti, la 053 quella a 3 — e la migration 110 le ha
> allineate entrambe invece di rimuoverne una. Toglierla è una decisione a sé.

> [!todo] Manca il deploy del codice
> La produzione gira su `8f9dca3` (14/09): la migration è viva, le correzioni
> del codice no. `deploy.sh` fa `git reset --hard origin/main`, quindi i due
> commit di oggi vanno prima portati su `main`.
> Il disallineamento è **innocuo**: `dashboard_kpi` non ha cambiato forma, il
> codice vecchio la legge e ora riceve numeri corretti. Restano da deployare i
> badge dell'archivio, il filtro per stato e il resto.

### Cosa fare, nell'ordine### Cosa fare, nell'ordine

1. Correggere `db-schemas` nel file aggiungendo `bi_direzionale`.
2. `sudo systemctl restart postgrest` (breve interruzione dell'API per tutti i portali).
3. Riverificare con la curl qui sopra: deve rispondere 200.
4. Solo dopo, applicare la migration `110` al DB della VM e fare il deploy del codice.
