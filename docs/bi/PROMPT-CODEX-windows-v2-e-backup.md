# Per Codex — lato Windows: pull dei backup e pacchetto V2

> Data: 29 agosto 2026 · rev. 2 (host key, impronte dei dump, script Python).
> Decisioni della tua nota **accettate integralmente**. Nessuna DDL V2 applicata,
> nessun run eliminato, nessuna query Windows toccata.
> Il committente ha scelto la destinazione dei backup: **la VM Windows `SRVWOA`**.
>
> **Novità rispetto alla prima stesura**: impronta della host key SSH (§1.4),
> impronte SHA-256 dei dump ora generate automaticamente (§1.5), e la mappa di
> cosa V2 tocca negli script Python della VM, letti uno per uno (§6).

---

## 1. Cosa è già pronto sulla VM Linux

### 1.1 Power BI può collegarsi — verificato

Sì: **Power BI Desktop si collega direttamente alla VM, senza gateway.** Il
connettore PostgreSQL è nativo e parla lo stesso protocollo che usa oggi verso
il Session Pooler di Supabase.

| Campo | Valore |
|---|---|
| Server | `intranet.s-ics.com:5432` |
| Database | `intranet` |
| Schema viste | `powerbi` (invariato) |
| Utente | `powerbi_reader` |
| Password | `/etc/intranet-db/secrets.env` → `PG_POWERBI_PASSWORD` |
| Cifratura | **obbligatoria** |

Configurazione applicata:

- `listen_addresses = 'localhost,192.168.1.21'`, porta 5432
- **TLS con il certificato GoDaddy già usato da nginx**, non con quello
  autofirmato. Connettendosi al *nome* `intranet.s-ics.com`, Windows valida
  catena e nome host con il proprio archivio certificati: niente «fidati
  comunque» da spuntare, che è la scorciatoia con cui poi non ci si accorge mai
  di un problema vero.
- `pg_hba.conf`: **`hostssl`** (non `host`) · solo `powerbi_reader` · solo il
  database `intranet` · da `192.168.1.0/24` e `10.212.134.0/24` ·
  `scram-sha-256`.

Collaudo:

| Prova | Esito |
|---|---|
| Connessione TLS + `select count(*) from powerbi.bi_ordinato` | ✅ 17.992 righe |
| Tentativo di `create table` | ✅ `permission denied for schema public` |
| Connessione **senza** TLS | ✅ rifiutata: `no pg_hba.conf entry ... no encryption` |
| Grant di `powerbi_reader` | ✅ 23 viste `powerbi` + 22 `public`, solo SELECT |

> [!warning] Aggiornamento pianificato dal cloud
> L'aggiornamento **manuale da Desktop** funziona così com'è. Se un giorno
> servisse l'aggiornamento **pianificato da Power BI Service**, quello
> richiederebbe un *on-premises data gateway* su una macchina Windows della LAN,
> perché il servizio cloud non raggiunge la VM. Oggi il Service non è usato.

### 1.2 Commutazione della pipeline — pronta, non applicata

`/usr/local/sbin/commuta-pipeline.sh` con
`locale | supabase | stato | sospendi | riattiva`.

Stato attuale, invariato:

```
La pipeline scrive su: SUPABASE (https://sowzewrfkoxernnvhzgg.supabase.co)
GET /rest/v1/bi_runs -> HTTP 200
Scheduler: daily.path active · cruscotto.path active · forecast.timer active
```

Qui **non serve ricompilare nulla**: `supabase_loader.py` (righe 326-327) e
`publish_complete_run.py` (300-301) leggono `SUPABASE_URL` e
`SUPABASE_SERVICE_ROLE_KEY` dall'ambiente a ogni esecuzione.

> [!info] Perché lo sottolineo
> Sul lato app è stato l'opposto e ci è costato un'ora. `NEXT_PUBLIC_*` viene
> sostituito da Next.js **dentro il bundle al build**: cambiare `.env.local` e
> riavviare non bastava, l'URL vecchio restava in 85 file. E il sintomo
> ingannava — `SUPABASE_SERVICE_ROLE_KEY` non ha quel prefisso, quindi si
> aggiornava davvero: l'app mandava la chiave *nuova* al database *vecchio*,
> login e pagine funzionavano, ma ogni chiamata col client admin dava 403 e dati
> vuoti. La pipeline non ha questo problema, ma valeva la pena dirlo.

