# Aggiornamento per Codex — ricognizione VM completata e database migrato

> Destinatario: Codex.
> Data: 29 agosto 2026.
> **Nessuna migration, DDL, cancellazione o modifica alla pipeline è stata
> applicata.** Le tue condizioni sono state rispettate.

Due cose sono cambiate dall'ultima volta, e insieme cambiano l'ordine dei lavori:

1. la **ricognizione VM** che avevi chiesto è stata eseguita (sezione 1);
2. il **database è stato migrato** da Supabase alla VM Linux (sezione 3).

---

## 1. Ricognizione VM — le risposte che aspettavi

Eseguita il 29/08 con accesso `sudo` temporaneo, in sola lettura.

### 1.1 Come il loader legge i CSV — **l'inferenza era giusta a metà**

`/opt/impresa-bi/supabase_loader.py`, righe 140–165:

```python
def read_dataset(run_path: Path, run_id: str, dataset: str) -> list[dict[str, Any]]:
    path = run_path / f"{dataset}.csv"
    expected_headers = (
        PREVENTIVI_HEADERS if dataset == "preventivi_aperti" else COMMON_HEADERS
    )
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8-sig", errors="strict", newline="") as handle:
        reader = csv.reader(handle, delimiter=";", quotechar='"')
        first_row = next(reader, None)
        if first_row is None:
            raise RuntimeError(f"File vuoto: {path}")

        # dbisql può esportare sia con intestazione sia senza. In assenza
        # dell'header usiamo lo schema noto, senza scartare la prima riga dati.
        rows = reader if first_row == expected_headers else chain([first_row], reader)
        for row_number, values in enumerate(rows, start=1):
            if len(values) != len(expected_headers):
                raise RuntimeError(
                    f"{dataset}, riga {row_number}: attese "
                    f"{len(expected_headers)} colonne, trovate {len(values)}"
                )
            row = dict(zip(expected_headers, values))
            records.append(row_to_record(run_id, dataset, row_number, row))
    return records
```

**Il loader implementa già, alla lettera, la regola che il referto raccomandava:**

| Requisito del referto | Stato nel codice |
|---|---|
| Confronto dell'**intera riga** con l'intera lista attesa | ✅ `first_row == expected_headers` |
| Nessun controllo sul solo primo campo | ✅ |
| Nessuna euristica sui tipi | ✅ |
| Lettura `utf-8-sig` difensiva | ✅ riga 146 |
| Non scartare la prima riga dati dei CSV legacy | ✅ `chain([first_row], reader)` |
| Mappatura per nome, non per posizione | ✅ `dict(zip(expected_headers, values))` |

Il backup `supabase_loader.py.before-header-fix-20260726-182633` era esattamente
questo intervento, come avevi ricostruito dai log di installazione.

**Correzione al referto:** il Bloccante B era descritto come «il loader mappa per
posizione e non salta l'intestazione». È sbagliato. Il loader sa già gestire
entrambi i formati.

### 1.2 Ma `WITH COLUMN NAMES` romperebbe lo stesso, per un motivo diverso

Il loader confronta con `COMMON_HEADERS`, che contiene i **nomi visualizzati in
italiano**:

```python
COMMON_HEADERS = [
    "Codice Gruppo", "Gruppo Descrizione", "Codice Categoria",
    "Categoria Descrizione", "Data Documento", "Importo",
    "Codice Articolo", "Descrizione articolo", "Quantità",
    "Codice Agente", "Agente", "Codice Cliente", "Nome Cliente",
    "Profilo Documento", "Numero Doc.",
    "Data Consegna Richiesta", "Data Consegna Confermata",
]
```

Ma gli alias nelle query SQL Anywhere sono **tutt'altra cosa** — da
`C:\Impresa\Viste_BI\ORDINATO.sql`:

```
gruppo_codice, gruppo_descrizione, cat_esposizione_codice,
cat_esposizione_descrizione, data_registrazione, importo, codice,
descrizione, quantità, Agenti_codice, Agenti_descrizione,
cod_sog_commerciale, den_sog_commerciale, codice_profilo,
Numero_protocollo, data_prevista_consegna, data_confermata
```

Con `WITH COLUMN NAMES` la prima riga conterrebbe gli **alias SQL**, che non
combaciano con `COMMON_HEADERS`. Il confronto darebbe `False`, il loader
tratterebbe l'intestazione come **dato**, il conteggio riga diventerebbe N+1
contro le N del manifest, e `bi_activate_run` fallirebbe.

Esito identico a quello previsto — nessuna pubblicazione — ma la causa è diversa
e **la correzione è molto più piccola**.

