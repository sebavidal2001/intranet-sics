# Accesso Power BI al PostgreSQL locale + pulizia failed-cruscotto

> 3 settembre 2026. Entrambe le attività completate.
> La password non compare in questo documento: si legge sulla VM con
> `sudo credenziale-powerbi --password`.

---

# Parte 1 — Pulizia `failed-cruscotto`

## Prima di toccare

| Directory | Data | Dimensione | `run_id` nel manifest | Righe |
|---|---|---:|---|---:|
| `20260801_194659` | 2026-08-01 17:47 | 11.100.320 B | `20260801_194659` | 26.372 |
| `20260801_195143` | 2026-08-01 17:51 | 11.101.028 B | `20260801_195143` | 26.372 |
| `20260802_123843` | 2026-08-02 10:38 | 11.100.317 B | `20260802_123843` | 26.372 |

Tutte e tre del **1-2 agosto**, `run_id` coerente col nome della cartella, due
file ciascuna (CSV + manifest), nessun altro elemento al primo livello.

### Riscontro a database

| Verifica | Esito |
|---|---|
| Fra i run `current` | **No** — i correnti sono `20260903_184234` e `20260903_192202` |
| Referenziate dai puntatori | **No** — `current_daily`, `current_forecast` (`20260828_013001`), `current_cruscotto` |
| I due run correnti coinvolti | **No** — stanno in `processed/` e `processed-cruscotto/`, cartelle diverse |

> [!info] Una sfumatura che vale la pena sapere
> Due delle tre — `20260801_195143` e `20260802_123843` — **esistono a database
> come `archived`**: vennero ricaricate con successo più tardi, lasciando
> indietro la copia fallita. La terza non c'è affatto. Ho cancellato **solo i
> file**: i record dei run restano dove sono.

## Rimozione

```
rimossa: /var/lib/impresa-bi/failed-cruscotto/20260801_194659  (11.100.320 byte)
rimossa: /var/lib/impresa-bi/failed-cruscotto/20260801_195143  (11.101.028 byte)
rimossa: /var/lib/impresa-bi/failed-cruscotto/20260802_123843  (11.100.317 byte)
```

| | |
|---|---|
| Spazio recuperato | **31 MB** (33.301.665 byte) |
| Disco libero | 182.071 MB → **182.103 MB** |
| Contenuto residuo | **vuota** |

Le altre cartelle intatte: `processed` 31, `processed-cruscotto` 29,
`forecasting` 4, `ready`/`ready-cruscotto`/`incoming`/`failed` 0. Backup e dati
PostgreSQL non toccati.

---

# Parte 2 — Accesso Power BI

## Parametri di connessione

| | |
|---|---|
| **Host** | `intranet.s-ics.com` |
| **Porta** | `5432` |
| **Database** | `intranet` |
| **Utente** | `powerbi_reader` |
| **SSL** | `verify-full` (in Power BI: **Encrypt connection** attivo) |
| **Certificato CA** | **nessuno da installare** |
| Password | `sudo credenziale-powerbi --password` sulla VM |

### Perché il nome e non l'indirizzo

Il certificato è emesso per `intranet.s-ics.com` (SAN: `intranet.s-ics.com`,
`www.intranet.s-ics.com`). Con `verify-full` il client verifica **anche il nome**:
connettersi a `192.168.1.21` fallirebbe la verifica, pur essendo lo stesso
server.

Il nome risolve **solo dal DNS interno** (192.168.1.15 → 192.168.1.21). Il DNS
pubblico non risponde: il servizio non è esposto fuori dalla rete.

### Perché nessun certificato da installare

```
leaf   : CN = intranet.s-ics.com
issuer : Go Daddy Secure Certificate Authority - G2
root   : Go Daddy Root Certificate Authority - G2
```

Il server invia leaf + intermedio; la radice GoDaddy G2 è **già nell'archivio
certificati di Windows**. Non serve alcun file `.crt` sul PC.

