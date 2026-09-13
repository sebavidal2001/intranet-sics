# Prima notte in automatico sul PostgreSQL locale

> 4 settembre 2026, verifica del mattino.
> **Tutta la catena ha funzionato.** Un controllo ha segnalato un'anomalia
> reale e spiegabile, e nel farlo ha portato a galla un difetto più serio.

---

## 1. Cosa è girato stanotte

| Servizio | Esito | Orario (UTC) |
|---|---|---|
| `intranet-db-backup.service` | success | 03/09 23:00 |
| `impresa-bi-daily.service` | success | 03/09 23:31 |
| `impresa-bi-cruscotto.service` | success | 04/09 00:48 |
| `impresa-bi-forecast.service` | success | 04/09 01:30 |
| `bi-retention.service` | success | 04/09 03:00 |
| `intranet-db-verifica.service` | **exit-code 1** | 04/09 06:00 |

Cinque su sei puliti. Il sesto è il caso interessante ed è trattato in §4.

## 2. I due run

| | Commerciale | Cruscotto |
|---|---|---|
| `run_id` | `20260904_013001` | `20260904_023002` |
| Ricevuto | 03/09 23:31:14 | 04/09 00:48:24 |
| Attivato | 03/09 23:31:20 | 04/09 00:48:28 |
| Stato | **`current`** | **`current`** |
| Righe | 66.646 | 26.691 |

Sei secondi fra ricezione e attivazione sul commerciale, quattro sul cruscotto.
Puntatori tutti aggiornati: `current_daily` e `current_forecast` su
`20260904_013001`, `current_cruscotto` su `20260904_023002`.

### Conteggi

| Dataset | Righe |
|---|---:|
| `consegnato` | 18.631 |
| `consegnato_futuro_per_mese` | 816 |
| `controllo_banco` | 3.535 |
| `fatturato` | 18.135 |
| `ordinato` | 18.192 |
| `portafoglio` | 816 |
| `preventivi_aperti` | 6.521 |

> [!info] Identici al run di ieri sera, ed è corretto
> Fra le 18:42 del 3 e l'01:30 del 4 non c'è attività commerciale: nessun
> documento inserito, nessuna riga cambiata. La crescita misurata in agosto era
> di ~116 righe al giorno, tutte concentrate in orario di ufficio.

Colonne V2 su `preventivi_aperti`: 6.521 righe, 2.105 documenti, **zero nulli**
su `id_documento` e `id_riga_documento`, 5.578 con `Data Richiesta Cliente`.

## 3. Retention

Ha fatto esattamente il suo mestiere, senza che nessuno guardasse:

```
Run da cancellare  : 1
  cancellato 20260824_013001  ->  righe: 65157  run: 1
VACUUM ANALYZE su bi_documenti_raw...
7|462109|197 MB
```

L'aritmetica torna: 460.620 − 65.157 + 66.646 = **462.109**. Sette run, tabella
197 MB, database 306 MB.

---

## 4. Il controllo che ha segnalato — e aveva ragione

```
PROBLEMI RILEVATI:
Il backup si e' piu' che dimezzato rispetto a ieri (41 MB contro 97 MB).
```

**È un vero positivo, e la causa siamo noi.** Il dump del 2 settembre pesava
101,8 MB, quello del 3 pesa 43,3 MB: la retention ha tolto 23 run e il
`VACUUM FULL` ha restituito lo spazio al disco. Il database è passato da 861 MB
a 306 MB, quindi il dump si è dimezzato per costruzione.

Il controllo confronta con il giorno prima, quindi si risolve da solo: domani
confronterà 41 MB con 41 MB. Anche la bandierina `GUASTO.txt` verrà cancellata
stanotte alle 23:00, perché il backup riuscito la rimuove.

Non c'è niente da correggere qui. Il controllo ha funzionato come doveva.

---

## 5. Il difetto vero, trovato tirando quel filo

L'avviso `OnFailure=` è partito e **è fallito**:

```
invio avviso fallito: SMTPAuthenticationError
```

Ho guardato quante volte aveva funzionato prima. **Mai.**

```
tentativi falliti registrati: 4
primo fallimento: 2026-08-29T12:43:22   ← il giorno in cui l'ho scritto
invii riusciti: 0
```

### La causa

L'applicazione legge `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_PORT`,
`SMTP_FROM`. **Il mio script leggeva `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS`.**

Entrambe le famiglie compaiono nel progetto, ma solo una è quella viva. Ho
scritto lo script guardando `.env.local`, ho visto delle variabili di posta
valorizzate e le ho usate senza verificare che fossero **quelle che l'app
usa davvero**.

### E c'è di peggio

`.env.local` contiene `EMAIL_*` e **nessuna `SMTP_*`**:

```
.env.local.example   SMTP_: 6   EMAIL_: 0     (17 maggio 2026)
.env.local           SMTP_: 0   EMAIL_: 5     (contenuto del 12 maggio 2026)
```

Il file di esempio — la configurazione documentata — dichiara sei variabili
`SMTP_*` e zero `EMAIL_*`. Il file vivo ha l'esatto contrario.

**Quindi l'intranet non può mandare email.** Le variabili che il codice legge
non esistono, e quelle che esistono vengono rifiutate dal server:

```
smtp.zoho.eu:465 → 535 Authentication Failed
```

Riguarda anche l'applicazione, non solo i miei avvisi: la route
`/api/portali/valutazioni/sessioni/sblocca` manda l'email ai valutatori quando
una sessione viene sbloccata. Con `process.env.SMTP_HOST` non definita, quella
email non parte.