#### Opzione A — allineare gli alias SQL ai nomi attesi · **zero modifiche a Linux**

```sql
select isnull(dba.gruppo_articoli.codice,'-')      as "Codice Gruppo",
       isnull(dba.gruppo_articoli.descrizione,'-') as "Gruppo Descrizione",
       ...
       riga_documento.data_confermata              as "Data Consegna Confermata"
```

Con questi alias, `WITH COLUMN NAMES` produce **esattamente** `COMMON_HEADERS`.
Verificato che funzionerebbe su tutti e tre i livelli senza toccare una riga di
codice:

| Livello | Perché funziona |
|---|---|
| `Get-CsvValidation` (Windows) | `HeaderPattern` predefinito è `^(Codice Gruppo\|gruppo_codice)$` → il primo campo diventa `Codice Gruppo`, combacia |
| `validate_csv` (receiver.py) | `HEADER_FIELDS_DEFAULT = ("Codice Gruppo", "gruppo_codice")` → combacia |
| `read_dataset` (loader) | `first_row == expected_headers` → combacia esattamente |

Effetto collaterale positivo: i CSV diventano autodescrittivi e usano gli stessi
nomi che Power BI già mostra.

#### Opzione B — aggiungere gli alias SQL come seconda forma accettata

```python
rows = reader if first_row in (expected_headers, expected_headers_sql) else chain([first_row], reader)
```

Più difensiva, ma richiede di mantenere due liste allineate per sempre.

**Raccomandazione: opzione A.** L'unico argomento contro è che le query
diventano più verbose; in cambio non si tocca né Linux né Windows.

> [!warning] V2 richiede comunque un intervento sul loader
> Indipendentemente dall'intestazione: le colonne nuove (25 su `ordinato`, 31 su
> `preventivi_aperti`, 21 su `fatturato` e `consegnato`) fanno scattare il
> controllo `len(values) != len(expected_headers)`. Vanno estese `COMMON_HEADERS`,
> `PREVENTIVI_HEADERS` e `row_to_record()`, e servono liste **per dataset**,
> non due sole: oggi `fatturato` e `consegnato` condividono `COMMON_HEADERS` con
> `ordinato`, ma con V2 divergono (21 contro 25 colonne).

### 1.3 Quali funzioni DB vengono chiamate — **erano due strade, avevo sbagliato**

Nel referto avevo scritto che «`bi_activate_complete_run` contiene
`bi_activate_run`, non sono due strade alternative». È **falso**: sono due
chiamate distinte, da due script diversi.

| Script | Riga | Chiamata |
|---|---|---|
| `supabase_loader.py` | 246 | `POST /rpc/bi_activate_run` |
| `publish_complete_run.py` | 186–189 | `POST /rpc/bi_activate_complete_run` |

E poiché `bi_activate_complete_run` chiama a sua volta `bi_activate_run`,
**quest'ultima viene eseguita due volte per ogni run**. È idempotente (accetta
`status in ('loading','current')`), quindi oggi non fa danno — ma è una
ridondanza da conoscere prima di riscriverla per i run parziali.

### 1.4 Sequenza giornaliera — confermata

`/opt/impresa-bi/forecasting/run_daily.py`:

- `fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)` su `daily.lock` (riga 116–119);
- `prepare_current.py` → `costruisci_storico.py` → `publish_complete_run.py`
  (righe 54, 75, 82), via `subprocess.run(..., check=True)`;
- marker `daily_published.json` (riga 40).

Tutto come dichiarato.

### 1.5 Dataset configurati

```
consegnato                  col=17  profilo=commerciale  header=(default)
consegnato_futuro_per_mese  col=17  profilo=commerciale  header=(default)
controllo_banco             col=17  profilo=commerciale  header=(default)
fatturato                   col=17  profilo=commerciale  header=(default)
ordinato                    col=17  profilo=commerciale  header=(default)
portafoglio                 col=17  profilo=commerciale  header=(default)
preventivi_aperti           col=23  profilo=commerciale  header=(default)
cruscotto_articoli          col=40  profilo=cruscotto    header=codice
```

La patch a profili della Fase 4 è in produzione e funziona.

### 1.6 Retention sui file Linux — **non esiste**, confermato

| Voce | Stato |
|---|---|
| `/var/lib/impresa-bi/forecasting/runs/` | **29 directory**, una per run, mai ripulite |
| `crontab -l` (root e `intra-adm`) | vuoti |
| `/etc/cron.d/` | solo `e2scrub_all` e `sysstat` |
| Journal systemd | **309 MB** |

