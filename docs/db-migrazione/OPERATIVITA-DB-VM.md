# PostgreSQL sulla VM — operatività

> Stato: **installato e collaudato** il 29 agosto 2026 su `srv-intranet`.
> Il database è **vuoto**: contiene solo lo schema sentinella `_collaudo`.
> I dati da Supabase **non sono ancora stati migrati**.

---

## 1. Cosa c'è sulla macchina

| Componente | Versione | Stato |
|---|---|---|
| PostgreSQL | **17.11** (PGDG) | attivo, avvio automatico |
| pgvector | **0.8.6** | ≥ Supabase (0.8.0) |
| pg_trgm | 1.6 | = Supabase |
| pgcrypto | 1.3 | = Supabase |
| uuid-ossp | 1.1 | = Supabase |
| pg_stat_statements | 1.11 | = Supabase |

Il repository **PGDG** è stato aggiunto (`/etc/apt/sources.list.d/pgdg.list`):
Ubuntu 24.04 offre solo PostgreSQL 16 e pgvector 0.6.0, con cui il restore da
Supabase **fallirebbe**.

### Database `intranet`

Creato per combaciare esattamente con Supabase — verificato:

| Proprietà | Supabase | VM |
|---|---|---|
| Encoding | UTF8 | UTF8 |
| Collate / Ctype | `en_US.UTF-8` | `en_US.UTF-8` |
| Locale provider | **ICU** (`i`) | **ICU** (`i`) |
| TimeZone | UTC | UTC |

> [!info] Perché ICU conta
> Il provider di collazione determina l'ordinamento dei testi e quindi
> **l'ordine dentro gli indici**. Con provider diversi il database ripristinato
> funzionerebbe, ma ordinamenti e ricerche per intervallo darebbero risultati
> diversi da quelli attuali.

### Ruoli

Replicati con i **nomi esatti** di Supabase — sono referenziati da 105 policy
RLS e da centinaia di grant. Flag `INHERIT` verificati uno a uno.

| Ruolo | Login | Inherit | BypassRLS | Serve a |
|---|---|---|---|---|
| `anon` | no | sì | no | Richieste non autenticate via PostgREST |
| `authenticated` | no | sì | no | Utenti con JWT valido |
| `service_role` | no | sì | **sì** | Accesso lato server dell'app |
| `authenticator` | sì | **no** | no | Il ruolo con cui PostgREST si connette |
| `powerbi_reader` | sì | **no** | no | Sola lettura su `powerbi.*` |
| `supabase_auth_admin` | sì | no | no | Proprietario dello schema `auth` (GoTrue) |
| `backup_ro` | sì | sì | no | Lettura per i backup |

> [!warning] `authenticator` deve restare NOINHERIT
> Senza, erediterebbe i privilegi di `service_role` su ogni connessione — anche
> per le richieste anonime. È il ruolo che regge l'intero modello di sicurezza.

### Configurazione

`/etc/postgresql/17/main/conf.d/10-intranet.conf` — drop-in, il file principale
non è stato toccato. Tarato per **2 vCPU condivise** con Next.js e la pipeline BI:
`shared_buffers 1536MB`, `max_connections 50`, `max_parallel_workers 2`,
`autovacuum_vacuum_cost_delay 10ms`.

### Rete

PostgreSQL ascolta **solo su `127.0.0.1:5432`**. Nessuna esposizione in LAN:
va aperta solo quando si ripunteranno i PBIX (passo 7 del piano), limitandola
in `pg_hba.conf` al singolo indirizzo del PC di Power BI.

---

## 2. Backup

### Cosa gira

| Quando | Cosa | Unit |
|---|---|---|
| **01:00** Europe/Rome | Dump del database + dei globals | `intranet-db-backup.timer` |
| **08:00** Europe/Rome | Verifica che il backup esista e sia sano | `intranet-db-verifica.timer` |
| A mano, trimestrale | Prova di ripristino | `intranet-db-prova-ripristino.sh` |

Il backup gira **prima** della pipeline BI dell'01:30: fotografa uno stato
stabile, non uno a metà caricamento.

### Due dump, non uno

- `intranet-AAAA-MM-GG.dump` — formato custom, compresso: schemi, dati,
  funzioni, policy.
- `globals-AAAA-MM-GG.sql` — ruoli e password. **Vivono fuori dal database**:
  senza, il ripristino produce un DB che nessuno può interrogare.

