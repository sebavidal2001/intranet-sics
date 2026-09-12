# Installazione pipeline trasporti su SRVWOA

Questi file non si distribuiscono automaticamente. Tutti i comandi vanno eseguiti a mano su
SRVWOA da Windows PowerShell avviata come amministratore. La macchina usa Windows Server
2012 R2 e Windows PowerShell 4.0.

Non registrare le attività finché non sono stati ripristinati gli allarmi SMTP, configurato
il receiver Linux per trasporti_documenti e misurata fuori orario la query live. Il tempo
atteso della query live a vuoto è inferiore a 2 secondi.

## File da copiare

Prima creare un backup datato di eventuali file omonimi:

    $DataOra = Get-Date -Format 'yyyyMMdd_HHmmss'
    $Backup = "C:\ProgramData\ImpresaBI\TaskBackups\trasporti-$DataOra"
    New-Item -ItemType Directory -Path $Backup -Force | Out-Null

    $PossibiliEsistenti = @(
        'C:\Impresa\BI_Bridge\Invoke-BIPipeline-Trasporti.ps1',
        'C:\Impresa\BI_Bridge\config.trasporti.json',
        'C:\Impresa\Viste_BI\TRASPORTI_DOCUMENTI.sql',
        'C:\Impresa\Viste_BI\TRASPORTI_DOCUMENTI_LIVE.sql'
    )
    foreach ($File in $PossibiliEsistenti) {
        if (Test-Path -LiteralPath $File -PathType Leaf) {
            Copy-Item -LiteralPath $File -Destination $Backup -Force
        }
    }

Copiare poi:

| File del repository | Destinazione su SRVWOA |
|---|---|
| scripts\bi-bridge\Invoke-BIPipeline-Trasporti.ps1 | C:\Impresa\BI_Bridge\Invoke-BIPipeline-Trasporti.ps1 |
| scripts\bi-bridge\config.trasporti.json | C:\Impresa\BI_Bridge\config.trasporti.json |
| scripts\bi-bridge\query\TRASPORTI_DOCUMENTI_LIVE.sql | C:\Impresa\Viste_BI\TRASPORTI_DOCUMENTI_LIVE.sql |
| scripts\bi-bridge\query\TRASPORTI_DOCUMENTI.sql | C:\Impresa\Viste_BI\TRASPORTI_DOCUMENTI.sql |

L'ultima query è quella a 90 giorni già collaudata e già presente nel repository. Non
modificarla. Verificare che la configurazione punti esattamente al client a 32 bit:

    C:\Program Files\SQL Anywhere 11\Bin32\dbisql.com

Non copiare credenziali o token dal repository. Il launcher legge, sotto l'account delle
attività pianificate:

    C:\ProgramData\ImpresaBI\sqlanywhere.credential.xml
    C:\ProgramData\ImpresaBI\linux-bridge.token

L'account deve essere lo stesso con cui i segreti DPAPI sono stati creati.

## Segnaposto e checkpoint live

La query live versionata contiene una sola occorrenza del segnaposto
{{ULTIMO_ID_SOGLIA}}. Il launcher legge l'ultimo ID effettivamente consegnato, calcola
ultimo_id_visto - 50 e scrive una copia SQL temporanea sotto
C:\ProgramData\ImpresaBI\temp con il valore numerico già sostituito. dbisql esegue quella
copia; il file temporaneo viene scritto tramite System.Text.UTF8Encoding($false), quindi
senza BOM come richiesto da dbisql SQL Anywhere 11, e viene rimosso nel blocco di pulizia.

Il checkpoint avanza soltanto dopo che dataset e manifest sono stati accettati dal receiver.
Un'esecuzione con -SkipUpload registra observed_max_id per il collaudo, ma non avanza
last_seen_id. Lo stato conserva anche gli ID della coda già consegnata: le 50 righe rilette
per sicurezza non provocano un upload continuo quando non è arrivato alcun documento nuovo.

Il CSV ad alta frequenza è separato dagli export notturni:

    C:\Impresa\Viste_BI\Esportazioni\Live\trasporti_documenti_live.csv

Il launcher crea automaticamente la sottocartella Live. La riconciliazione continua invece
a usare C:\Impresa\Viste_BI\Esportazioni\trasporti_documenti.csv. La separazione per
directory impedisce ai controlli di freschezza e agli snapshot che enumerano la radice degli
export notturni di includere accidentalmente il file aggiornato ogni 90 secondi.

## Collaudo prima della registrazione

-Prova controlla configurazione, percorso di dbisql e query, ma non acquisisce il lock, non
legge i segreti, non esegue dbisql, non modifica CSV o stati e non contatta il receiver:

    $Launcher = 'C:\Impresa\BI_Bridge\Invoke-BIPipeline-Trasporti.ps1'
    & $Launcher -Modo riconciliazione -Prova
    & $Launcher -Modo live -Prova

Il primo collaudo reale va eseguito fuori orario come attività pianificata temporanea o dalla
stessa sessione interattiva usata normalmente dai task; non usare WinRM. -SkipUpload
interroga il gestionale e valida il CSV, ma non legge il token, non contatta Linux e non
avanza il checkpoint consegnato.

Eseguire prima la riconciliazione:

    & $Launcher -Modo riconciliazione -SkipUpload
    $StatoRiconciliazione = Get-Content -LiteralPath 'C:\ProgramData\ImpresaBI\last-run-trasporti.json' -Raw | ConvertFrom-Json
    $StatoRiconciliazione | Format-List status,step,rows,observed_max_id,uploaded,message

