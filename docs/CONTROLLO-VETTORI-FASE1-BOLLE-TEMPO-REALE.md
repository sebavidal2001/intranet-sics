# Fase 1 — Bolle dal gestionale quasi in tempo reale

Data: 12 settembre 2026. Stato: piano approvato da definire con Codex, nessuna modifica applicata.

## Perché in tempo reale

I campi Lunghezza / Larghezza / Altezza non esistono nel gestionale: vanno inseriti a mano
sull'intranet per calcolare il peso volumetrico. Se la bolla compare sull'intranet il giorno
dopo, chi l'ha registrata non è più sul pezzo e i campi restano vuoti per sempre. Il requisito
non è tecnico, è di adozione: la bolla deve essere lì mentre la persona ha ancora in mano il
collo.

Obiettivo dichiarato: **bolla registrata su Impresa → visibile su `/vettori/bolle` entro 90
secondi**.

## Stato verificato il 12 settembre

| Componente | Stato |
|---|---|
| `bi.trasporti_documenti` in produzione | esiste, esposta via PostgREST, **0 righe** |
| Migration `090_bi_trasporti_documenti.sql` | applicata (68 colonne + `aggiornato_il`, PK `id_documento`) |
| `TRASPORTI_DOCUMENTI.sql` | recuperata, SHA del pacchetto verificato contro quello documentato |
| Profilo `trasporti` in `Invoke-BIPipeline.ps1` | **assente** — `ValidateSet` accetta solo commerciale/cruscotto/tutti |
| `last-run.json` su SRVWOA | **unico e condiviso** fra i profili |
| Task BI esistenti | commerciale 01:30, cruscotto 02:30, watchdog 09:00 — tutti esito 0 il 12/09 |
| `C:\Impresa\BI_Bridge\*` vs copia del PC vecchio | **hash identici**, nessuna divergenza |

## Architettura proposta

Due flussi distinti sullo stesso dataset, perché risolvono problemi diversi.

### A. Polling incrementale (il "tempo reale")

Task `IMPRESA_BI_TRASPORTI_LIVE` su SRVWOA, ripetizione **ogni 90 secondi**.

Predicato del poll — **sulla chiave primaria, non sulle date**:

```sql
WHERE d.id_documento > <ultimo_id_visto - 50>
  AND d.tipo_registro IN ('DV','DA')
```

`id_documento` è la primary key di `dba.documento`, quindi è indicizzata per certo: la query
è una scansione di intervallo su indice che tocca soltanto le righe nuove. Il costo è
trascurabile **a prescindere** da come siano indicizzate le colonne data.

Questa è una scelta di sicurezza, non di eleganza. Il predicato sulle date
(`data_creazione >= DATEADD(minute,-15,NOW()) OR data_modifica >= ...`) sarebbe più espressivo,
ma se su quelle colonne non esiste un indice diventa una scansione completa di `dba.documento`
ripetuta 960 volte al giorno, in orario di lavoro, sullo stesso database su cui gli operatori
registrano ordini e bolle. Non è un rischio teorico: è il modo tipico in cui si degrada un
gestionale. Con la PK il rischio non si misura e si spera, si elimina.

Il margine di 50 ID copre le transazioni lunghe che committano fuori ordine. L'upsert su
`id_documento` rende innocua la rilettura delle stesse righe.

Cosa si perde: il poll non vede le **modifiche** a bolle già esistenti. Non servono in tempo
reale — nessuno inserisce altezza e larghezza per una correzione fatta tre giorni dopo — e
arrivano comunque dalla riconciliazione giornaliera.

Due verifiche da fare prima di adottarlo, entrambe con query da niente sulla PK:

1. che `id_documento` sia effettivamente crescente nell'ordine di creazione;
2. quale sia lo scostamento massimo osservato fra ordine di ID e ordine di `data_creazione`,
   per confermare che 50 sia un margine adeguato.

Regole del runner:

- se `pipeline.lock` è occupato, **esce subito** senza attendere: non deve mai accodarsi
  dietro l'estrazione notturna pesante;
- stato in `last-run-trasporti-live.json`, separato;
- se il CSV è vuoto (nessuna bolla nei 15 minuti) **non fa upload** e non scrive allarmi:
  la stragrande maggioranza dei run sarà vuota ed è il caso normale, non un errore.

### B. Riconciliazione giornaliera

Task `IMPRESA_BI_TRASPORTI` con la finestra mobile a 90 giorni già collaudata (1.827 righe,
68 colonne). Serve a due cose che il polling non può fare:

1. recuperare le correzioni tardive — nel backfill risultano **234 documenti** registrati
   prima della finestra ma modificati di recente, che un filtro sulla sola `data_registrazione`
   avrebbe perso;
2. rilevare le **sparizioni**: gli `id_documento` presenti nel DB ma non più nella finestra
   del gestionale vengono marcati `assente_dal_gestionale`, mai cancellati fisicamente.
   Una finestra di upsert da sola non può accorgersene.

Orario: **04:15**, non 03:30. Il venerdì alle 03:30 gira Prophet sulla VM e non vanno
sovrapposte due estrazioni pesanti.

## Misura: tentata il 12 settembre, non riuscita

Il predicato sulla PK toglie il rischio per costruzione, ma la misura va fatta lo stesso prima
di registrare il task. Il primo tentativo è fallito e vale la pena verbalizzarlo, perché
l'errore si ripeterebbe.

Due invocazioni di `dbisql` da SRVWOA via WinRM:

1. `dbisql -nogui -c <conn> "READ '<file>'"` — forma sbagliata. Il processo ha macinato 100
   secondi di CPU senza produrre output. Terminato manualmente.
2. Forma corretta, copiata da `Invoke-BIPipeline.ps1:323` — file SQL come **argomento
   posizionale** più `-datasource airfluid90`. Il processo è rimasto appeso **23 minuti con
   12,5 secondi di CPU**: bloccato, non in calcolo, nessun CSV prodotto. Terminato
   manualmente. Nessun task BI era in esecuzione, nessun residuo lasciato.

Conclusione operativa: **`dbisql` non va invocato interattivamente via WinRM.** È
un'applicazione Java che in sessione non interattiva si blocca su qualcosa che da attività
pianificata non capita — la pipeline lo lancia così da mesi senza problemi. La misura va
quindi eseguita **come attività pianificata, fuori orario di lavoro**.

Cosa misurare, quando si farà:

- durata della query PK a vuoto (nessun ID nuovo): criterio di accettazione **sotto 2 secondi**;
- presenza di indici su `data_creazione` / `data_modifica`, che serve comunque a dimensionare
  la riconciliazione giornaliera;
- le due verifiche sulla monotonia di `id_documento` elencate sopra.

Finché queste misure non esistono, **nessun task viene registrato su SRVWOA**.

## Divisione del lavoro

### Codex — dentro il repo, nessun accesso alle VM

**Task 1: migration 096 + pagina bolle.**

Nuova migration `096_vettori_bolla_misure.sql`:

- tabella `vettori.bolla_misure`, una riga per gruppo di colli omogenei;
- FK `id_documento` → `bi.trasporti_documenti`, `ON DELETE RESTRICT`;
- colonne: `quantita`, `lunghezza_cm`, `larghezza_cm`, `altezza_cm`, `peso_reale_kg`,
  `volume_m3`, `fonte` (`manuale` | `magazzino` | `vettore`), `inserito_da`, `inserito_il`,
  `modificato_da`, `modificato_il`;
- RLS coerente con le altre tabelle `vettori.*`, GRANT espliciti;
- **il grezzo non si tocca**: `bi.trasporti_documenti` resta di sola scrittura per la pipeline.

Pagina `/vettori/bolle`, a monte di Fatture nella sidebar:

- elenco delle bolle in arrivo, ordinate per `data_creazione` discendente, con evidenza di
  quelle **senza misure**, che sono il lavoro da fare;
- inserimento di L/L/H per riga o per gruppo di colli, con peso volumetrico calcolato in
  tempo reale usando il motore esistente in `src/lib/portali/vettori/misure.ts`
  (300 kg/m³ GLS e Trading Post, 250 TNT/FedEx);
- quando `bi.trasporti_documenti.volume` è già valorizzato, si usa quello e non si chiede
  niente all'utente;
- niente polling lato browser per ora: la pagina si aggiorna al caricamento.

Vincoli per Codex: nessuna scrittura su `bi.*`, nessun `any`, Zod sugli input, test in
`src/tests/`, `npm run type-check` e la suite vettori verdi prima di consegnare.

### Io — VM Windows e Linux

1. Misurare la query PK **come attività pianificata fuori orario**, con `-SkipUpload`, prima
   di qualsiasi task. Non via WinRM: vedi la sezione sulla misura.
2. Sdoppiare gli stati: `last-run.json` resta al commerciale, si aggiungono
   `last-run-cruscotto.json`, `last-run-trasporti.json`, `last-run-trasporti-live.json`.
   `pipeline.lock` resta condiviso.