Ogni dump viene verificato con `pg_restore --list` subito dopo la creazione:
distingue un backup da un file troncato, e costa un secondo.

### Ritenzione

| Livello | Conservate | Promozione |
|---|---|---|
| Giornaliere | 7 giorni | — |
| Settimanali | 4 settimane | la domenica |
| Mensili | 6 mesi | il primo del mese |

### Comandi

```bash
# Stato in una schermata — non richiede privilegi
intranet-db-stato

# Backup immediato
sudo systemctl start intranet-db-backup.service

# Verifica immediata
sudo systemctl start intranet-db-verifica.service

# Prova di ripristino (trimestrale)
sudo -u postgres bash -c 'cd /var/lib/postgresql && /usr/local/sbin/intranet-db-prova-ripristino.sh'
sudo -u postgres dropdb intranet_prova_ripristino    # al termine

# Log
journalctl -u intranet-db-backup -n 50
```

### File

| Percorso | Contenuto |
|---|---|
| `/var/backups/intranet-db/` | I dump, divisi per livello |
| `/var/backups/intranet-db/stato.json` | Ultimo esito, leggibile da tutti |
| `/var/backups/intranet-db/GUASTO.txt` | Presente **solo** se c'è un guasto aperto |
| `/etc/default/intranet-db-backup` | Soglie del controllo |
| `/etc/intranet-db/secrets.env` | Password dei ruoli — `0600 root:root` |

---

## 3. Collaudo eseguito

Non è stato installato e basta: è stato provato.

| Prova | Esito |
|---|---|
| Dump del database e dei globals | ✅ 103 kB + 2,3 kB, validati con `pg_restore --list` |
| Ripristino su database usa-e-getta | ✅ 1 secondo |
| **Integrità del contenuto** | ✅ impronta MD5 **identica** su 5.000 righe con testo accentato (`àèéìòù ÀÈÉÌÒÙ çñ «virgolette» — trattino`) e numerici a 4 decimali |
| Indice GIN trigram | ✅ ricostruito, ricerca `%` funzionante |
| Indice HNSW vettoriale | ✅ ricostruito, ricerca per similarità corretta |
| Chiave primaria btree | ✅ ricostruita |
| Confronto oggetti esercizio ↔ ripristino | ✅ funzioni, FK, policy, viste, tabelle: identici |
| Ritenzione | ✅ un dump datato 30 giorni fa viene cancellato |
| Catena di allarme | ✅ guasto → unit fallita → `OnFailure` → syslog + bandierina |
| Azzeramento dell'allarme | ✅ il primo backup riuscito rimuove `GUASTO.txt` |

> [!info] Perché una sentinella con gli accenti
> Il database era vuoto: un ripristino di niente non prova niente. Le 5.000
> righe di `_collaudo.sentinella` esercitano esattamente ciò che conta nei dati
> veri — testo accentato (dove sbagliano encoding e collazione), numerici con
> decimali, e i due tipi di indice che il Preventivatore usa davvero.

Lo schema `_collaudo` va **eliminato dopo il restore da Supabase**:

```sql
drop schema _collaudo cascade;
```

---

## 4. Due cose non risolte

### 4.1 La posta non funziona — problema preesistente

Gli avvisi via email **non partono**. Zoho rifiuta le credenziali presenti in
`/opt/intranet-sics/.env.local`:

```
host: smtp.zoho.eu  porta 465  SSL
utente: val***@sics.it
login: RIFIUTATO — 535 Authentication Failed
```

La password è di 19 caratteri ASCII senza spazi ai bordi: non è un problema di
lettura del file.

**Chiarito dal committente il 29/08: la casella Zoho non è mai stata collegata.**
I valori in `.env.local` sono quindi segnaposto, non credenziali scadute.

> [!warning] Riguarda anche l'app, non solo i backup
> È la stessa configurazione che l'intranet userebbe per le proprie email — per
> esempio quando si sblocca una sessione di valutazione. Se Zoho non è mai stato
> collegato, **quelle email non sono mai partite**. Va deciso a parte se
> attivare la casella o usare un altro canale.

**Nel frattempo** l'allarme non è muto: resta la bandierina `GUASTO.txt`, la
riga in syslog (`journalctl -t intranet-db`) e l'unit systemd in stato `failed`.
`intranet-db-stato` mostra tutto in una schermata. Ma sono canali **passivi**:
qualcuno deve guardarli. Il requisito «il fallimento deve essere rumoroso» sarà
soddisfatto solo quando la posta tornerà a funzionare.

