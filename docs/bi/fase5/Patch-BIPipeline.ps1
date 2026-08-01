<#
.SYNOPSIS
    Patch idempotente di Invoke-BIPipeline.ps1 — profili di run (Fase 5).

.DESCRIPTION
    Aggiungere cruscotto_articoli alle query senza altro romperebbe la pipeline
    commerciale in due modi.

    1) MANIFEST CONDIVISO. Lo script valida tutte le query e invia UN SOLO
       manifest con tutti i file, sotto un solo run_id. Il Cruscotto finirebbe
       nel run dei sette dataset commerciali e l'attivazione lato database
       fallirebbe per numero di dataset: nessuna pubblicazione, ogni notte.

    2) INTESTAZIONE NON RICONOSCIUTA. Get-CsvValidation salta la prima riga solo
       se il primo campo e' "Codice Gruppo" o "gruppo_codice". Nel Cruscotto e'
       "codice": l'header verrebbe contato come riga dati e il conteggio
       dichiarato nel manifest non tornerebbe mai.

    La patch introduce il profilo di run: -Profilo commerciale|cruscotto|tutti
    filtra le query da eseguire, cosi' il Cruscotto ha run_id e manifest propri.
    Le sette query esistenti non vanno toccate: senza il campo Profilo ricadono
    in "commerciale" e si comportano esattamente come prima.

.PARAMETER Path
    Percorso di Invoke-BIPipeline.ps1.

.PARAMETER Check
    Verifica soltanto: dice cosa cambierebbe, senza scrivere niente.

.PARAMETER Diff
    Con -Check, mostra anche le righe che verrebbero introdotte.

.PARAMETER Restore
    Ripristina il file da un backup prodotto da una esecuzione precedente.

.EXAMPLE
    .\Patch-BIPipeline.ps1 -Path C:\Impresa\Viste_BI\Invoke-BIPipeline.ps1 -Check -Diff
    .\Patch-BIPipeline.ps1 -Path C:\Impresa\Viste_BI\Invoke-BIPipeline.ps1

.NOTES
    Non riavvia e non pianifica nulla: sono decisioni dell'operatore.
    Eseguire SEMPRE una passata con -Check prima di applicare.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path,
    [switch]$Check,
    [switch]$Diff,
    [string]$Restore
)

$ErrorActionPreference = "Stop"

# Presente solo dopo la patch: rende l'operazione ripetibile senza danni.
$Marcatore = 'function Select-QueriesPerProfilo'

function Fallisci([string]$Messaggio) {
    Write-Host ""
    Write-Host "ERRORE: $Messaggio" -ForegroundColor Red
    Write-Host "Nessuna modifica e' stata scritta." -ForegroundColor Red
    exit 1
}

if ($Restore) {
    if (-not (Test-Path -LiteralPath $Restore)) { Fallisci "Backup non trovato: $Restore" }
    Copy-Item -LiteralPath $Restore -Destination $Path -Force
    Write-Host "Ripristinato $Path da $Restore" -ForegroundColor Green
    exit 0
}

if (-not (Test-Path -LiteralPath $Path)) { Fallisci "File non trovato: $Path" }

$script:testo = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
$script:applicate = New-Object System.Collections.Generic.List[string]

if ($script:testo.Contains($Marcatore)) {
    Write-Host "Patch gia' applicata: nessuna modifica necessaria." -ForegroundColor Yellow
    exit 0
}

<#
    Sostituzione LETTERALE.

    Non si usa [regex]::Replace con una stringa di sostituzione: in .NET, dentro
    quella stringa, "$_" significa "l'intero testo di input" e "$&" il match.
    Il codice che stiamo inserendo contiene "$_" (Where-Object), quindi una
    sostituzione regex classica inserirebbe l'intero file dentro se stesso.

    Qui la regex serve solo a TROVARE. I gruppi vengono riportati con
    String.Replace, che e' letterale e non interpreta nulla.