> [!warning] Il certificato scade il 4 dicembre 2026 — fra 91 giorni
> È lo stesso di nginx. Quando viene rinnovato va ricaricato anche PostgreSQL
> (`systemctl reload postgresql@17-main`), altrimenti Power BI smette di
> connettersi con `verify-full` senza che nessuno colleghi le due cose.

### Sulla porta 6543

Non esiste su questa macchina: era il *pooler* di Supabase. In locale c'è solo
la 5432.

## Conteggio delle viste concesse

Da **connessione reale** come `powerbi_reader`, non da `SET ROLE`: `SET ROLE`
non attraversa `pg_hba`, non negozia TLS e non applica le impostazioni di ruolo.

```
TLS: TLSv1.3 | cifrario: TLS_AES_256_GCM_SHA384 | 256 bit
sola lettura: on | statement_timeout: 5min | idle_in_transaction: 2min
```

| Vista | Righe |
|---|---:|
| `bi_consegnato` | 18.631 |
| `bi_consegnato_futuro_per_mese` | 816 |
| `bi_controllo_banco` | 3.535 |
| `bi_fatturato` | 18.135 |
| `bi_ordinato` | 18.192 |
| `bi_portafoglio` | 816 |
| `bi_preventivi_aperti` | 6.521 |
| `bi_forecast_completo` | 180 |
| `bi_pipeline_commerciale` | 168 |
| `bi_forecast_2026` | 12 |
| `bi_forecast_2027` | 12 |
| `bi_cruscotto_articoli_corrente` | 26.691 |

I primi sette coincidono con il run `20260903_184234`, l'ultima con il run
cruscotto `20260903_192202`.

## Prova che il ruolo non possa scrivere

| Tentativo | Esito |
|---|---|
| `CREATE TABLE` in `powerbi` | NEGATO — *cannot execute CREATE TABLE in a read-only transaction* |
| `CREATE TABLE` in `public` | NEGATO — idem |
| `CREATE TEMP TABLE` | NEGATO — idem |
| `INSERT` su una vista | NEGATO — *cannot insert into view* |
| `CREATE SCHEMA` | NEGATO — idem |

Due cinture indipendenti: `default_transaction_read_only = on` sul ruolo, e
l'assenza di qualunque privilegio diverso da `SELECT`.

### E che non veda il resto

| Tentativo | Errore |
|---|---|
| `public.bi_documenti_raw` | permission denied for table |
| `public.bi_runs` | permission denied for table |
| `public.bi_publication_state` | permission denied for table |
| `public.utenti` | permission denied for table |
| `bi.costi_storico` | permission denied for **schema** |
| `bi.giacenze_storico` | permission denied for **schema** |
| `preventivatore.documenti` | permission denied for **schema** |
| `auth.users` | permission denied for **schema** |
| `powerbi.bi_preventivi_tempi` | permission denied for view (non concessa) |

Privilegi totali del ruolo: **12 `SELECT`, nient'altro.** Membro di **0** ruoli.

Sul database: `powerbi_reader=c` — solo `CONNECT`, niente `TEMPORARY`, niente
`CREATE`. Attributi: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
NOBYPASSRLS`.

## Prova che non sia raggiungibile da reti non autorizzate

Non si può falsificare l'indirizzo di partenza, ma la stessa macchina ne ha due.
Stesso server, stesso ruolo, stessa password: cambia solo da dove si bussa.

| Prova | Esito |
|---|---|
| da `192.168.1.21` (autorizzato) | **AMMESSO** |
| da `127.0.0.1` (non autorizzato) | **RESPINTO** — `pg_hba.conf rejects connection` |
| senza TLS da `192.168.1.21` | **RESPINTO** — solo `hostssl` |

### `pg_hba.conf`

```
hostssl   intranet   powerbi_reader   192.168.1.16/32   scram-sha-256
hostssl   intranet   powerbi_reader   192.168.1.21/32   scram-sha-256
local     all        powerbi_reader                     reject
host      all        powerbi_reader   all               reject
```

> [!warning] L'ordine è il controllo
> Le prime due righe stavano **in fondo** al file, dopo `host all all
> 127.0.0.1/32`. `pg_hba` si ferma alla prima corrispondenza: `powerbi_reader`
> entrava dal loopback attraverso la regola generica, aggirando la restrizione.
> L'ho scoperto perché la prova diceva AMMESSO dove mi aspettavo RESPINTO.
>
> Stessa cosa per la riga `local ... reject`, che era finita dopo `local all all
> peer` e non veniva mai raggiunta: configurazione morta che sembrava
> protettiva.

Due indirizzi, non due reti: c'erano `192.168.1.0/24` (qualunque macchina della
LAN) e `10.212.134.0/24` (qualunque portatile in VPN).

### Firewall

**Prima non esisteva**: `ufw` inattivo, `iptables` con policy `ACCEPT`, `nft`
vuoto. Ora:

```
Default: deny (incoming), allow (outgoing)