### 1.3 Account SFTP per il pull dei backup — creato

| Voce | Valore |
|---|---|
| Host | `192.168.1.21` (porta 22) |
| Utente | `bi-backup-pull` |
| Autenticazione | **solo chiave pubblica**, password disabilitata |
| Percorso | `/dump/giornalieri`, `/dump/settimanali`, `/dump/mensili` |
| Permessi | **sola lettura** (bind mount `ro`) |

Com'è confinato:

- nessuna shell (`ForceCommand internal-sftp -R`, `PermitTTY no`);
- rinchiuso in `/srv/backup-pull` (`ChrootDirectory`);
- `AllowTcpForwarding no`, `AllowAgentForwarding no`, `PermitTunnel no`;
- le chiavi autorizzate stanno in `/etc/ssh/chiavi-backup/`, **fuori dalla
  gabbia**: l'account non può riscriversi le proprie credenziali.

> [!warning] Due segreti che stavo per esporre
> `/var/backups/intranet-db/` conteneva `env/` e `pipeline/` con le copie di
> `.env.local` e `supabase.env` — cioè **le service role key**. Erano dentro
> l'albero che stavo per offrire in SFTP. Spostati in
> `/var/backups/intranet-env/` e `/var/backups/intranet-pipeline/` (0700 root),
> fuori dalla vista dell'account di pull. Verificato che non siano più
> raggiungibili.

Verifica finale, eseguita come `bi-backup-pull`:

```
giornalieri/ settimanali/ mensili/ + stato.json   → visibili
intranet-2026-08-29.dump (95,9 MB)                → leggibile
globals-2026-08-29.sql                            → leggibile
env/ e pipeline/                                  → non presenti
touch                                             → Read-only file system
```

### 1.4 Host key del server — per `SshHostKeyFingerprint`

Le impronte sono **pubbliche per definizione**: la loro funzione è farsi
riconoscere, quindi trasmetterle è corretto.

| Algoritmo | Impronta SHA-256 |
|---|---|
| **ED25519** | `SHA256:Ps9Bu26+4eDEbVGc29Ew72O6znCu1Dbou1zKOhP16yA` |
| RSA 3072 | `SHA256:NnTQgnka37/q1LagBVZZRKD7VwjTCGvtVfabcVFxHkU` |
| ECDSA 256 | `SHA256:av361j8LJvsfVvpL5xo0/r/NbMCQWnBaTPfREkr9Ypc` |

Stringa completa per `SessionOptions.SshHostKeyFingerprint`:

```
ssh-ed25519 256 SHA256:Ps9Bu26+4eDEbVGc29Ew72O6znCu1Dbou1zKOhP16yA
```

**Usa ED25519**: è il primo che il server offre in `HostKeyAlgorithms`, quindi è
quello che verrà negoziato. Inchiodare RSA o ECDSA funzionerebbe, ma ti legherebbe
a un algoritmo che il server considera di ripiego.

> [!warning] Verificala anche fuori da questo canale
> Te l'ho letta attraverso una sessione SSH gia' fidata — ragionevole, ma il
> senso del pinning e' non fidarsi di un canale solo. Dalla console della VM:
> `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`

### 1.5 Impronte SHA-256 dei dump — gia' pronte

Visto che il tuo pacchetto le verifica, ogni backup ora scrive un file `.sha256`
accanto al dump, nel formato di `sha256sum`. Confronti invece di ricalcolare su
96 MB a ogni pull, e un file troncato in transito si vede subito.

```
42976f2717981fd1f0df238f17050b77f4faf3e417204243639f5288104a18e1  intranet-2026-08-29.dump
a9766763a9cb1c665b6c5b99d7909cebc22a05b0fe4433159d3b7619d390b844  globals-2026-08-29.sql
```

Verificate con `sha256sum -c`: entrambe OK. Stessi permessi dei dump, quindi
visibili all'account di pull.

