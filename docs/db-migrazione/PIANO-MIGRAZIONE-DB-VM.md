# Migrazione del database sulla VM Linux — piano operativo

> Destinatario: Codex.
> Stato: **piano da approvare**. Nessun comando di questo documento è stato eseguito.
> Data: 29 agosto 2026 · repo `intranet-sics` @ `06b2408`

---

## 1. Obiettivo e strategia

Portare **tutto il database dell'intranet** su un PostgreSQL installato sulla VM
Linux `srv-intranet`, lasciando su Supabase **soltanto il perimetro dell'app
esterna `sics_service`**, completamente staccato dal database interno.

Sequenza voluta dal committente:

1. si sposta il database sulla VM;
2. **Supabase resta intatto come riserva** finché non è tutto verificato;
3. solo a verifica conclusa Supabase viene svuotato e ridotto al solo Service.

Il punto 2 è la garanzia di reversibilità: finché Supabase è intatto, tornare
indietro costa il cambio di tre variabili d'ambiente e un restart di pm2.

### Perché si fa

| Motivo | Dettaglio |
|---|---|
| Spazio | Il DB è a **836 MB** contro il limite di **500 MB** del piano free. Sulla VM ci sono 182 GB liberi |
| Costo | Il vincolo di budget è zero euro: Supabase Pro (25 $/mese) non è previsto |
| Latenza | I dati BI sono prodotti sulla VM, fanno un giro fino in Irlanda e tornano in ufficio per Power BI |
| Prospettiva | Un backend BI custom interroga il DB molto più di un refresh manuale di Power BI: il limite che morde diventerebbe la CPU, non lo spazio |

---

## 2. Stato accertato

### 2.1 La VM (ispezionata via VPN il 29/08/2026)

| Voce | Valore |
|---|---|
| Host | `srv-intranet` · `192.168.1.21` · Ubuntu 24.04.4 LTS |
| CPU | **2 vCPU** |
| RAM | 7,8 GB totali, **5,9 GB disponibili**, swap 4 GB |
| Disco | 204 GB, **182 GB liberi** (`/dev/mapper/ubuntu--vg-ubuntu--lv`, 7% usato) |
| Load | 0,18 · uptime 25 giorni |
| Timezone | **`Etc/UTC`** |
| Node | v20.20.2 · app `intranet-sics` sotto pm2, 60 MB RSS |
| nginx | un solo vhost: `intranet.s-ics.com` |
| PostgreSQL | **non installato** (`dpkg -l | grep -c postgres` → 0) |

> [!info] Il fuso orario è già allineato
> Supabase espone `TimeZone = UTC` e la VM è `Etc/UTC`. L'errore classico delle
> migrazioni — date che slittano di un'ora o di un giorno — **non si presenta**.
> Va comunque verificato dopo il restore, non dato per scontato.

### 2.2 Dipendenze reali da Supabase

Inventario fatto sul repository. Serve a dimensionare il lavoro:

| Prodotto Supabase | Uso nell'intranet | Conseguenza |
|---|---|---|
| PostgreSQL | Tutto: 54 tabelle interrogate, 28 RPC, 216 funzioni, 108 FK | Postgres 17 + estensioni standard |
| PostgREST | Ogni `.from()` e `.rpc()` | Stesso software self-hosted, **zero query da riscrivere** |
| GoTrue (Auth) | Solo 5 metodi: `getUser` (105 usi), `signInWithPassword`, `signOut`, `admin.createUser`, `admin.updateUserById`, `admin.deleteUser` | Binario Go, solo password grant |
| Storage | **Zero** nell'intranet. Un bucket `service-uploads` (37 file) è di Service | Non va installato |
| Realtime | **Zero**. Nessun `.channel()`, nessun `postgres_changes` | Non va installato |
| Edge Functions | **Zero**. `supabase/functions` non esiste | Non va installato |

Estensioni in uso: `vector` 0.8.0, `pg_trgm` 1.6, `pgcrypto` 1.3, `uuid-ossp`
1.1, `pg_stat_statements` 1.11. Tutte disponibili in `apt`.
`supabase_vault` 0.3.1 è installata ma **non usata da nessuno** (zero
riferimenti nel repo): si abbandona.

### 2.3 Fatti che semplificano la migrazione

