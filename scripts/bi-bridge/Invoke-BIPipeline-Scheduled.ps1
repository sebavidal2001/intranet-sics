#requires -version 4.0
[CmdletBinding()]
param()
Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$installRoot = "C:\Impresa\BI_Bridge"
$runtimeRoot = "C:\ProgramData\ImpresaBI"
$pipelinePath = Join-Path $installRoot "Invoke-BIPipeline.ps1"
$configPath = Join-Path $installRoot "config.json"
$launcherLogRoot = Join-Path $runtimeRoot "launcher-logs"
if (-not (Test-Path -LiteralPath $launcherLogRoot)) {
    New-Item -ItemType Directory -Path $launcherLogRoot -Force |
        Out-Null
}
$launchId = Get-Date -Format "yyyyMMdd_HHmmss"
$launchStarted = Get-Date
$launcherLog = Join-Path `
    $launcherLogRoot `
    ("scheduled-launch-{0}.log" -f $launchId)
function Write-LauncherLog {
    param(
        [string]$Message,
        [string]$Level = "INFO"
    )
    $line = "{0} | {1} | {2}" -f `
        (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), `
        $Level, `
        $Message
    Add-Content -LiteralPath $launcherLog -Value $line -Encoding UTF8
    Write-Output $line
}
try {
    Write-LauncherLog "Avvio launcher pianificato"
    Write-LauncherLog (
        "Account: {0}" -f `
        [Security.Principal.WindowsIdentity]::GetCurrent().Name
    )
    Write-LauncherLog (
        "PowerShell: {0}; 64 bit: {1}" -f `
        $PSVersionTable.PSVersion.ToString(), `
        [Environment]::Is64BitProcess
    )
    Write-LauncherLog "Pipeline: $pipelinePath"
    Write-LauncherLog "Configurazione: $configPath"
    if (-not (Test-Path -LiteralPath $pipelinePath)) {
        throw "Pipeline non trovata: $pipelinePath"
    }
    if (-not (Test-Path -LiteralPath $configPath)) {
        throw "Configurazione non trovata: $configPath"
    }
    Set-Location -LiteralPath $installRoot
    & $pipelinePath -ConfigPath $configPath
    $statusPath = Join-Path $runtimeRoot "last-run.json"
    if (-not (Test-Path -LiteralPath $statusPath)) {
        throw "La pipeline non ha prodotto last-run.json"
    }
    $status = Get-Content -LiteralPath $statusPath -Raw |
        ConvertFrom-Json
    Write-LauncherLog (
        "Run: {0}; stato: {1}; fase: {2}" -f `
        $status.run_id, `
        $status.status, `
        $status.step
    )
    if ([string]$status.status -ne "SUCCESS") {
        throw "Pipeline terminata con stato $($status.status)"
    }
    Write-LauncherLog "Launcher completato correttamente"
    exit 0
}
catch {
    $caughtError = $_.Exception.ToString()
    try {
        Write-LauncherLog $caughtError "ERROR"
    }
    catch {
        Write-Output $_.Exception.ToString()
    }
    try {
        $alertSender = Join-Path $runtimeRoot "Monitoring\Send-ImpresaBIAlert.ps1"
        if (Test-Path -LiteralPath $alertSender -PathType Leaf) {
            $statusPath = Join-Path $runtimeRoot "last-run.json"
            $runId = ''
            $phase = 'launcher'
            $dataset = ''
            $queryName = ''
            $outputFile = ''
            $nativeExitCode = $null
            $statusMessage = ''
            if ((Test-Path -LiteralPath $statusPath -PathType Leaf) -and
                ((Get-Item -LiteralPath $statusPath).LastWriteTime -ge $launchStarted.AddSeconds(-2))) {
                $failedStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
                $runId = [string]$failedStatus.run_id
                $phase = [string]$failedStatus.step
                $statusMessage = [string]$failedStatus.message
                if ($statusMessage -match '(?i)Query\s+([^\\/:*?"<>|]+\.sql)\s+fallita\s+con\s+codice\s+([0-9]+)') {
                    $queryName = $matches[1]
                    $nativeExitCode = [int]$matches[2]
                    $pipelineConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
                    $queryConfig = @($pipelineConfig.Queries | Where-Object { [string]$_.SqlFile -ieq $queryName } | Select-Object -First 1)
                    if ($queryConfig.Count -gt 0) {
                        $dataset = [string]$queryConfig[0].Dataset
                        $outputFile = [string]$queryConfig[0].OutputFile
                    }
                }
            }
            $completeDetails = $caughtError
            if (-not [string]::IsNullOrWhiteSpace($statusMessage)) {
                $completeDetails += "`r`nStato pipeline: $statusMessage"
            }
            $alertParameters = @{
                Component = 'windows-daily'
                Severity = 'ERROR'
                Summary = 'Pipeline giornaliera Windows fallita'
                Details = $completeDetails
                EventKey = ("{0}:daily:{1}:{2}" -f $env:COMPUTERNAME,$runId,$phase)
                Task = 'IMPRESA_BI_GIORNALIERO'
                RunId = $runId
                Phase = $phase
                Dataset = $dataset
                Query = $queryName
                OutputFile = $outputFile
                LogPaths = @($launcherLog,$statusPath,(Join-Path $runtimeRoot 'logs'))
                Remediation = @('Leggere fase, query e codice di uscita nel log allegato.','Verificare rete/VPN verso SQL Anywhere e HTTPS verso Linux.','Rilanciare solo dopo aver corretto la causa.')
                NoProcessExit = $true
            }
            if ($null -ne $nativeExitCode) { $alertParameters.ExitCode = $nativeExitCode }
            $alertResult = & $alertSender @alertParameters
            Write-LauncherLog ("Allarme: inviato={0}; copia={1}; esito={2}" -f $alertResult.Sent,$alertResult.RecordPath,$alertResult.Result) 'ERROR'
        }
        else {
            Write-LauncherLog "Modulo allarmi assente: $alertSender" 'ERROR'
        }
    }
    catch {
        try { Write-LauncherLog ("Invio allarme fallito: {0}" -f $_.Exception.ToString()) 'ERROR' } catch {}
    }
    exit 1
}