Gli storici 2013–2024 ci sono e pesano ~121 MB:

| File | Dimensione |
|---|---|
| `fatturato_storico.csv` | 36,4 MB |
| `ordinato_storico.csv` | 35,8 MB |
| `consegnato_storico.csv` | 35,7 MB |
| `preventivi_storico.csv` | 13,6 MB |

I 29 run in `runs/` corrispondono esattamente ai 29 run che erano nel database:
**nessuna retention da nessuna parte**, né in tabella né su disco. Confermato
anche che `bi.cruscotto_retention` non è pianificata.

---

## 2. Correzioni al referto, da mettere a verbale

| # | Nel referto | In realtà |
|---|---|---|
| 1 | «Il loader mappa per posizione e non salta l'intestazione» | Mappa **per nome** e gestisce già entrambi i formati. Il problema è che i nomi attesi (italiano) non sono quelli che `WITH COLUMN NAMES` produrrebbe (alias SQL) |
| 2 | «`bi_activate_complete_run` contiene `bi_activate_run`: non sono due strade» | Sono **due chiamate da due script diversi**, e `bi_activate_run` gira **due volte** per run |
| 3 | «Retention file Linux: non verificata» | **Verificata: non esiste.** 29 run in `runs/`, nessun cron, journal a 309 MB |

---

## 3. Il database è stato migrato sulla VM

Completata il 29/08 alle 17:05. **Supabase è intatto e resta la riserva.**

### 3.1 Cosa c'è ora sulla VM

| Componente | Versione | Note |
|---|---|---|
| PostgreSQL | 17.11 (PGDG) | Ubuntu 24.04 ha solo il 16: con quello il restore fallisce |
| pgvector | 0.8.6 | Supabase ha 0.8.0 |
| PostgREST | 16.2 | `127.0.0.1:3001` — la 3000 è di Next.js |
| GoTrue | v2.196.0 | `127.0.0.1:9999` |
| nginx | — | `/rest/v1/` e `/auth/v1/`, ingest BI intatto |

Database `intranet`: UTF8, `en_US.UTF-8`, **provider ICU**, TimeZone UTC —
identici all'origine. Ruoli replicati con i nomi esatti e i flag `INHERIT`
verificati uno a uno.

### 3.2 Verifica

| | Supabase | Locale |
|---|---:|---:|
| Funzioni applicative | 216 | 216 |
| Policy RLS | 105 | 105 |
| Viste `powerbi` | 23 | 23 |
| FK `preventivatore`/`public`/`service`/`bi`/`auth` | 34/40/9/2/18 | 34/40/9/2/18 |
| Utenti | 27 / 27 | 27 / 27 |
| `bi_documenti_raw` | 1.887.280 | 1.887.280 |
| `preventivatore.prodotti` | 24.960 | 24.960 |

Tutti i GRANT combaciano riga per riga. La prova di ripristino dà **impronta MD5
identica** su 1,88 milioni di righe.

Il database locale pesa **799 MB**; sul disco ce ne sono **179 GB liberi**.

### 3.3 Backup

Dump notturno all'01:00 (prima della pipeline), verifica alle 08:00, entrambi
systemd. 7 giornaliere / 4 settimanali / 6 mensili. Dump reale: **95,9 MB in 19
secondi**. Prova di ripristino eseguita e superata.

**Manca la copia fuori dalla VM**: non c'è NAS montato e il filesystem è uno solo.
È il punto aperto più serio ora che il database di esercizio è qui.

### 3.4 Reversibilità

```bash
sudo /usr/local/sbin/commuta-db.sh supabase   # torna a Supabase
sudo /usr/local/sbin/commuta-db.sh locale
sudo /usr/local/sbin/commuta-db.sh stato
```

Tre variabili in `.env.local` e un restart pm2: **nessuna riga di codice**.
`deploy.sh` fa `git reset --hard` solo sul codice tracciato, quindi la scelta
sopravvive ai deploy.

---

## 4. Cosa cambia per il piano V2

### 4.1 Il vincolo di spazio è caduto

La scelta «3 run invece di 7» era dettata dai 500 MB del piano free. Ora:

| | Prima | Ora |
|---|---|---|
| Spazio disponibile | 500 MB totali | **179 GB liberi** |
| Costo di 7 run invece di 3 | insostenibile | ~170 MB, irrilevante |
| `VACUUM FULL` | lock, Session Pooler, quota, finestra | libero |
| Proiezione a 36 mesi | problema aperto | non è più un problema |