- **Solo 3 file** usano il client Supabase lato browser, e solo per login/logout:
  `src/app/auth/login/page.tsx`, `src/components/layout/intranet-navbar.tsx`,
  `src/components/superadmin/superadmin-sidebar.tsx`. **Nessuna query ai dati
  parte dal browser.**
- **`public.utenti` non ha FK verso `auth.users`.** I 27 `id` coincidono per
  convenzione, non per vincolo.
- **Le password sono bcrypt** in `auth.users.encrypted_password`: il dump le
  porta, nessuno deve reimpostarne una.
- **Nessuna email parte da GoTrue**: gli utenti si creano con
  `email_confirm: true` e le email dell'app usano nodemailer con SMTP proprio.
- Il cambio password è già una route interna (`/api/auth/cambio-password`) che
  verifica da sé la vecchia password: non passa da GoTrue.
- **105 policy RLS, 51 delle quali usano `auth.uid()`**: continuano a valere
  identiche, perché `auth.uid()` legge un claim del token e non fa una join.

---

## 3. Il nodo da chiudere prima: `movimenta_giacenza`

> [!warning] È l'unico problema architetturale, e non nasce dalla migrazione
> `preventivatore.movimenta_giacenza` **non è una lettura**. Il corpo della
> funzione fa `UPDATE` su `preventivatore.prodotti_giacenze` (`esistenza` e
> `disponibilita`), con `SELECT … FOR UPDATE` e controllo di disponibilità, e
> inserisce in `preventivatore.movimenti_giacenza`.
> **L'app Service modifica il magazzino interno.**

Con due database staccati servono quindi **due flussi**, non zero:

- **interno → Supabase**: articoli, giacenze, clienti — o Service lavora su dati morti;
- **Supabase → interno**: i movimenti — o l'audit del magazzino perde pezzi.

**Attenuante rilevante:** il Cruscotto riscrive `prodotti_giacenze` ogni notte
dal gestionale. La verità sul magazzino sta nel gestionale, non nel nostro DB. I
movimenti di Service sono aggiustamenti intra-giornata che vengono comunque
sovrascritti alle 02:30. Il flusso di ritorno ha quindi valore **di audit**, non
di saldo.

**Domanda che blocca il disegno della replica (D1):**
un prelievo fatto da Service finisce anche nel gestionale?

- Se **sì** → il ritorno serve solo per tracciabilità: flusso semplice.
- Se **no** → esiste già oggi una divergenza fra magazzino reale e gestionale,
  che la migrazione non crea ma rende visibile. Va affrontata prima.

> [!info] Momento favorevole
> `service.attivita`, `service.viaggi` e `service.work_sessions` hanno **zero
> righe**; `preventivatore.movimenti_giacenza` ne ha **nove**. Non c'è storia da
> preservare: è il momento migliore per concordare il confine fra le due app.

---

## 4. Problemi lato codice — elenco completo

Ordinati per quantità di lavoro, non per gravità.

### 4.1 GoTrue va installato e collaudato — mezza giornata + test

È l'unico componente senza sostituto banale, perché tocca cookie, refresh token
e sessioni: quando si rompe, si rompe per tutti insieme.

Configurazione minima necessaria (niente OAuth, magic link, MFA, conferme email):

```
GOTRUE_SITE_URL           = https://intranet.s-ics.com
GOTRUE_DISABLE_SIGNUP     = true
GOTRUE_EXTERNAL_EMAIL_ENABLED = true
GOTRUE_MAILER_AUTOCONFIRM = true
GOTRUE_JWT_SECRET         = <stesso segreto usato da PostgREST>
GOTRUE_JWT_EXP            = <allineare al valore Supabase attuale>
GOTRUE_DB_DRIVER          = postgres
```

**Da collaudare seriamente:** il giro dei cookie di `@supabase/ssr` in
`src/middleware.ts` — refresh del token a ogni request, `getAll`/`setAll`, e la
scelta già presente di rendere i cookie auth session-only (niente
`maxAge`/`expires`). Deve funzionare identico. **Va provato con utenti veri
prima del taglio**, non dedotto.

### 4.2 I ruoli Supabase non esistono in Postgres nudo

`anon`, `authenticated`, `service_role`, `authenticator` sono ruoli creati da
Supabase. Su un Postgres vergine vanno ricreati **con gli stessi identici nomi**.

