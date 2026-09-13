# Cruscotto su PostgreSQL locale + correzione del pull dei backup

> 3 settembre 2026.
> **Cruscotto: sette controlli su sette passati** — puoi riabilitare
> `IMPRESA_BI_CRUSCOTTO`.
> **Backup: causa trovata e corretta**, il pull si può rilanciare.

---

# Parte 1 — Run cruscotto `20260903_192202`

## 1. Elaborato e pubblicato

| Voce | Valore |
|---|---|
| `run_id` | `20260903_192202` |
| Stato | **`current`** |
| Sorgente | `SRVWOA` |
| Catturato | 2026-09-03 19:41:15 |
| Ricevuto | 2026-09-03 17:41:18 UTC |
| **Pubblicato** | 2026-09-03 17:41:22 UTC |
| Puntatore | `current_cruscotto_run_id` = `20260903_192202` |
| Run precedente | `20260829_023002` → `archived` |

Quattro secondi fra ricezione e pubblicazione. `impresa-bi-cruscotto.service`
→ `Result=success`, 4,98 s di CPU. Archiviato in
`/var/lib/impresa-bi/processed-cruscotto/20260903_192202`.

## 2. Righe e colonne

| | Tuo | Manifest | Database |
|---|---:|---:|---:|
| Righe | 26.691 | 26.691 | **26.691** |
| Colonne | 40 | 40 | **40** (header CSV) |
| Byte | 11.234.292 | 11.234.292 | **11.234.292** |

`row_count` 26.691, `articoli_count` 25.072.
`powerbi.bi_cruscotto_articoli_corrente` restituisce **26.691** righe.

## 3. SHA-256: tre valori, non due

```
tuo            : 51c3b1622d4e523202c28cb8470fe6daf8f61f0adf61f25bf9a01341e0160a9c
file su disco  : 51c3b1622d4e523202c28cb8470fe6daf8f61f0adf61f25bf9a01341e0160a9c
registrato a DB: 51c3b1622d4e523202c28cb8470fe6daf8f61f0adf61f25bf9a01341e0160a9c
```

`bi.cruscotto_runs.sha256` conserva l'impronta, quindi il confronto non è fra il
tuo valore e un file, ma fra tre registrazioni indipendenti. Identiche.

## 4. Valorizzazione dell'UC

| Controllo | Valore | |
|---|---:|:--|
| Intervalli in `bi.costi_storico` | 25.225 | — |
| Articoli distinti | 24.317 | — |
| **Intervalli aperti** | **24.317** | ✅ |
| Articoli con più di un intervallo aperto | **0** | ✅ |
| `uc` nulli | **0** | ✅ |

**Un solo intervallo aperto per articolo**: l'invariante SCD2 regge dopo il
cambio di database.

Scritto da questo run: **394 nuovi intervalli** su 394 articoli — i costi
cambiati rispetto al 29 agosto.

Giacenze: **2.939 variazioni** su 1.251 articoli, 12 campi diversi, **0 delta
nulli** (il CHECK che vieta righe senza variazione reale non è stato aggirato).

### I 786 senza UC

`bi_cruscotto_articoli_corrente` ha 26.691 righe, di cui 25.905 con «Ultimo
Costo» e **786 senza**. Le ho controllate una per una:

```
righe senza UC : 786
  mai avuto un costo : 786
  avevano un costo   :   0
```

**Nessun articolo ha perso l'UC che aveva.** È assenza di dato all'origine, non
una regressione della pipeline.

## 5. Funzioni di attivazione

`published_at` valorizzato e `status='current'` con il precedente passato ad
`archived`: `bi_activate_cruscotto()` ha completato, guardie anti-caricamento
parziale incluse. Il log riporta anche `bi.cruscotto_retention`: «0 run e 0
righe di staging rimossi», «falliti in 48h: 0».

Viste `powerbi`:

| Vista | Righe |
|---|---:|
| `bi_cruscotto_articoli_corrente` | 26.691 |
| `bi_ultimo_costo_storico` | 25.225 |
| `bi_variazioni_ultimo_costo` | 25.035 |
| `bi_variazioni_giacenze` | 45.202 |

## 6. Supabase invariato

| | Locale | Supabase |
|---|---:|---:|
| Run cruscotto | 31 | **30** |
| Cruscotto `current` | `20260903_192202` | **`20260829_023002`** |
| Ultimo ricevuto | 03/09 17:41 | **29/08 00:47** |
| Intervalli `costi_storico` | 25.225 | **24.831** |
| `bi_runs` / righe raw | 7 / 460.620 | 30 / 1.953.348 |
| Dimensione | 271 MB | **861 MB** |

I 394 intervalli nuovi esistono solo in locale. Il cloud non ha visto il run.

## 7. Path e timer

| Unit | Attivo | Al riavvio |
|---|---|---|
| `impresa-bi-daily.path` | active | enabled |
| `impresa-bi-cruscotto.path` | active | enabled |
| `impresa-bi-forecast.timer` | active | enabled |
| `impresa-bi-ingest.service` | active | enabled |
| `bi-retention.timer` | active | enabled |
| `intranet-db-backup.timer` | active | enabled |

`ready/`, `ready-cruscotto/` e `failed/` vuote.

> [!info] `failed-cruscotto/` contiene 3 cartelle: sono del 1-2 agosto
> Risalgono allo sviluppo iniziale del cruscotto, non a oggi. A database non c'è
> un solo run in stato diverso da `current`/`archived`. Segnalo però che **niente
> ripulisce quei file**: `bi.cruscotto_retention` lavora sulle righe a DB, non
> sulle cartelle. Sono ~33 MB, quindi non urgente, ma resteranno lì per sempre.

## Puoi procedere

**Riabilita `IMPRESA_BI_CRUSCOTTO`.** Lato Linux non serve altro.

---

# Parte 2 — Il pull dei backup

## La causa non era il singolo file

Mancavano **quattro** impronte, non una:

```
settimanali/intranet-2026-08-30.dump      ← quella che hai segnalato
settimanali/globals-2026-08-30.sql
mensili/intranet-2026-09-01.dump
mensili/globals-2026-09-01.sql
```

`giornalieri/` le aveva tutte. Il motivo è in `intranet-db-backup.sh`: le
impronte venivano scritte solo per la copia giornaliera, e la promozione a
settimanale/mensile copiava **il dump ma non il suo `.sha256`**.

```bash
cp -f "$DUMP" "$RAD/settimanali/${DB}-${OGGI}.dump"
cp -f "$GLOB" "$RAD/settimanali/globals-${OGGI}.sql"
# e basta: nessuna impronta
```

Si sarebbe ripetuto **ogni domenica e ogni primo del mese**. Rattoppare il file
segnalato avrebbe chiuso il sintomo di stanotte e lasciato il difetto.

## Cosa ho fatto

### Le quattro impronte mancanti

Non le ho semplicemente calcolate. Ricalcolare l'impronta di un file per
certificarlo non dimostra nulla: se fosse già corrotto, si otterrebbe
un'impronta valida della sua corruzione.

Ogni copia è stata confrontata con l'impronta del **giornaliero di pari data**,
scritta al momento del dump:

```
settimanali/intranet-2026-08-30.dump   archivio valido · IDENTICA al giornaliero
settimanali/globals-2026-08-30.sql                      IDENTICA al giornaliero
mensili/intranet-2026-09-01.dump       archivio valido · IDENTICA al giornaliero
mensili/globals-2026-09-01.sql                          IDENTICA al giornaliero
```

I due `.dump` sono stati anche verificati con `pg_restore --list`. Quattro su
quattro conformi, zero sospetti.

### Lo script

La promozione ora usa una funzione che copia **anche** l'impronta e poi
**verifica la copia contro l'impronta dell'originale**:

```bash
promuovi() {
  local sorgente="$1" destinazione="$2"
  cp -f "$sorgente" "$destinazione"
  cp -f "$sorgente.sha256" "$destinazione.sha256"
  if ! ( cd "$(dirname "$destinazione")" &&
         sha256sum -c --quiet "$(basename "$destinazione").sha256" ); then
    echo "ERRORE: copia non conforme all'impronta: $destinazione"
    exit 1
  fi
  chmod 640 "$destinazione" "$destinazione.sha256"
  chgrp backup-lettori "$destinazione" "$destinazione.sha256" 2>/dev/null || true
}
```

Il confronto è contro l'impronta **di partenza**, non una ricalcolata sul posto:
una copia troncata da un disco pieno verrebbe altrimenti certificata come buona.

Provata su due casi, con la funzione estratta dallo script di produzione:

```
CASO 1 - copia integra    : PASSA (copia e impronta presenti)
CASO 2 - copia troncata   : PASSA (rifiutata, uscita non nulla)
```

### Stato finale

| Cartella | File | Impronte | |
|---|---:|---:|:--|
| `giornalieri` | 12 | 12 | ✅ |
| `settimanali` | 2 | 2 | ✅ |
| `mensili` | 2 | 2 | ✅ |

`sha256sum -c` su tutte: nessuna difformità. Permessi
`postgres:backup-lettori 0640`, visibili nel chroot `/srv/backup-pull/dump`.

## Puoi rilanciare il pull

Le quattro impronte sono già visibili lato SFTP. Il bind mount è in `/etc/fstab`
come `bind,ro`, quindi sopravvive al riavvio.

Dai log: `bi-backup-pull` si collega da **192.168.1.110 ogni notte alle 00:15**,
sessione di ~9 secondi. Ha funzionato l'1, il 2 e il 3 settembre — il pull non
era rotto, mancava il file che cercava.

---

## Perché `LastTaskResult=0` con `outcome=failed`

Non ho accesso alla VM Windows, quindi questa è una diagnosi da verificare sul
tuo script, non un accertamento.

`status.json` e `LastTaskResult` sono **due cose indipendenti**:

- `status.json` lo scrive il tuo script, secondo la sua logica;
- `LastTaskResult` è il **codice di uscita del processo**, e nient'altro.

Uno script che intercetta i propri errori, li registra nel JSON e poi arriva in
fondo **esce 0**. L'Utilità di pianificazione vede un processo terminato bene e
lo segna verde.

Da controllare, in ordine di probabilità:

1. **Il ramo di errore non chiama `exit 1`.** Con `powershell.exe -File`, il
   codice di uscita è solo quello che imposti tu: arrivare in fondo vale 0.
   Serve un `if ($outcome -ne 'ok') { exit 1 }` in coda.
2. **Un `try`/`catch` che assorbe l'errore.** Con `-Command`, un errore
   terminante *non* intercettato dà 1; uno intercettato dà 0.
3. **`$ErrorActionPreference = 'Stop'` non imposta da solo un codice di uscita.**
4. **Un wrapper `cmd.exe /c`** che restituisce il codice dell'ultimo comando
   invece di quello di PowerShell.

> [!warning] È il terzo controllo in questo progetto che dice «tutto bene» senza guardare
> Prima `/api/ping`, che non interrogava il database e restituiva il timestamp
> di build. Poi la ritenzione dei backup, dove `-o` senza parentesi faceva sì
> che i `.dump` non venissero **mai** cancellati. Ora un'attività pianificata
> verde su un esito fallito.
>
> Nessuno dei tre segnalava un guasto: tutti e tre segnalavano successo. Vale la
> pena che il pull, una volta corretto, venga **provato facendolo fallire** — per
> esempio nascondendo un `.sha256` — e che si verifichi che `LastTaskResult`
> diventi diverso da zero.

---

## Collegato a

- [`ESITO-run-locale-20260903.md`](ESITO-run-locale-20260903.md)
- [`../db-migrazione/OPERATIVITA-DB-VM.md`](../db-migrazione/OPERATIVITA-DB-VM.md)