#>
function Sostituisci {
    param(
        [string]$Descrizione,
        [string]$Pattern,
        [string]$Sostituto,
        [int]$Attese = 1,
        # Quando il pattern e' per natura ripetuto (tutte le "function", per
        # dire) si agisce solo sulla prima occorrenza, purche' ce ne sia almeno
        # una.
        [switch]$SoloPrima
    )

    $trovati = [regex]::Matches($script:testo, $Pattern, 'Multiline')

    if ($SoloPrima) {
        if ($trovati.Count -lt 1) {
            Fallisci ("[$Descrizione] nessuna occorrenza trovata.`n" +
                      "  Il file non corrisponde alla versione attesa: interrompo.")
        }
        $trovati = @($trovati[0])
    }
    elseif ($trovati.Count -ne $Attese) {
        Fallisci ("[$Descrizione] attese $Attese occorrenze, trovate $($trovati.Count).`n" +
                  "  Il file non corrisponde alla versione attesa: interrompo.")
    }

    # Dal fondo verso l'inizio: gli offset dei match precedenti restano validi.
    for ($k = $trovati.Count - 1; $k -ge 0; $k--) {
        $m = $trovati[$k]
        $out = $Sostituto
        for ($i = 1; $i -lt $m.Groups.Count; $i++) {
            $out = $out.Replace(('${0}' -f $i), $m.Groups[$i].Value)
        }
        $script:testo = $script:testo.Remove($m.Index, $m.Length).Insert($m.Index, $out)
    }

    $script:applicate.Add("$Descrizione ($($trovati.Count))")
}

# ── 1. Parametro -Profilo ───────────────────────────────────────────────────
# Si aggancia al blocco param(), subito prima di -ValidateOnly.
Sostituisci -Descrizione "parametro -Profilo" `
    -Pattern '(?m)^([ \t]*)\[switch\]\$ValidateOnly' `
    -Sostituto @'
$1[ValidateSet("commerciale", "cruscotto", "tutti")]
$1[string]$Profilo = "commerciale",
$1[switch]$ValidateOnly
'@

# ── 2. Funzione di selezione ────────────────────────────────────────────────
# Inserita prima della prima function dello script, cosi' e' definita ovunque.
# Il lookahead non consuma lo spazio dopo "function": senza, la sostituzione
# produrrebbe "functionGet-CsvValidation". PowerShell lo considera un nome di
# comando valido, quindi il controllo di sintassi non se ne accorge — lo scopre
# solo l'esecuzione.
Sostituisci -Descrizione "funzione Select-QueriesPerProfilo" -SoloPrima `
    -Pattern '(?m)^function(?=[ \t]+\w)' `
    -Sostituto @'
function Select-QueriesPerProfilo {
    <#
        Tiene solo le query del profilo richiesto. Le query senza il campo
        Profilo ricadono in "commerciale": la configurazione preesistente
        continua a valere senza modifiche.
    #>
    param($Queries, [string]$Profilo)

    if ($Profilo -eq "tutti") { return @($Queries) }

    $selezionate = @($Queries | Where-Object {
        $p = if ($_.PSObject.Properties.Name -contains "Profilo") {
            [string]$_.Profilo
        } else { "commerciale" }
        $p -eq $Profilo
    })

    if ($selezionate.Count -eq 0) {
        throw "Nessuna query configurata per il profilo '$Profilo'"
    }
    return $selezionate
}

function
'@

# ── 3. Uso della selezione al posto dell'elenco completo ────────────────────
# E' il punto che impedisce al Cruscotto di finire nel manifest commerciale.
$conteggio = ([regex]::Matches($script:testo, [regex]::Escape('$config.Queries'))).Count
if ($conteggio -lt 1) {
    Fallisci "Non trovo alcun riferimento a `$config.Queries: file inatteso."
}
$script:testo = $script:testo.Replace('$config.Queries', '$queries')
$script:applicate.Add("riferimenti a `$config.Queries reindirizzati ($conteggio)")

# La variabile va definita subito dopo la lettura della configurazione.
# Nota: questo inserimento avviene DOPO la sostituzione globale qui sopra,
# quindi il "$config.Queries" che segue resta intatto.
Sostituisci -Descrizione "definizione di `$queries" `
    -Pattern '(?m)^([ \t]*)(\$config[ \t]*=[ \t]*.*ConvertFrom-Json.*)$' `
    -Sostituto @'
$1$2
$1# @(...) obbligatorio: con una sola query PowerShell srotolerebbe l'array a
$1# scalare, e $queries.Count o $queries[0] smetterebbero di funzionare.
$1$queries = @(Select-QueriesPerProfilo -Queries $config.Queries -Profilo $Profilo)
$1Write-Host "Profilo '$Profilo': $($queries.Count) query selezionate"
'@