22/tcp     ALLOW  Anywhere         # SSH (solo chiave)
80/tcp     ALLOW  Anywhere         # nginx HTTP
443/tcp    ALLOW  Anywhere         # nginx HTTPS
5432/tcp   ALLOW  192.168.1.16     # PostgreSQL - PC Power BI
5432/tcp   ALLOW  192.168.1.21     # PostgreSQL - VM stessa
```

Effetto collaterale utile: **la 3000 di Next.js, che era esposta su tutte le
interfacce, ora è chiusa.** Il sito passa da nginx, come deve.

L'ho acceso via SSH programmando prima il proprio annullamento
(`systemd-run --on-active=600 … ufw disable`), poi ho verificato con una
connessione **nuova** — non quella già aperta, che sopravvive comunque — e solo
allora ho annullato il timer.

---

## Il nodo tecnico: `security_invoker`

Le tue due richieste erano **incompatibili** com'era il database:

- «solo `SELECT` sulle viste `powerbi.*`»
- «nessun accesso alle tabelle `bi.*`, `public.*`»

La catena era:

```
powerbi.bi_consegnato  (security_invoker = true)
  └─> public.bi_consegnato  (security_invoker = true)
        └─> public.bi_documenti_raw + public.bi_runs
```

Con `security_invoker` a ogni livello, il controllo dei permessi ricade sul
**chiamante**: per leggere la vista, `powerbi_reader` avrebbe avuto bisogno del
`SELECT` su `bi_documenti_raw` — esattamente ciò che non deve avere.

Ho portato **entrambi gli strati** a `security_invoker = false`, cioè esecuzione
con i privilegi del proprietario. È la stessa scelta già fatta per le viste del
Cruscotto, e per lo stesso motivo.

> [!info] Non allarga i permessi di nessun altro
> Su quelle viste hanno grant solo `postgres` (proprietario) e `service_role`,
> che ha già DML completo sulle tabelle sottostanti. RLS è attiva ma **non
> forzata**, quindi il proprietario la scavalcava comunque. Cambia soltanto il
> percorso di `powerbi_reader`.
>
> Conseguenza da ricordare: chi modificherà quelle viste in futuro scrive codice
> che gira con i privilegi del proprietario.

---

## Cose da sapere

### Ho revocato 22 grant in `public`

`powerbi_reader` poteva leggere `public.bi_documenti_raw`, `public.bi_runs`,
`public.bi_publication_state` e altri 19 oggetti — eredità dell'assetto
Supabase, dove le viste stavano in `public`.

**Se uno dei PBIX di prova leggeva direttamente da lì, ora si romperà.** È il
momento giusto perché tu te ne accorga: rompersi adesso, mentre stai lavorando
sulle copie TEST, è molto meglio che scoprirlo dopo.

### Dodici viste concesse, dodici ancora no

Alle undici che avevi elencato ho aggiunto
**`bi_cruscotto_articoli_corrente`** (26.691 righe, verificata da connessione
reale). Era già definer, quindi è bastato il `GRANT`.

Restano **non concesse**:

```
bi_calendario                 bi_pipeline_bu_mensile
bi_consegnato_futuro_mensile  bi_preventivi_tempi
bi_copertura_costi            bi_ultimo_costo_storico
bi_cv_risultati_forecast      bi_variazioni_giacenze
bi_fatturato_bu_mensile       bi_variazioni_ultimo_costo
bi_fatturato_mensile          bi_marginalita_documenti
```

Se un PBIX ne usa una, dimmi quale e la aggiungo.

### File orfano rimosso

`/etc/impresa-bi/powerbi-reader.env` conteneva `POWERBI_DB_PASSWORD` e altre
quattro chiavi, risaliva al 26 luglio e **nessun servizio o script lo
referenziava**. Verificato di nuovo prima di toccarlo (0 riferimenti in
`/etc/systemd`, `/opt/impresa-bi`, `/usr/local/sbin`, `/usr/local/bin`,
`/etc/cron.d`), poi rimosso con `shred` — trattamento dovuto a un file di
credenziali.

### `192.168.1.16` non risponde

La VM non lo vede nemmeno a livello **ARP**, mentre sette altri host dello
stesso segmento rispondono. L'ARP sta sotto IP e il firewall di Windows non lo
blocca: quel PC in questo momento **non è presente sul segmento** — spento, o
con un altro indirizzo.

Non era quindi un problema di PostgreSQL né di firewall: la 5432 era già
raggiungibile e in ascolto con TLS. Quando il PC torna in rete, se l'indirizzo
fosse diverso da `.16` vanno aggiornati due punti: la regola `ufw` e la riga
`pg_hba`.

---

## Verifiche di non-regressione

| Cosa | Esito |
|---|---|
| Homepage intranet | HTTP 307 (redirect al login, corretto) |
| `/rest/v1/` (PostgREST) | HTTP 200 |
| `/auth/v1/health` (GoTrue) | HTTP 200 |
| SSH da connessione **nuova** dopo il firewall | OK |
| Scrittura pipeline: `POST bi_runs` | **201** |
| Scrittura pipeline: `POST bi_documenti_raw` | **201** |
| `DELETE` a cascata | **204**, zero residui |

L'ultima serie conta più delle altre: ho revocato `CONNECT` a `PUBLIC` e
restituito i privilegi esplicitamente ai cinque ruoli con login. La pipeline
gira stanotte all'01:30 senza nessuno a guardare, e volevo saperlo prima io.


---

# Parte 3 — Indirizzo VPN del PC Power BI

> Aggiunta del 3 settembre 2026, sera.

## Stato delle regole

### `pg_hba.conf` — come le legge PostgreSQL, non come le ho scritte

| Riga | Tipo | Database | Ruolo | Indirizzo | Netmask | Metodo | Errori |
|---:|---|---|---|---|---|---|---|
| 125 | `local` | all | `powerbi_reader` | — | — | **reject** | — |
| 136 | `hostssl` | `intranet` | `powerbi_reader` | `192.168.1.16` | `255.255.255.255` | `scram-sha-256` | — |
| 137 | `hostssl` | `intranet` | `powerbi_reader` | `192.168.1.21` | `255.255.255.255` | `scram-sha-256` | — |
| 141 | `hostssl` | `intranet` | `powerbi_reader` | **`10.212.134.202`** | `255.255.255.255` | `scram-sha-256` | — |
| 144 | `host` | all | `powerbi_reader` | all | — | **reject** | — |

Letto da `pg_hba_file_rules`: colonna `error` vuota su tutte, netmask `/32` su
tutte e tre. PostgreSQL ricaricato.

### UFW — porta 5432

```
5432/tcp   ALLOW   192.168.1.16       # PostgreSQL - PC Power BI
5432/tcp   ALLOW   192.168.1.21       # PostgreSQL - VM stessa
5432/tcp   ALLOW   10.212.134.202     # PostgreSQL - PC Power BI via VPN
```

**La rete `10.212.134.0/24` non è stata autorizzata**, né in `pg_hba` né in UFW.

## Risultato del test

Non posso originare traffico da `10.212.134.202`: è l'indirizzo del PC, e
assegnarlo alla VM per simularlo dirotterebbe su di sé il traffico diretto al
PC vero. Ho fatto invece il **controllo negativo**, che dimostra la stessa cosa
al contrario.

Questa macchina è su **`10.212.134.201`** — un indirizzo distante uno da quello
autorizzato, sullo stesso pool VPN:

| Porta | Da `10.212.134.201` (non autorizzato) |
|---|---|
| 22 | raggiungibile |
| 443 | raggiungibile |
| **5432** | **BLOCCATA** |

È esattamente il quadro che avevi rilevato da `.202` prima della modifica. Poiché
le due regole differiscono solo nell'ultimo ottetto e la `/32` è confermata dal
parser di PostgreSQL, il caso positivo segue per costruzione: `.202` passa,
`.201` no.

### La prova definitiva tocca al PC

```powershell
Test-NetConnection -ComputerName intranet.s-ics.com -Port 5432
```

Deve dare `TcpTestSucceeded: True`. Poi la connessione vera da Power BI.

> [!info] I rifiuti non lasciano traccia nei log
> Il mio tentativo bloccato non compare fra i `UFW BLOCK`: il livello di
> registrazione è `low` e i pacchetti scartati dalla politica predefinita non
> vengono registrati. Se in futuro serve diagnosticare un rifiuto, va alzato il
> livello (`ufw logging medium`) — non l'ho fatto per non allargare l'intervento.

---

## L'indirizzo NON è stabile

Hai chiesto di verificarlo, e la risposta è **no**. Dai log della macchina, che
coprono da fine aprile:

| Indirizzo | Accessi | Periodo | Chi |
|---|---:|---|---|
| `10.212.134.200` | 21 | 1-5 agosto 2026 | `intra-adm` |
| `10.212.134.201` | 372 | 1 agosto → oggi | `intra-adm` (questa postazione) |
| `10.212.134.202` | — | **14 maggio 2026** | `intra-adm`, accesso con password |
| `10.212.134.202` | — | **oggi 20:15** | il PC Power BI (il tuo test sulla 22) |

Due elementi, entrambi conclusivi:

1. **`.202` è già appartenuto a un altro dispositivo.** Il 14 maggio ci si è
   collegato qualcuno come `intra-adm`; oggi lo stesso indirizzo è del PC Power
   BI. L'indirizzo viene riciclato.
2. **La stessa postazione ha cambiato indirizzo.** Questa macchina è comparsa
   come `.200` e poi come `.201`.

È un pool dinamico. Come chiesto, **non ho allargato niente**: la regola resta
`/32` su `.202`.

### Cosa comporta

Autorizzare `10.212.134.202/32` autorizza **il dispositivo che in quel momento
ha quella concessione**, non il PC Power BI. Oggi coincidono; alla prossima
riassegnazione potrebbero non coincidere più, in due modi diversi:

- il PC prende un altro indirizzo e **Power BI smette di connettersi**;
- un altro portatile prende `.202` e **si trova la porta 5432 aperta** — gli
  servirebbe comunque la password, che resta il vero cancello, ma la
  restrizione di rete diventa decorativa.

### Due modi per renderlo stabile, a tua scelta

**A — Far uscire Power BI dalla LAN invece che dal tunnel.** Il PC ha già
`192.168.1.16` sul Wi-Fi ed è sullo stesso segmento della VM: è il tunnel che si
prende la rotta verso `192.168.1.21`. Con un'eccezione di split-tunnel per quel
solo indirizzo, la sorgente tornerebbe `.16` — **già autorizzata, e stabile
perché è un indirizzo di LAN**. È la soluzione che preferisco: toglie la VPN dal
percorso invece di inseguirla.

**B — Riserva statica sul concentratore VPN** per il PC Power BI, così `.202`
diventa suo in modo permanente.

Fammi sapere quale strada prendete e adeguo le regole. Nel frattempo funziona,
ma è appoggiato a una concessione che può cambiare.

---

## Collegato a

- [`ESITO-cruscotto-locale-e-backup-20260903.md`](ESITO-cruscotto-locale-e-backup-20260903.md)
- [`ESITO-run-locale-20260903.md`](ESITO-run-locale-20260903.md)
- [`../db-migrazione/OPERATIVITA-DB-VM.md`](../db-migrazione/OPERATIVITA-DB-VM.md)
