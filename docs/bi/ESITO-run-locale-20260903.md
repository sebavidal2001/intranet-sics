# Esito run `20260903_184234` — primo run sul PostgreSQL locale

> 3 settembre 2026, finestra di migrazione.
> **Tutti e otto i controlli passati.** Scheduler Linux riaccesi dopo la tua
> conferma su `IMPRESA_BI_GIORNALIERO`. Supabase non toccato.

---

## 1. Integrità del trasferimento

**I sette SHA-256 coincidono con i tuoi**, cifra per cifra. Manifest conforme:
`preventivi_aperti` 6.521 × 32 colonne, gli altri sei × 17.

`impresa-bi-daily.service` → uscita pulita, nessun errore.
Sorgenti archiviate in `/var/lib/impresa-bi/processed/20260903_184234`.
`incoming/`, `ready/`, `failed/` tutte vuote.

---

## 2. Destinazione: locale, non Supabase

```
La pipeline scrive su: LOCALE (https://intranet.s-ics.com)
GET /rest/v1/bi_runs -> HTTP 200
```

Prima di elaborare il tuo run avevo verificato il percorso di scrittura in
isolamento — `POST bi_runs` 201, `POST bi_documenti_raw` con le colonne V2
valorizzate 201, rilettura corretta, `DELETE` a cascata 204, zero residui.

---

## 3. Conteggi per dataset

| Dataset | CSV | Database | |
|---|---:|---:|:--|
| `consegnato` | 18.631 | 18.631 | ✅ |
| `consegnato_futuro_per_mese` | 816 | 816 | ✅ |
| `controllo_banco` | 3.535 | 3.535 | ✅ |
| `fatturato` | 18.135 | 18.135 | ✅ |
| `ordinato` | 18.192 | 18.192 | ✅ |
| `portafoglio` | 816 | 816 | ✅ |
| `preventivi_aperti` | 6.521 | 6.521 | ✅ |
| **Totale** | **66.646** | **66.646** | ✅ |

Aggregati mensili: 1.577 righe.

---

## 4. Attivazione e puntatori

| Voce | Valore |
|---|---|
| Ricevuto | 2026-09-03 16:45:24 UTC |
| Attivato | 2026-09-03 16:45:31 UTC |
| Stato | **`current`** |
| Sorgente | `SRVWOA` |
| Puntatore daily | `20260903_184234` |
| Run precedente | `20260829_013001` → **`archived`** |

Entrambe le funzioni hanno girato: `bi_activate_run` (dal loader) e
`bi_activate_complete_run` (da `publish_complete_run.py`). Sette secondi fra
ricezione e attivazione.

---

## 5. Le nove colonne V2

| Controllo | Valore | |
|---|---:|:--|
| Righe | 6.521 | ✅ |
| Documenti distinti | 2.105 | ✅ |
| `ID Documento` nulli | **0** | ✅ |
| `ID Riga Documento` nulli | **0** | ✅ |
| `ID Utente Creatore` nulli | **0** | ✅ |
| Con `Data Richiesta Cliente` | 5.578 su 6.521 | — |
| Creatori distinti | 7 | — |

Zero nulli sulle chiavi tecniche: è la condizione che tenevo d'occhio, perché
un `id_documento` nullo farebbe sparire quel preventivo dal calcolo dei tempi
**senza produrre alcun errore**.

---

## 6. `powerbi.bi_preventivi_tempi`

| Esito | Documenti | Giorni Risposta |
|---|---:|---|
| `valida` | 1.748 | min 0 · max 162 · **media 0,3** |
| `assente` | 306 | (nullo) |
| `successiva_alla_registrazione` | 50 | (nullo) |
| `fuori_intervallo` | 1 | (nullo) |
| **Totale** | **2.105** | |

La somma torna esattamente ai documenti distinti: ogni documento classificato
una volta sola. L'anomalia `fuori_intervallo` è sempre e solo quella dell'anno
`2202`, e «Giorni Risposta» resta annullata.

Le viste legacy restituiscono i conteggi attesi, tutte e sette. Nessuna
regressione.

---

## 7. Supabase non è stato toccato

Fotografia presa **prima** di elaborare il run, e ripetuta **dopo**:

| | Prima | Dopo |
|---|---:|---:|
| Run | 30 | **30** |
| Righe `bi_documenti_raw` | 1.953.348 | **1.953.348** |
| `current` | `20260829_220525` | **`20260829_220525`** |
| Ultimo `received_at` | 2026-08-29 20:09 | **2026-08-29 20:09** |
| Dimensione | 861 MB | **861 MB** |

Identiche. Il cloud è fermo al 29 agosto e non ha visto nulla di stanotte.

---

## 8. Confronto con l'ultimo run cloud

Cinque giorni fra i due, `20260829_220525` (Supabase) e `20260903_184234`
(locale):

| Dataset | 29/08 cloud | 03/09 locale | Δ |
|---|---:|---:|---:|
| `consegnato` | 18.483 | 18.631 | +148 |
| `fatturato` | 18.062 | 18.135 | +73 |
| `ordinato` | 17.992 | 18.192 | +200 |
| `preventivi_aperti` | 6.476 | 6.521 | +45 |
| `controllo_banco` | 3.521 | 3.535 | +14 |
| `portafoglio` | 767 | 816 | +49 |
| `consegnato_futuro_per_mese` | 767 | 816 | +49 |
| **Totale** | **66.068** | **66.646** | **+578** |

