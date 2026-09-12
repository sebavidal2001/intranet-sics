# BI Bridge — copia versionata di quello che gira su SRVWOA

Questi file **non vengono eseguiti da questo repository**. Sono la copia sotto controllo di
versione della pipeline installata su `SRVWOA` in `C:\Impresa\BI_Bridge\`, che estrae i dati
dal gestionale SQL Anywhere e li consegna al receiver sulla VM Linux.

Fino al 12 settembre 2026 esistevano in due soli posti: la macchina stessa e una cartella sul
PC di lavoro precedente. Nessuno dei due è un backup, e nessuno dei due mostra cosa è cambiato
e quando.

## Corrispondenza verificata il 12 settembre 2026

Gli SHA-256 della copia coincidono con quelli dei file installati su SRVWOA:

| File | SHA-256 (primi 16) |
|---|---|
| `Invoke-BIPipeline.ps1` | `4417272650437D89` |
| `Invoke-BIPipeline-Scheduled.ps1` | `204F86177C091AE9` |
| `Invoke-BIPipeline-Cruscotto.ps1` | `98FD47F86BEA3860` |
| `config.json` | `2B6F4DB591B0579A` |

> [!warning] Modificare qui non cambia la produzione
> Dopo ogni modifica il file va distribuito su SRVWOA a mano, con backup di quello sostituito
> e confronto degli hash prima e dopo. La verità operativa resta la macchina.

## Vincoli dell'ambiente di destinazione

- **Windows Server 2012 R2, PowerShell 4.0.** Niente `-Depth` su `Get-ChildItem`, niente
  operatore ternario, niente `??`, niente `-AsHashtable`.
- Il client SQL Anywhere è la versione **11 Bin32**
  (`C:\Program Files\SQL Anywhere 11\Bin32\dbisql.com`), non la 16 Bin64.
- `dbisql` va invocato con il file SQL come **argomento posizionale** più
  `-datasource airfluid90`, come fa `Invoke-BIPipeline.ps1`. La forma `"READ '<file>'"` fa
  macinare il processo a vuoto.
- **I file SQL per dbisql vanno scritti senza BOM.** `Set-Content -Encoding UTF8` lo aggiunge,
  dbisql risponde `SQLCODE=-131` e apre un prompt `1. Stop / 2. Continue` che nessuno chiude:
  il processo resta appeso per sempre stampando la domanda, e dall'esterno sembra una query
  lenta. Usare `[IO.File]::WriteAllText($p, $testo, (New-Object System.Text.UTF8Encoding($false)))`.
- Da **attività pianificata** l'operatore `&` va bene: lo usa la pipeline da mesi. Da **WinRM**
  no: servono `Start-Process` e i flussi rediretti su file, altrimenti la console non ha
  destinazione e il processo si blocca.
- Da attività pianificata serve `LogonType=Password`: registrando il task senza password si
  ottiene un logon `Interactive` e DPAPI non decifra la credenziale del gestionale.

## Segreti

Non sono qui e non devono arrivarci. Stanno in `C:\ProgramData\ImpresaBI\`, cifrati DPAPI
sotto l'account che esegue le attività pianificate:

- `sqlanywhere.credential.xml` — utenza del gestionale
- `linux-bridge.token` — token del ponte verso il receiver

## Query

`query/TRASPORTI_DOCUMENTI.sql` è il dataset `trasporti_documenti` a 68 colonne, collaudato a
settembre 2026 ma **mai installato**: `Invoke-BIPipeline.ps1` accetta ancora solo i profili
`commerciale`, `cruscotto` e `tutti`. È il punto di partenza della Fase 1 descritta in
`docs/CONTROLLO-VETTORI-FASE1-BOLLE-TEMPO-REALE.md`.
