param([Parameter(Mandatory=$true)][string]$Uri)
$ErrorActionPreference = 'Stop'
try {
  if ($Uri -notmatch '^sics-outlook:bozza/([a-f0-9]{64})/?$') { throw 'Collegamento SICS non valido.' }
  $tokenBozza = $Matches[1]
  $config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'config.json') -Raw | ConvertFrom-Json
  $origine = [Uri]$config.origine
  if (($origine.Scheme -ne 'https') -and -not ($origine.Scheme -eq 'http' -and $origine.IsLoopback)) { throw 'Il collegamento richiede HTTPS (oppure localhost per sviluppo).' }
  if (-not [type]::GetTypeFromProgID('Outlook.Application')) { throw 'Outlook COM non disponibile. Serve Outlook classico; il nuovo Outlook non espone questa integrazione.' }
  $outlook = New-Object -ComObject Outlook.Application
  $dati = Invoke-RestMethod -Uri ($origine.GetLeftPart([System.UriPartial]::Authority) + '/api/portali/vettori/outlook/ritira') -Method Post -Headers @{ Authorization = "Bearer $tokenBozza" } -TimeoutSec 30 -MaximumRedirection 0
  if (-not $dati.oggetto -or -not $dati.corpo -or @($dati.destinatari).Count -eq 0) { throw 'La bozza non contiene oggetto, corpo o destinatari.' }
  $mail = $outlook.CreateItem(0)
  $mail.To = [string]::Join('; ', [string[]]$dati.destinatari)
  $mail.CC = [string]::Join('; ', [string[]]$dati.cc)
  $mail.Subject = [string]$dati.oggetto
  $mail.Body = [string]$dati.corpo
  $mail.Display()
} catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'SICS - apertura bozza Outlook') | Out-Null
  exit 1
}
