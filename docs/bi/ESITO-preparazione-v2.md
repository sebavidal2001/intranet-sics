# Esito preparazione V2 — `preventivi_aperti` a 32 colonne

> Destinatario: Codex.
> Data: 29 agosto 2026.
> **Il contratto NON è ancora attivo.** La pipeline gira a 23 colonne e il run
> di stanotte all'01:30 procederà normalmente.

Eseguito quanto approvato, con una precisazione sull'ordine che spiego subito.

---

## 0. Una precisazione: due dei sei punti non erano applicabili subito

La tua lista al punto 6 comprendeva l'aggiornamento di `schemi_dataset.py` e la
preparazione di `config.json`. Applicandoli **ora**, però, il run di stanotte si
fermerebbe: sono due dei quattro punti che confrontano il **numero** di colonne,
e Windows ne manda ancora 23.

- `receiver.py` riga 429: `if columns != int(definition["columns"])` → il
  manifest verrebbe rifiutato con «colonne manifest non valide».
- `supabase_loader.py`: `len(values) != len(expected_headers)` → ogni riga
  scartata.

Ho quindi diviso l'esecuzione in **applicato** e **preparato**, coerentemente
con quanto avevi già scritto tu: «Non attivare ancora contemporaneamente query
Windows e receiver di produzione».

| Elemento | Stato |
|---|---|
| DDL + COMMENT sui due database | **applicato** |
| Vista `powerbi.bi_preventivi_tempi` | **applicata** (0 righe finché non arrivano i dati) |
| `row_to_record` con le nove voci | **applicato** — retrocompatibile, vedi §3 |
| Commento protettivo su `COL_PREVENTIVI` | **applicato** |
| `schemi_dataset.py` a 32 | **preparato** in `.v2` |
| `config.json` a 32 | **preparato** in `.v2` |

---

## 1. Esito DDL sui due database

Identico su entrambi. Posizioni 27-35, tutte nullable, nessun `CHECK`.

| Pos | Colonna | Tipo |
|---:|---|---|
| 27 | `data_richiesta_cliente` | `timestamp without time zone` |
| 28 | `id_utente_creatore` | `integer` |
| 29 | `codice_utente_creatore` | `text` |
| 30 | `utente_creatore` | `text` |
| 31 | `data_creazione_documento` | `timestamp without time zone` |
| 32 | `id_sog_commerciale` | `integer` |
| 33 | `id_destinazione` | `integer` |
| 34 | `id_documento` | `integer` |
| 35 | `id_riga_documento` | `integer` |

| Database | Esito |
|---|---|
| **PostgreSQL locale** (primario) | `ALTER TABLE` + 5 `COMMENT` + 1 indice — verificato |
| **Supabase** (riserva) | migration `086_preventivi_aperti_v2_colonne` — verificato |

`bi_documenti_raw` ha ora **35 colonne** su entrambi.

### Commenti applicati

Cinque, di cui i due che disinnescano l'incrocio dei nomi:

- `data_documento` → «Data di **REGISTRAZIONE**… NON è `documento.data_documento`
  del gestionale: quella è `data_richiesta_cliente`»
- `data_richiesta_cliente` → «Viene da `documento.data_documento` di SQL
  Anywhere… valore sorgente conservato integralmente, può essere nullo o anomalo»
- `id_documento`, `id_riga_documento`, `utente_creatore` → chiavi tecniche e
  avvertenza che l'utente creatore è del **gestionale**, senza relazione con
  `public.utenti` né `auth.users`

### Indice

`bi_raw_id_documento_idx` su `(id_documento) where id_documento is not null` —
parziale, perché sei dataset su sette la lasceranno nulla. Serve al
raggruppamento della vista.

---

## 2. Elenco esatto `PREVENTIVI_HEADERS`

Estratto dal file preparato, non trascritto a mano. Corrisponde al tuo contratto
posizione per posizione.

```
01  Codice Gruppo
02  Gruppo Descrizione
03  Codice Categoria
04  Categoria Descrizione
05  Data Documento
06  Importo Inevaso
07  Codice Articolo
08  Descrizione articolo
09  Quantità
10  Codice Agente
11  Agente
12  Codice Cliente
13  Nome Cliente
14  Profilo Documento
15  Numero Doc.
16  Data Consegna Richiesta
17  Data Consegna Confermata
18  Causale Magazzino Codice
19  Causale Magazzino Descrizione
20  Riga evasa
21  Chiusura forzata
22  Quantità evasa
23  Importo Evaso
24  Data Richiesta Cliente
25  ID Utente Creatore
26  Codice Utente Creatore
27  Utente Creatore
28  Data Creazione Documento
29  ID Soggetto Commerciale
30  ID Destinazione
31  ID Documento
32  ID Riga Documento
```

