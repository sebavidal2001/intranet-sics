#requires -version 4.0
<#
    Lanciatore del SOLO profilo "acquisti" (ordini a fornitore).

    Attivita' pianificata: IMPRESA_BI_ACQUISTI, senza orario, da lanciare a
    mano quando servono gli ordini aggiornati durante il giorno:

        Start-ScheduledTask -TaskName IMPRESA_BI_ACQUISTI

    Di notte gli acquisti arrivano gia' dal launcher del Cruscotto
    (Invoke-BIPipeline-Cruscotto.ps1), dopo cruscotto e costi. Quello pero'
    estrae per ~20 minuti e il lock della pipeline e' condiviso: lanciato di
    giorno ferma anche la pipeline "trasporti live" del Portale Vettori (il
    25/09/2026 dalle 07:27 alle 07:46). Qui l'estrazione dura ~20 secondi.

    Stesso account e stessa modalita' di logon del Cruscotto (Password): senza,
    DPAPI non decifra le credenziali della pipeline.
#>
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
    New-Item -ItemType Directory -Path $launcherLogRoot -Force | Out-Null
}
$launcherLog = Join-Path $launcherLogRoot ("acquisti-launch-{0}.log" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
function Write-LauncherLog {
    param([string]$Message, [string]$Level = "INFO")
    $line = "{0} | {1} | {2}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Level, $Message
    Add-Content -LiteralPath $launcherLog -Value $line -Encoding UTF8
    Write-Output $line
}
try {
    Write-LauncherLog "Avvio launcher acquisti"
    Write-LauncherLog ("Account: {0}" -f [Security.Principal.WindowsIdentity]::GetCurrent().Name)
    if (-not (Test-Path -LiteralPath $pipelinePath)) { throw "Pipeline non trovata: $pipelinePath" }
    if (-not (Test-Path -LiteralPath $configPath)) { throw "Configurazione non trovata: $configPath" }
    Set-Location -LiteralPath $installRoot
    & $pipelinePath -ConfigPath $configPath -Profilo acquisti -StatusFile "last-run-acquisti.json"
    $statoPath = Join-Path $runtimeRoot "last-run-acquisti.json"
    if (-not (Test-Path -LiteralPath $statoPath)) { throw "La pipeline non ha prodotto last-run-acquisti.json" }
    $stato = Get-Content -LiteralPath $statoPath -Raw | ConvertFrom-Json
    Write-LauncherLog ("Run: {0}; stato: {1}; fase: {2}" -f $stato.run_id, $stato.status, $stato.step)
    if ([string]$stato.status -ne "SUCCESS") { throw ("Pipeline acquisti terminata con stato {0}: {1}" -f $stato.status, $stato.message) }
    Write-LauncherLog "Launcher acquisti completato correttamente"
    exit 0
}
catch {
    try { Write-LauncherLog $_.Exception.ToString() "ERROR" } catch { Write-Output $_.Exception.ToString() }
    exit 1
}