Ho esteso anche la ritenzione ai `.sha256`: col pattern precedente si sarebbero
accumulate per sempre mentre i dump sparivano, lasciandoti impronte orfane di
file inesistenti. Provato cancellando un finto file di 30 giorni fa.

**Manca solo la chiave pubblica**: appena me la mandi la autorizzo.

---

## 2. Cosa devi costruire su Windows

### 2.1 Pull notturno dei backup — il blocco che chiude la migrazione

Il verso è quello che avevi proposto e lo confermo: **Windows tira da Linux**,
non viceversa. Così la VM Linux non ha nessuna credenziale verso la rete, e se
venisse compromessa non potrebbe cancellare né cifrare le copie. È l'unica
disposizione in cui il backup protegge davvero dal caso peggiore.

**Cosa serve:**

1. **Una coppia di chiavi sul lato Windows.** Mandami la pubblica in formato
   OpenSSH (`ssh-ed25519 AAAA... commento`). La privata resta su `SRVWOA`,
   protetta come le altre credenziali della pipeline.

2. **Client SFTP: WinSCP con libreria .NET — scelta confermata.** Controllo
   della host key, log dettagliati, trasferimento atomico e verifica SHA-256
   sono esattamente le proprieta' che servono qui, e giustificano
   l'installazione rispetto a un `psftp.exe` da copiare e basta. Le impronte per
   il pinning sono in §1.4, i checksum dei dump in §1.5.

3. **Lo script di pull**, con questi requisiti:
   - scarica i `.dump` e i `.sql` **nuovi** da `/dump/giornalieri`;
   - **verifica l'integrità**: confronta la dimensione con l'originale, e se
     possibile un hash. Un file troncato che sembra un backup è peggio di un
     backup mancante;
   - ritenzione su Windows: **7 giornaliere, 4 settimanali, 6 mensili**, come su
     Linux;
   - **fallisce rumorosamente**. Questo è il punto su cui insisto: sulla VM
     Linux gli avvisi via email non partono perché la casella Zoho non è mai
     stata collegata, quindi restano canali passivi. Se anche il pull fallisce
     in silenzio, nessuno se ne accorge finché non serve il backup. Serve almeno
     un evento nel registro eventi di Windows con un ID dedicato, e un file di
     stato con data ed esito;
   - compatibile **PowerShell 4.0**: niente `Expand-Archive`, niente operatori
     ternari, niente `??`, niente `-AsHashtable`.

4. **Verifiche preliminari** sull'host scelto: spazio libero (servono ~10 GB per
   la ritenzione completa: 95 MB × 17 copie ≈ 1,7 GB, con margine), account
   tecnico sotto cui gira l'attività pianificata, e che quell'account possa
   scrivere nella cartella di destinazione.

> [!warning] Supabase non è più un backup
> Concordo con la tua precisazione, e vale la pena ripeterla: dalla
> commutazione, Supabase è uno **snapshot di rollback fermo al 29/08**, non una
> copia aggiornata. Finché il pull non funziona, i preventivi che le persone
> scrivono esistono **in un posto solo, su un disco solo**. È il rischio
> maggiore aperto in questo momento.

### 2.2 Pacchetto V2 in staging — da non distribuire

Come da tua ripartizione: preparalo, non rilasciarlo finché il passaggio V1 al
locale non è verificato.

**Header CSV, opzione A confermata.** Gli alias quotati devono corrispondere
*esattamente* a `COMMON_HEADERS` / `PREVENTIVI_HEADERS` del loader, che ho letto
sulla VM:

```
"Codice Gruppo", "Gruppo Descrizione", "Codice Categoria",
"Categoria Descrizione", "Data Documento", "Importo",
"Codice Articolo", "Descrizione articolo", "Quantità",
"Codice Agente", "Agente", "Codice Cliente", "Nome Cliente",
"Profilo Documento", "Numero Doc.",
"Data Consegna Richiesta", "Data Consegna Confermata"
```

`preventivi_aperti` aggiunge le sei di `PREVENTIVI_HEADERS`, fra cui
`"Importo Inevaso"` al posto di `"Importo"`.

Attenzione a tre dettagli che fanno fallire il confronto: **`"Quantità"` ha
l'accento**, **`"Numero Doc."` ha il punto finale**, e **`"Descrizione
articolo"` ha la a minuscola**. Il loader confronta l'intera riga con
uguaglianza esatta: un carattere diverso e l'intestazione viene caricata come
dato.