```sql
-- Bozza. I nomi sono parte del contratto, non una convenzione.
create role anon          nologin;
create role authenticated nologin;
create role service_role  nologin bypassrls;
create role authenticator login password '...' noinherit;
grant anon, authenticated, service_role to authenticator;
create role powerbi_reader login password '...';
```

`authenticator` è il ruolo con cui PostgREST si connette e da cui fa `SET ROLE`
leggendo il claim `role` del JWT.

> [!warning] Un errore qui non dà errore
> Se un nome cambia, 105 policy e centinaia di grant cambiano comportamento in
> silenzio — e il modo in cui te ne accorgi è che qualcuno vede dati che non
> dovrebbe. Il collaudo obbligatorio è: **un commerciale ristretto deve vedere
> esattamente i preventivi di prima** (`src/lib/portali/preventivatore/ruoli.ts`,
> `getIdClientiVisibili`).

### 4.3 Le 12 tabelle con FK verso `auth.users`

Portando anche l'auth in casa **non è un problema** — le FK seguono i dati.
È però la ragione tecnica per cui l'auth *deve* venire con noi:

| Schema | Tabelle |
|---|---|
| `preventivatore` | `ai_config`, `ai_usage_events`, `bi_dashboard_log`, `bi_dashboards`, `chat_sessioni`, `documenti`, `query_log`, `schede_approvate`, `schede_generate`, `utente_ruoli_funzionali` |
| `service` | `attivita`, `operatori_abilitati` — **restano su Supabase** e lì trovano il loro `auth.users` |

### 4.4 Due identità per quattro persone

I 4 operatori in `service.operatori_abilitati` avranno un account sul Supabase
di Service, distinto da quello intranet. È il prezzo del taglio netto, ed è più
economico di sincronizzare due GoTrue.

**Conseguenza da progettare:** `movimenti_giacenza.eseguito_da` ha
`default auth.uid()` e conterrà l'UUID del Supabase-Service, non il nostro.
Quando i movimenti tornano indietro quell'UUID non corrisponde a nessuna riga di
`public.utenti`. **Serve una tabella di mappatura di 4 righe**, compilata a mano.
Piccola, ma se ci si dimentica lo si scopre mesi dopo guardando un audit che non
sa dire chi ha fatto cosa.

### 4.5 Tuning per 2 vCPU

Disco e RAM abbondano, i core no. Sulla VM girano già Next.js in produzione e la
pipeline Python. I momenti di contesa sono noti e notturni: **il Cruscotto
(~21 minuti)** e **la cross-validation di Prophet il venerdì** (CPU-bound).

Indicazioni di partenza, da rifinire con `pg_stat_statements`:

```
shared_buffers            = 2GB
effective_cache_size      = 4GB
work_mem                  = 16MB
maintenance_work_mem      = 512MB
max_connections           = 50      # PostgREST fa pooling per conto suo
max_parallel_workers      = 2       # con 2 core il parallelismo si mangia se stesso
max_parallel_workers_per_gather = 1
autovacuum_vacuum_cost_delay    = 10ms
wal_compression           = on
```

### 4.6 Il lavoro minuto

| Cosa | Dove | Note |
|---|---|---|
| Rigenerare i tipi | `src/types/database.ts` | Generato: va rifatto contro il nuovo DB |
| Tre variabili d'ambiente | `/opt/intranet-sics/.env.local` sulla VM | URL, anon key, service role key. Il file sopravvive a `deploy.sh` (che fa `git reset --hard` sul solo codice) |
| nginx | vhost `intranet.s-ics.com` | Pubblicare `/rest/v1/` e `/auth/v1/` verso 127.0.0.1 |
| Script Node | `scripts/*.mjs`, `*.cjs` | Leggono `SUPABASE_URL` e service key dallo stesso `.env`: cambiano indirizzo, non codice |
| Prototipo BI | `src/lib/prototipo-bi/sorgente.ts` | Il commento «PostgREST ha gli aggregati disabilitati» smette di essere vero: self-hosted si abilitano. È un guadagno |
| Schema cache | — | Dopo ogni DDL serve `NOTIFY pgrst, 'reload schema'`, come già fanno le migration |

---

## 5. Cosa resta su Supabase

Il progetto **non si dismette**: si svuota fino a diventare il backend della sola
app Service. Sul piano free ci sta con enorme margine.