### 4.2 Non esiste ancora una copia fuori dalla VM

I backup stanno su `/var/backups/intranet-db`, cioè **sullo stesso disco del
database**. Questo protegge dall'errore umano — un `DELETE` sbagliato, una
migration andata male — ma **non dal guasto**: un disco che muore porta via
database e backup insieme.

Sulla macchina non ci sono mount di rete, e il filesystem è uno solo (204 GB,
tutto su `/`). Serve una decisione sulla destinazione:

- un NAS aziendale montato in sola scrittura;
- una copia via `rsync`/`scp` verso un'altra macchina;
- uno storage esterno cifrato.

Finché quella copia non esiste, **la migrazione non va completata**: fino al
passo 6 Supabase resta la riserva vera, ma dal passo 8 in poi non lo sarebbe più.

---

## 5. Da fare al momento del restore da Supabase

- [ ] Alzare `MIN_BYTE` in `/etc/default/intranet-db-backup` da `50000` a
      `10000000` (10 MB). Il valore attuale è tarato sul database vuoto: dopo il
      restore un dump gravemente monco passerebbe il controllo.
- [ ] `drop schema _collaudo cascade;`
- [ ] Rieseguire la prova di ripristino con i dati veri e registrarne la durata.
- [ ] Confrontare i conteggi con Supabase: **216 funzioni, 108 FK, 105 policy,
      23 viste `powerbi`** (valori misurati il 29/08/2026).
- [ ] Creare i ruoli che compaiono nei grant del dump e che oggi non esistono
      (si estraggono dal TOC con `pg_restore --list` prima di ripristinare).

---

## 6. Accesso amministrativo — da revocare

Per l'installazione è stato concesso un sudo senza password:

```bash
ssh -t intra-adm@192.168.1.21 'sudo rm -f /etc/sudoers.d/99-migrazione-db && echo REVOCATO'
```

> [!warning] Va revocato quando i lavori sono finiti.
> Il file si chiama `99-migrazione-db` proprio perché chiunque lo veda capisca
> che è temporaneo.

---

## Collegato a

- [`PIANO-MIGRAZIONE-DB-VM.md`](PIANO-MIGRAZIONE-DB-VM.md) — il piano completo
- [`../bi/REVISIONE-PIANO-BI-V2.md`](../bi/REVISIONE-PIANO-BI-V2.md) — retention BI

---

## 7. Aggiornamento 29/08 pomeriggio — stack applicativo completo

### Componenti aggiunti

| Servizio | Versione | Porta | Stato |
|---|---|---|---|
| PostgREST | 16.2 | `127.0.0.1:3001` | attivo, avvio automatico |
| GoTrue (supabase/auth) | v2.196.0 | `127.0.0.1:9999` | attivo, 70 migrazioni applicate, 23 tabelle in `auth` |

Nessun Docker: due binari e due unit systemd, irrobustite con
`ProtectSystem=strict`, `PrivateTmp`, `NoNewPrivileges`, `MemoryMax=512M`.

> [!warning] La porta 3000 era già occupata
> È la porta di Next.js. PostgREST è su **3001**. Da ricordare se qualcuno
> legge documentazione Supabase generica, che assume la 3000.

### nginx

Snippet `/etc/nginx/snippets/supabase-compat.conf`, incluso nel vhost:

| Percorso | Destinazione |
|---|---|
| `/rest/v1/` | `127.0.0.1:3001` (PostgREST) |
| `/auth/v1/` | `127.0.0.1:9999` (GoTrue) |
| `/api/v1/bi-ingest/` | invariato — `^~` ha la precedenza, verificato |
| `/` | invariato — Next.js sulla 3000 |

Backup del vhost originale in `/root/intranet.s-ics.com.prima-di-supabase-compat-*`.

> [!info] Perché le barre finali in `proxy_pass` contano
> Con `proxy_pass http://127.0.0.1:3001/` nginx **toglie** il prefisso
> `/rest/v1/` prima di inoltrare. Senza la barra finale, PostgREST riceverebbe
> `/rest/v1/tabella` e risponderebbe 404 su tutto.

### Segreto JWT — generato qui, mai importato

