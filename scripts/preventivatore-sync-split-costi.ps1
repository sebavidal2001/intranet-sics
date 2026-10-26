<#
.SYNOPSIS
  Sincronizza lo split dei costi di Impresa nel Preventivatore (a richiesta).

.DESCRIPTION
  1. esegue scripts/bi-bridge/query/SPLIT_COSTI.sql su SRVWOA (WinRM + dbisql);
  2. scarica il CSV (~55.000 articoli, colonne in ordine di articoli_costi_split_staging);
  3. lo carica sulla VM (scp + psql \copy) e chiama preventivatore.sostituisci_split_costi(),
     che sostituisce la tabella in una transazione e rifiuta un file con meno righe del minimo.

  Prerequisiti (vedi memoria "Accesso SRVWOA e VM"): credenziale DPAPI in
  $env:LOCALAPPDATA\srvwoa.cred.xml, ssh a intra-adm@192.168.1.21 con sudo senza password.
  La migration 157 deve essere gia' applicata.

  Non e' ancora una pipeline notturna: per automatizzarla serve un profilo accanto a
  "clienti" (SRVWOA + receiver + unit systemd), vedi Vault "Preventivatore - Consuntivazione".

.PARAMETER SoloEstrai  scarica il CSV e stampa i numeri senza toccare il database.
.PARAMETER MinRighe    sotto questa soglia il caricamento viene rifiutato (default 5000).
#>
param(
  [switch]$SoloEstrai,
  [int]$MinRighe = 5000,
  [string]$Vm = "intra-adm@192.168.1.21",
  [string]$Srvwoa = "192.168.1.110",
  [string]$Cartella = (Join-Path $env:TEMP "split-costi")
)

$ErrorActionPreference = "Stop"
$query = Join-Path $PSScriptRoot "bi-bridge\query\SPLIT_COSTI.sql"
if (-not (Test-Path $query)) { throw "Query non trovata: $query" }
New-Item -ItemType Directory -Force $Cartella | Out-Null
$csvLocale = Join-Path $Cartella "split_costi.csv"

$cred = Import-Clixml "$env:LOCALAPPDATA\srvwoa.cred.xml"
$testo = [IO.File]::ReadAllText($query)

Write-Host "1/3 Estrazione da Impresa (SRVWOA)..."
$sess = New-PSSession -ComputerName $Srvwoa -Credential $cred
try {
  $esito = Invoke-Command -Session $sess -ArgumentList $testo -ScriptBlock {
    param($sql)
    $d = "C:\Windows\Temp\split_" + [guid]::NewGuid().ToString("N")
    New-Item -ItemType Directory $d | Out-Null
    $f = "$d\q.sql"; $o = "$d\o.txt"; $e = "$d\e.txt"
    [IO.File]::WriteAllText($f, $sql, (New-Object System.Text.UTF8Encoding($false)))
    New-Item -ItemType Directory -Force "C:\Impresa\Viste_BI\Esportazioni" | Out-Null
    $dbisql = (Get-ChildItem "C:\Program Files*\SQL Anywhere 11\Bin32\dbisql.exe" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName
    if (-not $dbisql) { return @{ ok = $false; errore = "dbisql non trovato" } }
    $p = Start-Process $dbisql -ArgumentList "-datasource airfluid90 -nogui `"$f`"" `
      -RedirectStandardOutput $o -RedirectStandardError $e -PassThru -NoNewWindow
    if (-not $p.WaitForExit(300000)) { $p.Kill(); return @{ ok = $false; errore = "timeout dbisql (300 s)" } }
    $err = Get-Content $e -Raw
    $out = "C:\Impresa\Viste_BI\Esportazioni\split_costi.csv"
    if (-not (Test-Path $out)) { return @{ ok = $false; errore = "CSV non prodotto. $err" } }
    Remove-Item $d -Recurse -Force
    return @{ ok = $true; errore = $err }
  }
  if (-not $esito.ok) { throw "Estrazione fallita: $($esito.errore)" }
  Copy-Item -FromSession $sess -Path "C:\Impresa\Viste_BI\Esportazioni\split_costi.csv" -Destination $csvLocale -Force
}
finally { Remove-PSSession $sess }

$righe = (Get-Content $csvLocale | Measure-Object -Line).Lines
Write-Host ("   {0} righe, {1:N1} MB -> {2}" -f $righe, ((Get-Item $csvLocale).Length / 1MB), $csvLocale)
if ($righe -lt $MinRighe) { throw "Solo $righe righe (minimo $MinRighe): file incompleto, non carico." }
if ($SoloEstrai) { Write-Host "Solo estrazione: database non toccato."; return }

Write-Host "2/3 Caricamento sulla VM..."
scp -q $csvLocale "${Vm}:/tmp/split_costi.csv"
if ($LASTEXITCODE -ne 0) { throw "scp fallito" }

Write-Host "3/3 Sostituzione dello split nel database..."
# Lo script remoto viaggia come file: passare comandi con virgolette come argomento di ssh
# li rompe (PowerShell 5.1 toglie le virgolette interne).
$remoto = @'
set -e
chmod 644 /tmp/split_costi.csv
sudo -n -u postgres psql -d intranet -v ON_ERROR_STOP=1   -c "TRUNCATE preventivatore.articoli_costi_split_staging"   -c "\copy preventivatore.articoli_costi_split_staging FROM '/tmp/split_costi.csv' WITH (FORMAT csv, DELIMITER ';')"   -c "SELECT preventivatore.sostituisci_split_costi(__MIN__, 'sync da PC')"
rm -f /tmp/split_costi.csv /tmp/split_costi_carica.sh
'@
$remoto = ($remoto -replace "`r", "") -replace "__MIN__", $MinRighe
$shLocale = Join-Path $Cartella "split_costi_carica.sh"
[IO.File]::WriteAllText($shLocale, $remoto, (New-Object System.Text.UTF8Encoding($false)))
scp -q $shLocale "${Vm}:/tmp/split_costi_carica.sh"
if ($LASTEXITCODE -ne 0) { throw "scp dello script fallito" }
ssh $Vm "bash /tmp/split_costi_carica.sh"
if ($LASTEXITCODE -ne 0) { throw "Caricamento fallito (lo split precedente e' rimasto intatto)" }
Write-Host "Fatto."