3. Estendere `ValidateSet` a `trasporti` e distribuire il launcher, con backup del file
   sostituito e hash prima/dopo.
4. Lato Linux: mappatura del dataset nel loader, verifica che il receiver accetti run
   frequenti e piccoli senza intasare `incoming`.
5. Riparare il canale SMTP degli avvisi (prerequisito bloccante, sezione dedicata), poi
   estendere il watchdog: allarme dedicato per trasporti, **silenzioso sui run vuoti**.
6. Backfill controllato dal 2025 (10.755 righe) solo dopo che il flusso incrementale è
   verde per almeno 24 ore.

## Vincoli tecnici da non dimenticare

**SRVWOA è Windows Server 2012 R2 con PowerShell 4.0.** Niente `-Depth` su `Get-ChildItem`,
niente operatore ternario, niente `??`, niente `-AsHashtable`. Qualunque script destinato a
quella macchina va scritto per la 4.0 e provato là, non qui.

**Il client SQL Anywhere su SRVWOA è la versione 11 Bin32**, non la 16 Bin64:

```
C:\Program Files\SQL Anywhere 11\Bin32\dbisql.com
```

Il `config.trasporti-staging.json` recuperato dal PC vecchio punta alla 16 Bin64, che su
SRVWOA **non esiste**. Va corretto prima di distribuire il launcher, altrimenti il task muore
al primo avvio con «dbisql non trovato».

**`dbisql` non si invoca via WinRM**, vedi la sezione sulla misura.

## Prerequisito bloccante: il canale d'allarme è rotto

L'unità `intranet-db-avviso@intranet-db-verifica.service` sulla VM Linux è in stato **failed**
dal 29 agosto, con `SMTPAuthenticationError`. Il 4 settembre la verifica del backup è fallita
davvero, l'allarme è partito e l'invio è morto sull'autenticazione: nessuno l'ha saputo.

I backup in sé sono sani — dump giornaliero da 42 MB, SHA-256 scritte, ultimo l'11 settembre
alle 23:00, verificato il 12 alle 06:00 — ma il meccanismo che avvisa quando smettono di
esserlo non funziona.

Ricade direttamente su questa fase: il punto 5 della mia lista prevede un allarme dedicato per
trasporti. **Finché il canale mail è rotto qualunque allarme aggiungiamo è decorativo**, e un
flusso che gira ogni 90 secondi senza allarmi funzionanti è peggio che non averlo. Va sistemato
prima di schedulare, non dopo.

Sospetto da confermare: lo script degli avvisi usa credenziali SMTP diverse o scadute rispetto
a quelle dell'app intranet, che le mail le manda correttamente. La conferma richiede di leggere
la configurazione dello script, che è di root: serve la password sudo di `intra-adm`. Il
rimedio richiede la password SMTP, che va inserita dall'utente.

Nota collegata: `intra-adm` non appartiene al gruppo `impresa-bi`, quindi
`/opt/impresa-bi/schemi_dataset.py` — dove va dichiarato il contratto di `trasporti_documenti`
per il loader — non è leggibile. Anche quello richiede sudo o l'aggiunta al gruppo.

## Domande ancora aperte

Le sei conferme richieste a settembre sono risolte tranne una:

| # | Domanda | Risposta |
|---|---|---|
| 1 | Migration 090 pronta? | Sì, applicata in produzione, tabella vuota |
| 2 | `timestamptz` o timestamp locale? | `timestamp` senza fuso, come da migration 090 |
| 3 | Tutti i profili DA/DV? | Sì, la tabella non filtra per profilo |
| 4 | Cancellazioni fisiche | Marcatura `assente_dal_gestionale` dalla riconciliazione giornaliera |
| 5 | Stati separati per profilo | Sì, punto 2 della mia lista |
| 6 | Upload del backfill | Dopo 24 ore di incrementale verde |

Il dubbio sul polling a 90 secondi è chiuso dal predicato sulla PK: non serve più decidere fra
5 minuti e una tabella di outbox sul gestionale, e l'ERP non va toccato.

Restano da chiudere, in ordine: il canale SMTP degli avvisi, l'accesso in lettura a
`schemi_dataset.py`, e la misura notturna.

Collegato a: [[Controllo Vettori - Listini e Motore di Calcolo]] · [[Controllo Vettori - Schema DB]] · [[Pipeline BI Impresa]] · [[intranet-sics]].
