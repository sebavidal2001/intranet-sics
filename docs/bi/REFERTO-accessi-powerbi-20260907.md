# Referto — ripristino accessi Power BI del 7 settembre 2026

> Stato: **risolto e verificato**. Intervento eseguito su `srv-intranet`
> (192.168.1.21) il 7 settembre 2026, su segnalazione dal PC Power BI
> (`AIR-036`).

---

## Il sintomo non era quello che sembrava

La segnalazione era «gli aggiornamenti di Power BI falliscono». La prima cosa
verificata è stata se il problema fosse **a monte** — cioè se i dati sulla VM
fossero fermi. Non lo erano:

| Pipeline | Ultimo run | Ricevuto |
|---|---|---|
| Cruscotto articoli (`bi.cruscotto_runs`) | `20260907_023002` | 7 set 2026, 02:50 |
| Dati commerciali (`public.bi_runs`) | `20260907_013001` | 7 set 2026, 01:31 |

Entrambe arrivano da `SRVWOA` (192.168.1.110) e sono **regolari**. Il guasto era
solo **in lettura, dal PC verso la VM**: nessun dato mancante, nessun
ingest saltato.

> [!info] Perché la distinzione conta
> Se l'ingest si fosse fermato, il ripristino degli accessi non avrebbe
> risolto niente: Power BI avrebbe letto dati vecchi senza errori. Vale sempre
> la pena separare «non riesco a leggere» da «non c'è niente da leggere».

---

## La causa: l'indirizzo VPN è scaduto

Il PC raggiunge la VM **attraverso il tunnel VPN**, quindi il server vede
l'indirizzo del pool VPN e non quello di LAN. Il 3 settembre quell'indirizzo era
`10.212.134.202` ed è stato autorizzato. Oggi il PC è `10.212.134.200`.

Il pool è dinamico e la scadenza era stata prevista nel referto del 3 settembre.
È successo esattamente come descritto.

### La prova

Dal kernel della VM, alle 18:42 di oggi:

```
[UFW BLOCK] SRC=10.212.134.200 DST=192.168.1.21 PROTO=TCP DPT=5432 SYN
```

Il pacchetto viene scartato da UFW **prima** di arrivare a PostgreSQL: da qui il
timeout, e non un errore di autenticazione. Password e certificato non
c'entravano.

---

## Cosa è stato cambiato

Backup di entrambi i file con suffisso `.bak-20260907-191113`.

| Punto | Prima | Dopo |
|---|---|---|
| UFW porta 5432 | `10.212.134.202` | `10.212.134.200` |
| `pg_hba.conf` riga 141 | `hostssl intranet powerbi_reader 10.212.134.202/32` | `...10.212.134.200/32` |
| `snippets/impresa-bi-ingest.conf` | `allow` 127.0.0.1, .21, .110 | **aggiunto** `allow 10.212.134.200` |

La vecchia regola `.202` è stata **sostituita, non affiancata**: lasciarla
avrebbe autorizzato il dispositivo che riceverà quella concessione in futuro,
che non sarà necessariamente questo PC. La rete `10.212.134.0/24` non è stata
autorizzata.

`nginx -t` superato, nginx e PostgreSQL ricaricati. `pg_hba_file_rules` rilegge
la regola a riga 141 con netmask `/32`, prima del `reject` generale di riga 144,
e **zero errori** su tutto il file.

### L'allowlist Nginx è un'aggiunta, non un ripristino

Va detto chiaramente, perché il referto di partenza lo presentava come
ripristino. Dai log di accesso (finestra 21 agosto → 7 settembre):

| Sorgente | Esiti |
|---|---|
| `192.168.1.110` (SRVWOA) | 140 × `201`, 1 × `200` |
| `10.212.134.200 / .201 / .202` | **solo `403`** |

Il PC non ha **mai** avuto un upload riuscito su `/api/v1/bi-ingest/`: non era in
allowlist e il 403 non è una regressione di oggi. Autorizzarlo è una scelta
nuova — serve alla pipeline manuale `AVVIO_BI_MANUALE` che gira sul PC, ma
significa che **un portatile in VPN può scrivere nel dataset BI**. Il bridge
token resta il secondo cancello. Per revocarla basta togliere la riga `allow`
dallo snippet e ricaricare nginx.

---

## Controllo negativo