Il segreto JWT **non** è stato preso da Supabase. Riusarlo avrebbe significato
farlo transitare da un sistema all'altro per guadagnare solo la sopravvivenza
delle sessioni aperte — e i cookie dell'intranet sono già session-only per
scelta esplicita nel middleware.

Conseguenza: **al momento del taglio tutti rifanno il login una volta.**

Da `JWT_SECRET` sono state derivate `ANON_KEY` e `SERVICE_ROLE_KEY`, che sono
JWT firmati con il ruolo nel claim — esattamente come su Supabase. Tutto in
`/etc/intranet-db/secrets.env` (`0600 root:root`).

### Collaudo eseguito

| Prova | Esito |
|---|---|
| PostgREST si connette a PostgreSQL 17.11 | ✅ pool di 10 connessioni |
| Chiave valida | ✅ HTTP 200 |
| **Chiave manomessa** | ✅ **HTTP 401** |
| Cambio di ruolo via JWT | ✅ nessuna chiave → `anon`; `ANON_KEY` → `anon`; `SERVICE_ROLE_KEY` → `service_role`; utente di sessione sempre `authenticator` |
| GoTrue `/auth/v1/health` via nginx | ✅ risponde |
| App sulla radice | ✅ HTTP 200, non disturbata |
| Ingest BI | ✅ HTTP 200, intatto |

> [!info] Il cambio di ruolo è il meccanismo che regge tutto
> Sono le 105 policy RLS a decidere chi vede cosa, e funzionano solo se
> `authenticator` assume il ruolo giusto leggendolo dal token. Verificato che si
> comporta identico a Supabase.

### Restore: script pronto, in attesa della credenziale

`/usr/local/sbin/migra-da-supabase.sh` — dump da Supabase e restore locale.
Legge `SUPABASE_DB_URL` da `/etc/intranet-db/supabase-origine.env`, che **non
esiste ancora**: va creato con la stringa di connessione.

Schemi migrati: `public`, `preventivatore`, `service`, `bi`, `powerbi`,
`ai_presales`, `supabase_migrations`.

Esclusi di proposito:

| Schema | Perché |
|---|---|
| `auth` | Lo gestisce GoTrue, che ha già creato le sue tabelle. Si importano **solo i dati** di `auth.users` e `auth.identities`: gli hash bcrypt vengono con loro, nessuno reimposta password |
| `storage` | Serve solo a Service, che resta su Supabase |
| `graphql`, `graphql_public`, `realtime`, `vault`, `extensions`, `pgbouncer` | Infrastruttura Supabase, non usata dall'intranet |

Lo script **non modifica Supabase**: fa solo letture.

---

## 8. Migrazione completata — 29/08/2026, ore 17:05

**L'app punta al database locale.** Supabase è intatto e resta la riserva.

### Verifica dei dati

| Misura | Supabase | Locale | |
|---|---:|---:|:--|
| Funzioni applicative | 216 | 216 | ✅ |
| Policy RLS | 105 | 105 | ✅ |
| Viste `powerbi` | 23 | 23 | ✅ |
| FK `preventivatore` / `public` / `service` / `bi` / `auth` | 34/40/9/2/18 | 34/40/9/2/18 | ✅ |
| Utenti (`public.utenti` / `auth.users`) | 27 / 27 | 27 / 27 | ✅ |
| `bi_documenti_raw` | 1.887.280 | 1.887.280 | ✅ |
| `preventivatore.prodotti` | 24.960 | 24.960 | ✅ |
| `prodotti_giacenze` / `clienti_master` / `documenti` | 26.565 / 5.699 / 385 | idem | ✅ |
| `bi.giacenze_storico` / `bi_aggregati_mensili` | 42.263 / 45.573 | idem | ✅ |

Le 5 FK di `storage` non ci sono perché quello schema è escluso di proposito:
serve solo a Service, che resta su Supabase.

Tutti i **GRANT** combaciano riga per riga: `anon` 26 oggetti in `public` + 1 in
`preventivatore`, `authenticated` 26+3+4, `powerbi_reader` 23+22,
`service_role` 49+38+5.

### Due errori miei, e cosa hanno insegnato

**1. Schema `extensions` escluso.** Supabase tiene `uuid-ossp` in `extensions`, e
otto tabelle usano `extensions.uuid_generate_v4()` come default. Averlo escluso
ha fatto fallire quelle `CREATE TABLE`, e a cascata **100 istruzioni**
dipendenti — 38 delle quali su `public.utenti`. Un errore all'inizio, cento
alla fine.