> [!info] Non è una regressione della migrazione
> La copia originale intatta del file, `env.local.SUPABASE-ORIGINALE`, ha
> contenuto datato **12 maggio 2026** e già allora conteneva `EMAIL_*` e nessuna
> `SMTP_*`. La situazione precede di mesi lo spostamento del database. Nessuna
> delle commutazioni ha tolto niente: `commuta-db.sh` copia il file, non lo
> riscrive.

### Cosa ho corretto

`intranet-db-avvisa.py` ora legge `SMTP_*` e usa `EMAIL_*` solo come ripiego, e
il messaggio d'errore dice **quale** server e **quale** utente sono stati
rifiutati invece del solo nome dell'eccezione:

```
Invio fallito: SMTPAuthenticationError (server smtp.zoho.eu:465, utente val***)
```

### Cosa serve da voi

Una credenziale valida. Vanno aggiunte a `/opt/intranet-sics/.env.local` le
variabili che l'applicazione si aspetta:

```
SMTP_HOST=…
SMTP_PORT=…
SMTP_USER=…
SMTP_PASSWORD=…
SMTP_FROM=…
```

Su Zoho, se l'account ha la verifica in due passaggi, serve una **password
specifica per applicazione**, non quella di accesso. Le vecchie `EMAIL_*` a quel
punto si possono togliere.

Non ho inventato né indovinato nulla: la password la mettete voi.

> [!warning] È il quarto controllo in questo progetto che non controllava
> Prima `/api/ping`, che restituiva il timestamp di build senza toccare il
> database. Poi la ritenzione dei backup, dove `-o` senza parentesi impediva la
> cancellazione dei `.dump`. Poi l'attività Windows verde su un esito fallito.
> Ora il mio sistema di allarme, che per sei giorni non ha potuto suonare.
>
> I primi tre li ho trovati nel lavoro altrui. Questo è mio, ed è dello stesso
> tipo: **scritto, mai provato facendolo fallire.** Bastava un invio di prova il
> giorno in cui l'ho installato.

---

## 6. Il resto, tutto a posto

| Voce | Esito |
|---|---|
| Backup 03/09 | 43,3 MB, con impronta |
| Copertura impronte | giornalieri 12/12, settimanali 2/2, mensili 2/2 |
| Pull da `SRVWOA` | 04/09 00:15:02, sessione di 11 secondi |
| Intranet | homepage 307, `/rest/v1/` 200, `/auth/v1/health` 200 |
| Supabase | **invariato**: 30 run, 1.953.348 righe, fermo al 29/08, 861 MB |

La correzione delle promozioni ha retto: tutte le impronte al loro posto e il
pull non ha più protestato.

### Power BI si è collegato, e funziona

> [!warning] Correzione: la prima versione di questo referto diceva il contrario
> Avevo cercato le connessioni nei log di sistema. Ma `log_connections` è **off**
> — l'impostazione predefinita — quindi le connessioni **riuscite** non finiscono
> nei log. Non avevo la prova dell'assenza: avevo l'assenza di prove, e le ho
> scambiate per la stessa cosa.
>
> La fonte giusta era `pg_stat_statements`, che tiene il conto per utente.

Dal 3 settembre, `powerbi_reader` ha eseguito **410 chiamate** restituendo
**284.138 righe**, per 24,1 secondi di esecuzione complessiva. Le query portano
la firma del motore Mashup (`"$Table"."Codice Gruppo"`), preceduta dalle
interrogazioni di metadati tipiche del driver Npgsql.

| Vista | Chiamate | Righe | Peggiore |
|---|---:|---:|---:|
| `bi_ordinato` | 7 | 72.771 | 2.176 ms |
| `bi_consegnato` | 6 | 71.531 | 3.914 ms |
| `bi_fatturato` | 5 | 68.425 | 1.562 ms |
| `bi_preventivi_aperti` | 5 | 25.469 | 1.458 ms |
| `bi_controllo_banco` | 6 | 15.141 | 2.872 ms |
| `bi_consegnato_futuro_per_mese` | 5 | 3.265 | 140 ms |
| `bi_portafoglio` | 5 | 3.265 | 133 ms |
| `bi_forecast_completo` | 3 | 361 | <1 ms |
| `bi_pipeline_commerciale` | 3 | 337 | <1 ms |
| `bi_forecast_2026` / `_2027` | 3 + 3 | 25 + 25 | <1 ms |

**Il caricamento più lento è durato 3,9 secondi**, contro un `statement_timeout`
di 5 minuti: margine ampio, nessun rischio di interruzione sui refresh.

`bi_cruscotto_articoli_corrente` risulta letta una sola volta con una riga: è la
mia verifica di ieri, non un caricamento. Il PBIX del Cruscotto non l'ha ancora
usata — l'ho concessa a sera inoltrata.

### Il perimetro tiene

`bi_preventivi_tempi` compare nelle statistiche ma **resta negata**: era il mio
tentativo fallito, registrato comunque. Riprovata ora da connessione reale:

```
ERROR:  permission denied for view bi_preventivi_tempi
bi_ordinato: 18192
concessioni totali: 12
```

> [!todo] Vale la pena accendere `log_connections`
> Senza, alla domanda «qualcuno si è collegato?» il sistema non sa rispondere, e
> ci si affida a `pg_stat_statements`, che però si azzera a ogni riavvio del
> servizio. Il costo è una riga di log per connessione: PostgREST le tiene
> aperte a lungo e Power BI si collega a raffiche, quindi il volume sarebbe
> trascurabile. Non l'ho attivato di mia iniziativa.

---

## Collegato a

- [`ACCESSO-POWERBI-postgres-locale.md`](ACCESSO-POWERBI-postgres-locale.md)
- [`ESITO-cruscotto-locale-e-backup-20260903.md`](ESITO-cruscotto-locale-e-backup-20260903.md)
- [`ESITO-run-locale-20260903.md`](ESITO-run-locale-20260903.md)
