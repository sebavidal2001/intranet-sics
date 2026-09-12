#requires -version 4.0
[CmdletBinding()]
param([switch]$NoRecoveryStart)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$root = 'C:\ProgramData\ImpresaBI\Monitoring'
$statePath = Join-Path $root 'watchdog-state.json'
$logRoot = Join-Path $root 'logs'
$sender = Join-Path $root 'Send-ImpresaBIAlert.ps1'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$logPath = Join-Path $logRoot ("watchdog-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))

function Write-WatchLog([string]$Message, [string]$Level = 'INFO') {
    $line = '{0} | {1} | {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
    Write-Output $line
}

function Load-State {
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try { return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json }
        catch { Write-WatchLog "Stato illeggibile, lo ricreo: $($_.Exception.Message)" 'WARNING' }
    }
    return [pscustomobject]@{ active = $null; recovery_started = $null }
}

function Save-State($State) {
    $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Convert-MapToObject($Map) {
    $object = New-Object PSObject
    foreach ($key in @($Map.Keys)) {
        $object | Add-Member -MemberType NoteProperty -Name ([string]$key) -Value $Map[$key]
    }
    return $object
}

function Get-PropertyValue($Object, [string]$Name) {
    if ($null -ne $Object -and $null -ne $Object.PSObject.Properties[$Name]) { return $Object.$Name }
    return $null
}

$state = Load-State
$active = @{}
if ($null -ne $state.active) {
    foreach ($p in @($state.active.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' -and -not [string]::IsNullOrWhiteSpace($_.Name) })) {
        $active[$p.Name] = [string]$p.Value
    }
}
$started = @{}
if ($null -ne $state.recovery_started) {
    foreach ($p in @($state.recovery_started.PSObject.Properties | Where-Object { $_.MemberType -eq 'NoteProperty' -and -not [string]::IsNullOrWhiteSpace($_.Name) })) {
        $started[$p.Name] = [string]$p.Value
    }
}

trap {
    try { Write-WatchLog ("Errore fatale watchdog: {0}" -f $_.Exception.ToString()) 'ERROR' } catch {}
    exit 1
}

function Send-StateAlert {
    param(
        [string]$Key,
        [string]$Component,
        [string]$Severity,
        [string]$Summary,
        [string]$Details,
        [string[]]$Logs,
        [string[]]$Remediation
    )
    if ($active.ContainsKey($Key) -and $Severity -ne 'RECOVERY') {
        Write-WatchLog "Allarme già attivo, non duplicato: $Key"
        return
    }
    $taskName = switch ($Component) {
        'windows-daily' { 'IMPRESA_BI_GIORNALIERO' }
        'windows-cruscotto' { 'IMPRESA_BI_CRUSCOTTO' }
        'windows-backup-pull' { 'IMPRESA_DB_BACKUP_PULL' }
        default { '' }
    }
    $sendResult = & $sender -Component $Component -Severity $Severity -Summary $Summary -Details $Details -EventKey $Key -Task $taskName -LogPaths $Logs -Remediation $Remediation -NoProcessExit
    Write-WatchLog ("Notifica {0}: inviata={1}; risultato={2}; copia={3}" -f $Key,$sendResult.Sent,$sendResult.Result,$sendResult.RecordPath)
    if ($Severity -eq 'RECOVERY') { $active.Remove($Key) }
    elseif ($sendResult.Sent) { $active[$Key] = (Get-Date).ToString('o') }
}

function Resolve-State {
    param([string]$Key, [string]$Component, [string]$Summary)
    if ($active.ContainsKey($Key)) {
        Send-StateAlert -Key $Key -Component $Component -Severity 'RECOVERY' -Summary $Summary -Details 'Il controllo che aveva generato l’allarme è tornato regolare.' -Logs @($logPath) -Remediation @()
    }
}

function Get-TaskSnapshot([string]$TaskName) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) { return $null }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    return [pscustomobject]@{
        Name = $TaskName
        State = [string]$task.State
        Enabled = ($task.State -ne 'Disabled')
        LastRun = $info.LastRunTime
        LastResult = [int64]$info.LastTaskResult
        NextRun = $info.NextRunTime
        Action = (($task.Actions | ForEach-Object { "$($_.Execute) $($_.Arguments)" }) -join '; ')
    }
}

function Format-Task($Snapshot) {
    if ($null -eq $Snapshot) { return 'attività assente' }
    return "stato=$($Snapshot.State); ultimo_avvio=$($Snapshot.LastRun.ToString('o')); ultimo_codice=$($Snapshot.LastResult); prossimo=$($Snapshot.NextRun.ToString('o')); azione=$($Snapshot.Action)"
}

$now = Get-Date
$today = $now.Date
$checks = @(
    [pscustomobject]@{ Name='IMPRESA_BI_GIORNALIERO'; Component='windows-daily'; Cutoff=[datetime]($today.AddHours(4)); MaxHours=3; Logs=@('C:\ProgramData\ImpresaBI\last-run.json','C:\ProgramData\ImpresaBI\logs') },
    [pscustomobject]@{ Name='IMPRESA_DB_BACKUP_PULL'; Component='windows-backup-pull'; Cutoff=[datetime]($today.AddHours(4)); MaxHours=2; Logs=@('C:\ProgramData\ImpresaBI\BackupPull\status.json') },
    [pscustomobject]@{ Name='IMPRESA_BI_CRUSCOTTO'; Component='windows-cruscotto'; Cutoff=[datetime]($today.AddHours(5).AddMinutes(30)); MaxHours=4; Logs=@('C:\ProgramData\ImpresaBI\last-run.json','C:\ProgramData\ImpresaBI\logs') }
)