# ── 4. Intestazione configurabile ───────────────────────────────────────────
Sostituisci -Descrizione "parametro HeaderPattern in Get-CsvValidation" `
    -Pattern '(?m)^([ \t]*)\[double\]\$MaxAgeHours[ \t]*$' `
    -Sostituto @'
$1[double]$MaxAgeHours,
$1[string]$HeaderPattern = "^(Codice Gruppo|gruppo_codice)$"
'@

Sostituisci -Descrizione "confronto del primo campo di intestazione" `
    -Pattern '\[string\]\$fields\[0\][ \t]*-match[ \t]*"\^\(Codice Gruppo\|gruppo_codice\)\$"' `
    -Sostituto '[string]$fields[0] -match $HeaderPattern'

Sostituisci -Descrizione "passaggio di HeaderPattern alla validazione" `
    -Pattern '(?m)^([ \t]*)(-MaxAgeHours[ \t]+\(\[double\]\$config\.MaxAgeHours\))[ \t]*$' `
    -Sostituto @'
$1$2 `
$1-HeaderPattern $headerPattern
'@

# $headerPattern va calcolato prima della chiamata a Get-CsvValidation.
Sostituisci -Descrizione "calcolo di `$headerPattern" `
    -Pattern '(?m)^([ \t]*)(\$info[ \t]*=[ \t]*Get-CsvValidation.*)$' `
    -Sostituto @'
$1$headerPattern = if ($query.PSObject.Properties.Name -contains "HeaderPattern") {
$1    [string]$query.HeaderPattern
$1} else { "^(Codice Gruppo|gruppo_codice)$" }
$1$2
'@

# ── Esito ───────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "Modifiche individuate:" -ForegroundColor Cyan
foreach ($voce in $script:applicate) { Write-Host "  - $voce" }

# Il file deve restare PowerShell valido: un errore di sintassi qui costa una
# notte di pipeline.
$errori = $null
[System.Management.Automation.Language.Parser]::ParseInput($script:testo, [ref]$null, [ref]$errori) | Out-Null
if ($errori -and $errori.Count -gt 0) {
    Write-Host ""
    Write-Host "Il risultato non e' PowerShell valido:" -ForegroundColor Red
    $errori | Select-Object -First 5 | ForEach-Object { Write-Host "  $($_.Message)" -ForegroundColor Red }
    Fallisci "sintassi non valida dopo la patch"
}
Write-Host "Sintassi verificata: il risultato compila." -ForegroundColor Green

if ($Diff) {
    Write-Host ""
    Write-Host "Righe introdotte:" -ForegroundColor Cyan
    $prima = (Get-Content -LiteralPath $Path -Encoding UTF8)
    $dopo  = $script:testo -split "`r?`n"
    Compare-Object $prima $dopo | Where-Object { $_.SideIndicator -eq "=>" } |
        ForEach-Object { Write-Host "  + $($_.InputObject)" -ForegroundColor Green }
}

if ($Check) {
    Write-Host ""
    Write-Host "Verifica superata. Nessuna modifica scritta (-Check)." -ForegroundColor Yellow
    exit 0
}

$marca  = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$Path.before-profili-$marca"
Copy-Item -LiteralPath $Path -Destination $backup -Force

# UTF8 senza BOM: lo stesso encoding con cui lo script viene letto.
$encoding = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Path, $script:testo, $encoding)

Write-Host ""
Write-Host "Patch applicata a $Path" -ForegroundColor Green
Write-Host "Backup: $backup" -ForegroundColor Green
Write-Host ""
Write-Host "Passi successivi:" -ForegroundColor Cyan
Write-Host "  1. aggiungere la voce cruscotto_articoli a config.json"
Write-Host "  2. copiare CRUSCOTTO_ARTICOLI.sql nella cartella delle query"
Write-Host "  3. .\Invoke-BIPipeline.ps1 -Profilo commerciale -ValidateOnly -SkipUpload"
Write-Host "     (deve continuare a funzionare esattamente come prima)"
Write-Host "  4. .\Invoke-BIPipeline.ps1 -Profilo cruscotto -ValidateOnly -SkipUpload"
