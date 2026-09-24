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
    ("cruscotto-launch-{0}.log" -f $launchId)
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
    & $pipelinePath -ConfigPath $configPath -Profilo cruscotto
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

    # ── Profili accessori: storico costi e ordini di acquisto ─────────────
    # Run SEPARATI, dopo il Cruscotto e non insieme a lui: manifest distinti,
    # quindi un guasto qui non impedisce il completamento del run Cruscotto
    # (receiver.py rifiuta il manifest se manca un dataset del profilo, e con
    # i dataset insieme un errore avrebbe fermato l'aggiornamento di
    # preventivatore.prodotti, cioe' il Preventivatore).
    #
    # Per la stessa ragione l'errore NON viene propagato: a questo punto il
    # Cruscotto e' gia' stato estratto, validato e accettato dal Linux, e
    # dichiararlo fallito sarebbe falso. Resta scritto nel log e nello stato,
    # e il profilo si ferma all'ultimo caricamento riuscito — dati vecchi di
    # un giorno, non dati sbagliati. Ogni profilo ha il suo file di stato.
    foreach ($profiloAccessorio in @("costi", "acquisti")) {
        $fileStato = "last-run-$profiloAccessorio.json"
        try {
            Write-LauncherLog "Avvio profilo $profiloAccessorio"
            & $pipelinePath -ConfigPath $configPath -Profilo $profiloAccessorio -StatusFile $fileStato
            $statoPath = Join-Path $runtimeRoot $fileStato
            if (Test-Path -LiteralPath $statoPath) {
                $stato = Get-Content -LiteralPath $statoPath -Raw |
                    ConvertFrom-Json
                Write-LauncherLog (
                    "{0} - run: {1}; stato: {2}; fase: {3}" -f `
                    $profiloAccessorio, `
                    $stato.run_id, `
                    $stato.status, `
                    $stato.step
                )
                if ([string]$stato.status -ne "SUCCESS") {
                    Write-LauncherLog (
                        "Profilo {0} NON riuscito: {1}" -f $profiloAccessorio, $stato.message
                    ) "ERROR"
                }
            }
            else {
                Write-LauncherLog "Profilo ${profiloAccessorio}: nessuno stato prodotto" "ERROR"
            }
        }
        catch {
            Write-LauncherLog (
                "Profilo {0} fallito: {1}" -f $profiloAccessorio, $_.Exception.Message
            ) "ERROR"
        }
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
            if ((Test-Path -LiteralPath $statusPath -PathType Leaf) -and
                ((Get-Item -LiteralPath $statusPath).LastWriteTime -ge $launchStarted.AddSeconds(-2))) {
                $failedStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
                $runId = [string]$failedStatus.run_id
                $phase = [string]$failedStatus.step
            }
            $alertResult = & $alertSender `
                -Component 'windows-cruscotto' `
                -Severity 'ERROR' `
                -Summary 'Pipeline Cruscotto articoli Windows fallita' `
                -Details $caughtError `
                -EventKey ("{0}:cruscotto:{1}:{2}" -f $env:COMPUTERNAME,$runId,$phase) `
                -Task 'IMPRESA_BI_CRUSCOTTO' `
                -RunId $runId `
                -Phase $phase `
                -Dataset 'cruscotto_articoli' `
                -Query 'CRUSCOTTO_ARTICOLI.sql' `
                -OutputFile 'cruscotto_articoli.csv' `
                -LogPaths @($launcherLog,$statusPath,(Join-Path $runtimeRoot 'logs')) `
                -Remediation @('Controllare se dbisqlc.exe sta ancora lavorando prima di rilanciare.','Verificare rete/VPN verso SQL Anywhere e HTTPS verso Linux.','Confrontare righe, colonne e SHA-256 nel manifest.') `
                -NoProcessExit
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