Write-WatchLog "Avvio controllo; account=$([Security.Principal.WindowsIdentity]::GetCurrent().Name); NoRecoveryStart=$NoRecoveryStart"

foreach ($check in $checks) {
    $snapshot = Get-TaskSnapshot $check.Name
    $baseKey = "$($env:COMPUTERNAME):$($check.Name)"
    if ($null -eq $snapshot) {
        Send-StateAlert -Key "${baseKey}:missing" -Component $check.Component -Severity 'CRITICAL' -Summary "Attività pianificata assente: $($check.Name)" -Details 'Get-ScheduledTask non trova l’attività prevista.' -Logs @($logPath) -Remediation @('Verificare che l’attività sia stata eliminata o rinominata.','Ripristinarla dal backup XML in C:\ProgramData\ImpresaBI\TaskBackups.')
        continue
    }
    Resolve-State -Key "${baseKey}:missing" -Component $check.Component -Summary "Attività nuovamente presente: $($check.Name)"

    if (-not $snapshot.Enabled) {
        Send-StateAlert -Key "${baseKey}:disabled" -Component $check.Component -Severity 'CRITICAL' -Summary "Attività disabilitata: $($check.Name)" -Details (Format-Task $snapshot) -Logs @($logPath) -Remediation @("Abilitare con Enable-ScheduledTask -TaskName '$($check.Name)'.",'Verificare prima perché sia stata disabilitata.')
    } else { Resolve-State -Key "${baseKey}:disabled" -Component $check.Component -Summary "Attività riabilitata: $($check.Name)" }

    if ($snapshot.State -eq 'Running') {
        $hours = ($now - $snapshot.LastRun).TotalHours
        if ($hours -gt $check.MaxHours) {
            Send-StateAlert -Key "${baseKey}:hung" -Component $check.Component -Severity 'CRITICAL' -Summary "Attività apparentemente bloccata: $($check.Name)" -Details ("In esecuzione da {0:N1} ore. {1}" -f $hours,(Format-Task $snapshot)) -Logs @($logPath) -Remediation @('Non avviare una seconda copia.','Controllare dbisqlc.exe, powershell.exe e i log indicati.','Terminare manualmente solo dopo aver verificato che non stia ancora producendo output.')
        } else { Resolve-State -Key "${baseKey}:hung" -Component $check.Component -Summary "Attività non più bloccata: $($check.Name)" }
        continue
    }
    Resolve-State -Key "${baseKey}:hung" -Component $check.Component -Summary "Attività non più bloccata: $($check.Name)"

    if ($now -lt $check.Cutoff) { continue }
    $ranToday = ($snapshot.LastRun -ge $today)
    if (-not $ranToday) {
        $recoveryKey = "$($check.Name):$($today.ToString('yyyyMMdd'))"
        $canStart = (-not $NoRecoveryStart) -and (-not $started.ContainsKey($recoveryKey))
        if ($check.Name -eq 'IMPRESA_BI_CRUSCOTTO') {
            $daily = Get-TaskSnapshot 'IMPRESA_BI_GIORNALIERO'
            $canStart = $canStart -and ($null -ne $daily) -and ($daily.LastRun -ge $today) -and ($daily.LastResult -eq 0)
        }
        if ($canStart) {
            try {
                Start-ScheduledTask -TaskName $check.Name
                $started[$recoveryKey] = (Get-Date).ToString('o')
                Write-WatchLog "Recupero avviato per attività saltata: $($check.Name)" 'WARNING'
            } catch { Write-WatchLog "Recupero fallito per $($check.Name): $($_.Exception.Message)" 'ERROR' }
        }
        Send-StateAlert -Key "${baseKey}:missed:$($today.ToString('yyyyMMdd'))" -Component $check.Component -Severity 'ERROR' -Summary "Esecuzione giornaliera mancante: $($check.Name)" -Details (Format-Task $snapshot) -Logs @($logPath) -Remediation @('Verificare che SRVWOA fosse accesa e connessa alla rete.','Controllare cronologia dell’Utilità di pianificazione.','Il watchdog tenta un solo avvio di recupero; non lancia duplicati.')
        continue
    }
    Resolve-State -Key "${baseKey}:missed:$($today.ToString('yyyyMMdd'))" -Component $check.Component -Summary "Esecuzione recuperata: $($check.Name)"

    if ($snapshot.LastResult -ne 0) {
        Send-StateAlert -Key "${baseKey}:failed:$($snapshot.LastRun.ToString('yyyyMMddHHmmss'))" -Component $check.Component -Severity 'ERROR' -Summary "Attività terminata con errore: $($check.Name)" -Details (Format-Task $snapshot) -Logs @($logPath) -Remediation @('Aprire il log più recente del componente.','Usare fase, query, codice di uscita e test rete riportati nell’allarme.','Rilanciare solo dopo aver eliminato la causa.')
    } else {
        foreach ($key in @($active.Keys | Where-Object { $_ -like "${baseKey}:failed:*" })) {
            Resolve-State -Key $key -Component $check.Component -Summary "Attività tornata regolare: $($check.Name)"
        }
    }
}

$stateOut = [ordered]@{
    active = (Convert-MapToObject $active)
    recovery_started = (Convert-MapToObject $started)
    checked_at = (Get-Date).ToUniversalTime().ToString('o')
}
Save-State $stateOut
Write-WatchLog 'Controllo completato'
exit 0