**Conteggi colonne**: `ordinato` 25, `preventivi_aperti` 31, `fatturato` 21,
`consegnato` 21, `filiera_righe` 7. Gli altri invariati.

Il manifest deve continuare a dichiarare colonne, righe e SHA-256.

---

## 3. Sequenza concordata, e dove siamo

| # | Passo | Stato |
|---|---|---|
| 1 | Backup verificato e punto di rollback | ✅ dump 95,9 MB con dati vivi, ripristino provato, impronta MD5 identica |
| 2 | Sospensione scheduler BI | ⏸ pronta (`commuta-pipeline.sh sospendi`), **non eseguita** |
| 3 | Pipeline contro il locale | ⏸ pronta, non applicata |
| 4 | Run controllato sul locale | ⏸ |
| 5 | Ruolo `powerbi_reader` locale | ✅ creato e collaudato |
| 6 | Test Power BI da un PC LAN | ⏸ tocca al committente |
| 7 | Ripuntamento PBIX + confronto KPI | ⏸ |
| 8 | Riattivazione scheduler + un run completo | ⏸ |
| 9 | V2 | ⏸ |

**Stanotte alle 01:30 la pipeline gira su Supabase come sempre.** Pipeline e
Power BI restano entrambe sul cloud: lo stato è coerente e i report di lunedì
sono corretti. Preferisco commutare quando possiamo osservare un run completo,
non di sabato sera.

Dopo il primo run V1 sul locale ti restituisco quanto hai chiesto: run id,
conteggi per dataset, esito delle funzioni di attivazione, confronto col cloud,
stato di timer e path, endpoint effettivo del loader, istruzioni di rollback
provate.

---

## 4. Una precisazione su Zoho

Nei tuoi chiarimenti scrivi che «le email della vecchia pipeline Windows non
dimostrano che le credenziali Zoho dell'intranet funzionino». Non era quello che
avevo riportato: il committente ha confermato che **la casella Zoho non è mai
stata collegata**, e che i valori in `.env.local` sono segnaposto. Non c'è un
canale funzionante da cui dedurre l'altro — non ne funziona nessuno, e le email
dell'intranet (per esempio lo sblocco delle sessioni di valutazione) non sono
mai partite.

Lo segnalo perché altrimenti si va a cercare un problema di configurazione che
non esiste. È comunque una decisione separata dalla migrazione.

---

## 5. Cosa mi serve da te

| # | Cosa | Blocca |
|---|---|---|
| 1 | **Chiave pubblica OpenSSH** generata su `SRVWOA`, dopo la diagnostica | L'attivazione del pull SFTP |
| 2 | Conferma che su `SRVWOA` ci siano ~10 GB liberi e un account tecnico per l'attività pianificata | Il dimensionamento della ritenzione |
| 3 | Se estrarre gli header in un modulo condiviso (§6) rientra nel tuo pacchetto V2 o lo faccio io lato Linux | La ripartizione del lavoro sul loader |

Appena arriva la chiave, autorizzo l'account e facciamo un pull di prova
insieme, prima di metterlo in pianificazione.

---

## 6. Gli script Python della VM: cosa V2 tocca davvero

Letti tutti sulla VM il 29/08. La catena è:

```
supabase_loader.py   → carica i CSV grezzi in bi_documenti_raw
prepare_current.py   → normalizza i CSV (header sempre presente in uscita) + regola BU
costruisci_storico.py→ concatena storici 2013-2024 + correnti, aggrega per mese
aggiorna_forecast.py → Prophet sugli aggregati
publish_complete_run.py → pubblica derivati e stato
```

### Impatto di V2, script per script

| Script | Va modificato? | Perché |
|---|---|---|
| `supabase_loader.py` | **Sì, sostanziale** | Liste header per dataset + `row_to_record` per le colonne nuove |
| `prepare_current.py` | **Sì, ma solo le liste** | Ha una **copia duplicata** di `COMMON_HEADERS` e `PREVENTIVI_HEADERS` |
| `costruisci_storico.py` | **No** | Legge per nome e usa 6 colonne: le extra le ignora |
| `aggiorna_forecast.py` | **No** | Legge solo gli aggregati mensili prodotti a monte |
| `publish_complete_run.py` | **Indiretta** | Riusa `raw_loader.read_dataset` e `raw_loader.DATASETS` |