| Oggetto | Peso | Chi lo scrive |
|---|---|---|
| `auth` con i soli 4 operatori | < 1 MB | Creati una volta a mano |
| Schema `service` (`attivita`, `viaggi`, `work_sessions`, `operatori_abilitati`) | 0 righe | **Service** |
| Bucket `service-uploads` | 37 file | **Service** |
| Copia di `articoli_service` e `clienti_service` | ~25 MB | **Interno**, in sola lettura per Service |
| `movimenta_giacenza` + `movimenti_giacenza` | 9 righe | **Service**, rispedito all'interno per audit |

> [!warning] Regola non negoziabile della replica
> **Ogni tabella ha uno scrittore, e uno solo.** Le anagrafiche le scrive il DB
> interno e Supabase le riceve; movimenti e attività li scrive Service e
> l'interno li riceve. Nessuna tabella con due padroni, o si finisce a
> discutere di conflitti su chi ha ragione sulle giacenze.

**Come spingere i dati:** uno script schedulato sulla VM che legge il DB locale e
scrive su Supabase con la service key, dopo il Cruscotto notturno. È lo stesso
pattern della pipeline BI, con gli stessi strumenti e le stesse persone che lo
sanno mantenere. Niente logical replication, niente FDW: 25 MB al giorno non li
meritano.

---

## 6. Piano di esecuzione

Ogni passo dichiara se ci si può fermare senza aver rotto niente.

### Passo 0 — Prerequisiti (nessuna modifica)

- [ ] **D1**: conversazione con chi sviluppa Service. Un prelievo finisce anche
      nel gestionale? Chi scrive cosa?
- [ ] **D3**: i PBIX si aggiornano solo dall'ufficio? Dopo la migrazione
      serviranno LAN o VPN.
- [ ] **D4**: esiste già uno snapshot/backup della VM a livello di
      infrastruttura? Non è verificabile dall'interno della macchina.
- [ ] **D5**: chi tiene i backup e chi si accorge se smettono.
- [ ] **Accesso**: `intra-adm` è nel gruppo `sudo` ma **sudo richiede la
      password**. Serve decidere come operare (vedi §9).

**Fermarsi qui**: sì, è solo informazione.

### Passo 1 — **Non** fare la retention su Supabase

> [!warning] Correzione rispetto alla proposta iniziale
> Il Referto V2 raccomandava di fare la retention **prima** di migrare, per
> spostare 170 MB invece di 700. Con la strategia «Supabase resta come riserva
> finché non è tutto verificato» quella raccomandazione **si rovescia**:
> cancellare 26 run da Supabase significa **indebolire la copia di sicurezza
> proprio mentre la si sta usando come tale**.

Sequenza corretta:

1. si migra **tutto**, compresi i 29 run e i 700 MB di `bi_documenti_raw`;
2. Supabase resta intatto, con la storia completa, come riserva;
3. la retention a 3 run si esegue **sul database della VM**, dove `VACUUM FULL`
   non ha vincoli di quota, di pooler né di finestra condivisa;
4. se qualcosa va storto, Supabase ha ancora tutto.

Il costo aggiuntivo è trascurabile: un dump di 1,9 milioni di righe compresso sta
in ~200 MB e il restore su LAN è questione di minuti. In cambio, **l'unica
operazione irreversibile del piano viene spostata su una macchina dove esiste una
copia integra di ciò che si sta cancellando** — che è esattamente il modo in cui
andrebbe fatta.

Il `VACUUM FULL` su Supabase, di conseguenza, **non si fa affatto**.

Procedura di retention, anteprima e backup dei metadati:
[`docs/bi/REVISIONE-PIANO-BI-V2.md`](../bi/REVISIONE-PIANO-BI-V2.md) §3 — da
applicare al passo 6-bis, non qui.

**Fermarsi qui**: sì, non c'è niente da fare.

### Passo 2 — PostgreSQL sulla VM