Una regola di rete si prova **al contrario**: se non si dimostra che un IP non
autorizzato viene respinto, non si è dimostrato niente.

Da `192.168.1.25` (LAN, fuori da ogni allowlist), dopo la modifica:

| Prova | Esito | Atteso |
|---|---|---|
| TCP 5432 | **chiusa** | sì |
| `GET /api/v1/bi-ingest/health` | **403** | sì |
| `GET /` | 200 | sì |

Il perimetro regge: si è aperto un solo indirizzo, non una fascia.

---

## Il residuo da sistemare

### La regola LAN `192.168.1.16` è anch'essa scaduta

Autorizza ancora un indirizzo che **non è più del PC**: oggi il PC è `AIR-036`
su `192.168.1.24` (Wi-Fi) e `192.168.1.88` (Ethernet, *deprecated*). L'indirizzo
`.16` non risponde e non è registrato nel DNS interno.

Non è stata rimossa perché oggi non fa danno e non serve a nessun ripristino, ma
è **lo stesso identico rischio della `.202`**: se il DHCP la assegna a un altro
dispositivo, quel dispositivo si trova la 5432 aperta. Va sostituita insieme alla
scelta definitiva, non prima.

### La soluzione stabile — tre opzioni, non due

La `/32` sulla VPN è un cerotto: si rompe alla prossima riassegnazione.

| | Come | Costo | Limite |
|---|---|---|---|
| **A** | Riserva statica sul concentratore VPN per il PC | serve accesso al concentratore | l'accesso resta legato a un indirizzo |
| **B** | Riserva DHCP per `AIR-036` + split-route di `192.168.1.21/32` fuori dal tunnel | serve accesso al router/DHCP | idem, ma l'indirizzo è di LAN e più stabile |
| **C** | **Tunnel SSH** dal PC: `ssh -L 5432:localhost:5432`, Power BI punta a `localhost` | nessuna modifica di rete | il tunnel deve essere attivo al refresh |

> [!info] Perché la C merita di essere considerata
> La porta 22 è già aperta a chiunque e protetta **solo da chiave**: è l'unico
> accesso che non dipende dall'indirizzo del PC. Con un tunnel non servirebbe
> più nessuna regola `/32`, e la 5432 potrebbe essere **chiusa del tutto** verso
> la VPN invece che aperta a un indirizzo alla volta. In cambio, il refresh
> richiede che il tunnel sia su — che è un vincolo vero se i refresh sono
> pianificati e non manuali.

A e B tolgono il problema dalla VM ma richiedono di poter mettere le mani sulla
rete; C si risolve interamente sul PC.

---

## Cosa non è stato toccato

Come richiesto: **password di `powerbi_reader` invariata**, **bridge token non
ruotato**. Erano fuori causa — il traffico non arrivava nemmeno a chiederli.
La verifica del token va fatta ora che i pacchetti passano.

---

## Verifiche da fare dal PC

```powershell
Test-NetConnection intranet.s-ics.com -Port 5432
```

Deve dare `TcpTestSucceeded: True`. Poi:

```powershell
& "C:\Impresa\Viste_BI\Esportazioni\AVVIO_BI_MANUALE\pipeline\Test-Preflight.ps1" `
  -ConfigPath "C:\Impresa\Viste_BI\Esportazioni\AVVIO_BI_MANUALE\pipeline\config.json"