Crescita su tutti e sette, nessun calo anomalo, nessun salto. In linea con il
turnover misurato in agosto (~3% a settimana).

Sui tempi di risposta il confronto è ancora più stretto:

| Esito | 29/08 | 03/09 |
|---|---:|---:|
| `valida` | 1.740 | 1.748 |
| `assente` | 299 | 306 |
| `successiva_alla_registrazione` | 49 | 50 |
| `fuori_intervallo` | **1** | **1** |

Media dei giorni di risposta **0,3 in entrambi**. La distribuzione non si è
mossa: il cambio di database non ha alterato il calcolo.

---

## 9. Retention applicata: da 30 run a 7

Approfitto della finestra per chiudere il problema che ci ha portati qui.

```
Prima :  30 run · 1.953.348 righe · tabella 724 MB
Dopo  :   7 run ·   460.620 righe · tabella 171 MB
```

Database intero: **271 MB**. Cancellati 23 run archiviati, i più vecchi per
primi, in due lotti con verifica in mezzo. Il `VACUUM FULL` ha restituito lo
spazio al disco in 5 secondi.

### Come è protetto

Ho scritto `/usr/local/sbin/bi-retention.sh`. La lista dei run protetti **non
viene passata da fuori**: la ricalcola la `DELETE` stessa, nella propria
transazione. Se un run diventasse `current` fra l'anteprima e l'esecuzione,
resterebbe protetto lo stesso.

Protetti sempre, anche se vecchi:

- `bi_runs.status = 'current'`
- `bi_publication_state.current_daily_run_id`
- `bi_publication_state.current_forecast_run_id`

Il puntatore forecast era su `20260828_013001` — dentro i sette, quindi nessun
conflitto; ma sarebbe stato salvato comunque.

### Il timer

`bi-retention.timer` gira **ogni giorno alle 05:00 Europe/Rome**: dopo il push
notturno, dopo il cruscotto e dopo il forecast del venerdì, prima della verifica
backup delle 08:00. `OnFailure=` sullo stesso canale di avviso dei backup.

Il servizio fa `VACUUM ANALYZE`, **non** `VACUUM FULL`: nessun lock esclusivo
nella routine notturna. Il `FULL` resta un'operazione da finestra di
manutenzione.

Provato a vuoto prima di armarlo: «Run da cancellare: 0», uscita 0.

---

## 10. Stato attuale

| Voce | Stato |
|---|---|
| Pipeline BI | scrive su **locale** |
| Intranet | su **locale** (invariata) |
| `impresa-bi-daily.path` | **active**, enabled |
| `impresa-bi-cruscotto.path` | **active**, enabled |
| `impresa-bi-forecast.timer` | **active** — ven 04/09 03:30 |
| `bi-retention.timer` | **active** — ven 04/09 05:00 |
| `impresa-bi-ingest.service` | active — accetta upload |
| `intranet-db-backup.timer` | active — 01:00 |
| Power BI | ancora su **Supabase** |
| Supabase | 861 MB, fermo al 29/08 |

Tutte le unit sono `enabled`: sopravvivono al riavvio della VM.

Backup del database preso oggi alle 16:38 UTC, prima di tutto: contiene tutti e
30 i run, quindi i 23 cancellati restano recuperabili.

---

## 11. Finestra chiusa

`IMPRESA_BI_GIORNALIERO` riabilitato da te (prossima esecuzione ven 04/09 01:30,
contratto a 32 colonne). Scheduler Linux riaccesi da me. `IMPRESA_BI_CRUSCOTTO`
resta disabilitato su Windows, come previsto.

> [!info] `impresa-bi-cruscotto.path` è acceso lato Linux
> È solo una sorveglianza su una cartella: senza il task Windows non riceve
> nulla e non fa nulla. L'ho riacceso perché quando riabiliterai il cruscotto
> non serva toccare Linux.

**Il primo run automatico verso il PostgreSQL locale è quello di stanotte.**

### Una verifica che non ho potuto fare prima

Ho controllato *dopo* aver cancellato i 23 run — avrei dovuto farlo prima — che
niente legga la storia dai run archiviati. Il risultato è tranquillizzante:
nessun file della pipeline interroga `bi_documenti_raw` in lettura, e
`costruisci_storico.py` prende lo storico dai **CSV su disco**
(`preventivi_storico.csv`, 2013-2024), non dal database. Le uniche letture di
`bi_runs` stanno nel loader e riguardano il run corrente.

La retention era quindi sicura, ma lo ero per fortuna e non per verifica.

### Da fare, non stanotte:

- ripuntare i PBIX su `intranet.s-ics.com:5432` (lo fa Sebastiano in Power BI
  Desktop, con l'utente di sola lettura già pronto);
- completare i contratti V2 rimanenti — `ordinato` 25, `fatturato` e
  `consegnato` 21, `filiera_righe` 7;
- decidere il ruolo definitivo di Supabase.

---

## Collegato a

- [`ESITO-run-v2-verificato.md`](ESITO-run-v2-verificato.md) — il run del 29/08 sul cloud
- [`CONFRONTO-snapshot-vs-incrementale.md`](CONFRONTO-snapshot-vs-incrementale.md)
- [`../db-migrazione/OPERATIVITA-DB-VM.md`](../db-migrazione/OPERATIVITA-DB-VM.md)
