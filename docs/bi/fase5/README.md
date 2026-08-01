# Pacchetto server Windows — Cruscotto articoli

Da applicare sul server SQL Anywhere (`SRVWOA`, 192.168.1.110). Contiene tutto
il necessario: query, patch dello script di pipeline, configurazione, collaudo
e rollback.

> [!warning] Non aggiungere il Cruscotto a `config.json` senza applicare la patch
> `Invoke-BIPipeline.ps1` valida tutte le query e invia **un solo** manifest con
> tutti i file, sotto un solo `run_id`. Il Cruscotto finirebbe nel run dei sette
> dataset commerciali e l'attivazione lato database fallirebbe per numero di
> dataset: **nessuna pubblicazione commerciale, ogni notte**.
>
> Secondo punto: `Get-CsvValidation` salta la prima riga solo se il primo campo
> è `Codice Gruppo` o `gruppo_codice`. Nel Cruscotto è `codice`, quindi
> l'intestazione verrebbe contata come riga dati e il conteggio dichiarato nel
> manifest non tornerebbe mai.

## Contenuto

| File | Destinazione |
|---|---|
| `CRUSCOTTO_ARTICOLI.sql` | `C:\Impresa\Viste_BI\Query\` |
| `Patch-BIPipeline.ps1` | eseguito una volta, modifica `Invoke-BIPipeline.ps1` |
| `config-cruscotto.json` | frammento da inserire in `config.json` |

Le credenziali (`sqlanywhere.credential.xml`, `linux-bridge.token`) **non
vengono toccate** e restano sul server Windows.

---

## Installazione

Aprire PowerShell **come amministratore** nella cartella di questo pacchetto.

### 1. Copiare la query

```powershell
Copy-Item .\CRUSCOTTO_ARTICOLI.sql C:\Impresa\Viste_BI\Query\ -Force
```

È la query validata, integrale, 40 colonne. Non va ricopiata a mano.

### 2. Verificare la patch senza applicarla

```powershell
.\Patch-BIPipeline.ps1 -Path C:\Impresa\Viste_BI\Invoke-BIPipeline.ps1 -Check -Diff
```

Deve elencare **otto** modifiche e dire che il risultato compila. `-Diff` mostra
le righe che verrebbero introdotte.

Se dice che il file non corrisponde alla versione attesa, **fermarsi**: lo
script è stato modificato rispetto alla copia su cui la patch è stata provata.
In quel caso mandami il file e adatto i pattern.

### 3. Applicare

```powershell
.\Patch-BIPipeline.ps1 -Path C:\Impresa\Viste_BI\Invoke-BIPipeline.ps1
```

Crea da sé un backup `Invoke-BIPipeline.ps1.before-profili-<data>`.
Rieseguirlo non fa danni: si accorge di aver già lavorato e si ferma.

### 4. Aggiungere la query alla configurazione

Aprire `config.json` e inserire in coda all'array `Queries` il contenuto di
`config-cruscotto.json`, ricordando la virgola dopo l'ultima voce esistente:

```json
    },
    {
      "SqlFile": "CRUSCOTTO_ARTICOLI.sql",
      "OutputFile": "cruscotto_articoli.csv",
      "Dataset": "cruscotto_articoli",
      "ExpectedColumns": 40,
      "Profilo": "cruscotto",
      "HeaderPattern": "^codice$"
    }
  ]
}
```

Le sette query esistenti **non vanno toccate**: senza il campo `Profilo`
ricadono automaticamente in `commerciale`.

Controllo rapido che il JSON sia ancora valido:

```powershell
Get-Content C:\Impresa\Viste_BI\config.json -Raw | ConvertFrom-Json | Select-Object -ExpandProperty Queries | Format-Table Dataset, Profilo, ExpectedColumns
```

### 5. Collaudo, in questo ordine

```powershell
# a) La pipeline commerciale deve comportarsi ESATTAMENTE come prima
.\Invoke-BIPipeline.ps1 -Profilo commerciale -ValidateOnly -SkipUpload

