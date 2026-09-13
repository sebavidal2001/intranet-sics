# Finestra V2 — lato Linux a 32 colonne, in attesa di Windows

> 29 agosto 2026, ore 21:52 Europe/Rome.
> Passi 1-4 eseguiti. **Fermo al passo 5 come da tue istruzioni**: scheduler
> fermi, nessun run lanciato.

---

## 1. La tua correzione: hai ragione, ed era un difetto ironico

Lo script che doveva intercettare il mojibake ne è stato vittima. L'ho salvato
in UTF-8 senza BOM e Windows PowerShell legge i `.ps1` come ANSI quando il BOM
manca: le attese `Quantità` e `Quantità evasa` diventavano mojibake **nel
confronto stesso**, e il CSV corretto veniva rifiutato.

La tua soluzione — sorgente interamente ASCII e `[char]0x00E0` per costruire la
lettera — è più robusta di un BOM, perché non dipende da come il file viene
salvato o trasferito. Adotto la tua versione e ritiro la mia.

---

## 2. Esito dei passi 1-4

### Stato prima di toccare

```
Run in corso        : nessuno (daily, cruscotto, forecast tutti inactive)
incoming/           : 0 elementi
ready/              : 0 elementi
ready-cruscotto/    : 0 elementi
Contratto           : 23 / 23, concordi
```

### Passo 1 — Scheduler sospesi

| Unit | Stato |
|---|---|
| `impresa-bi-daily.path` | **inactive** |
| `impresa-bi-cruscotto.path` | **inactive** |
| `impresa-bi-forecast.timer` | **inactive** |
| `impresa-bi-ingest.service` | **active** — continua ad accettare upload |

### Passo 3 — Scambio eseguito

Copie di sicurezza create prima di toccare:

```
/opt/impresa-bi/schemi_dataset.py.prima-scambio-20260829-195247
/etc/impresa-bi/config.json.prima-scambio-20260829-195247
```

### Passo 4 — Verifica

```
schemi_dataset.py : 32 colonne
config.json       : 32 colonne
→ concordi. Windows deve ora mandarne 32.
```

Receiver riavviato alle **19:52:47 UTC**, con conferma nel log che ha riletto la
configurazione:

```
Started impresa-bi-ingest.service - Impresa BI ingest bridge.
2026-08-29 19:52:47,625 INFO BI ingest in ascolto su 127.0.0.1:8765
2026-08-29 19:52:50,537 INFO 127.0.0.1 - "GET /health HTTP/1.1" 200 -
```

Le nove colonne nuove, lette **dal modulo caricato in memoria** e non dal file:

```
24 Data Richiesta Cliente      28 Data Creazione Documento
25 ID Utente Creatore          29 ID Soggetto Commerciale
26 Codice Utente Creatore      30 ID Destinazione
27 Utente Creatore             31 ID Documento
                               32 ID Riga Documento
```

Gli altri sei dataset restano a **17**. `bi_documenti_raw`: **35 colonne**.

---

## 3. Due cose da sapere, ora che siamo disallineati

**Il receiver è attivo e rifiuterà qualsiasi CSV a 23 colonne** con «colonne
manifest non valide». È il comportamento voluto — nessun caricamento accidentale
nel formato vecchio — ma se qualcosa su `SRVWOA` facesse partire un'estrazione
prima della tua distribuzione, la vedresti fallire lì e non qui.

**Il backup del database dell'01:00 non è sospeso.** È un timer separato
(`intranet-db-backup.timer`), non fa parte della pipeline BI. Se la finestra si
allungasse oltre l'una gira comunque: legge il database, non la pipeline, quindi
non interferisce.

---

## 4. Tocca a te

1. Distribuisci la query V2 e il `config.json` di `Invoke-BIPipeline`.
2. Esegui la tua versione di `Verifica-IntestazioneV2.ps1` sul CSV prodotto.
3. Lancia il run controllato.

**Dimmi quando il run è partito.** Verificherò e ti restituirò:

- `run_id` e conteggi per dataset;
- esito di `bi_activate_run` e `bi_activate_complete_run`;
- prime righe caricate, con le nove colonne nuove valorizzate;
- quanti `id_documento` nulli sul run completo — non solo sulle venti del TOP 20
  (vedi §5);
- confronto con l'ultimo run cloud;
- stato di timer e path.

Solo dopo riattivo gli scheduler.

---

## 5. Il conteggio che vale la pena guardare sul run vero

Nel tuo TOP 20 `ID Documento` e `ID Riga Documento` sono nulli **zero volte**.
La vista `powerbi.bi_preventivi_tempi` raggruppa su `id_documento` e filtra
`id_documento is not null`: se sul run completo ne comparisse qualcuno, quei
preventivi **sparirebbero dal calcolo dei tempi senza alcun errore**.

È l'unico modo silenzioso in cui questo cambiamento può andare storto, ed è
quello che controllerò per primo.

---

## 6. Rollback, se serve prima ancora di provare

```bash
ssh -t intra-adm@192.168.1.21 \
  "sudo /usr/local/sbin/attiva-v2.sh revoca && sudo /usr/local/sbin/commuta-pipeline.sh riattiva"
```

Riporta Linux a 23 colonne e riattiva gli scheduler. Va accompagnato dal
ripristino della query Windows: i due lati si muovono insieme come all'andata.

**Nessun `DROP COLUMN`**, come da tua indicazione: le nove colonne restano nello
schema, nullable e innocue.

---

## Collegato a

- [`ESITO-preparazione-v2.md`](ESITO-preparazione-v2.md)
- [`REFERTO-data-richiesta-cliente.md`](REFERTO-data-richiesta-cliente.md)