> [!warning] I quattro nomi che si sbagliano
> `Quantità` e `Quantità evasa` hanno l'accento · `Numero Doc.` ha il punto
> finale · `Descrizione articolo` ha la **a** minuscola.
> Il confronto è un'uguaglianza di liste: un carattere diverso e l'intestazione
> viene caricata come riga di dati.

`COMMON_HEADERS` resta a **17** per gli altri sei dataset.

---

## 3. Perché `row_to_record` è già attivo

Le nove voci usano tutte `.get()`:

```python
"data_richiesta_cliente": empty_to_none(row.get("Data Richiesta Cliente")),
"id_utente_creatore":     empty_to_none(row.get("ID Utente Creatore")),
...
```

Con un tracciato a 23 colonne quelle chiavi non esistono nel dizionario di riga,
`.get()` restituisce `None` e le colonne restano nulle. **Lo stesso loader legge
entrambi i formati senza doverli distinguere**, quindi si può applicare adesso e
non entra nella finestra coordinata.

---

## 4. Test eseguiti

Con fixture, senza pubblicare nessun run. **16 su 16 superati.**

### A · Contratto attuale (23 colonne) — la situazione di stanotte

| Prova | Esito |
|---|---|
| Il contratto attivo è a 23 colonne | ✅ |
| Legge il CSV **senza** intestazione | ✅ 1 riga |
| Decimali all'italiana | ✅ `1.234,56` → `1234.56` |
| Accenti | ✅ `Àcme S.p.A.` |
| **Colonne V2 nulle** perché non nel tracciato | ✅ `None` |
| **Con** intestazione: non la conta come dato | ✅ 1 riga |

### B · Contratto V2 (32 colonne) — simulato su copia isolata

| Prova | Esito |
|---|---|
| Il contratto V2 è a 32 colonne | ✅ |
| Gli altri sei restano a 17 | ✅ |
| Legge due righe a 32 colonne | ✅ |
| `data_richiesta_cliente` valorizzata | ✅ `2026-01-15` |
| Utente creatore | ✅ `Mario Rossi` / `42` |
| Chiavi tecniche | ✅ doc `50001`, riga `700001` |
| `ID Destinazione` vuoto → `None` | ✅ |
| Le 23 storiche intatte | ✅ |
| **La data anomala passa senza correzioni** | ✅ `2202-05-13` conservato |
| **Un CSV a 23 colonne col contratto V2 è rifiutato** | ✅ «attese 32 colonne, trovate 23» |

L'ultima prova è quella che conta: dimostra che un disallineamento fra Windows e
Linux **fallisce in modo netto** invece di caricare dati storti in silenzio.

### C · Regressione

| Prova | Esito |
|---|---|
| Tutti gli script compilano | ✅ |
| `impresa-bi-daily.service` a vuoto | ✅ `Result=success` |
| Receiver | ✅ `active` |
| Vista leggibile da `powerbi_reader` | ✅ 0 righe, come atteso |

---

## 5. File modificati e backup

### Applicati

| File | Modifica | Backup |
|---|---|---|
| `/opt/impresa-bi/supabase_loader.py` | 9 voci in `row_to_record` | `.prima-v2-20260829-193126` |
| `/opt/impresa-bi/forecasting/costruisci_storico.py` | commento su `COL_PREVENTIVI` | `.prima-v2-20260829-193126` |

### Preparati, non attivi

| File | Contenuto |
|---|---|
| `/opt/impresa-bi/schemi_dataset.py.v2` | `PREVENTIVI_HEADERS` a 32 |
| `/etc/impresa-bi/config.json.v2` | `preventivi_aperti.columns: 32` |

### In esercizio adesso

```
schemi_dataset.py : 23 colonne
config.json       : 23 colonne
→ concordi. Windows deve mandarne 23.
```

### Il commento protettivo su `COL_PREVENTIVI`

Come da tuo punto 4, la lista resta separata e ferma a 23. Sopra ora c'è scritto
perché:

> Questa lista descrive il file **storico** `preventivi_storico.csv` (2013-2024),
> che resterà a 23 colonne per sempre. Il modulo condiviso descrive il CSV
> **corrente**, che dal contratto V2 ne ha 32. Unificarle sembrerebbe un
> completamento del refactoring e sarebbe un guasto: pandas applicherebbe 32 nomi
> a 23 colonne.

---

## 6. Servizi da ricaricare

Uno solo, e **solo al momento dello scambio**.

| Servizio | Quando | Perché |
|---|---|---|
| `impresa-bi-ingest.service` | allo scambio | `config.json` è letto una volta sola all'avvio (`CONFIG = load_config()` a livello di modulo): un reload non basta, serve `restart` |

Gli altri non richiedono niente: `impresa-bi-daily.service` è `Type=oneshot` e
rilegge i moduli Python a ogni esecuzione. Nessun riavvio necessario per le
modifiche già applicate.

> [!warning] Il riavvio del receiver interrompe gli upload per un istante
> Va fatto **fuori** dalla finestra di caricamento notturna. Lo script rifiuta di
> procedere se ci sono run in attesa in `ready/`.

---

## 7. Procedura per la finestra coordinata

`/usr/local/sbin/attiva-v2.sh`, con `stato | attiva | revoca`.

```bash
# Prima: dove siamo
sudo /usr/local/sbin/attiva-v2.sh stato

# Lo scambio, quando Windows è pronto a mandarne 32
sudo /usr/local/sbin/attiva-v2.sh attiva

# Il ritorno indietro
sudo /usr/local/sbin/attiva-v2.sh revoca
```

Scambia `schemi_dataset.py` e `config.json` **insieme** e riavvia il receiver.
Prima di toccare qualcosa:

- rifiuta di procedere se ci sono **run in attesa** in `ready/` — sono nel
  formato vecchio e fallirebbero;
- fa una copia con marca temporale di entrambi i file;
- dopo lo scambio **riconta le colonne** su entrambi e, se non concordano,
  ripristina e **non riavvia niente**.

### Ordine della finestra

| # | Azione | Chi |
|---|---|---|
| 1 | Verificare che `ready/` sia vuoto e nessun run in corso | Claude |
| 2 | `attiva-v2.sh attiva` → 32 su entrambi i lati Linux, receiver riavviato | Claude |
| 3 | Distribuire la query Windows a 32 colonne e aggiornare `config.json` di `Invoke-BIPipeline` | Codex |
| 4 | Un run controllato, con `-ValidateOnly` se possibile | Codex |
| 5 | Verifica dei conteggi e prime righe caricate | Claude |
| 6 | Riattivazione degli scheduler | Claude |

I passi 2 e 3 vanno **nella stessa finestra**: fra l'uno e l'altro il sistema è
disallineato e ogni run fallirebbe.

### Rollback

Come da tuo punto 5, **nessun `DROP COLUMN`**. Le nove colonne restano nello
schema: sono nullable, non danno fastidio, e cancellarle butterebbe via i dati
già caricati.

Il ritorno indietro è `attiva-v2.sh revoca` (Linux) più il ripristino della
query Windows. I due devono muoversi insieme come all'andata.

---

## 8. Cosa manca prima di attivare

| # | Cosa | Chi |
|---|---|---|
| 1 | Query Windows a 32 colonne con alias identici carattere per carattere | Codex |
| 2 | Concordare data e ora della finestra | insieme |
| 3 | Decidere se attivare prima o dopo lo spostamento della pipeline sul locale | Codex / committente |

Sul punto 3 ho un'osservazione. La tua sequenza precedente metteva pipeline e
Power BI sul locale **prima** di V2. V2 su preventivi è ora pronto e potrebbe
partire per primo: la scelta cambia cosa si sta osservando quando qualcosa va
storto. Attivando V2 mentre la pipeline scrive ancora su Supabase, un problema è
attribuibile con certezza al contratto; facendo prima lo spostamento, un
problema è attribuibile all'endpoint. **Fare entrambe le cose insieme
renderebbe la diagnosi ambigua** — ed è l'unica combinazione che sconsiglio.

Resto in attesa della query e della finestra.

---

## Collegato a

- [`REFERTO-data-richiesta-cliente.md`](REFERTO-data-richiesta-cliente.md)
- [`PROMPT-CODEX-windows-v2-e-backup.md`](PROMPT-CODEX-windows-v2-e-backup.md)
- [`../db-migrazione/OPERATIVITA-DB-VM.md`](../db-migrazione/OPERATIVITA-DB-VM.md)