> [!warning] Ubuntu 24.04 non ha PostgreSQL 17 — serve il repository PGDG
> Verificato sulla VM il 29/08/2026:
>
> | Pacchetto | Candidato nei repo Ubuntu | Serve |
> |---|---|---|
> | `postgresql-16` | 16.15 | — |
> | `postgresql-17` | **non disponibile** | **17.x** (Supabase è su 17.6) |
> | `postgresql-16-pgvector` | **0.6.0** | **0.8.0** |
>
> Non è un dettaglio di versione: un dump in formato custom prodotto da
> PostgreSQL 17 **non si ripristina su 16**, e lo schema usa funzioni di pgvector
> 0.8 (`halfvec`, `binary_quantize`, `hnsw_bit_support`) che in 0.6 non esistono.
> Con i pacchetti Ubuntu il restore fallisce.
>
> `/etc/apt/sources.list.d/` contiene oggi solo `ubuntu.sources` e
> `nodesource.sources`: **PGDG va aggiunto**.

```bash
# Bozza. Da rivedere prima di eseguire.

# 1. Repository ufficiale PostgreSQL (PGDG)
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
     --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list

# 2. PostgreSQL 17 + estensioni
sudo apt update
sudo apt install -y postgresql-17 postgresql-contrib-17 postgresql-17-pgvector

# 3. Verifica: versione server e versione di pgvector disponibile
sudo -u postgres psql -c "select version()"
sudo -u postgres psql -c "select * from pg_available_extensions where name='vector'"
```

La versione di `pgvector` va confrontata con **0.8.0**: se PGDG ne offre una più
recente va bene (è retrocompatibile), se più vecchia il restore fallisce e va
risolto prima di procedere.

- `postgresql.conf` con il tuning di §4.5.
- `listen_addresses` sulla LAN, **mai su 0.0.0.0 pubblico**.
- `pg_hba.conf` ristretto: la VM stessa (`127.0.0.1`) e il PC di Power BI.
- Creare i ruoli di §4.2 con i nomi esatti.
- **Backup e allarme attivi da subito** (§7), prima che ci siano dati veri:
  è l'unico momento in cui provarli non costa niente.

**Fermarsi qui**: sì, nulla è collegato.

### Passo 3 — Restore di prova e confronto

```bash
# Dump da Supabase (Session Pooler, non Transaction Pooler).
pg_dump --no-owner --no-privileges -Fc -d "<connection string>" -f supabase.dump
pg_restore -d intranet --no-owner --no-privileges supabase.dump
```

Confronto obbligatorio sorgente/destinazione — **non «sembra a posto»**:

| Controllo | Query |
|---|---|
| Righe per tabella | `select relname, n_live_tup from pg_stat_user_tables order by 1` |
| Funzioni: attese **216** | `select count(*) from information_schema.routines where routine_schema in ('public','preventivatore','service','bi')` |
| Vincoli FK: attesi **108** | `select count(*) from pg_constraint where contype='f'` |
| Policy RLS: attese **105** | `select count(*) from pg_policies where schemaname in ('public','preventivatore','service','bi')` |
| Viste `powerbi`: attese **23** | `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='powerbi' and c.relkind='v'` |
| Sequenze allineate | `setval` corretto, o il primo insert va in conflitto di chiave |
| Timezone | `show TimeZone` → deve dare `UTC` su entrambi |
| Checksum sui dati | Somma importi per dataset e per mese sulle viste BI, vecchio contro nuovo |

**Fermarsi qui**: sì, è una copia inerte.

### Passo 4 — PostgREST e GoTrue nativi

Due binari e due unit systemd. **Niente Docker**, coerentemente con la scelta già
fatta per la pipeline BI. Non servono Kong, Realtime, Storage, Studio né edge
runtime: l'inventario di §2.2 dice che nessuno è usato.

```
postgresql-17 + pgvector   apt · systemd
postgrest                  binario statico · systemd · 127.0.0.1:3000
gotrue (supabase/auth)     binario Go   · systemd · 127.0.0.1:9999
nginx                      già presente · /rest/v1/ e /auth/v1/ → 127.0.0.1
```

PostgREST: `db-schemas = "public,preventivatore,service,bi"`, `db-anon-role = anon`,
`jwt-secret` identico a quello di GoTrue, e **`db-aggregates-enabled = true`**
(su Supabase è disabilitato; qui si può accendere).

L'app **non punta ancora** al nuovo stack.

**Fermarsi qui**: sì.

### Passo 5 — Collaudo con una copia dell'app

Con una istanza dell'app puntata al nuovo stack, su una porta diversa:

- [ ] Login e logout con un utente reale; refresh del token dopo scadenza.
- [ ] **Un commerciale ristretto vede esattamente i preventivi di prima.**
- [ ] Builder Preventivatore: creazione, modifica, duplicazione documento.
- [ ] Le 28 RPC rispondono (`dashboard_*`, `ai_*`, `get_preventivatore_context`,
      `crea_documento_dal_builder`, `movimenta_giacenza`, …).
- [ ] Le relazioni annidate PostgREST (`clienti_master(ragione_sociale)`)
      restituiscono i dati incorporati.
- [ ] Ricerca articoli (`pg_trgm`) e ricerca semantica (`pgvector`).
- [ ] `npm run test` verde.

**Fermarsi qui**: sì — ed è il punto in cui si decide davvero.

### Passo 6 — Il taglio (reversibile)

In fascia serale, con Supabase **ancora intatto**:

1. dump finale da Supabase;
2. restore sul DB della VM;
3. tre variabili in `/opt/intranet-sics/.env.local`;
4. `pm2 restart intranet-sics`.

**Rollback**: si rimettono le tre variabili di prima e si riavvia. Costa un
restart.

**Fermarsi qui**: sì. Questo stato — intranet in casa, Supabase intatto come
riserva — **è quello che il committente vuole mantenere finché non è tutto
verificato**, e va tenuto il più a lungo possibile.

### Passo 6-bis — Retention a 3 run, sul DB della VM

Ora che i dati sono in casa e Supabase conserva la storia completa, la
cancellazione dei 26 run diventa un'operazione a rischio quasi nullo:

1. anteprima con la query di [`REVISIONE-PIANO-BI-V2.md`](../bi/REVISIONE-PIANO-BI-V2.md) §3;
2. `bi_runs_storico` popolata con i metadati dei run da eliminare;
3. `DELETE` nell'ordine dichiarato, a lotti;
4. `VACUUM FULL public.bi_documenti_raw` — **qui è libero**: nessuna quota,
   nessun Session Pooler, finestra scelta da noi, 182 GB di spazio temporaneo;
5. `REINDEX` non serve, `VACUUM FULL` ricostruisce già gli indici.

Se il risultato non convince, Supabase ha ancora tutti i 29 run.

### Passo 7 — Power BI

Ripuntare i PBIX su `192.168.1.21:5432`. Stesso driver PostgreSQL, stessi nomi di
vista, stesse colonne: misure e relazioni non si toccano. Un PBIX aggiornato
**senza modificarlo**, con i totali confrontati con il giorno prima.

### Passo 8 — Supabase si riduce al solo Service ⚠️

> [!warning] Punto di non ritorno
> Da qui in poi tornare indietro non è più un cambio di variabili.
> Non eseguire finché il passo 6 non è in esercizio da almeno alcune settimane e
> D1 non ha risposta.

1. Creare i 4 account operatore sul Supabase di Service.
2. Tabella di mappatura UUID (§4.4).
3. Attivare i due flussi di replica (§5).
4. Svuotare da Supabase tutto ciò che non serve a Service.

### Passo 9 — Doppia conservazione

**Un mese** prima di toccare qualunque cosa su Supabase. Costa poco tenerlo e
vale moltissimo il giorno in cui serve.

---

## 7. Backup — condizione, non contorno

> [!warning] Qui si sposta il rischio, e va guardato in faccia
> Oggi Supabase fa backup giornalieri, fuori sede, e se la VM prende fuoco il
> database sopravvive. Portandolo in casa **quella rete di sicurezza sparisce e
> diventa un compito**. E non si tratta più di dati BI rigenerabili: si tratta
> dei preventivi che le persone scrivono tutto il giorno.

| Livello | Cosa | Ritenzione | Dove |
|---|---|---|---|
| Giornaliero | `pg_dump -Fc`, notturno, **prima** della pipeline BI | 7 giorni | Disco VM, partizione separata |
| Settimanale | Lo stesso dump, promosso | 4 settimane | **Fuori dalla VM** |
| Mensile | Lo stesso dump, promosso | 6 mesi | **Fuori sede** |
| PITR | WAL con pgBackRest | 7 giorni | Storage esterno |

Con ~330 MB di database un dump compresso sta in 60–80 MB: sui 182 GB liberi il
costo è invisibile. **Il PITR passa da opzionale a consigliato**, perché la
domanda «quanto lavoro possiamo permetterci di perdere?» ora ha per oggetto i
preventivi.

