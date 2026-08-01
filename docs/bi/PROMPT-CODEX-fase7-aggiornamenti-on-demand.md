# Prompt per Codex — Programma di aggiornamento dati su richiesta

> Copia tutto il testo sotto la linea e passalo a Codex.

---

## Cosa devi costruire

Un piccolo programma Windows con interfaccia grafica, da installare sul PC di
**una singola persona**, che le permetta di far partire l'aggiornamento dei dati
BI fuori dagli orari notturni, scegliendo con delle caselle cosa aggiornare.

Non è un'applicazione web e non va nell'intranet: è un programma locale, usato
da una persona sola, in rete aziendale.

## Contesto

C'è una pipeline BI che ogni notte porta dati dal gestionale a Supabase.

| Macchina | Ruolo |
|---|---|
| `SRVWOA` (192.168.1.110), Windows Server, PowerShell 4.0 | SQL Anywhere + gli script della pipeline in `C:\Impresa\BI_Bridge` |
| `srv-intranet` (192.168.1.21), Linux | Riceve i CSV e li carica su Supabase |
| PC dell'utente | Dove va il programma che devi scrivere |

Sul server esistono **già** due attività pianificate, funzionanti e collaudate:

| Attività | Orario | Cosa estrae | Durata |
|---|---|---|---|
| `IMPRESA_BI_GIORNALIERO` | 01:30 | I 7 dataset commerciali: consegnato, consegnato_futuro_per_mese, controllo_banco, fatturato, ordinato, portafoglio, preventivi_aperti | pochi minuti |
| `IMPRESA_BI_CRUSCOTTO` | 02:30 | `cruscotto_articoli` (anagrafica e giacenze) | **~21 minuti** |

Entrambe girano come `DMNAIRFLUID\adm.varas` con la password salvata, e da sole
fanno tutto: estrazione, invio a Linux, caricamento su Supabase.

## L'idea di fondo

**Non devi ricostruire la pipeline.** Le attività pianificate esistenti si
possono avviare a richiesta, anche da un altro computer:

```
schtasks /Run /S SRVWOA /TN "IMPRESA_BI_CRUSCOTTO"
```

Il programma quindi si limita a: far scegliere cosa aggiornare, avviare le
attività corrispondenti sul server, e mostrare cosa sta succedendo.

Questo evita completamente code, database intermedi, servizi in ascolto e
chiavi di accesso sul PC dell'utente.

## Vincolo importante sulla scelta

Le due attività sono le uniche unità selezionabili, e non è una limitazione
aggirabile: il sistema che riceve i dati **pretende tutti e sette i dataset
commerciali insieme**, e rifiuta un invio parziale. Un manifest incompleto viene
respinto.

Quindi le caselle sono due:

- **Dati commerciali** — aggiorna tutti e sette insieme, pochi minuti
- **Cruscotto articoli** — anagrafica e giacenze, circa 21 minuti

Se l'utente le spunta entrambe, le attività vanno avviate **in sequenza, non in
parallelo**: sul server c'è un lock globale (`pipeline.lock`) che fa fallire la
seconda se la prima è ancora in corso.

Nell'interfaccia scrivi accanto a ogni casella quanto ci vorrà. Ventun minuti di
attesa vanno detti prima, non scoperti dopo.

## Requisiti

**Interfaccia**

- Due caselle con descrizione e tempo stimato
- Un pulsante per avviare
- Stato di avanzamento leggibile: cosa sta girando adesso, da quanto
- Esito finale chiaro: riuscito o fallito, e in caso di errore cosa guardare
- Italiano, niente gergo tecnico: la userà una persona che non deve sapere cosa
  sia un manifest o un dataset

**Comportamento**

- Se un'attività è già in esecuzione sul server (perché l'ha avviata qualcun
  altro, o perché è l'orario notturno), **non avviarla di nuovo**: dillo e basta.
  Lo stato si legge con `schtasks /Query /S SRVWOA /TN "..." /FO LIST /V` oppure
  con `Get-ScheduledTask -CimSession`.
- Con entrambe le caselle spuntate: avvia la prima, **aspetta che finisca**, poi
  la seconda.
- L'avvio è asincrono: `schtasks /Run` torna subito, non aspetta la fine. Devi
  interrogare periodicamente lo stato per sapere quando ha finito.
- L'esito di un'attività si legge da `LastTaskResult`: `0` è successo, qualsiasi
  altro valore è errore.
- La finestra non deve congelarsi durante l'attesa.

**Tecnologia**

Proponi tu, motivando. Un'ipotesi ragionevole è PowerShell con WinForms: gira
senza installare nulla, si distribuisce come un file più un collegamento sul
desktop, ed è coerente con il resto degli strumenti aziendali. Se preferisci
altro, spiega perché e come si installa.

Sul PC dell'utente ci sarà PowerShell 5.1 o superiore, ma **il server ha la 4.0**:
se generi codice che gira là, verifica la compatibilità (niente `Expand-Archive`,
niente operatori ternari, niente `??`).

## Da verificare prima di scrivere codice

Il metodo descritto sopra funziona **se l'utente ha i permessi per avviare
attività pianificate sul server**. Verificalo per primo, dal PC dell'utente:

```
schtasks /Query /S SRVWOA /TN "IMPRESA_BI_CRUSCOTTO"
```

- Se risponde con i dati dell'attività, la strada è quella giusta: procedi.
- Se risponde `Access is denied`, la persona non ha quei permessi. **Fermati e
  chiedi** prima di cambiare architettura: le alternative (un servizio in ascolto
  sul server, o una coda su Supabase interrogata dal server) sono molto più
  complesse e vanno decise insieme, non date per scontate.

## Vincoli

- **Non toccare la pipeline esistente.** Gli script in `C:\Impresa\BI_Bridge`, le
  attività pianificate, il receiver Linux e le funzioni su Supabase sono in
  esercizio. Il programma deve limitarsi ad avviare attività già configurate.
- **Nessuna credenziale nel programma**: né password, né chiavi Supabase, né
  token. L'autenticazione è quella di Windows, con l'utente che ha già effettuato
  l'accesso al dominio.
- **Nessun segreto nei commit.**
- Se serve leggere i log del server, si trovano in
  `C:\ProgramData\ImpresaBI\launcher-logs\` (`scheduled-launch-*.log` per il
  commerciale, `cruscotto-launch-*.log` per il Cruscotto). Sono raggiungibili
  via `\\SRVWOA\C$\ProgramData\ImpresaBI\launcher-logs\` se i permessi lo
  consentono — verifica, non darlo per scontato.
- Il programma deve poter essere disinstallato cancellando un file: niente
  registro di sistema, niente servizi.

## Come procedere

1. Verifica i permessi come descritto sopra.
2. **Esponi il progetto prima di implementarlo**: come rilevi lo stato, come
   gestisci l'attesa senza bloccare la finestra, cosa vede l'utente in ciascuna
   fase. Aspetta conferma.
3. Implementa, e **provalo davvero**: avvia un'attività, guarda che il programma
   se ne accorga, che segua l'avanzamento e riporti l'esito giusto. Non dire
   "dovrebbe funzionare".
4. Consegna istruzioni di installazione comprensibili a chi lo userà, non a uno
   sviluppatore.

## Cosa chiedere se non lo trovi

- se serve una notifica a fine elaborazione o basta guardare la finestra
- se il programma deve poter essere usato anche mentre la persona fa altro
  (ridotto a icona) o resta in primo piano
- se vuole vedere quando è stato fatto l'ultimo aggiornamento riuscito
