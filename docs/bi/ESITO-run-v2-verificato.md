# Esito verifica run V2 `20260829_220525` — tutti i controlli passati

> 29 agosto 2026, ore 22:20 Europe/Rome.
> **Run pubblicato e verificato. Scheduler Linux riattivati.**
> Nessun intervento sullo schema, nessun rollback.
> Puoi riattivare `IMPRESA_BI_GIORNALIERO`.

---

## 1. Posizione e stato del run

| Voce | Valore |
|---|---|
| Ricevuto | 2026-08-29 20:09:02 UTC |
| Attivato | 2026-08-29 20:09:49 UTC |
| Stato | **`current`** |
| Sorgente | `SRVWOA` |
| Puntatore daily | `20260829_220525` |
| Archiviato in | `/var/lib/impresa-bi/processed/20260829_220525` |
| Marker | `daily_published.json`, `mode: daily` |
| `ready/` | vuota |
| `failed/` | vuota |

**SHA-256 di `preventivi_aperti.csv` all'arrivo:**

```
4d965283705cc8a2bbca6e58496d6072de258d63f7ae57cf549f92ecd048fd0a
```

Identico al tuo. Il file è arrivato integro.

Prima riga del CSV ricevuto:

```
"Codice Gruppo";"Gruppo Descrizione";"Codice Categoria";"Categoria Descrizione";
"Data Documento";"Importo Inevaso";"Codice Articolo";"Descrizione articolo";"Quantità";…
```

`Quantità` con l'accento corretto: l'intestazione aggiunta dal tuo script è
sopravvissuta al trasferimento senza alterazioni.

---

## 2. Loader e funzioni di attivazione

`impresa-bi-daily.service` → `Result=success`, `ExecMainStatus=0`, 7,3 s di CPU.

Sequenza completata: `prepare_current.py` → `costruisci_storico.py` →
`publish_complete_run.py`, con `bi_activate_complete_run` in coda.

```
RAW consegnato: 18483 righe        DAILY fatturato_mensile: 164 righe
RAW consegnato_futuro_per_mese: 767   DAILY pipeline_commerciale: 168
RAW controllo_banco: 3521          DAILY fatturato_bu_mensile: 561
RAW fatturato: 18062               DAILY pipeline_bu_mensile: 672
RAW ordinato: 17992                DAILY consegnato_futuro_mensile: 7
RAW portafoglio: 767
RAW preventivi_aperti: 6476
RUN 20260829_220525 PUBBLICATO IN MODALITÀ DAILY
```

> [!info] Il refactoring ha retto
> Era anche la prima esecuzione reale del modulo condiviso `schemi_dataset.py`
> su dati veri: 66.068 righe attraverso `prepare_current.py` e il loader, senza
> un errore.

---

## 3. Conteggi delle sette estrazioni

| Dataset | CSV (tuo) | Database | |
|---|---:|---:|:--|
| `consegnato` | 18.483 | 18.483 | ✅ |
| `consegnato_futuro_per_mese` | 767 | 767 | ✅ |
| `controllo_banco` | 3.521 | 3.521 | ✅ |
| `fatturato` | 18.062 | 18.062 | ✅ |
| `ordinato` | 17.992 | 17.992 | ✅ |
| `portafoglio` | 767 | 767 | ✅ |
| `preventivi_aperti` | 6.476 | 6.476 | ✅ |
| **Totale** | **66.068** | **66.068** | ✅ |

Aggregati mensili: 1.572 righe, come nei run precedenti.

---

## 4. Le nove colonne nuove

| Controllo | Tuo CSV | Database | |
|---|---:|---:|:--|
| Righe | 6.476 | 6.476 | ✅ |
| Documenti distinti | 2.089 | 2.089 | ✅ |
| `ID Documento` nulli | 0 | **0** | ✅ |
| `ID Riga Documento` nulli | 0 | **0** | ✅ |
| `ID Utente Creatore` nulli | 0 | **0** | ✅ |
| Righe senza `Data Richiesta Cliente` | 918 | **918** | ✅ |
| Documenti senza `Data Richiesta Cliente` | 299 | **299** | ✅ |

Altri valori misurati: `ID Soggetto Commerciale` nulli **0**;
`ID Destinazione` nulli **4.744** su 6.476 (atteso — la maggior parte dei
clienti non ha destinazione); **7 creatori distinti**.

### Confronto con il run precedente

| Run | Righe | Con `Data Richiesta` | Con `ID Documento` | Con `Utente Creatore` |
|---|---:|---:|---:|---:|
| `20260829_220525` (V2) | 6.476 | **5.558** | **6.476** | **6.476** |
| `20260829_013001` (V1) | 6.476 | 0 | 0 | 0 |

Stesso numero di righe fra i due run — nessuna perdita né duplicazione — e le
colonne nuove passano da vuote a piene. 5.558 = 6.476 − 918: coerente.

---

## 5. `powerbi.bi_preventivi_tempi`

**2.089 righe = i documenti distinti.** Il raggruppamento per `ID Documento`
funziona: nessun preventivo contato più volte per le sue righe articolo.

### Distribuzione di `Esito Controllo Data`

| Esito | Documenti | Giorni Risposta |
|---|---:|---|
| `valida` | **1.740** | min 0 · max 162 · **media 0,3** |
| `assente` | 299 | (nullo) |
| `successiva_alla_registrazione` | 49 | (nullo) |
| `fuori_intervallo` | **1** | (nullo) |
| **Totale** | **2.089** | |

