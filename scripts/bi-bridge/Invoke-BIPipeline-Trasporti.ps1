#requires -version 4.0

[CmdletBinding()]
param(
    # Nessun valore predefinito qui: su PowerShell 4.0 $PSScriptRoot e' VUOTO
    # dentro il blocco param() quando lo script viene lanciato con -File, e
    # Join-Path fallisce prima ancora che lo script cominci. Verificato su
    # SRVWOA il 12 settembre 2026. Il percorso si risolve nel corpo.
    [string]$ConfigPath,
    [ValidateSet("live", "riconciliazione")]
    [string]$Modo = "live",
    [switch]$SkipUpload,
    [switch]$Prova,
    [long]$UltimoIdVisto = -1
)

# $PSScriptRoot qui e' valorizzato: nel corpo funziona, nel param() no.
# $MyInvocation copre il caso in cui lo script venga invocato con il dot-source.
if (-not $ConfigPath) {
    $cartella = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $ConfigPath = Join-Path $cartella "config.trasporti.json"
}

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

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

function Get-PropertyValue {
    param($Object, [string]$Name)
    if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) {
        return $Object.$Name
    }
    return $null
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

function Get-CheckpointFromState {
    param([string]$Path)

    $result = [ordered]@{
        available = $false
        last_seen_id = $null
        seen_ids_window = @()
        path = $Path
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]$result
    }

    try {
        $saved = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
        $checkpointUploaded = Get-PropertyValue -Object $saved -Name "checkpoint_uploaded"
        if ($null -eq $checkpointUploaded) {
            $checkpointUploaded = Get-PropertyValue -Object $saved -Name "uploaded"
        }
        $savedLastSeen = Get-PropertyValue -Object $saved -Name "last_seen_id"
        if ([bool]$checkpointUploaded -and $null -ne $savedLastSeen) {
            $parsedLastSeen = 0L
            if ([long]::TryParse([string]$savedLastSeen, [ref]$parsedLastSeen)) {
                $result.available = $true
                $result.last_seen_id = $parsedLastSeen
                $savedSeenIds = Get-PropertyValue -Object $saved -Name "seen_ids_window"
                foreach ($savedId in @($savedSeenIds)) {
                    $parsedSavedId = 0L
                    if ([long]::TryParse([string]$savedId, [ref]$parsedSavedId)) {
                        $result.seen_ids_window += $parsedSavedId
                    }
                }
            }
        }
    }
    catch {
        throw ("Stato non leggibile {0}: {1}" -f $Path, $_.Exception.Message)
    }
    return [pscustomobject]$result
}

