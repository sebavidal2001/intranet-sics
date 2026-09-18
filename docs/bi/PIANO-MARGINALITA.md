# Piano — marginalità a costo storico nel BI

> Stato: **tutti i blocchi fatti; in produzione mancano solo il deploy
> dell'applicazione e la prima notte automatica** (18/09/2026).
> Analisi di partenza: `docs/bi/REFERTO-costo-alla-vendita-20260917.md`.

## Esito dei blocchi 1 e 2 — 18/09/2026

### In produzione, fatto

| Dove | Che cosa |
|---|---|
| SRVWOA | `C:\Impresa\Viste_BI\STORICO_COSTI.sql` — gira in **0,6 s**, 11.158 righe, solo l'anno corrente |
| SRVWOA | `config.json`: nona query, dataset `costi_listino_storico`, **profilo `costi`** |
| SRVWOA | `Invoke-BIPipeline.ps1`: profilo `costi` ammesso + nuovo parametro `-StatusFile` |
| SRVWOA | `Invoke-BIPipeline-Cruscotto.ps1`: dopo il Cruscotto lancia il profilo `costi`, con l'errore che **non si propaga** |
| VM | Migration **112 applicata** (`--single-transaction`), GRANT verificati: `anon`/`authenticated` non vedono nulla |
| VM | **Backfill di 402.170 righe in 13 secondi** (da qui ci volevano tre minuti) |
| VM | `/etc/impresa-bi/config.json`: decimo dataset, profilo `costi`; receiver riavviato |
| VM | `/opt/impresa-bi/costi-ingest.sh`, `impresa-bi-costi.path` e `.service`, directory `ready/processed/failed-costi` |

### I numeri di produzione combaciano col gestionale

| Anno | Valore | Copertura | Margine | Gestionale |
|---|---:|---:|---:|---:|
| 2025 | 3.744.126,35 € | 97,92 % | **35,40 %** | 35,40 % |
| 2026 | 2.759.773,02 € | 97,94 % | **32,57 %** | 32,57 % |

Sul 2026 il valore combacia **al centesimo** e il costo del venduto a 15
centesimi su 1,8 milioni.

### Tre cose trovate installando

> [!warning] `Math.min(...righe.map(...))` fa saltare lo stack a 402.170 righe
> `Maximum call stack size exceeded` al primo backfill vero: lo spread passa un
> argomento per elemento. Non si vedeva sui file dell'anno corrente, che di
> righe ne hanno undicimila — il codice era stato provato solo su quelli.
> Sostituito con un ciclo.

> [!warning] Lo stato del run era un file solo
> `last-run.json` è unico e i launcher lo rileggono per comporre gli allarmi:
> due profili nella stessa notte si sarebbero sovrascritti lo stato, e un
> allarme del Cruscotto avrebbe riportato il run_id dei costi. Ora
> `Invoke-BIPipeline.ps1` accetta `-StatusFile`; `commerciale` e `cruscotto`
> restano sul file storico, il profilo `costi` scrive in `last-run-costi.json`.
> **Verificato**: dopo una prova del profilo costi, `last-run.json` conteneva
> ancora il run del Cruscotto delle 02:50.

> [!info] La pipeline non si può provare via WinRM
> `Import-Clixml` della credenziale del database fallisce con *"The computer
> must be trusted for delegation"*: DPAPI non decifra in un logon di rete.
> L'unico contesto valido è l'attività pianificata, che gira come
> `DMNAIRFLUID\adm.varas` con `LogonType=Password`. Per la prova end-to-end si
> lancia quella con `Start-ScheduledTask`.
>
> Nota di passaggio: `$PSScriptRoot` è vuoto quando lo script parte con
> `-File`, quindi `-ConfigPath` va sempre passato esplicito. Il launcher lo fa
> già, ed è il motivo per cui il difetto non era mai emerso.

## Esito dei blocchi 4 e 5 — 18/09/2026

Codice applicativo scritto e provato: `npm run lint` pulito, `npm run
type-check` pulito, **776 test di unità passati, zero falliti**.