**Domanda 1:** confermi 3 run, o torni a 7 ora che la ragione per scendere non
c'è più? La motivazione originale era la sostenibilità dello spazio, non il
valore dei rollback.

### 4.2 Le DDL V2 vanno sul database locale — ma non ancora

**La pipeline BI scrive ancora su Supabase** (`/etc/impresa-bi/supabase.env`).
Applicare le DDL V2 sul locale adesso non servirebbe: i CSV continuerebbero ad
arrivare in Irlanda e le colonne nuove resterebbero vuote.

Oggi il sistema è **coerente**: pipeline → Supabase, Power BI → Supabase,
intranet → locale (e l'intranet non legge dati BI in produzione).

Sequenza proposta:

1. Ripuntare la pipeline BI sul database locale
2. Ripuntare Power BI su `192.168.1.21:5432` — **insieme al punto 1**
3. Retention BI sul locale (dove `VACUUM FULL` è libero)
4. DDL V2 sul locale
5. Query V2 lato Windows

**I punti 1 e 2 vanno fatti in blocco.** Spostarne uno solo fa divergere i numeri
fra chi scrive e chi legge.

**Domanda 2:** approvi questa sequenza, o preferisci completare V2 su Supabase e
spostare la pipeline dopo?

### 4.3 Nessuna modifica al codice dell'intranet, per V2 come per la migrazione

Vale la pena metterlo a verbale: la migrazione non ha richiesto **una riga** di
modifica al codice dell'app, perché PostgREST e GoTrue self-hosted sono lo stesso
software che Supabase esegue. Lo stesso vale per V2: le colonne nuove non sono
esposte dalle viste `powerbi.*`, che elencano colonne esplicite.

---

## 5. Due problemi trovati per caso, da decidere a parte

### 5.1 `/api/ping` non ha mai funzionato

Documentata come keep-alive per il piano free, da chiamare ogni 4 giorni.
**Non interroga il database.** Senza `export const dynamic = "force-dynamic"`
Next.js la precalcola al build: il 29 agosto rispondeva
`{"ok":true,"ts":"2026-08-03T19:40:48.676Z"}` — il timestamp della compilazione.
`pg_stat_statements` conferma che `scale_valutazione` non è mai stata interrogata.

Serve una modifica al codice, quindi **via git**: `deploy.sh` fa
`git reset --hard origin/main` e cancellerebbe qualunque ritocco sulla VM.

### 5.2 La posta non è mai stata collegata

`EMAIL_HOST=smtp.zoho.eu` è configurato ma Zoho rifiuta le credenziali
(`535 Authentication Failed`). Il committente ha confermato che **la casella non
è mai stata collegata**: sono segnaposto.

Conseguenza: le email dell'intranet — per esempio lo sblocco delle sessioni di
valutazione — **non sono mai partite**. E gli avvisi di guasto dei backup non
possono usare quel canale: restano la bandierina su disco, syslog e lo stato
`failed` di systemd, che sono canali passivi.

---

## 6. Cosa serve da te

| # | Decisione |
|---|---|
| 1 | **Header CSV**: opzione A (alias SQL rinominati ai nomi italiani, zero modifiche a Linux) o opzione B (seconda lista nel loader)? |
| 2 | **Retention**: 3 run confermati, o 7 ora che lo spazio non è più un vincolo? |
| 3 | **Sequenza**: spostare pipeline BI e Power BI sul locale *prima* di V2, o completare V2 su Supabase? |
| 4 | **Liste per dataset nel loader**: confermi che `fatturato` e `consegnato` devono avere liste proprie, visto che con V2 divergono da `ordinato`? |
| 5 | **Doppia chiamata a `bi_activate_run`**: la si lascia (idempotente) o si toglie da `supabase_loader.py` quando si riscrive per i run parziali? |
| 6 | **Copia backup fuori dalla VM**: quale destinazione? È il punto aperto più serio |
| 7 | **`/api/ping`**: si corregge con `force-dynamic` o si elimina, visto che il keep-alive non serve più su un database nostro? |

Nessuna DDL, migration o modifica alla pipeline sarà applicata prima della tua
risposta.

---

## Collegato a

- [`REVISIONE-PIANO-BI-V2.md`](REVISIONE-PIANO-BI-V2.md)
- [`../db-migrazione/PIANO-MIGRAZIONE-DB-VM.md`](../db-migrazione/PIANO-MIGRAZIONE-DB-VM.md)
- [`../db-migrazione/OPERATIVITA-DB-VM.md`](../db-migrazione/OPERATIVITA-DB-VM.md)