La somma torna esattamente ai documenti distinti: **ogni documento è
classificato una volta e una sola**.

### L'anomalia `fuori_intervallo`, isolata

```
Numero Doc. 587 · LOGIMATIC srl · creato da BARBARA GIORIO
Data Richiesta Cliente : 2202-06-16
Data Registrazione     : 2026-06-17
scarto                 : 64.281 giorni
Giorni Risposta        : NULL
```

È l'anno 2202 che avevi trovato: una trasposizione di `2026` in `2202`. La vista
espone la data grezza e **annulla** «Giorni Risposta» — senza quel filtro, un
solo documento su 2.089 avrebbe spostato la media da 0,3 a **31 giorni**.

### I 49 `successiva_alla_registrazione`

Le più distanti:

| Numero Doc. | Cliente | Richiesta | Registrazione | Scarto |
|---|---|---|---|---:|
| 954 | FIVES OTO spa | 2026-04-03 | 2025-09-10 | +205 gg |
| 60 | CENACCHI INTERNATIONAL srl | 2026-08-04 | 2026-01-22 | +194 gg |
| 86 | ALPHAMAC srl | 2026-04-29 | 2026-01-27 | +92 gg |
| 1255 | BEGHELLI spa | 2026-01-30 | 2025-11-28 | +63 gg |

> [!warning] Non sembrano errori di battitura
> Gli scarti sono di mesi e le date sono tutte plausibili in sé. L'ipotesi più
> probabile è che in quei casi il campo venga usato per **un'altra data** — una
> validità, una consegna desiderata, un richiamo programmato — invece che per la
> richiesta.
>
> La vista li segnala e non li corregge, come stabilito. Ma prima che qualcuno
> costruisca un KPI sui tempi di risposta, converrebbe chiederlo a chi inserisce
> i preventivi: sono 49 documenti su 2.089, il 2,3%, quindi non spostano le
> medie — ma cambiano il significato del campo.

---

## 6. Nessuna regressione

| Oggetto | Esito |
|---|---|
| `powerbi.bi_preventivi_aperti` (legacy) | **23 colonne, 6.476 righe** — intatta |
| `powerbi.bi_ordinato` | 17.992 righe |
| `powerbi.bi_fatturato` | 18.062 righe |

Le viste storiche non si sono accorte di niente: elencano colonne esplicite, e
le nove nuove restano invisibili finché qualcuno non le chiede. **I PBIX
esistenti continuano a funzionare senza modifiche.**

---

## 7. Stato finale e orari

Scheduler Linux **riattivati**:

| Unit | Stato |
|---|---|
| `impresa-bi-daily.path` | active |
| `impresa-bi-cruscotto.path` | active |
| `impresa-bi-forecast.timer` | active |
| `impresa-bi-ingest.service` | active |

```
schemi_dataset.py : 32 colonne
config.json       : 32 colonne
→ concordi. Windows deve mandarne 32.
```

### Prossime esecuzioni

| Quando (UTC) | Cosa |
|---|---|
| Sab 29/08 23:00 | Backup del database (= 01:00 Europe/Rome) |
| Dom 30/08 06:00 | Verifica del backup (= 08:00) |
| Ven 04/09 01:30 | Forecast settimanale Prophet (= 03:30) |

**`impresa-bi-daily.path` è in ascolto**: appena riabiliti
`IMPRESA_BI_GIORNALIERO`, il run notturno verrà elaborato automaticamente.

### Puoi procedere

Riattiva pure l'attività Windows. Da parte mia non serve altro: schema
invariato, nessun rollback, contratto a 32 colonne allineato su entrambi i lati.

---

## 8. Sul primo tentativo fallito

`WITH COLUMN NAMES` non supportato da dbisql 11.0.1 — buona diagnosi, e la
soluzione è migliore dell'originale: l'intestazione scritta da uno script che la
**confronta** subito dopo averla aggiunta è più verificabile di una prodotta dal
motore, dove nessuno la guarda finché non arriva a destinazione.

Vale la pena metterlo a verbale: **la versione di dbisql sulla VM è 11.0.1**,
non la 16 che compare nella documentazione della Fase 5. È il tipo di dettaglio
che fa perdere una serata la prossima volta che si tocca la fase di estrazione.

Nessun file era stato inviato e la pipeline aveva ripristinato i CSV precedenti:
il lato Linux non ha visto nulla di quel tentativo.

---

## 9. Una cosa da tenere d'occhio, non urgente

Supabase è ora a **861 MB** (era 836). Il run V2 ha aggiunto ~25 MB e la
retention non è ancora attiva: continua a crescere di un run al giorno.

Non blocca niente adesso — il database accetta scritture — ma è la ragione per
cui lo spostamento della pipeline sul PostgreSQL locale, dove ci sono 177 GB
liberi, resta il prossimo passo sensato.

---

## Collegato a

- [`FINESTRA-V2-lato-linux-pronto.md`](FINESTRA-V2-lato-linux-pronto.md)
- [`ESITO-preparazione-v2.md`](ESITO-preparazione-v2.md)
- [`REFERTO-data-richiesta-cliente.md`](REFERTO-data-richiesta-cliente.md)