Devono risultare status = SUCCESS, rows maggiore di zero e 68 colonne nel log. Usare poi il
massimo osservato soltanto per il collaudo live; con -SkipUpload questo valore non diventa un
checkpoint operativo:

    $Misura = Measure-Command {
        & $Launcher -Modo live -UltimoIdVisto ([long]$StatoRiconciliazione.observed_max_id) -SkipUpload
    }
    $Misura.TotalSeconds
    Get-Content -LiteralPath 'C:\ProgramData\ImpresaBI\last-run-trasporti-live.json' -Raw | ConvertFrom-Json |
        Format-List status,step,rows,new_rows,threshold_id,observed_max_id,uploaded,message

Accettare il live solo se la misura a vuoto è inferiore a 2 secondi e se il piano operativo ha
confermato monotonia degli ID e adeguatezza del margine 50.

Quando il receiver è pronto, eseguire una riconciliazione senza -SkipUpload. Questa consegna
la finestra a 90 giorni e crea il checkpoint dal quale il live può partire senza parametri:

    & $Launcher -Modo riconciliazione
    & $Launcher -Modo live

Controllare il receiver e i due stati prima di registrare i task. Un live senza documenti
nuovi termina con codice 0, status = SUCCESS, empty = true e non invia né dataset né manifest.
Un lock occupato produce skipped_lock = true, sempre con codice 0 e senza allarme.

## Registrazione delle due attività

I comandi seguenti sono compatibili con PowerShell 4.0. Usano IgnoreNew anche a livello di
Task Scheduler; pipeline.lock resta comunque condiviso con tutti gli altri profili. Inserire
lo stesso account che possiede i segreti DPAPI. La password resta in memoria solo per il tempo
necessario a Register-ScheduledTask.

    $TaskUser = Read-Host 'Account del task (DOMINIO\utente)'
    $TaskPasswordSecure = Read-Host 'Password del task' -AsSecureString
    $PasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($TaskPasswordSecure)
    try {
        $TaskPasswordPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($PasswordPointer)

        $PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
        $WorkingDirectory = 'C:\Impresa\BI_Bridge'
        $LiveArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\Impresa\BI_Bridge\Invoke-BIPipeline-Trasporti.ps1" -Modo live'
        $RiconciliazioneArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\Impresa\BI_Bridge\Invoke-BIPipeline-Trasporti.ps1" -Modo riconciliazione'

        $LiveAction = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $LiveArguments -WorkingDirectory $WorkingDirectory
        $LiveTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) -RepetitionInterval (New-TimeSpan -Seconds 90) -RepetitionDuration (New-TimeSpan -Days 3650)
        $LiveSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
        Register-ScheduledTask -TaskName 'IMPRESA_BI_TRASPORTI_LIVE' -Description 'Bolle Impresa verso intranet ogni 90 secondi' -Action $LiveAction -Trigger $LiveTrigger -Settings $LiveSettings -User $TaskUser -Password $TaskPasswordPlain -RunLevel Highest -Force

        $RiconciliazioneAction = New-ScheduledTaskAction -Execute $PowerShellExe -Argument $RiconciliazioneArguments -WorkingDirectory $WorkingDirectory
        $RiconciliazioneTrigger = New-ScheduledTaskTrigger -Daily -At '04:15'
        $RiconciliazioneSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
        Register-ScheduledTask -TaskName 'IMPRESA_BI_TRASPORTI' -Description 'Riconciliazione giornaliera bolle, finestra mobile 90 giorni' -Action $RiconciliazioneAction -Trigger $RiconciliazioneTrigger -Settings $RiconciliazioneSettings -User $TaskUser -Password $TaskPasswordPlain -RunLevel Highest -Force
    }
    finally {
        $TaskPasswordPlain = $null
        if ($PasswordPointer -ne [IntPtr]::Zero) {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($PasswordPointer)
        }
    }

Verificare la configurazione registrata:

    Get-ScheduledTask -TaskName 'IMPRESA_BI_TRASPORTI','IMPRESA_BI_TRASPORTI_LIVE' |
        Select-Object TaskName,State,@{Name='Azione';Expression={$_.Actions.Execute + ' ' + $_.Actions.Arguments}}
    Get-ScheduledTaskInfo -TaskName 'IMPRESA_BI_TRASPORTI'
    Get-ScheduledTaskInfo -TaskName 'IMPRESA_BI_TRASPORTI_LIVE'

## Annullamento e ritorno indietro

Prima impedire nuovi avvii, poi rimuovere entrambe le attività:

    Disable-ScheduledTask -TaskName 'IMPRESA_BI_TRASPORTI_LIVE' -ErrorAction SilentlyContinue
    Disable-ScheduledTask -TaskName 'IMPRESA_BI_TRASPORTI' -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName 'IMPRESA_BI_TRASPORTI_LIVE' -Confirm:$false -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName 'IMPRESA_BI_TRASPORTI' -Confirm:$false -ErrorAction SilentlyContinue

Controllare che nessun processo relativo al launcher sia ancora in esecuzione. Ripristinare
gli eventuali file presenti nella cartella di backup creata all'inizio; se non esisteva una
versione precedente, rimuovere soltanto i quattro file elencati nella sezione File da
copiare. Non rimuovere pipeline.lock senza avere prima verificato che nessun'altra pipeline
sia attiva. Conservare i log e i due last-run-trasporti*.json per l'audit; non serve
modificare i segreti e non va modificato alcun launcher BI preesistente.
