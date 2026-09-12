#requires -version 4.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Component,
    [ValidateSet('INFO','WARNING','ERROR','CRITICAL','RECOVERY','TEST')]
    [string]$Severity = 'ERROR',
    [Parameter(Mandatory = $true)][string]$Summary,
    [string]$Details = '',
    [string]$EventKey = '',
    [string]$Task = '',
    [string]$RunId = '',
    [string]$Phase = '',
    [string]$Dataset = '',
    [string]$Query = '',
    [string]$OutputFile = '',
    [Nullable[int]]$ExitCode = $null,
    [string[]]$LogPaths = @(),
    [string[]]$Remediation = @(),
    [switch]$NoProcessExit
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$monitorRoot = 'C:\ProgramData\ImpresaBI\Monitoring'
$alertRoot = Join-Path $monitorRoot 'alerts'
$configPath = Join-Path $monitorRoot 'alert-config.json'
$tokenPath = Join-Path $monitorRoot 'alert.token'
New-Item -ItemType Directory -Path $alertRoot -Force | Out-Null

function Protect-Text {
    param([AllowNull()][object]$Value)
    if ($null -eq $Value) { return '' }
    $text = [string]$Value
    $text = $text -replace '(?i)(password|passwd|pwd|token|authorization|apikey|api_key)\s*[:=]\s*[^\s;,]+', '$1=[REDACTED]'
    $text = $text -replace '(?i)Bearer\s+[A-Za-z0-9._~+\-/=]+', 'Bearer [REDACTED]'
    return $text
}

function Read-LogTail {
    param([string]$Path)
    if (Test-Path -LiteralPath $Path -PathType Container) {
        $latest = @(Get-ChildItem -LiteralPath $Path -File -ErrorAction Stop |
            Sort-Object LastWriteTime -Descending | Select-Object -First 3)
        return [ordered]@{
            path = $Path
            exists = $true
            directory = $true
            latest_files = @($latest | ForEach-Object {
                [ordered]@{
                    path = $_.FullName
                    bytes = $_.Length
                    modified_at = $_.LastWriteTime.ToString('o')
                    tail = @(Get-Content -LiteralPath $_.FullName -Tail 80 -ErrorAction Stop | ForEach-Object { Protect-Text $_ })
                }
            })
        }
    }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{ path = $Path; exists = $false; tail = @() }
    }
    $lines = @(Get-Content -LiteralPath $Path -Tail 80 -ErrorAction Stop | ForEach-Object { Protect-Text $_ })
    return [ordered]@{
        path = $Path
        exists = $true
        bytes = (Get-Item -LiteralPath $Path).Length
        modified_at = (Get-Item -LiteralPath $Path).LastWriteTime.ToString('o')
        tail = $lines
    }
}

if ([string]::IsNullOrWhiteSpace($EventKey)) {
    $EventKey = ('{0}:{1}:{2}:{3}' -f $env:COMPUTERNAME, $Component, $Phase, $Summary)
}

$logEvidence = @()
foreach ($path in $LogPaths) {
    try { $logEvidence += Read-LogTail -Path $path }
    catch { $logEvidence += [ordered]@{ path = $path; exists = $true; read_error = (Protect-Text $_.Exception.Message) } }
}

$network = [ordered]@{}
try {
    $network.sql_anywhere = [bool](Test-NetConnection -ComputerName '192.168.1.227' -Port 2638 -InformationLevel Quiet -WarningAction SilentlyContinue)
} catch { $network.sql_anywhere = $false }
try {
    $network.linux_https = [bool](Test-NetConnection -ComputerName 'intranet.s-ics.com' -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue)
} catch { $network.linux_https = $false }
try {
    $network.dns_linux = @([Net.Dns]::GetHostAddresses('intranet.s-ics.com') | ForEach-Object { $_.IPAddressToString })
} catch { $network.dns_linux = @() }

$payload = [ordered]@{
    version = 1
    source = 'windows'
    host = $env:COMPUTERNAME
    component = $Component
    severity = $Severity
    occurred_at = (Get-Date).ToUniversalTime().ToString('o')
    event_key = $EventKey
    summary = (Protect-Text $Summary)
    details = (Protect-Text $Details)
    task = $Task
    run_id = $RunId
    phase = $Phase
    dataset = $Dataset
    query = $Query
    output_file = $OutputFile
    exit_code = if ($null -ne $ExitCode) { [int]$ExitCode } else { $null }
    diagnostics = [ordered]@{
        account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        powershell = $PSVersionTable.PSVersion.ToString()
        os = [Environment]::OSVersion.VersionString
        network = $network
    }
    logs = $logEvidence
    remediation = @($Remediation | ForEach-Object { Protect-Text $_ })
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss_fff'
$safeComponent = $Component -replace '[^A-Za-z0-9_.-]', '_'
$recordPath = Join-Path $alertRoot ("{0}-{1}.json" -f $stamp, $safeComponent)
$payload | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $recordPath -Encoding UTF8

$sent = $false
$sendMessage = ''
try {
    if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "Configurazione assente: $configPath" }
    if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) { throw "Token alert assente: $tokenPath" }
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $endpoint = [string]$config.endpoint
    if ($endpoint -notmatch '^https://') { throw 'Endpoint alert non HTTPS o non valido' }
    $token = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'Token alert vuoto' }
    $headers = @{ Authorization = "Bearer $token" }
    $body = $payload | ConvertTo-Json -Depth 12 -Compress
    $response = Invoke-WebRequest -Uri $endpoint -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $body -UseBasicParsing -TimeoutSec 30
    if ([int]$response.StatusCode -lt 200 -or [int]$response.StatusCode -ge 300) { throw "HTTP $($response.StatusCode)" }
    $sent = $true
    $sendMessage = "HTTP $($response.StatusCode)"
    $token = $null
} catch {
    $sendMessage = Protect-Text $_.Exception.Message
}

$delivery = [ordered]@{
    attempted_at = (Get-Date).ToUniversalTime().ToString('o')
    sent = $sent
    result = $sendMessage
}
$finalRecord = [ordered]@{ payload = $payload; delivery = $delivery }
$finalRecord | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $recordPath -Encoding UTF8

$result = [pscustomobject]@{ Sent = $sent; RecordPath = $recordPath; Result = $sendMessage }
if ($NoProcessExit) {
    Write-Output $result
    return
}
if ($sent) {
    Write-Output "ALERT_INVIATO | $Severity | $Component | $Summary"
    exit 0
}
Write-Warning "ALERT_NON_INVIATO | $Severity | $Component | $Summary | $sendMessage | Copia locale: $recordPath"
exit 2