```

> [!warning] Se l'indirizzo VPN è cambiato di nuovo
> Prima di ogni altra diagnosi, ricontrollare la sorgente vista dal server:
> `Find-NetRoute -RemoteIPAddress 192.168.1.21`. Se non è `10.212.134.200`, il
> problema è di nuovo questo e non un guasto nuovo.

---

## Collegato a

- [[intranet-sics - Database su VM]]
- `docs/bi/ACCESSO-POWERBI-postgres-locale.md` — referto del 3 settembre 2026

---

# Seguito — 9 settembre 2026: la `/32` è stata abbandonata

Due giorni dopo, l'errore è tornato identico. La `/32` non ha retto, e il modo
in cui ha ceduto è la ragione per cui è stata sostituita.

## Cosa era successo

| | 3 set | 7 set | 9 set |
|---|---|---|---|
| PC Power BI (`AIR-036`) in LAN | `192.168.1.16` | `192.168.1.24` | **`192.168.1.92` + `.88`** |
| PC Power BI in VPN | `10.212.134.202` | `10.212.134.200` | — |
| Chi ha `10.212.134.200` oggi | — | il PC | **un altro portatile** (`AIR-029`) |

Tre indirizzi diversi in sei giorni. E soprattutto: la `/32` VPN autorizzata il 7
settembre, **48 ore dopo era assegnata a una macchina diversa**, che si è
trovata la 5432 aperta. Verificato in diretta, non dedotto.

> [!warning] Il controllo non stava proteggendo quello che sembrava proteggere
> Su due tentativi, la regola ha autorizzato il dispositivo sbagliato due volte:
> la `.202` era già stata di un altro (referto del 3 settembre), la `.200` lo è
> diventata. Una regola che punta a un indirizzo dinamico non identifica una
> macchina — dà solo l'impressione di farlo.

## Una precisazione sui log

In prima battuta l'assenza di `UFW BLOCK` su 5432 sembrava significativa. **Non
lo è**: le regole di log di UFW sono limitate a `3/min` con burst 10,
*condivisi fra tutto il traffico bloccato*, e la VM ne scarta ~12/min di rumore
(porte 10001, 64120, 161 da stampanti e scanner SNMP). Un tentativo del PC
verrebbe quasi certamente ingoiato dal limitatore.

La diagnosi regge sul **DNS interno**, non sui log: `AIR-036` risolve oggi in
`192.168.1.92` e `192.168.1.88`, nessuno dei due in allowlist.

## La configurazione nuova

Tre regole `/32` sostituite da una sola, e il pool VPN escluso.

| Punto | Prima | Dopo |
|---|---|---|
| UFW 5432 | `.16`, `.21`, `10.212.134.200` | **`192.168.1.0/24`** |
| `pg_hba.conf` | tre righe `hostssl` `/32` | **una riga** `192.168.1.0/24` |
| Nginx bi-ingest | +`10.212.134.200` | **rimossa** |

Backup: suffisso `.bak-20260909-113029`.

Il ragionamento: **il cancello vero non è mai stato l'indirizzo**. È `hostssl`
(TLS obbligatorio) + `scram-sha-256` + un solo ruolo + un solo database + sola
lettura su `powerbi.*` + il `reject` finale. La `/24` di LAN dice «da dentro
l'ufficio»; il pool VPN non dice niente di stabile e resta **escluso**.

## Le tre prove

Una regola di rete si prova in entrambi i versi.

| Prova | Da | Esito |
|---|---|---|
| 5432 **chiusa** dal pool VPN | `10.212.134.200` | `TcpTestSucceeded: False` |
| 5432 **aperta e autenticante** dalla LAN | `192.168.1.21` | `fe_sendauth: no password supplied` |
| Connessione **senza TLS respinta** | `192.168.1.21` | `pg_hba.conf rejects connection … no encryption` |

La seconda è quella che conta davvero: il messaggio dimostra che il pacchetto ha
attraversato UFW, ha trovato il listener e ha **superato `pg_hba`**, fermandosi
solo perché non è stata data la password. `443` resta aperta, i tre servizi
attivi, `pg_hba_file_rules` legge la `/24` con netmask `255.255.255.0` alla riga
141 prima del `reject` di riga 144, con **zero errori**.

## Resta aperto

> [!todo] Il PC non è più in allowlist su `/api/v1/bi-ingest/`
> Rimuovendo la `/32` VPN, il PC ha perso anche l'autorizzazione a **scrivere**
> nel dataset BI, aggiunta il 7 settembre. `Test-Preflight.ps1` fallirà il
> controllo «IP ammesso da Nginx».
>
> Non è stato riaperto sulla `/24` di proposito: **leggere** da tutta la LAN e
> **scrivere** da tutta la LAN sono decisioni di peso diverso, e l'ingest di
> produzione arriva da `192.168.1.110` e funziona. Se la pipeline manuale
> `AVVIO_BI_MANUALE` deve poter caricare, va aggiunto un indirizzo in modo
> deliberato.

> [!todo] Il tunnel SSH resta la risposta per il lavoro da remoto
> Fuori dall'ufficio la 5432 ora è chiusa. `ssh -L 5432:localhost:5432` verso la
> VM e Power BI puntato a `localhost` è l'unico accesso che non dipende
> dall'indirizzo del PC — la 22 è aperta a chiunque e protetta solo da chiave.