**2. `--no-privileges` sul dump.** Il database ripristinato era perfetto per
struttura e dati, e **completamente inaccessibile**: `permission denied` su
tutto. È la conferma pratica di quanto già scritto nell'audit di sicurezza del
Preventivatore — **sono i GRANT il vero gate, non le policy RLS**: senza
`GRANT SELECT` una policy non viene nemmeno raggiunta.

L'ordine corretto, che ora lo script rispetta: estensioni negli schemi giusti →
`auth` creato da GoTrue → **dati degli utenti** → schemi applicativi. Gli utenti
prima, perché dodici tabelle hanno FK verso `auth.users`.

### Collaudo funzionale

Eseguito con le librerie e la configurazione dell'app (`@supabase/supabase-js`
e `.env.local`), cioè lo stesso identico percorso del codice in esercizio:

| Prova | Esito |
|---|---|
| `scale_valutazione`, `utenti`, conteggio esatto | ✅ |
| Schema `preventivatore` via `.schema()` | ✅ |
| **Accenti conservati** | ✅ `AVI.COOP Società Cooperativa Agricola` |
| **Relazione annidata** `documenti→clienti_master` | ✅ |
| Ricerca trigram su `descrizione` | ✅ 3 risultati |
| Viste `bi_ordinato`, `bi_fatturato`, `bi_preventivi_aperti` | ✅ |
| RPC `get_portali_utente`, `dashboard_kpi` | ✅ |
| **`anon` NON legge i preventivi** | ✅ `permission denied for table documenti` |

Catena di autenticazione, con un utente finto creato e poi eliminato:

| Prova | Esito |
|---|---|
| Creazione via API admin GoTrue | ✅ |
| Login email+password | ✅ access_token, refresh_token, 3600s |
| Password sbagliata | ✅ HTTP 400 |
| **Token GoTrue accettato da PostgREST** | ✅ ruolo `authenticated`, `auth.uid()` corretto |
| Refresh del token | ✅ |
| Utenti reali intatti | ✅ 27 |

### Backup con i dati veri

- Dump: **95,9 MB in 19 secondi**, validato con `pg_restore --list`.
- Prova di ripristino: 271 funzioni, 103 FK, 105 policy, 23 viste, 98 tabelle —
  **identici**.
- `bi_documenti_raw`: **1.887.280 righe** e **impronta MD5 identica** fra
  esercizio e ripristino.
- Soglia `MIN_BYTE` alzata a 10 MB ora che i dati sono reali.

### Tornare indietro

```bash
sudo /usr/local/sbin/commuta-db.sh supabase   # torna a Supabase
sudo /usr/local/sbin/commuta-db.sh locale     # torna al locale
sudo /usr/local/sbin/commuta-db.sh stato      # dove punta adesso
```

Cambia tre variabili in `.env.local` e riavvia pm2: **nessuna riga di codice**.
Commutando verso `locale` lo script fa un controllo di salute e, se l'app non
risponde, **torna indietro da solo**.

Copia del `.env.local` originale in
`/var/backups/intranet-db/env/env.local.SUPABASE-ORIGINALE`.

> [!info] Il segreto JWT è nuovo
> Le sessioni aperte prima della commutazione non sono più valide: al primo
> accesso ognuno rifà il login una volta. I cookie erano già session-only, quindi
> per la maggior parte degli utenti è indistinguibile da una normale riapertura
> del browser.

---

## 9. Cosa resta da fare

### ⚠ La pipeline BI scrive ancora su Supabase

`/etc/impresa-bi/supabase.env` punta al progetto Supabase: il run dell'01:30
**caricherà là**, non sul database locale. Oggi è coerente — anche Power BI legge
ancora Supabase — ma è una divergenza che va chiusa consapevolmente, e i due
spostamenti (pipeline e Power BI) vanno fatti **insieme**.

Finché non si fa, il `bi_documenti_raw` locale resta fermo al 29/08.

### ⚠ `/api/ping` non ha mai funzionato

La rotta è documentata come keep-alive per il piano free di Supabase, da
chiamare ogni 4 giorni. **Non interroga il database**: senza
`export const dynamic = "force-dynamic"` Next.js la precalcola al build, e
risponde sempre lo stesso JSON con il timestamp della compilazione — verificato,
restituiva `2026-08-03` il 29 agosto. `pg_stat_statements` conferma che
`scale_valutazione` non è mai stata interrogata.

