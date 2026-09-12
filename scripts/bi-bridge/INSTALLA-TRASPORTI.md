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

### Contratto del manifest verso Linux

Il campo `mode` del manifest fa parte del contratto verso il lato Linux e contiene la
modalità del run: `live` oppure `riconciliazione`. Il caricatore si appoggia a questo campo
per decidere se può marcare come spariti i documenti non più presenti nel gestionale: può
farlo soltanto per una riconciliazione, che copre la finestra a 90 giorni, e mai per un run
live, che per costruzione contiene soltanto ID nuovi.

Questo dato non è ridondante anche se la modalità compare nel file di stato: tutti i run
arrivano nella stessa directory `ready-trasporti` e il manifest è il contratto disponibile
al caricatore Linux. Il campo `mode` non deve quindi essere rimosso da chi in futuro modifica
il launcher.

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

> [!warning] `New-ScheduledTaskTrigger` non sa ripetere, su questa macchina
> Su Windows Server 2012 R2 con PowerShell 4.0, `New-ScheduledTaskTrigger -Once` **accetta**
> `-RepetitionInterval` e `-RepetitionDuration` e poi li **scarta in silenzio**: il trigger si
> costruisce, ma `Repetition.Interval` e `Repetition.Duration` restano vuoti. Verificato sulla
> macchina il 12 settembre 2026.
>
> Registrando il task in quel modo, il live partirebbe **una volta sola** e non si ripeterebbe
> mai piu'. Nessun errore, nessun avviso: le bolle arriverebbero al primo colpo e poi basta.
>
> Non funziona nemmeno assegnare la ripetizione con `New-CimInstance`: su quella versione il
> trigger `-Once` non espone una proprieta' `Repetition` scrivibile.
>
> La strada che funziona e' `schtasks`, che gestisce la ripetizione in modo nativo.

### Il live, ogni minuto

`schtasks /SC MINUTE` accetta da 1 a 999 minuti. Si usa **1 minuto** invece dei 90 secondi
previsti: non e' esprimibile in secondi, e un minuto e' comunque migliore dell'obiettivo. Con
la query misurata a 0,85 secondi significa occupare il gestionale per circa l'1% del tempo.

`/RP *` chiede la password a video: non finisce ne' in un file ne' nella cronologia dei
comandi. `/RU` con `/RP` produce un task con `LogonType=Password`, che e' **obbligatorio**:
senza, il logon e' `Interactive` e DPAPI non riesce a decifrare la credenziale del gestionale.

    schtasks /Create /TN "IMPRESA_BI_TRASPORTI_LIVE" ^
      /TR "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"C:\Impresa\BI_Bridge\Invoke-BIPipeline-Trasporti.ps1\" -Modo live" ^
      /SC MINUTE /MO 1 ^
      /RU "DMNAIRFLUID\adm.varas" /RP * ^
      /RL HIGHEST /F

### La riconciliazione, alle 04:15

Qui la ripetizione non serve e il trigger giornaliero di PowerShell funziona; si usa comunque
`schtasks` per coerenza. Le 04:15 non collidono con il commerciale dell'01:30, con il cruscotto
delle 02:30, ne' con Prophet delle 03:30 del venerdi'.

    schtasks /Create /TN "IMPRESA_BI_TRASPORTI" ^
      /TR "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"C:\Impresa\BI_Bridge\Invoke-BIPipeline-Trasporti.ps1\" -Modo riconciliazione" ^
      /SC DAILY /ST 04:15 ^
      /RU "DMNAIRFLUID\adm.varas" /RP * ^
      /RL HIGHEST /F

### Controllare che la ripetizione ci sia davvero

Il punto da verificare non e' che il task esista, ma che si **ripeta**. Se `Interval` esce
vuoto, il task e' stato creato nel modo sbagliato:

    Get-ScheduledTask -TaskName 'IMPRESA_BI_TRASPORTI_LIVE' |
        ForEach-Object { $_.Triggers } |
        Select-Object -Property @{Name='Intervallo';Expression={$_.Repetition.Interval}},
                                @{Name='Durata';Expression={$_.Repetition.Duration}}

Atteso: `Intervallo = PT1M`. Vuoto significa che la ripetizione non e' stata applicata.

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
