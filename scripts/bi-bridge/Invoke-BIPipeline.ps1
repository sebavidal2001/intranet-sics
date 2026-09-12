#requires -version 4.0

[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "config.json"),
    [ValidateSet("commerciale", "cruscotto", "tutti")]
    [string]$Profilo = "commerciale",
    [switch]$ValidateOnly,
    [switch]$SkipUpload
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

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

function New-DirectoryIfMissing {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

function Write-PipelineLog {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    $line = "{0} | {1} | {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Write-Host $line
    Add-Content -LiteralPath $script:LogPath -Value $line -Encoding UTF8
}

function Convert-SecureStringToPlainText {
    param([Security.SecureString]$SecureValue)
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function Get-Sha256 {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $sha = New-Object Security.Cryptography.SHA256Managed
    try {
        $bytes = $sha.ComputeHash($stream)
        return ([BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Get-CsvValidation {
    param(
        [string]$Path,
        [int]$ExpectedColumns,
        [double]$MaxAgeHours,
        [string]$HeaderPattern = "^(Codice Gruppo|gruppo_codice)$"
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw "File mancante: $Path"
    }

    Add-Type -AssemblyName Microsoft.VisualBasic
    $parser = New-Object Microsoft.VisualBasic.FileIO.TextFieldParser(
        $Path,
        [Text.Encoding]::UTF8,
        $true
    )
    $parser.TextFieldType = [Microsoft.VisualBasic.FileIO.FieldType]::Delimited
    $parser.SetDelimiters(";")
    $parser.HasFieldsEnclosedInQuotes = $true
    $parser.TrimWhiteSpace = $false

    $rowCount = 0
    $lineNumber = 0
    try {
        while (-not $parser.EndOfData) {
            $fields = $parser.ReadFields()
            $lineNumber++
            if ($null -eq $fields) {
                continue
            }
            if ($fields.Count -ne $ExpectedColumns) {
                throw "Numero colonne errato in $Path alla riga $lineNumber`: attese $ExpectedColumns, trovate $($fields.Count)"
            }

            $isHeader = $lineNumber -eq 1 -and
                [string]$fields[0] -match $HeaderPattern
            if (-not $isHeader) {
                $rowCount++
            }
        }
    }
    finally {
        $parser.Close()
    }

    if ($rowCount -lt 1) {
        throw "Nessuna riga dati in $Path"
    }

    $file = Get-Item -LiteralPath $Path
    $ageHours = ((Get-Date) - $file.LastWriteTime).TotalHours
    if ($MaxAgeHours -gt 0 -and $ageHours -gt $MaxAgeHours) {
        throw "File troppo vecchio: $Path ($([Math]::Round($ageHours, 1)) ore)"
    }

    return [ordered]@{
        file = $file.Name
        rows = $rowCount
        columns = $ExpectedColumns
        bytes = $file.Length
        modified = $file.LastWriteTime.ToString("s")
        sha256 = Get-Sha256 -Path $Path
    }
}

function Send-Dataset {
    param(
        [string]$BaseUrl,
        [string]$Dataset,
        [string]$Path,
        [string]$RunId,
        [string]$Sha256,
        [string]$Token
    )

    Add-Type -AssemblyName System.Net.Http
    $url = $BaseUrl.TrimEnd("/") + "/" + [Uri]::EscapeDataString($Dataset)
    $handler = New-Object Net.Http.HttpClientHandler
    $client = New-Object Net.Http.HttpClient($handler)
    $stream = [IO.File]::OpenRead($Path)
    $content = New-Object Net.Http.StreamContent($stream)
    $request = New-Object Net.Http.HttpRequestMessage(
        [Net.Http.HttpMethod]::Post,
        $url
    )

    try {
        $request.Headers.Add("X-Bridge-Token", $Token)
        $request.Headers.Add("X-Run-Id", $RunId)
        $request.Headers.Add("X-Dataset", $Dataset)
        $request.Headers.Add("X-SHA256", $Sha256)
        $content.Headers.ContentType = New-Object Net.Http.Headers.MediaTypeHeaderValue("text/csv")
        $content.Headers.ContentDisposition = New-Object Net.Http.Headers.ContentDispositionHeaderValue("attachment")
        $content.Headers.ContentDisposition.FileName = '"' + [IO.Path]::GetFileName($Path) + '"'
        $request.Content = $content

        $response = $client.SendAsync($request).Result
        $responseBody = $response.Content.ReadAsStringAsync().Result
        if (-not $response.IsSuccessStatusCode) {
            throw "Upload $Dataset fallito: HTTP $([int]$response.StatusCode) $responseBody"
        }
        return $responseBody
    }
    finally {
        $request.Dispose()
        $content.Dispose()
        $stream.Dispose()
        $client.Dispose()
        $handler.Dispose()
    }
}

function Send-CompletionManifest {
    param(
        [string]$BaseUrl,
        [string]$ManifestJson,
        [string]$RunId,
        [string]$Token
    )

    Add-Type -AssemblyName System.Net.Http
    $url = $BaseUrl.TrimEnd("/") + "/complete"
    $client = New-Object Net.Http.HttpClient
    $request = New-Object Net.Http.HttpRequestMessage(
        [Net.Http.HttpMethod]::Post,
        $url
    )
    $content = New-Object Net.Http.StringContent(
        $ManifestJson,
        [Text.Encoding]::UTF8,
        "application/json"
    )
    try {
        $request.Headers.Add("X-Bridge-Token", $Token)
        $request.Headers.Add("X-Run-Id", $RunId)
        $request.Content = $content
        $response = $client.SendAsync($request).Result
        $responseBody = $response.Content.ReadAsStringAsync().Result
        if (-not $response.IsSuccessStatusCode) {
            throw "Chiusura run fallita: HTTP $([int]$response.StatusCode) $responseBody"
        }
        return $responseBody
    }
    finally {
        $request.Dispose()
        $content.Dispose()
        $client.Dispose()
    }
}

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    throw "Configurazione non trovata: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
# @(...) obbligatorio: con una sola query PowerShell srotolerebbe l'array a
# scalare, e $queries.Count o $queries[0] smetterebbero di funzionare.
$queries = @(Select-QueriesPerProfilo -Queries $config.Queries -Profilo $Profilo)
Write-Host "Profilo '$Profilo': $($queries.Count) query selezionate"
$runId = Get-Date -Format "yyyyMMdd_HHmmss"
$runtimeRoot = [string]$config.RuntimeRoot
$logRoot = Join-Path $runtimeRoot "logs"
$backupRoot = Join-Path $runtimeRoot "backups"
$statusPath = Join-Path $runtimeRoot "last-run.json"
$lockPath = Join-Path $runtimeRoot "pipeline.lock"
$dbCredentialPath = Join-Path $runtimeRoot "sqlanywhere.credential.xml"
$bridgeTokenPath = Join-Path $runtimeRoot "linux-bridge.token"

New-DirectoryIfMissing -Path $runtimeRoot
New-DirectoryIfMissing -Path $logRoot
New-DirectoryIfMissing -Path $backupRoot
$script:LogPath = Join-Path $logRoot ("pipeline_{0}.log" -f $runId)

$lockStream = $null
$snapshotPath = $null
$status = [ordered]@{
    run_id = $runId
    status = "RUNNING"
    started = (Get-Date).ToString("s")
    finished = $null
    step = "startup"
    files = @()
    message = ""
}

try {
    $lockStream = [IO.File]::Open(
        $lockPath,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None
    )

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Write-PipelineLog "Avvio pipeline $runId"

    if (-not (Test-Path -LiteralPath ([string]$config.OutputRoot))) {
        New-DirectoryIfMissing -Path ([string]$config.OutputRoot)
    }

    $beforeTimes = @{}
    foreach ($query in $queries) {
        $outputPath = Join-Path ([string]$config.OutputRoot) ([string]$query.OutputFile)
        if (Test-Path -LiteralPath $outputPath) {
            $beforeTimes[[string]$query.OutputFile] = (Get-Item -LiteralPath $outputPath).LastWriteTimeUtc
        }
        else {
            $beforeTimes[[string]$query.OutputFile] = [DateTime]::MinValue
        }
    }

    if (-not $ValidateOnly) {
        if (-not (Test-Path -LiteralPath ([string]$config.DbisqlPath))) {
            throw "dbisql non trovato: $($config.DbisqlPath)"
        }
        if (-not (Test-Path -LiteralPath $dbCredentialPath)) {
            throw "Credenziali SQL Anywhere mancanti: eseguire Setup-Secrets.ps1"
        }

        $snapshotPath = Join-Path $backupRoot $runId
        New-DirectoryIfMissing -Path $snapshotPath
        foreach ($query in $queries) {
            $outputPath = Join-Path ([string]$config.OutputRoot) ([string]$query.OutputFile)
            if (Test-Path -LiteralPath $outputPath) {
                Copy-Item -LiteralPath $outputPath -Destination $snapshotPath -Force
            }
        }

        $credential = Import-Clixml -LiteralPath $dbCredentialPath
        $dbPassword = Convert-SecureStringToPlainText -SecureValue $credential.Password
        try {
            $connection = "uid={0};pwd={1}" -f $credential.UserName, $dbPassword
            $status.step = "extract"

            foreach ($query in $queries) {
                $sqlPath = Join-Path ([string]$config.SqlRoot) ([string]$query.SqlFile)
                if (-not (Test-Path -LiteralPath $sqlPath)) {
                    throw "Query SQL mancante: $sqlPath"
                }

                Write-PipelineLog "Esecuzione $($query.SqlFile)"
                $arguments = @(
                    "-c",
                    $connection,
                    "-datasource",
                    [string]$config.DataSource,
                    "-nogui",
                    $sqlPath
                )
                $queryOutput = & ([string]$config.DbisqlPath) @arguments 2>&1
                $exitCode = $LASTEXITCODE
                if ($queryOutput) {
                    Write-PipelineLog (($queryOutput | Out-String).Trim())
                }
                if ($exitCode -ne 0) {
                    throw "Query $($query.SqlFile) fallita con codice $exitCode"
                }

                $outputPath = Join-Path ([string]$config.OutputRoot) ([string]$query.OutputFile)
                if (-not (Test-Path -LiteralPath $outputPath)) {
                    throw "La query non ha prodotto $outputPath"
                }
                $newTime = (Get-Item -LiteralPath $outputPath).LastWriteTimeUtc
                if ($newTime -le $beforeTimes[[string]$query.OutputFile]) {
                    throw "La query non ha aggiornato $outputPath"
                }
            }
        }
        finally {
            $dbPassword = $null
            $connection = $null
        }
    }
    else {
        Write-PipelineLog "Modalita ValidateOnly: query non eseguite"
    }

    $status.step = "validate"
    $validated = @()
    foreach ($query in $queries) {
        $outputPath = Join-Path ([string]$config.OutputRoot) ([string]$query.OutputFile)

        if ([string]$query.Dataset -eq "preventivi_aperti") {
            $headerValidatorPath = Join-Path `
                $PSScriptRoot `
                "Verifica-IntestazioneV2.ps1"
            if (-not (Test-Path -LiteralPath $headerValidatorPath)) {
                throw "Verificatore intestazione V2 mancante: $headerValidatorPath"
            }

            $windowsPowerShell = Join-Path $PSHOME "powershell.exe"
            $headerValidationOutput = & $windowsPowerShell `
                -NoProfile `
                -NonInteractive `
                -ExecutionPolicy Bypass `
                -File $headerValidatorPath `
                -Percorso $outputPath `
                -AggiungiSeAssente 2>&1
            $headerValidationExitCode = $LASTEXITCODE
            if ($headerValidationOutput) {
                Write-PipelineLog (
                    ($headerValidationOutput | Out-String).Trim()
                )
            }
            if ($headerValidationExitCode -ne 0) {
                throw (
                    "Intestazione V2 non valida per {0}: codice {1}" -f `
                    $outputPath, `
                    $headerValidationExitCode
                )
            }
        }

        $headerPattern = if ($query.PSObject.Properties.Name -contains "HeaderPattern") {
            [string]$query.HeaderPattern
        } else { "^(Codice Gruppo|gruppo_codice)$" }
        $info = Get-CsvValidation `
            -Path $outputPath `
            -ExpectedColumns ([int]$query.ExpectedColumns) `
            -MaxAgeHours ([double]$config.MaxAgeHours) `
            -HeaderPattern $headerPattern
        $info.dataset = [string]$query.Dataset
        $validated += $info
        Write-PipelineLog "OK $($info.file): righe=$($info.rows), colonne=$($info.columns), sha256=$($info.sha256)"
    }
    $status.files = $validated

    if (-not $SkipUpload) {
        if (-not (Test-Path -LiteralPath $bridgeTokenPath)) {
            throw "Token del ponte Linux mancante: eseguire Setup-Secrets.ps1"
        }
        $tokenEncrypted = (Get-Content -LiteralPath $bridgeTokenPath -Raw).Trim()
        $tokenSecure = $tokenEncrypted | ConvertTo-SecureString
        $tokenPlain = Convert-SecureStringToPlainText -SecureValue $tokenSecure
        try {
            $status.step = "upload"
            foreach ($item in $validated) {
                $path = Join-Path ([string]$config.OutputRoot) ([string]$item.file)
                Write-PipelineLog "Invio dataset $($item.dataset)"
                $response = Send-Dataset `
                    -BaseUrl ([string]$config.LinuxIngestBaseUrl) `
                    -Dataset ([string]$item.dataset) `
                    -Path $path `
                    -RunId $runId `
                    -Sha256 ([string]$item.sha256) `
                    -Token $tokenPlain
                Write-PipelineLog "Risposta Linux $($item.dataset): $response"
            }

            $manifest = [ordered]@{
                run_id = $runId
                source = $env:COMPUTERNAME
                completed_at = (Get-Date).ToString("s")
                files = $validated
            } | ConvertTo-Json -Depth 6
            $completion = Send-CompletionManifest `
                -BaseUrl ([string]$config.LinuxIngestBaseUrl) `
                -ManifestJson $manifest `
                -RunId $runId `
                -Token $tokenPlain
            Write-PipelineLog "Run accettato dal Linux: $completion"
        }
        finally {
            $tokenPlain = $null
        }
    }
    else {
        Write-PipelineLog "Modalita SkipUpload: invio al Linux non eseguito"
    }

    $status.status = "SUCCESS"
    $status.step = "complete"
    $status.finished = (Get-Date).ToString("s")
    $status.message = "Estrazione, validazione e consegna completate."
    Write-PipelineLog "PIPELINE COMPLETATA"
}
catch {
    $status.status = "FAILED"
    $status.finished = (Get-Date).ToString("s")
    $status.message = $_.Exception.Message
    Write-PipelineLog $_.Exception.ToString() "ERROR"

    if ($snapshotPath -and (Test-Path -LiteralPath $snapshotPath)) {
        foreach ($query in $queries) {
            $backupPath = Join-Path $snapshotPath ([string]$query.OutputFile)
            if (Test-Path -LiteralPath $backupPath) {
                Copy-Item `
                    -LiteralPath $backupPath `
                    -Destination (Join-Path ([string]$config.OutputRoot) ([string]$query.OutputFile)) `
                    -Force
            }
        }
        Write-PipelineLog "Ripristinati gli output precedenti" "WARN"
    }
    throw
}
finally {
    $status | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statusPath -Encoding UTF8
    if ($lockStream) {
        $lockStream.Dispose()
    }
    if (Test-Path -LiteralPath $lockPath) {
        Remove-Item -LiteralPath $lockPath -Force
    }
}