Serve una modifica al codice, quindi **via git**, non a mano sulla VM: `deploy.sh`
fa `git reset --hard origin/main` e cancellerebbe qualunque ritocco locale.

### Altri punti aperti

- [ ] **Copia dei backup fuori dalla VM** — §4.2. Ora è più urgente di prima:
      il database di esercizio è qui.
- [ ] **Power BI** da ripuntare su `192.168.1.21:5432` (richiede di aprire
      `listen_addresses` e `pg_hba.conf` al solo PC di Power BI).
- [ ] **Retention BI a 3 run** sul database locale, dove `VACUUM FULL` è libero.
- [ ] **Revocare il sudo temporaneo** — §6.
- [ ] Modifica non committata sulla VM: `scripts/bi-cruscotto-stato.mjs`
      sparirà al prossimo deploy.

---

## 10. Power BI verso la VM

**Sì, Power BI Desktop si collega direttamente e aggiorna i report senza gateway.**
Il connettore PostgreSQL è nativo: parla il protocollo Postgres sulla 5432,
esattamente come faceva col Session Pooler di Supabase. Cambia solo la sorgente.

### Parametri di connessione

| Campo | Valore |
|---|---|
| Server | `intranet.s-ics.com:5432` |
| Database | `intranet` |
| Schema delle viste | `powerbi` (invariato) |
| Utente | `powerbi_reader` |
| Password | in `/etc/intranet-db/secrets.env`, riga `PG_POWERBI_PASSWORD` |
| Cifratura | **obbligatoria** — spuntare «Crittografa connessione» |

> [!info] Perché il nome e non l'IP
> Il certificato è quello **GoDaddy già usato da nginx** per
> `intranet.s-ics.com`. Connettendosi al nome, Windows valida catena e nome host
> con il proprio archivio certificati: nessuna eccezione da spuntare. Con l'IP
> il nome non combacerebbe e servirebbe disattivare la verifica — cioè
> rinunciare a distinguere una connessione sana da una manomessa.

### Configurazione applicata sulla VM

| Cosa | Dove | Valore |
|---|---|---|
| Ascolto | `conf.d/20-powerbi.conf` | `listen_addresses = 'localhost,192.168.1.21'` |
| TLS | idem | certificato GoDaddy, `ssl_min_protocol_version = TLSv1.2` |
| Accesso | `pg_hba.conf` | **`hostssl`** · solo `powerbi_reader` · solo db `intranet` · da `192.168.1.0/24` e `10.212.134.0/24` · `scram-sha-256` |

`hostssl` e non `host`: una connessione senza TLS viene **rifiutata**, non
accettata in chiaro.

### Collaudo eseguito

| Prova | Esito |
|---|---|
| Connessione TLS + lettura `powerbi.bi_ordinato` | ✅ 17.992 righe |
| Tentativo di scrittura | ✅ `permission denied for schema public` |
| Connessione **senza** TLS | ✅ rifiutata: `no pg_hba.conf entry ... no encryption` |
| Grant di `powerbi_reader` | ✅ 23 viste `powerbi` + 22 `public`, **solo SELECT** |

### Cambiare la sorgente in un PBIX

*Trasforma dati → Impostazioni origine dati → Cambia origine.* Nomi di schema,
viste e colonne sono identici a Supabase: **misure, relazioni e visualizzazioni
non si toccano**. Cambiano solo server, database e credenziali.

> [!warning] Aggiornamento pianificato dal cloud
> L'aggiornamento **manuale da Power BI Desktop** funziona così com'è. Se un
> giorno si volesse l'aggiornamento **pianificato da Power BI Service**, quello
> richiede un *on-premises data gateway* installato su una macchina Windows
> della LAN, perché il servizio cloud non raggiunge la VM. Oggi il Service non
> è usato, quindi non serve.

> [!warning] Solo da LAN o VPN
> La 5432 non è esposta su Internet e il router non la inoltra. Chi aggiorna i
> report deve essere in ufficio o in VPN. **Sulla VM non c'è un firewall
> attivo** (`ufw` inattivo, `iptables` in ACCEPT): l'unico controllo è
> `pg_hba.conf`. Funziona, ma vale la pena valutare `ufw` come secondo strato.