### Le tre regole

1. **Una copia fuori dalla VM, sempre.** Un dump sullo stesso disco protegge
   dall'errore umano, non dal guasto: sono due rischi diversi e ne copre uno.
2. **Il ripristino va provato**, una volta a trimestre, su un database
   usa-e-getta, contando le righe. Un backup mai ripristinato non è un backup,
   è un file.
3. **Il fallimento deve essere rumoroso.** Un backup che smette in silenzio dà la
   stessa tranquillità senza la sostanza — è lo stesso meccanismo che ha reso
   invisibile per settimane la crescita di `bi_documenti_raw`.

```bash
# Bozza. Il principio conta piu' della sintassi.
0 1 * * *  pg_dump -Fc -d intranet -f /var/backups/pg/intranet-$(date +\%F).dump \
           && find /var/backups/pg -name '*.dump' -mtime +7 -delete

# Il controllo che urla: nessun dump nelle ultime 26 ore, o dump sospetto.
0 8 * * *  test "$(find /var/backups/pg -name '*.dump' -mmin -1560 -size +40M | wc -l)" -ge 1 \
           || mail -s 'BACKUP DB MANCANTE' ...
```

### Monitoraggio in esercizio

- Età e dimensione dell'ultimo dump, con allarme.
- **Spazio libero sul disco della VM.** Il vincolo cambia natura, non sparisce:
  da 500 MB imposti da Supabase si passa a quanti GB ha la partizione — e quando
  finiscono l'app non risponde più, invece di limitarsi a rifiutare le scritture.
- `bi_pipeline_health()`, già esistente.
- Conteggio dei run in `bi_runs`, per verificare che la retention giri.

---

## 8. Costi da accettare consapevolmente

| Costo | Mitigabile | Nota |
|---|---|---|
| La continuità diventa nostra | Sì, con disciplina | Un disco LVM, nessuna replica, e sulla VM oggi non c'è nemmeno un Postgres: zero esperienza operativa in casa |
| Power BI solo da LAN o VPN | Sì, con VPN | Da confermare (D3) |
| Un confine da concordare con Service | **No** | È una conversazione, non lavoro tecnico. Senza, la replica non si progetta |

**Guadagni**, per equità: sparisce il limite dei 500 MB e con esso la retention
obbligata a 3 run; i dati BI smettono di fare il giro dell'Irlanda; il forecast e
un eventuale BI custom girano senza quote di CPU; gli aggregati PostgREST
diventano disponibili.

---

## 9. Blocco operativo immediato

**`sudo` sulla VM richiede la password.** `intra-adm` è nel gruppo `sudo` ma non
può eseguire nulla in modo non interattivo. Nessun passo dal 2 in poi è
eseguibile finché non si sceglie una via:

1. `NOPASSWD` temporaneo per l'utente che esegue la migrazione, revocato a fine
   lavoro;
2. il committente esegue a mano gli script preparati, uno alla volta;
3. una sessione condivisa in cui il committente autentica il sudo.

**Nessuna di queste comporta la condivisione della password con un assistente.**

---

## 10. Decisioni aperte

| # | Domanda | Blocca |
|---|---|---|
| D1 | Un prelievo fatto da Service finisce anche nel gestionale? | Il disegno della replica → passo 8 |
| D2 | Chi sviluppa Service e quando è disponibile? | Passo 0 |
| D3 | I PBIX si aggiornano solo dall'ufficio? | Passo 7 |
| D4 | Esiste già un backup dell'intera VM a livello infrastruttura? | Dimensiona §7 |
| D5 | Chi tiene i backup e chi si accorge se smettono? | §7 — la domanda meno tecnica e la più importante |
| D6 | Come si risolve il blocco sudo? | Tutto dal passo 2 |

---

## Collegato a

- [`docs/bi/REVISIONE-PIANO-BI-V2.md`](../bi/REVISIONE-PIANO-BI-V2.md) — retention a 3 run, da fare prima
- [`docs/bi/fase4/README.md`](../bi/fase4/README.md) — receiver a profili
- [`docs/bi/fase5/README.md`](../bi/fase5/README.md) — pacchetto server Windows
- `CLAUDE.md` — architettura, ruoli, design system