function Get-CsvValidation {
    param(
        [string]$Path,
        [string]$Dataset,
        [int]$ExpectedColumns,
        [double]$MaxAgeHours,
        [string]$HeaderPattern
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
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
    $ids = @()
    $maxId = $null
    $conIntestazione = $false
    try {
        while (-not $parser.EndOfData) {
            $fields = $parser.ReadFields()
            $lineNumber++
            if ($null -eq $fields) {
                continue
            }
            if ($fields.Count -ne $ExpectedColumns) {
                throw ("Numero colonne errato in {0} alla riga {1}: attese {2}, trovate {3}" -f $Path, $lineNumber, $ExpectedColumns, $fields.Count)
            }
            # Il client SQL Anywhere 11 non supporta WITH COLUMN NAMES, quindi
            # il CSV arriva SENZA intestazione. I CSV prodotti a settembre con
            # il client 16 invece ce l'hanno. Si accettano entrambi: se la prima
            # riga e' un'intestazione la si salta, altrimenti e' gia' un dato.
            # Il contratto vero e' l'ordine delle colonne, verificato per
            # posizione: un'intestazione fabbricata qui passerebbe sempre il
            # controllo e non verificherebbe niente.
            if ($lineNumber -eq 1 -and [string]$fields[0] -match $HeaderPattern) {
                $conIntestazione = $true
                continue
            }

            $id = 0L
            if (-not [long]::TryParse([string]$fields[0], [ref]$id)) {
                throw "id_documento non numerico in $Path alla riga $lineNumber"
            }
            $ids += $id
            $rowCount++
            if ($null -eq $maxId -or $id -gt [long]$maxId) {
                $maxId = $id
            }
        }
    }
    finally {
        $parser.Close()
    }

    if ($lineNumber -eq 0) {
        throw "CSV privo di intestazione: $Path"
    }

    $file = Get-Item -LiteralPath $Path
    $ageHours = ((Get-Date) - $file.LastWriteTime).TotalHours
    if ($MaxAgeHours -gt 0 -and $ageHours -gt $MaxAgeHours) {
        throw "File troppo vecchio: $Path ($([Math]::Round($ageHours, 1)) ore)"
    }

    $info = [ordered]@{
        file = $file.Name
        dataset = $Dataset
        rows = $rowCount
        columns = $ExpectedColumns
        bytes = $file.Length
        modified = $file.LastWriteTime.ToString("s")
        sha256 = Get-Sha256 -Path $Path
    }
    return [pscustomobject]@{
        Info = $info
        Ids = @($ids)
        MaxId = $maxId
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

function Open-PipelineLock {
    param(
        [string]$Path,
        [string]$RunMode,
        [int]$WaitSeconds
    )

    $deadline = (Get-Date).AddSeconds($WaitSeconds)
    $waitLogged = $false
    while ($true) {
        try {
            return [IO.File]::Open(
                $Path,
                [IO.FileMode]::CreateNew,
                [IO.FileAccess]::Write,
                [IO.FileShare]::None
            )
        }
        catch [IO.IOException] {
            if (-not (Test-Path -LiteralPath $Path)) {
                throw
            }
            if ($RunMode -eq "live") {
                return $null
            }
            if ((Get-Date) -ge $deadline) {
                throw "pipeline.lock occupato oltre $WaitSeconds secondi: $Path"
            }
            if (-not $waitLogged) {
                Write-PipelineLog "pipeline.lock occupato; attendo la riconciliazione" "WARN"
                $waitLogged = $true
            }
            Start-Sleep -Seconds 5
        }
    }
}

function Test-TransportConfiguration {
    param($Config, $Query, [string]$RunMode)

    if ([int]$Query.ExpectedColumns -ne 68) {
        throw "ExpectedColumns deve essere 68 per trasporti_documenti"
    }
    if ([string]$Query.HeaderPattern -ne "^id_documento$") {
        throw "HeaderPattern deve essere '^id_documento$'"
    }
    if (-not (Test-Path -LiteralPath ([string]$Config.DbisqlPath) -PathType Leaf)) {
        throw "dbisql non trovato: $($Config.DbisqlPath)"
    }
    $sqlPath = Join-Path ([string]$Config.SqlRoot) ([string]$Query.SqlFile)
    if (-not (Test-Path -LiteralPath $sqlPath -PathType Leaf)) {
        throw "Query SQL mancante: $sqlPath"
    }
    $sqlText = Get-Content -LiteralPath $sqlPath -Raw
    $placeholder = "{{ULTIMO_ID_SOGLIA}}"
    $placeholderCount = ([regex]::Matches($sqlText, [regex]::Escape($placeholder))).Count
    if ($RunMode -eq "live" -and $placeholderCount -ne 1) {
        throw "La query live deve contenere una sola volta $placeholder"
    }
    if ($RunMode -eq "riconciliazione" -and $placeholderCount -ne 0) {
        throw "La query di riconciliazione non deve contenere $placeholder"
    }
    if ($sqlText -notmatch [regex]::Escape([string]$Query.OutputFile)) {
        throw "La query non scrive il file configurato $($Query.OutputFile)"
    }
}

function Get-SeenMap {
    param([long[]]$Ids)
    $map = @{}
    foreach ($id in @($Ids)) {
        $map[$id.ToString([Globalization.CultureInfo]::InvariantCulture)] = $true
    }
    return $map
}

function Get-WindowIds {
    param([long[]]$Ids, [long]$LastSeenId)
    $windowStart = $LastSeenId - 50L
    return @($Ids | Where-Object { $_ -gt $windowStart } | Sort-Object -Unique)
}

function Protect-NativeOutput {
    param(
        [string]$Text,
        [string]$Connection,
        [string]$Password
    )
    $safe = $Text
    if (-not [string]::IsNullOrEmpty($Connection)) {
        $safe = $safe.Replace($Connection, "[CONNESSIONE REDATTA]")
    }
    if (-not [string]::IsNullOrEmpty($Password)) {
        $safe = $safe.Replace($Password, "[PASSWORD REDATTA]")
    }
    return $safe
}

function Send-FailureAlert {
    param(
        [string]$RuntimeRoot,
        [string]$RunMode,
        [string]$Details,
        [string]$RunId,
        [string]$Phase,
        [string]$LogPath,
        [string]$StatusPath
    )
    try {
        $alertSender = Join-Path $RuntimeRoot "Monitoring\Send-ImpresaBIAlert.ps1"
        if (-not (Test-Path -LiteralPath $alertSender -PathType Leaf)) {
            Write-PipelineLog "Modulo allarmi assente: $alertSender" "WARN"
            return
        }
        $component = "windows-trasporti"
        $taskName = "IMPRESA_BI_TRASPORTI"
        if ($RunMode -eq "live") {
            $component = "windows-trasporti-live"
            $taskName = "IMPRESA_BI_TRASPORTI_LIVE"
        }
        $alertParameters = @{
            Component = $component
            Severity = "ERROR"
            Summary = "Pipeline trasporti $RunMode fallita"
            Details = $Details
            EventKey = ("{0}:trasporti:{1}:{2}:{3}" -f $env:COMPUTERNAME, $RunMode, $RunId, $Phase)
            Task = $taskName
            RunId = $RunId
            Phase = $Phase
            Dataset = "trasporti_documenti"
            LogPaths = @($LogPath, $StatusPath)
            Remediation = @(
                "Leggere stato e log del run.",
                "Verificare rete verso SQL Anywhere e HTTPS verso Linux.",
                "Rilanciare solo dopo avere corretto la causa."
            )
            NoProcessExit = $true
        }
        $alertResult = & $alertSender @alertParameters
        Write-PipelineLog ("Allarme: inviato={0}; copia={1}; esito={2}" -f $alertResult.Sent, $alertResult.RecordPath, $alertResult.Result) "ERROR"
    }
    catch {
        try {
            Write-PipelineLog ("Invio allarme fallito: {0}" -f $_.Exception.Message) "ERROR"
        }
        catch {}
    }
}

if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw "Configurazione non trovata: $ConfigPath"
}

$config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$selectedQueries = @($config.Queries | Where-Object {
    [string]$_.Modo -eq $Modo
})
if ($selectedQueries.Count -ne 1) {
    throw "Configurazione non valida: attesa una query per il modo '$Modo'"
}
$query = $selectedQueries[0]
$runId = Get-Date -Format "yyyyMMdd_HHmmss"
$runtimeRoot = [string]$config.RuntimeRoot
$logRoot = Join-Path $runtimeRoot "logs"
$backupRoot = Join-Path $runtimeRoot "backups"
$tempRoot = Join-Path $runtimeRoot "temp"
$lockPath = Join-Path $runtimeRoot "pipeline.lock"
$dbCredentialPath = Join-Path $runtimeRoot "sqlanywhere.credential.xml"
$bridgeTokenPath = Join-Path $runtimeRoot "linux-bridge.token"
$statusFileName = "last-run-trasporti.json"
if ($Modo -eq "live") {
    $statusFileName = "last-run-trasporti-live.json"
}
$statusPath = Join-Path $runtimeRoot $statusFileName

New-DirectoryIfMissing -Path $runtimeRoot
New-DirectoryIfMissing -Path $logRoot
New-DirectoryIfMissing -Path $backupRoot
$script:LogPath = Join-Path $logRoot ("pipeline_trasporti_{0}_{1}.log" -f $Modo, $runId)

Write-PipelineLog "Avvio pipeline trasporti; modo=$Modo; run=$runId"
Test-TransportConfiguration -Config $config -Query $query -RunMode $Modo
if ($Prova) {
    Write-PipelineLog ("Modalita Prova completata: configurazione, dbisql e query verificati; " +
        "gestionale, output, lock, stato e receiver non toccati")
    return
}

$liveStatePath = Join-Path $runtimeRoot "last-run-trasporti-live.json"
$reconciliationStatePath = Join-Path $runtimeRoot "last-run-trasporti.json"
$checkpoint = [pscustomobject]([ordered]@{
    available = $false
    last_seen_id = $null
    seen_ids_window = @()
    path = ""
})
$checkpointSource = "nessuno"

if ($Modo -eq "live") {
    if ($UltimoIdVisto -ge 0) {
        $checkpoint.available = $true
        $checkpoint.last_seen_id = $UltimoIdVisto
        $checkpoint.path = "parametro -UltimoIdVisto"
        $checkpointSource = "parametro"
    }
    else {
        $checkpoint = Get-CheckpointFromState -Path $liveStatePath
        if ($checkpoint.available) {
            $checkpointSource = "live"
        }
        else {
            $checkpoint = Get-CheckpointFromState -Path $reconciliationStatePath
            if ($checkpoint.available) {
                $checkpointSource = "riconciliazione"
            }
        }
    }
}
else {
    $checkpoint = Get-CheckpointFromState -Path $reconciliationStatePath
    if ($checkpoint.available) {
        $checkpointSource = "riconciliazione"
    }
}

$lastSeenId = $null
$checkpointUploaded = $false
$seenIdsWindow = @()
if ($checkpoint.available) {
    $lastSeenId = [long]$checkpoint.last_seen_id
    $checkpointUploaded = $true
    $seenIdsWindow = @($checkpoint.seen_ids_window)
}
if ($Modo -eq "live" -and $UltimoIdVisto -ge 0) {
    $checkpointUploaded = $false
}

$status = [ordered]@{
    run_id = $runId
    mode = $Modo
    status = "RUNNING"
    started = (Get-Date).ToString("s")
    finished = $null
    step = "startup"
    files = @()
    rows = 0
    new_rows = 0
    observed_max_id = $null
    last_seen_id = $lastSeenId
    threshold_id = $null
    checkpoint_source = $checkpointSource
    checkpoint_uploaded = $checkpointUploaded
    seen_ids_window = @($seenIdsWindow)
    uploaded = $false
    empty = $false
    skipped_lock = $false
    message = ""
}

$waitSeconds = 0
if ($Modo -eq "riconciliazione") {
    $waitSeconds = [int]$config.LockWaitSecondsRiconciliazione
}
$lockParameters = @{
    Path = $lockPath
    RunMode = $Modo
    WaitSeconds = $waitSeconds
}
$lockStream = $null
try {
    $lockStream = Open-PipelineLock @lockParameters
}
catch {
    $status.status = "FAILED"
    $status.step = "lock"
    $status.finished = (Get-Date).ToString("s")
    $status.message = $_.Exception.Message
    $status | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statusPath -Encoding UTF8
    Write-PipelineLog $_.Exception.ToString() "ERROR"
    $lockAlertParameters = @{
        RuntimeRoot = $runtimeRoot
        RunMode = $Modo
        Details = $_.Exception.ToString()
        RunId = $runId
        Phase = "lock"
        LogPath = $script:LogPath
        StatusPath = $statusPath
    }
    Send-FailureAlert @lockAlertParameters
    throw
}
if ($null -eq $lockStream) {
    $status.status = "SUCCESS"
    $status.step = "skipped_lock"
    $status.finished = (Get-Date).ToString("s")
    $status.skipped_lock = $true
    $status.message = "Lock occupato: run live saltato senza attesa."
    $status | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statusPath -Encoding UTF8
    Write-PipelineLog $status.message
    return
}

$snapshotPath = $null
$generatedSqlPath = $null
$failure = $null
$outputPath = Join-Path ([string]$config.OutputRoot) ([string]$query.OutputFile)
$outputDirectory = [IO.Path]::GetDirectoryName($outputPath)

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    if ($Modo -eq "live" -and $null -eq $lastSeenId) {
        throw ("Checkpoint live assente. Eseguire prima una riconciliazione con upload " +
            "oppure usare -UltimoIdVisto per un collaudo controllato.")
    }

    New-DirectoryIfMissing -Path $outputDirectory
    $beforeTime = [DateTime]::MinValue
    if (Test-Path -LiteralPath $outputPath -PathType Leaf) {
        $beforeTime = (Get-Item -LiteralPath $outputPath).LastWriteTimeUtc
    }

    $snapshotPath = Join-Path $backupRoot $runId
    New-DirectoryIfMissing -Path $snapshotPath
    if (Test-Path -LiteralPath $outputPath -PathType Leaf) {
        $snapshotOutputPath = Join-Path $snapshotPath ([string]$query.OutputFile)
        $snapshotOutputDirectory = [IO.Path]::GetDirectoryName($snapshotOutputPath)
        New-DirectoryIfMissing -Path $snapshotOutputDirectory
        Copy-Item -LiteralPath $outputPath -Destination $snapshotOutputPath -Force
    }

    if (-not (Test-Path -LiteralPath $dbCredentialPath -PathType Leaf)) {
        throw "Credenziali SQL Anywhere mancanti: $dbCredentialPath"
    }

    $sqlPath = Join-Path ([string]$config.SqlRoot) ([string]$query.SqlFile)
    if ($Modo -eq "live") {
        $thresholdId = [long]$lastSeenId - 50L
        $status.threshold_id = $thresholdId
        $templateSql = Get-Content -LiteralPath $sqlPath -Raw
        $thresholdText = $thresholdId.ToString([Globalization.CultureInfo]::InvariantCulture)
        $generatedSql = $templateSql.Replace("{{ULTIMO_ID_SOGLIA}}", $thresholdText)
        New-DirectoryIfMissing -Path $tempRoot
        $generatedSqlPath = Join-Path $tempRoot ("TRASPORTI_DOCUMENTI_LIVE_{0}.sql" -f $runId)
        [IO.File]::WriteAllText(
            $generatedSqlPath,
            $generatedSql,
            (New-Object System.Text.UTF8Encoding($false))
        )
        $sqlPath = $generatedSqlPath
        Write-PipelineLog ("Query live preparata: ultimo_id_visto={0}; soglia={1}" -f $lastSeenId, $thresholdId)
    }

    $credential = Import-Clixml -LiteralPath $dbCredentialPath
    $dbPassword = Convert-SecureStringToPlainText -SecureValue $credential.Password
    $connection = $null
    try {
        $connection = "uid={0};pwd={1}" -f $credential.UserName, $dbPassword
        $status.step = "extract"
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
            $nativeText = ($queryOutput | Out-String).Trim()
            $safeNativeText = Protect-NativeOutput -Text $nativeText -Connection $connection -Password $dbPassword
            Write-PipelineLog $safeNativeText
        }
        if ($exitCode -ne 0) {
            throw "Query $($query.SqlFile) fallita con codice $exitCode"
        }
    }
    finally {
        $dbPassword = $null
        $connection = $null
    }

    if (-not (Test-Path -LiteralPath $outputPath -PathType Leaf)) {
        throw "La query non ha prodotto $outputPath"
    }
    $newTime = (Get-Item -LiteralPath $outputPath).LastWriteTimeUtc
    if ($newTime -le $beforeTime) {
        throw "La query non ha aggiornato $outputPath"
    }

    $status.step = "validate"
    $validationParameters = @{
        Path = $outputPath
        Dataset = [string]$query.Dataset
        ExpectedColumns = [int]$query.ExpectedColumns
        MaxAgeHours = [double]$config.MaxAgeHours
        HeaderPattern = [string]$query.HeaderPattern
    }
    $validation = Get-CsvValidation @validationParameters
    $info = $validation.Info
    $ids = @($validation.Ids)
    $status.files = @($info)
    $status.rows = [int]$info.rows
    $status.observed_max_id = $validation.MaxId
    Write-PipelineLog ("OK {0}: righe={1}, colonne={2}, sha256={3}" -f $info.file, $info.rows, $info.columns, $info.sha256)

    if ($Modo -eq "riconciliazione" -and [int]$info.rows -eq 0) {
        throw "La riconciliazione a 90 giorni non ha prodotto righe"
    }

    $uploadRequired = $false
    $newIds = @()
    if ($Modo -eq "riconciliazione") {
        $uploadRequired = $true
        $newIds = @($ids)
        $status.new_rows = $newIds.Count
    }
    else {
        $seenMap = Get-SeenMap -Ids $seenIdsWindow
        foreach ($id in @($ids)) {
            $idKey = $id.ToString([Globalization.CultureInfo]::InvariantCulture)
            if (-not $seenMap.ContainsKey($idKey)) {
                $newIds += $id
            }
        }
        $status.new_rows = $newIds.Count
        if ($newIds.Count -gt 0) {
            $uploadRequired = $true
        }
    }

    if (-not $uploadRequired) {
        $status.empty = $true
        Write-PipelineLog "Nessun nuovo documento (caso normale): upload e manifest non eseguiti; checkpoint invariato"
    }
    elseif ($SkipUpload) {
        Write-PipelineLog "Modalita SkipUpload: estrazione validata, checkpoint non avanzato"
    }
    else {
        if (-not (Test-Path -LiteralPath $bridgeTokenPath -PathType Leaf)) {
            throw "Token del ponte Linux mancante: $bridgeTokenPath"
        }
        $tokenEncrypted = (Get-Content -LiteralPath $bridgeTokenPath -Raw).Trim()
        $tokenSecure = $tokenEncrypted | ConvertTo-SecureString
        $tokenPlain = Convert-SecureStringToPlainText -SecureValue $tokenSecure
        try {
            $status.step = "upload"
            Write-PipelineLog "Invio dataset $($query.Dataset)"
            $sendParameters = @{
                BaseUrl = [string]$config.LinuxIngestBaseUrl
                Dataset = [string]$query.Dataset
                Path = $outputPath
                RunId = $runId
                Sha256 = [string]$info.sha256
                Token = $tokenPlain
            }
            $response = Send-Dataset @sendParameters
            Write-PipelineLog "Risposta Linux $($query.Dataset): $response"

            $manifest = [ordered]@{
                run_id = $runId
                mode = $Modo
                source = $env:COMPUTERNAME
                completed_at = (Get-Date).ToString("s")
                files = @($info)
            } | ConvertTo-Json -Depth 6
            $completionParameters = @{
                BaseUrl = [string]$config.LinuxIngestBaseUrl
                ManifestJson = $manifest
                RunId = $runId
                Token = $tokenPlain
            }
            $completion = Send-CompletionManifest @completionParameters
            Write-PipelineLog "Run accettato dal Linux: $completion"
            $status.uploaded = $true
        }
        finally {
            $tokenPlain = $null
        }

        $newLastSeenId = [long]$validation.MaxId
        if ($null -ne $lastSeenId -and $lastSeenId -gt $newLastSeenId) {
            $newLastSeenId = [long]$lastSeenId
        }
        $lastSeenId = $newLastSeenId
        $seenIdsWindow = Get-WindowIds -Ids $ids -LastSeenId $lastSeenId
        $status.last_seen_id = $lastSeenId
        $status.checkpoint_uploaded = $true
        $status.seen_ids_window = @($seenIdsWindow)
    }

    $status.status = "SUCCESS"
    $status.step = "complete"
    $status.finished = (Get-Date).ToString("s")
    if ($status.empty) {
        $status.message = "Nessun nuovo documento; nessun upload necessario."
    }
    elseif ($SkipUpload) {
        $status.message = "Estrazione e validazione completate; upload saltato."
    }
    else {
        $status.message = "Estrazione, validazione e consegna completate."
    }
    Write-PipelineLog "PIPELINE COMPLETATA: $($status.message)"
}
catch {
    $failure = $_
    $status.status = "FAILED"
    $status.finished = (Get-Date).ToString("s")
    $status.message = $_.Exception.Message
    Write-PipelineLog $_.Exception.ToString() "ERROR"

    if ($snapshotPath -and (Test-Path -LiteralPath $snapshotPath)) {
        $backupPath = Join-Path $snapshotPath ([string]$query.OutputFile)
        if (Test-Path -LiteralPath $backupPath -PathType Leaf) {
            Copy-Item -LiteralPath $backupPath -Destination $outputPath -Force
            Write-PipelineLog "Ripristinato l'output precedente" "WARN"
        }
    }
}
finally {
    try {
        $status | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $statusPath -Encoding UTF8
    }
    finally {
        try {
            if ($generatedSqlPath -and (Test-Path -LiteralPath $generatedSqlPath -PathType Leaf)) {
                Remove-Item -LiteralPath $generatedSqlPath -Force
            }
        }
        finally {
            if ($lockStream) {
                $lockStream.Dispose()
                if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
                    Remove-Item -LiteralPath $lockPath -Force
                }
            }
        }
    }
}

if ($null -ne $failure) {
    $alertParameters = @{
        RuntimeRoot = $runtimeRoot
        RunMode = $Modo
        Details = $failure.Exception.ToString()
        RunId = $runId
        Phase = [string]$status.step
        LogPath = $script:LogPath
        StatusPath = $statusPath
    }
    Send-FailureAlert @alertParameters
    throw $failure
}
