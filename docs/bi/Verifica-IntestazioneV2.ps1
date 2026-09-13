<#
.SYNOPSIS
    Controlla che l'intestazione del CSV preventivi_aperti V2 corrisponda
    ESATTAMENTE al contratto a 32 colonne, prima di caricarlo.

.DESCRIPTION
    Il loader Linux confronta la prima riga con la lista attesa usando
    un'uguaglianza di liste. Se non combacia, non la riconosce come
    intestazione e la carica come RIGA DI DATI: il conteggio diventa N+1 e
    bi_activate_run rifiuta la pubblicazione.

    E' un guasto rumoroso e non corrompe niente, ma costa la notte. Questo
    controllo lo anticipa di dodici ore e lo sposta sulla macchina giusta.

    Il caso che intercetta per primo e' quello segnalato da Codex: se
    PREVENTIVI_APERTI.sql non resta in Windows-1252, dbisql esporta
    "Quantita'" (con accento) come "QuantitA " e il confronto salta.

    Compatibile PowerShell 4.0: nessun operatore ternario, nessun ??,
    nessun cmdlet introdotto dopo la 4.0.

.EXAMPLE
    .\Verifica-IntestazioneV2.ps1 -Percorso C:\Impresa\Viste_BI\Esportazioni\preventivi_aperti.csv
#>

[CmdletBinding()]
param(
    [string]$Percorso = "C:\Impresa\Viste_BI\Esportazioni\preventivi_aperti.csv"
)

$ErrorActionPreference = "Stop"

# Contratto V2 approvato il 2026-08-29. L'ordine e' parte del contratto.
$Attese = @(
    "Codice Gruppo",
    "Gruppo Descrizione",
    "Codice Categoria",
    "Categoria Descrizione",
    "Data Documento",
    "Importo Inevaso",
    "Codice Articolo",
    "Descrizione articolo",
    "Quantità",
    "Codice Agente",
    "Agente",
    "Codice Cliente",
    "Nome Cliente",
    "Profilo Documento",
    "Numero Doc.",
    "Data Consegna Richiesta",
    "Data Consegna Confermata",
    "Causale Magazzino Codice",
    "Causale Magazzino Descrizione",
    "Riga evasa",
    "Chiusura forzata",
    "Quantità evasa",
    "Importo Evaso",
    "Data Richiesta Cliente",
    "ID Utente Creatore",
    "Codice Utente Creatore",
    "Utente Creatore",
    "Data Creazione Documento",
    "ID Soggetto Commerciale",
    "ID Destinazione",
    "ID Documento",
    "ID Riga Documento"
)

if (-not (Test-Path -LiteralPath $Percorso)) {
    Write-Host "File non trovato: $Percorso" -ForegroundColor Red
    exit 1
}

# Il CSV e' prodotto con ENCODING 'UTF-8': va letto come tale, o l'accento
# risulterebbe alterato dal LETTORE invece che dallo scrittore, e si
# inseguirebbe un problema che non esiste.
$Lettore = New-Object System.IO.StreamReader($Percorso, [System.Text.Encoding]::UTF8)
try {
    $PrimaRiga = $Lettore.ReadLine()
} finally {
    $Lettore.Close()
}

if ([string]::IsNullOrEmpty($PrimaRiga)) {
    Write-Host "Il file e' vuoto." -ForegroundColor Red
    exit 1
}

# Il separatore e' ';' e le virgolette sono opzionali: si tolgono se ci sono.
$Trovate = @()
foreach ($campo in ($PrimaRiga -split ';')) {
    $Trovate += $campo.Trim().Trim('"')
}

Write-Host ""
Write-Host "File    : $Percorso"
Write-Host "Colonne : $($Trovate.Count)  (attese: $($Attese.Count))"
Write-Host ""

$Problemi = @()

if ($Trovate.Count -ne $Attese.Count) {
    $Problemi += "Numero di colonne errato: $($Trovate.Count) invece di $($Attese.Count)."
}

$Limite = [Math]::Min($Trovate.Count, $Attese.Count)
for ($i = 0; $i -lt $Limite; $i++) {
    # -cne: confronto SENSIBILE alle maiuscole. "Descrizione articolo" ha la 'a'
    # minuscola, e un confronto insensibile lascerebbe passare "Descrizione
    # Articolo" che il loader poi rifiuterebbe.
    if ($Trovate[$i] -cne $Attese[$i]) {
        $n = $i + 1
        $Problemi += "Colonna $n : trovata '$($Trovate[$i])' invece di '$($Attese[$i])'"
    }
}

if ($Problemi.Count -eq 0) {
    Write-Host "INTESTAZIONE CORRETTA: 32 colonne, tutte corrispondenti." -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host "INTESTAZIONE NON CONFORME" -ForegroundColor Red
Write-Host ""
foreach ($p in $Problemi) { Write-Host "  $p" -ForegroundColor Red }
Write-Host ""

# La diagnosi piu' probabile, detta esplicitamente invece di lasciarla dedurre.
$SospettoEncoding = $false
foreach ($t in $Trovate) {
    if ($t -match 'Ã') { $SospettoEncoding = $true }
}
if ($SospettoEncoding) {
    Write-Host "Nei nomi compare la sequenza 'A-tilde': e' il segno tipico di un" -ForegroundColor Yellow
    Write-Host "file .sql salvato in UTF-8 e letto da dbisql come Windows-1252." -ForegroundColor Yellow
    Write-Host "Rimedio: risalvare PREVENTIVI_APERTI.sql in Windows-1252 (ANSI)," -ForegroundColor Yellow
    Write-Host "lasciando ENCODING 'UTF-8' nella clausola OUTPUT TO." -ForegroundColor Yellow
    Write-Host ""
}

exit 1
