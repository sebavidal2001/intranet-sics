# Fase 5 — Integrazione Windows del dataset `cruscotto_articoli`

Artefatti per il server SQL Anywhere (`192.168.1.110`). Da applicare **manualmente**:
l'agente non ha accesso a quel server.

> [!warning] Due problemi bloccanti se il Cruscotto viene aggiunto "ingenuamente"
> Aggiungere semplicemente una voce a `config.Queries` **rompe la pipeline commerciale**.
>
> **1. Manifest condiviso → run a 8 dataset.**
> `Invoke-BIPipeline.ps1` valida tutte le query e invia **un unico** manifest con
> tutti i file (`files = $validated`), sotto un solo `run_id`. Il Cruscotto
> finirebbe nello stesso run dei 7 dataset commerciali, e
> `bi_activate_run` (tuttora invocata da `bi_activate_complete_run`) fallirebbe:
> *"Il manifest del run X non contiene 7 dataset"*. Risultato: **nessuna
> pubblicazione commerciale**, ogni notte.
>
> **2. Riconoscimento intestazione errato.**
> `Get-CsvValidation` riconosce l'header con:
> ```powershell
> $isHeader = $lineNumber -eq 1 -and [string]$fields[0] -match "^(Codice Gruppo|gruppo_codice)$"
> ```
> La prima colonna del Cruscotto è `codice`: l'intestazione **verrebbe contata
> come riga dati**. Il manifest dichiarerebbe `rows` +1 rispetto alle righe
> realmente caricate e l'attivazione fallirebbe per conteggio non corrispondente.

La patch qui sotto risolve entrambi introducendo il concetto di **profilo di run**.

---

## 1. Query — `CRUSCOTTO_ARTICOLI.sql`

File pronto: [`docs/bi/CRUSCOTTO_ARTICOLI.sql`](CRUSCOTTO_ARTICOLI.sql) → copiare in
`C:\Impresa\Viste_BI\Query\CRUSCOTTO_ARTICOLI.sql`. **Non va ricopiata a mano**:
è la query validata, integrale.

Unica differenza rispetto a quella fornita: l'`OUTPUT` scrive su file
**temporaneo** `.csv.tmp`. Serve perché il consumatore Linux può leggere il CSV
mentre l'estrazione è ancora in corso; il file definitivo compare solo a
scrittura completata (rename eseguito da PowerShell, § 2.4).

```sql
OUTPUT TO 'C:\Impresa\Viste_BI\Esportazioni\cruscotto_articoli.csv.tmp'
FORMAT ASCII DELIMITED BY ';' QUOTE '"' ENCODING 'UTF-8';
```

Tutto il resto è invariato: `Ult_Costo` / `data_Ult_Costo` da
`dba.vs_listino_ultimo_costo` (`prezzo` / `data_inizio`), 40 colonne nello
stesso ordine, `ORDER BY articolo.codice, magazzino` (output deterministico, che
rende stabile il confronto change-only).

---

## 2. Patch a `Invoke-BIPipeline.ps1`

### 2.1 Parametro di profilo

```powershell
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "config.json"),
    [ValidateSet("commerciale", "cruscotto", "tutti")]
    [string]$Profilo = "commerciale",      # <-- NUOVO
    [switch]$ValidateOnly,
    [switch]$SkipUpload
)
```

### 2.2 Selezione delle query per profilo

Subito dopo `$config = Get-Content ... | ConvertFrom-Json`:

```powershell
# Ogni query dichiara il profilo di appartenenza (default: commerciale).
$queriesTutte = @($config.Queries)
if ($Profilo -eq "tutti") {
    $queries = $queriesTutte
} else {
    $queries = @($queriesTutte | Where-Object {
        $p = if ($_.PSObject.Properties.Name -contains "Profilo") { [string]$_.Profilo } else { "commerciale" }
        $p -eq $Profilo
    })
}
if ($queries.Count -eq 0) { throw "Nessuna query per il profilo '$Profilo'" }
```

Poi **sostituire ogni `$config.Queries` con `$queries`** nei quattro punti in cui
compare (calcolo `$beforeTimes`, snapshot di backup, esecuzione, validazione) e
nel blocco `catch` che ripristina gli output.

> Con `-Profilo cruscotto` viene eseguita, validata e inviata **solo** la query
> del Cruscotto, con un `run_id` proprio e un manifest separato: i due flussi non
> si incrociano mai.

### 2.3 Riconoscimento intestazione configurabile

In `Get-CsvValidation` aggiungere il parametro e usarlo:

```powershell
function Get-CsvValidation {
    param(
        [string]$Path,
        [int]$ExpectedColumns,
        [double]$MaxAgeHours,
        [string]$HeaderPattern = "^(Codice Gruppo|gruppo_codice)$"   # <-- NUOVO
    )
    ...
            $isHeader = $lineNumber -eq 1 -and [string]$fields[0] -match $HeaderPattern
    ...
}
```

E al richiamo:

```powershell
$headerPattern = if ($query.PSObject.Properties.Name -contains "HeaderPattern") {
    [string]$query.HeaderPattern
} else { "^(Codice Gruppo|gruppo_codice)$" }

$info = Get-CsvValidation `
    -Path $outputPath `
    -ExpectedColumns ([int]$query.ExpectedColumns) `
    -MaxAgeHours ([double]$config.MaxAgeHours) `
    -HeaderPattern $headerPattern
```

### 2.4 Rename atomico del file temporaneo

Nel ciclo di estrazione, subito dopo il controllo del codice di uscita di `dbisql`
e **prima** della verifica di esistenza dell'output:

```powershell
# Se la query scrive su file temporaneo, promuovilo solo a estrazione riuscita.
if ($query.PSObject.Properties.Name -contains "TempFile" -and [string]$query.TempFile) {
    $tempPath = Join-Path ([string]$config.OutputRoot) ([string]$query.TempFile)
    if (-not (Test-Path -LiteralPath $tempPath)) {
        throw "La query non ha prodotto il file temporaneo $tempPath"
    }
    Move-Item -LiteralPath $tempPath -Destination $outputPath -Force
}
```

### 2.5 Lock per profilo

Il lock attuale è unico (`pipeline.lock`) e impedisce qualsiasi esecuzione
parallela. Va bene come protezione, ma blocca anche un run Cruscotto mentre gira
il commerciale. Per consentirli in parallelo (restando esclusivi per profilo):

```powershell
$lockPath = Join-Path $runtimeRoot ("pipeline.{0}.lock" -f $Profilo)
```

Se invece preferisci che **non** possano mai sovrapporsi, lascia `pipeline.lock`
invariato: è la scelta più prudente e non richiede modifiche.

---

## 3. `config.json` — voce da aggiungere

```json
{
  "SqlFile": "CRUSCOTTO_ARTICOLI.sql",
  "OutputFile": "cruscotto_articoli.csv",
  "TempFile": "cruscotto_articoli.csv.tmp",
  "Dataset": "cruscotto_articoli",
  "ExpectedColumns": 40,
  "Profilo": "cruscotto",
  "HeaderPattern": "^codice$"
}
```

Alle 7 query esistenti **non serve toccare nulla**: senza il campo `Profilo`
ricadono automaticamente in `commerciale`.

---

## 4. Attivazione in due tempi

Non schedulare subito. Prima verifica manuale:

```powershell
# 1) Solo validazione, nessuna estrazione e nessun invio
.\Invoke-BIPipeline.ps1 -Profilo cruscotto -ValidateOnly -SkipUpload

# 2) Estrazione reale, ancora senza invio a Linux
.\Invoke-BIPipeline.ps1 -Profilo cruscotto -SkipUpload

# 3) Run completo con invio
.\Invoke-BIPipeline.ps1 -Profilo cruscotto
```

Verifica che il commerciale sia rimasto intatto:

```powershell
.\Invoke-BIPipeline.ps1 -Profilo commerciale -ValidateOnly -SkipUpload
```

Solo quando i tre passaggi sono verdi, aggiungere l'attività pianificata
(orario suggerito: **02:30**, dopo il commerciale delle 01:30, per non far
competere due estrazioni pesanti sullo stesso database).

---

## 5. Rollback

1. Rimuovere la voce `cruscotto_articoli` da `config.json` → la pipeline torna
   esattamente al comportamento precedente (le 7 query non sono state toccate).
2. Ripristinare `Invoke-BIPipeline.ps1` dal backup fatto prima della patch.
3. Disattivare l'attività pianificata del Cruscotto, se già creata.
4. Lato Linux/Supabase il flusso Cruscotto è indipendente: disattivarlo non
   influenza né i 7 dataset né il forecast.

> [!note] Perché non uno script separato
> Duplicare `Invoke-BIPipeline.ps1` avrebbe significato mantenere due copie di
> lock, logging, validazione, backup e upload. La patch riusa tutto ciò che già
> funziona e aggiunge solo la nozione di profilo.