# b) Il Cruscotto, solo validazione, nessun invio
.\Invoke-BIPipeline.ps1 -Profilo cruscotto -ValidateOnly -SkipUpload

# c) Estrazione reale del Cruscotto, ancora senza invio
.\Invoke-BIPipeline.ps1 -Profilo cruscotto -SkipUpload

# d) Run completo con invio a Linux
.\Invoke-BIPipeline.ps1 -Profilo cruscotto
```

Il punto (a) è il più importante: se qualcosa è cambiato per il commerciale,
fermarsi e ripristinare il backup.

Ogni esecuzione stampa in testa `Profilo 'X': N query selezionate`. Per il
commerciale N deve essere 7, per il Cruscotto 1.

### 6. Pianificazione

Solo quando tutti e quattro i punti sono verdi. Il run commerciale esistente
resta com'è; se ne aggiunge uno per il Cruscotto:

```powershell
$azione   = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File C:\Impresa\Viste_BI\Invoke-BIPipeline.ps1 -Profilo cruscotto" `
    -WorkingDirectory "C:\Impresa\Viste_BI"
$trigger  = New-ScheduledTaskTrigger -Daily -At 02:30
$impostaz = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName "Impresa BI - Cruscotto articoli" `
    -Action $azione -Trigger $trigger -Settings $impostaz `
    -User "SYSTEM" -RunLevel Highest -Force
```

**02:30**, dopo il commerciale dell'01:30: due estrazioni pesanti in parallelo
sullo stesso SQL Anywhere non convengono. Il lock `pipeline.lock` dello script
le impedisce comunque di sovrapporsi.

---

## Rollback

```powershell
# 1. Togliere la pianificazione
Unregister-ScheduledTask -TaskName "Impresa BI - Cruscotto articoli" -Confirm:$false

# 2. Togliere la voce cruscotto_articoli da config.json (modifica manuale)

# 3. Ripristinare lo script
Get-ChildItem C:\Impresa\Viste_BI\Invoke-BIPipeline.ps1.before-profili-*
.\Patch-BIPipeline.ps1 -Path C:\Impresa\Viste_BI\Invoke-BIPipeline.ps1 `
    -Restore C:\Impresa\Viste_BI\Invoke-BIPipeline.ps1.before-profili-<data>
```

Il passo 3 da solo riporta il comportamento a prima della patch.

---

## Come è stato collaudato

La patch è stata sviluppata e provata su uno scheletro fedele di
`Invoke-BIPipeline.ps1`, eseguito davvero con tre profili:

| Esecuzione | Query eseguite | Dataset nel manifest |
|---|---|---|
| **Senza patch**, Cruscotto in config | 3 | **3** ← il problema |
| Con patch, `-Profilo commerciale` | 2 | 2 |
| Con patch, `-Profilo cruscotto` | 1 | 1 |
| Con patch, `-Profilo tutti` | 3 | 3 |

La riga "senza patch" è esattamente ciò che in produzione diventerebbe un run a
otto dataset, con l'attivazione commerciale bloccata.

Due difetti sono emersi proprio da questo collaudo e sono già corretti:

- la sostituzione produceva `functionGet-CsvValidation` (spazio mangiato dal
  pattern). PowerShell lo considera un nome di comando valido, quindi il
  controllo di sintassi non se ne accorgeva: solo l'esecuzione lo ha rivelato;
- con una sola query PowerShell srotolava l'array a scalare e `.Count` spariva.

> [!note] Limite del collaudo
> Lo scheletro riproduce la struttura dello script reale, non il suo testo
> esatto. È per questo che `-Check` esiste e va eseguito per primo: verifica che
> ogni pattern trovi esattamente le occorrenze attese e che il risultato
> compili, altrimenti si ferma **senza scrivere nulla**.