### Perché `costruisci_storico.py` non va toccato

Legge con `read_csv(..., header=0)` e accede **per nome**: `"Data Documento"`,
`"Importo"`, `"Gruppo Descrizione"`, `"Categoria Descrizione"`, `"Numero Doc."`,
`"Codice Articolo"`. Le colonne aggiuntive vengono lette e ignorate.

Il `concat` fra storici (17 colonne) e correnti (25) produce `NaN` nelle colonne
che gli storici non hanno — irrilevante, perché non sono fra quelle usate. Anche
la deduplica è difensiva: `[c for c in [...] if c in df.columns]`.

Conserva `encoding` a due tentativi (`utf-8-sig`, poi `latin1`) per i CSV
storici, `dayfirst=True`, e `parse_importo` per i decimali all'italiana. **Va
lasciato com'è**: è la parte che regge dodici anni di storia.

### ⚠ La duplicazione da eliminare in V2

`COMMON_HEADERS` e `PREVENTIVI_HEADERS` esistono in **due file**, identiche ma
indipendenti: `supabase_loader.py` (righe 21-60) e `prepare_current.py`
(righe 8-60).

Con V2 vanno aggiornate **insieme**. Se se ne aggiorna una sola, il guasto è
sgradevole: il loader carica correttamente e **pubblica**, poi
`prepare_current.py` fallisce con «attese 17 colonne, trovate 25» — e si ferma
solo il forecast. I dati commerciali risultano freschi, il forecast resta al
giorno prima, e nessuno se ne accorge finché non guarda le date.

**Raccomandazione**: estrarre le liste in un modulo condiviso — è esattamente
la `HEADERS_BY_DATASET` che chiedi, ma importata da entrambi invece che copiata.

Nota su `INPUTS` di `prepare_current.py`: copre **cinque** dataset, non sette
(`controllo_banco` e `portafoglio` non servono al forecast). I dataset nuovi di
V2 — `crm`, `filiera` — **non devono passare da qui**.

### ⚠ La regola BU è scritta in due posti

`prepare_current.py` righe 92-95:

```python
categoria = row[3].strip().upper()
if categoria in {"COSTRUITO", "STRUTTURE"} and row[1] != categoria:
    row[1] = categoria
```

La stessa regola vive nelle viste SQL:

```sql
CASE WHEN upper(TRIM(d.categoria_descrizione)) = ANY (ARRAY['COSTRUITO','STRUTTURE'])
     THEN upper(TRIM(d.categoria_descrizione))
     ELSE d.gruppo_descrizione END AS "Gruppo Descrizione"
```

Due implementazioni della stessa decisione, in linguaggi diversi. Oggi
coincidono; se un giorno si aggiunge una terza business unit va cambiata in
entrambi i posti, e non c'è niente che lo ricordi.

> [!info] Buona notizia sulle posizioni
> La regola BU usa gli **indici** `row[1]` e `row[3]`. Poiché le colonne V2
> vanno **in coda**, quelle posizioni non si spostano e la trasformazione
> continua a funzionare senza modifiche.

### Il loader era già pronto per gli header — ma non per questi nomi

Ricapitolando il punto di §2.2: sia `supabase_loader.py` sia
`prepare_current.py` hanno già la logica giusta —

```python
rows = reader if first_row == headers else chain([first_row], reader)
```

— con lettura `utf-8-sig`. Manca solo che i nomi emessi da `WITH COLUMN NAMES`
coincidano con quelli attesi, ed è quello che l'opzione A risolve.

---

## Collegato a

- [`PROMPT-CODEX-dopo-migrazione.md`](PROMPT-CODEX-dopo-migrazione.md)
- [`REVISIONE-PIANO-BI-V2.md`](REVISIONE-PIANO-BI-V2.md)
- [`../db-migrazione/OPERATIVITA-DB-VM.md`](../db-migrazione/OPERATIVITA-DB-VM.md)

---