| File | Cosa è cambiato |
|---|---|
| `sorgente.ts` | `caricaCostiArticoli()` → `caricaStoricoCosti()`; `costoAllaData()` risolve per bisezione; ripiego su `preventivatore.prodotti` che si dichiara |
| `sorgente.ts` | `VERSIONE_FORMA` **2 → 3** |
| `tipi.ts` | `Snapshot.costiApprossimati`; commenti di `costoUnitario`/`dataCosto` riscritti |
| `semantico.ts` | `quantitaOrientata()`; le tre metriche di margine la usano; avvisi riscritti |
| `src/tests/prototipo-bi-costo-storico.test.ts` | nuovo: risoluzione alla data + segno delle note di credito |
| `src/tests/prototipo-bi-margine.test.ts` | aggiornato + caso del ripiego |
| `prototipo-bi/costo-storico-dal-database.test.ts` | nuovo: la catena vera contro il database |
| `prototipo-bi/_env.ts` | nuovo: il caricamento di `.env.local` era ricopiato in sette file |

**La catena vera dà il numero giusto.** Il test contro il database verifica
che il margine 2025 sia **35,40 %** — lo stesso misurato sul gestionale — e
che il fatturato combaci al centesimo, perché un margine che coincide su un
fatturato diverso non dimostrerebbe niente. Verifica anche due cose che
nessun unit test può dimostrare: che lo **stesso articolo abbia costi diversi
in anni diversi** (senza, tutto passerebbe anche con l'ultimo costo noto), e
che **nessuna riga usi un costo datato dopo la vendita** — che era il difetto
originale, il 32,5% del valore.

### Prestazioni misurate

| Voce | Valore |
|---|---:|
| Snapshot completo | 23,3 s · heap 180 MB · 18.062 righe di fatturato |
| di cui storico costi | **14,3 s** (82.770 righe, 83 pagine PostgREST) |
| Costruzione della mappa | 57 ms |
| Memoria della mappa | **11 MB** |

Misurato da un PC di casa verso Supabase in Irlanda: in produzione il database
sta sulla stessa macchina del processo, quindi il numero sarà molto più basso.
**Va rimisurato lì** (test 6).

> [!warning] Meno righe non vuol dire più veloce, quando si pagina
> Delle 82.770 righe esposte dalla vista, solo 21.759 riguardano i 6.734
> articoli che compaiono davvero nelle vendite: le altre sono righe di apertura
> di articoli fermi da anni. Sembra spreco, così ho scritto la variante
> filtrata e l'ho misurata.
>
> | | righe | pagine | tempo | memoria |
> |---|---:|---:|---:|---:|
> | vista attuale | 82.770 | 83 | **14,3 s** | 11 MB |
> | vista filtrata | 21.759 | 22 | **39,7 s** | 2 MB |
>
> Tre volte più lenta leggendo un quarto dei dati: PostgREST **riesegue la
> query a ogni pagina**, quindi la union delle sette viste si paga 22 volte
> (1,8 s a pagina contro 172 ms). Variante scartata.
>
> Se un giorno i 14 s dessero fastidio, la strada è togliere la paginazione —
> una funzione che restituisce tutto in un `jsonb` — non ridurre le righe.

## Esito del blocco 3 — 17/09/2026

Migration 112 applicata su Supabase di sviluppo, backfill completo caricato,
numeri verificati contro il gestionale.

| Misura | Gestionale | Supabase dopo il carico |
|---|---:|---:|
| Righe fatturato 2025 | 10.011 | **10.011** |
| Valore 2025 | 3.744.126,35 € | **3.744.126,35 €** |
| Costo del venduto 2025 | 2.368.795,46 € | 2.368.461,68 € |
| **Margine 2025** | **35,40 %** | **35,40 %** |
| Copertura 2025 | 97,94 % | 97,92 % |

Lo scarto sul costo è di **333,78 € su 2,37 milioni (0,014%)**: viene da 503 €
di valore che sul gestionale trova un costo e nella vista no. Sotto la soglia
di rilevanza, ma è un numero misurato, non una speranza.

### Quanto pesa

| Voce | Peso |
|---|---:|
| Tabella `bi.costi_listino_storico` (402.170 righe) | **38 MB** — 24 dati + 13 di chiave primaria |
| Per riga | 98 byte |
| Database di produzione, oggi | 328 MB → **+11,6%** |
| Disco della VM | 18 GB usati su 204: irrilevante |
| CSV del backfill, una volta | 14,9 MB |
| CSV notturno, ogni notte | 437 KB (11.153 righe) |
| Righe lette dallo snapshot ogni 6 ore | 82.770, e **non cambiano** se si carica meno storico |

> [!info] Un indice tolto: 14 MB per niente
> La prima stesura aveva un indice `(codice_articolo, valido_dal DESC)` accanto
> alla PK, perché l'accesso è `order by valido_dal desc limit 1`. Misurato su
> 402.170 righe, il planner usa `Index Scan Backward` sulla **chiave primaria**
> con gli **stessi 4 buffer** e lo stesso tempo: un btree si percorre in
> entrambi i versi. L'indice costava 14 MB su 52 e una scrittura in più per
> ogni riga a ogni ingest. Rimosso.

Il costo dello snapshot non dipende da quanto storico si conserva — la vista
espone comunque solo gli ultimi tre anni più l'apertura. Quindi caricare tutto
dal 1999 costa **solo disco**, e serve il giorno in cui il BI estenderà
l'orizzonte dei fatti (che è il progetto successivo). Conviene tenerlo tutto.

Backfill: **402.170 righe** dal 1999, 55.901 articoli, 0 duplicate nel file.
La vista `public.bi_costi_listino_storico` ne espone **82.770** — più delle
~52.000 stimate, perché la riga di apertura serve a tutti i 55.901 articoli,
anche a quelli fermi da anni. Restano 83 pagine PostgREST, accettabili.

**Idempotenza e anni chiusi, provati sul campo.** Ricaricando l'anno corrente
due volte: 0 inserite, 0 aggiornate, 0 eliminate. Poi ho piantato due righe
fasulle, una nel 2024 e una nel 2026, e ho rilanciato il ricarico del 2026:

- `__PROVA_ANNO_CORRENTE__` (2026) → **eliminata**
- `__PROVA_ANNO_CHIUSO__` (2024) → **rimasta**
- `aggiornato_il` degli anni 2023–2025 → **fermo** al timestamp del backfill

È la prova che il ricarico notturno non riscrive la storia.

> [!warning] Scoperta: il costo delle note di credito viene SOMMATO invece che sottratto
> Nella vista `bi_fatturato` l'importo porta il segno del documento
> (`tot_riga_val_az * segno_iva`) ma **la quantità no**: una nota di credito ha
> importo negativo e quantità positiva. Il costo del venduto la somma invece di
> sottrarla. **È un errore che esiste già oggi**, indipendente dal costo
> storico: 7.365,76 € di costo con il segno sbagliato sul 2025–2026, cioè
> 14.731 € di errore sul costo del venduto.
>
> La regola corretta è `quantità × (importo < 0 ? −1 : +1)`. Verificata sui
> casi in cui divergerebbe dal segno del documento: **29 righe NAC con importo
> ≥ 0 hanno costo in gioco 0,00 €** e **19 righe di fattura con importo < 0 non
> hanno articolo a listino**. Nei casi che pesano il segno dell'importo è
> sempre quello giusto.
>
> Senza questa correzione il margine 2025 dà 35,20% invece di 35,40%: va nel
> blocco 4 insieme al resto.

## Contesto

Il BI calcola già margine, margine %, costo del venduto e copertura costi
(`semantico.ts:277-318`), ma il costo che usa è **l'ultimo noto**
(`preventivatore.prodotti.ult_costo`), non quello valido alla data di vendita.
Conseguenza misurata: sul 2022 il margine risulta 28,97% invece di 34,53%
(−5,55 punti, −177.158 €), e il numero **cambia da solo** ogni mese perché
`ult_costo` si muove. Ogni analisi retroattiva è quindi inattendibile e non
riproducibile.

Il costo alla data di vendita **esiste nel gestionale dal 1999**: listino 331
(`UC`), versionato per `variazione.data_inizio`. Il referto dimostra copertura
del 97,9–99,6% del valore fatturato in ogni anno dal 2022.

**Esito voluto**: le quattro metriche di margine continuano a chiamarsi come
oggi — dashboard e analisi salvate non si rompono — ma sotto usano il costo
valido il giorno della vendita, e il risultato è riproducibile nel tempo.

## Due decisioni già prese

1. **Sostituire, non affiancare.** Stesse chiavi (`margine`, `margine_pct`,
   `costo_venduto`, `copertura_costi_pct`), stesse etichette; cambiano
   descrizione, avvisi e il costo sottostante.
2. **Gli anni chiusi si caricano una volta sola.** Verificato sul gestionale:
   un anno si assesta entro il 31 marzo dell'anno successivo, poi la deriva è
   di ~4 righe su 19.000 (0,02%). La notte si ricarica **solo l'anno corrente**.

## Perché una tabella a upsert e non un dataset a run

I sette dataset commerciali vivono nel modello **run-swap**: ogni notte
`bi_activate_run` sostituisce in blocco tutto il contenuto corrente
(`supabase_loader.py:214`). Va bene per i fatti, che il BI tiene solo dal 2025,
ma è l'opposto di quello che serve qui: lo storico costi è **cumulativo** e non
va riscritto ogni notte.

Quindi lo storico costi non entra fra i dataset a run: è una tabella propria,
con chiave `(codice_articolo, valido_dal)` e ingest a **upsert**. Il backfill
si fa una volta; la notte tocca solo l'anno corrente.

## I cinque blocchi di lavoro

### 1 · Gestionale — la query di estrazione

Nuovo file `C:\Impresa\Viste_BI\STORICO_COSTI.sql` (versionato nel repo in
`scripts/bi-bridge/query/STORICO_COSTI.sql`). Tre colonne:
`codice_articolo`, `valido_dal`, `costo`.

```sql
SET TEMPORARY OPTION on_error = 'exit';
SELECT a.codice, CAST(v.data_inizio AS DATE), p.prezzo
FROM dba.prezzo p
  JOIN dba.variazione v        ON p.id_variazione = v.id_variazione
  JOIN dba.par_sistema ps      ON v.id_listino = ps.id_listino_ultimo_costo
  JOIN dba.unita_confezione uc ON uc.id_unita_confezione = p.id_unita_confezione
                              AND uc.unita_base = 'S'
  JOIN dba.articolo a          ON a.id_articolo = uc.id_articolo
WHERE v.data_inizio >= '<INIZIO>' AND p.prezzo > 0
ORDER BY a.codice, v.data_inizio;
```

Due varianti dello stesso file:

| Variante | `<INIZIO>` | Righe | Quando gira |
|---|---|---:|---|
| **backfill** | `1999-01-01` | ~402.000 | una volta, a mano |
| **notturna** | 1° gennaio dell'anno corrente | ~11.000 | ogni notte, col profilo `cruscotto` |

> [!warning] Profilo **`costi`**, NON `cruscotto` — corretto il 17/09/2026
> La prima stesura metteva la query nel profilo `cruscotto` per ereditarne
> l'attività pianificata. È un errore serio: `receiver.py` **rifiuta il
> manifest** se mancano dataset del profilo
> (`manifest incompleto per il profilo {profile}`). Con i due dataset nello
> stesso profilo, un guasto della query costi impedirebbe il completamento del
> run Cruscotto, quindi `preventivatore.prodotti` non si aggiornerebbe e **si
> fermerebbe il Preventivatore in produzione**. L'accoppiamento è bidirezionale.
>
> Profilo separato, quindi: due run indipendenti, un guasto per volta. Il costo
> è nullo sul lato pianificazione — lo stesso launcher chiama
> `Invoke-BIPipeline.ps1 -Profilo costi` dopo `-Profilo cruscotto`, e i due run
> hanno manifest separati. Sul lato VM servono `ready-costi`, un `.path`/
> `.service` e `costi-ingest.sh` gemelli di quelli del Cruscotto.

> [!warning] `on_error = 'exit'` come prima riga
> Senza, un errore apre il prompt `1. Stop / 2. Continue` e `dbisql` resta
> appeso per sempre. Vedi la nota nel referto.

### 2 · VM — ricezione e ingest

- `/etc/impresa-bi/config.json`: nuovo dataset
  `"costi_listino_storico": { "columns": 3, "profile": "cruscotto", "header_first_field": "codice_articolo" }`.
  Stando nel profilo `cruscotto`, il receiver pretende **entrambi** i CSV prima
  di considerare completo il run: niente run a metà.
- `/opt/impresa-bi/cruscotto-ingest.sh`: dopo l'ingest del cruscotto, chiamare
  anche `node /opt/intranet-sics/scripts/bi-ingest-costi.mjs --file=…`.
- Nuovo `scripts/bi-ingest-costi.mjs`, sul modello di
  `scripts/bi-ingest-cruscotto.mjs`: parsa, riversa in staging, chiama la
  funzione di ingest atomico. Flag `--backfill` per il carico una tantum
  (nessun limite di anno, batch più grandi).

### 3 · Database — migration 112

`supabase/migrations/112_bi_costi_listino_storico.sql`:

- `bi.costi_listino_storico (codice_articolo text, valido_dal date, costo numeric(14,4), aggiornato_il timestamptz)`,
  PK `(codice_articolo, valido_dal)`, indice `(codice_articolo, valido_dal DESC)`.
- `bi.costi_storico_staging` + `bi.ingest_costi_storico(p_run_id, p_anno_da)`:
  upsert in transazione singola; cancella solo le righe dell'**anno ricaricato**
  che non sono più nel file, mai il resto.
- Vista `public.bi_costi_storico` — **necessaria**: lo schema `bi` non è esposto
  da PostgREST, e una query su schema non esposto torna vuota senza errore.
  La vista restituisce, per ogni articolo, le righe dagli ultimi tre anni solari
  **più la riga di apertura** (l'ultima precedente al taglio), così il costo
  risolve anche per una vendita di inizio periodo. ~52.000 righe.
- GRANT al solo `service_role`, sul modello della migration 075g.

Da applicare su **entrambi** i database: VM di produzione e Supabase di
sviluppo.

### 4 · Applicazione — `src/lib/prototipo-bi/`

| File | Cosa cambia |
|---|---|
| `sorgente.ts:231` `caricaCostiArticoli()` | diventa `caricaStoricoCosti()`: legge `public.bi_costi_storico` e costruisce `Map<codice, {dal, costo}[]>` ordinata decrescente |
| `sorgente.ts:322` | la risoluzione per riga usa `r.data`: prima voce con `dal <= r.data`. Ricerca binaria, non scansione: 52.000 voci × 66.000 righe |
| `sorgente.ts:208-225` | il commento sulle due avvertenze va riscritto: cadono entrambe, ne subentra una nuova (costo di ricostituzione, non COGS) |
| `tipi.ts:38-46` | `costoUnitario` resta; `dataCosto` diventa la data **della versione applicata** |
| `sorgente.ts` `VERSIONE_FORMA` | **da incrementare a 3**. Senza, per sei ore dopo il deploy lo snapshot in cache servirebbe i vecchi costi senza dare errore |
| `semantico.ts:270-318` | descrizioni e avvisi: da "a ultimo costo noto" a "al costo valido alla data di vendita" |
| `semantico.ts:285,295,305` | **il segno**: `r.quantita * (r.importo < 0 ? -1 : 1)` al posto di `r.quantita`, altrimenti il costo delle note di credito si somma invece di sottrarsi (vedi l'avviso in cima) |
| `semantico.ts:732` | l'avviso di copertura resta e resta obbligatorio accanto al margine |

Fallback: se `public.bi_costi_storico` non risponde, `caricaStoricoCosti()`
ripiega su `preventivatore.prodotti` come oggi, e lo **dichiara negli avvisi**.
Il margine non deve sparire per un guasto dell'ingest, ma non deve neanche
cambiare significato in silenzio.

### 5 · Test

- `src/tests/prototipo-bi-costo-storico.test.ts` (nuovo): risoluzione
  point-in-time — vendita prima della prima variazione (→ `null`), fra due
  variazioni (→ la precedente), dopo l'ultima (→ l'ultima), articolo assente
  (→ `null`, mai zero).
- `npm run test`, `npm run type-check`, `npm run lint`.

## Cosa manca per andare in produzione

Fatto e provato: migration, backfill, numeri contro il gestionale, idempotenza,
anni chiusi, GRANT (`anon`, `authenticated`, `powerbi_reader` non vedono nulla),
e la trappola di Capodanno. Quello che segue **non è ancora provato**.

### Applicativi — il blocco 4 non esiste ancora

| # | Test | Perché |
|---|---|---|
| 1 | Risoluzione point-in-time: prima del primo costo → `null`; fra due variazioni → la precedente; dopo l'ultima → l'ultima; articolo assente → `null` | è il cuore del cambiamento |
| 2 | Nota di credito: costo **sottratto**, non sommato | l'errore che ho trovato oggi |
| 3 | Il margine che esce dal BI = **35,40 %** sul 2025 | è la prova end-to-end |
| 4 | `VERSIONE_FORMA` incrementata: uno snapshot di forma vecchia viene scartato | altrimenti per 6 ore servirebbe i vecchi costi **senza dare errore** |
| 5 | Vista assente → si ripiega su `preventivatore.prodotti` e **lo si dichiara negli avvisi** | il margine non deve sparire per un guasto dell'ingest, né cambiare significato in silenzio |

### Prestazioni, da misurare sulla VM

| # | Test | Nota |
|---|---|---|
| 6 | Tempo di costruzione dello snapshot, prima e dopo | oggi ~4,4 s; si aggiungono 83 pagine PostgREST |
| 7 | Memoria del processo Next.js con 82.770 voci in più | la VM ha 7,9 GB, 5,7 disponibili: margine c'è, ma il BI gira **dentro** l'intranet |

### Pipeline, mai percorsa end-to-end

| # | Test | Nota |
|---|---|---|
| 8 | La query notturna con `DATEFORMAT(getdate(),'YYYY-01-01')` | provata solo con date esplicite |
| 9 | Giro completo Windows → receiver → ingest → tabella, con un run vero | |
| 10 | **Un guasto dei costi non ferma il Cruscotto** | da provare mandando un manifest costi rotto e verificando che `preventivatore.prodotti` si aggiorni lo stesso |

### Reversibilità

| # | Test | Nota |
|---|---|---|
| 11 | Rollback: togliere la vista e verificare che il BI regga | vedi il test 5 |
| 12 | Ordine: **backfill prima del deploy applicativo** | così il codice nuovo trova i dati già pronti, e non c'è una finestra in cui il margine è vuoto |

## Ordine di esecuzione

1. Migration 112 su Supabase di sviluppo → backfill → verifica dei numeri
   contro quelli del referto (2025: margine 35,40%, 2026: 32,57%).
2. Codice applicativo + test, verificati in locale contro Supabase.
3. Query e `config.json` sul gestionale; prima esecuzione **manuale** con
   `-SkipUpload` per controllare righe e tracciato.
4. Migration 112 sulla VM + backfill + config del receiver + `cruscotto-ingest.sh`.
5. Deploy dell'applicazione sulla VM.
6. Prima notte automatica: verificare che il run `cruscotto` porti entrambi i
   CSV e che l'anno corrente si aggiorni senza toccare gli anni chiusi.

## Verifica finale

- Il margine 2025 nel BI deve dare **35,40%** su 3.666.902 € coperti, il 2026
  **32,57%** su 2.702.944 € — gli stessi numeri misurati sul gestionale.
- Copertura costi ≥ 97,9% su entrambi gli anni.
- Rieseguendo la stessa analisi a distanza di giorni, **lo stesso numero**: è
  la proprietà che oggi manca.
- `bi.costi_listino_storico`: le righe con `valido_dal` in anni chiusi non
  devono cambiare `aggiornato_il` dopo il backfill.

## Cosa NON è in questo piano

**Estendere l'orizzonte del BI oltre il 2025.** Oggi `bi_fatturato` parte dal
13/01/2025 (18.647 righe) perché le query Windows filtrano `>= 2025`. Con lo
storico costi in piedi, il margine sarà corretto e riproducibile **su 2025 e
2026**; per confrontare cinque anni serve prima portare indietro i fatti, e lì
il modello run-swap va ripensato (archivio per anni chiusi + viste in UNION).
È un progetto a sé, da decidere dopo aver visto funzionare questo.

**Il costo dei pezzi effettivamente venduti.** Resta un margine a costo di
ricostituzione: vedi la sezione dedicata nel referto.

## Collegato a

- `docs/bi/REFERTO-costo-alla-vendita-20260917.md`
- `src/lib/prototipo-bi/sorgente.ts`, `semantico.ts`, `tipi.ts`
- `scripts/bi-bridge/config.json`, `scripts/bi-ingest-cruscotto.mjs`
- `supabase/migrations/073_bi_cruscotto_articoli.sql` (modello per la 112)
