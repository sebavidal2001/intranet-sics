# Per Codex — dalla ricognizione alla pipeline: dataset `trasporti_documenti`

> Data: 7 settembre 2026 · segue il pacchetto `LAB_TRASPORTI_20260905`.
> Ambito: **sola lettura** su SQL Anywhere `SRVWOA`, più la messa in pipeline.
> Le sette query commerciali, il loro `run_id` e il loro orario **non si toccano**.
>
> Il laboratorio del 5 settembre ha già dato le risposte: `BF` è `tipo_registro='DA'`,
> il numero DDT del fornitore sta in `documento.num_documento`, la zona si risolve
> al 100%, i tempi di consegna non esistono. Il CSV candidato a 62 colonne è stato
> verificato contro le fatture vere dei vettori e **aggancia il 89% delle spedizioni
> GLS e il 100% delle partenze Trading Post**. Quel lavoro non va rifatto.
>
> Qui si passa da estrazione di laboratorio a **dataset in pipeline**, con tre
> aggiunte al tracciato.

---

## 1. Cosa cambia rispetto al laboratorio

| | Laboratorio (fatto) | Produzione (da fare) |
|---|---|---|
| Esecuzione | a mano, una volta | profilo `trasporti`, task pianificato proprio |
| Periodo | 2026 intero | backfill una tantum + **finestra mobile** ogni notte |
| Caricamento | CSV su disco | upsert su `bi.trasporti_documenti` |
| Colonne | 62 | **68**: sei in più, sotto |
| Destinazione | cartella di lavoro | Linux → PostgreSQL, come gli altri dataset |

---

## 2. Le sei colonne nuove

Servono a due cose: sapere **chi ha creato la bolla** — il committente vuole
tracciare il carico di lavoro del back office — e poter **escludere i documenti
generati automaticamente** da quel conteggio.

Il join è già nel tuo `QUERY_CANDIDATA_BOLLE.sql`, e i nomi delle colonne sono
quelli che la pipeline commerciale usa già su `ordinato` e `preventivi_aperti`:
riusarli identici evita due convenzioni per la stessa cosa.

```sql
  d.id_utente_crea,
  u.ut_utente      AS codice_utente_creatore,
  u.ut_descrizione AS utente_creatore,
  d.id_utente_modifica,
  d.data_modifica,
  d.generato_da
...
LEFT OUTER JOIN dba.utenti u ON u.id_utenti = d.id_utente_crea
```

`data_creazione` è già la colonna 10 del tracciato attuale: non va duplicata.

**Da verificare, e non da assumere**: `documento.generato_da` è `varchar(80)` e
non so quali valori prenda. Mandami

```sql
SELECT generato_da, count(*) FROM dba.documento
WHERE data_registrazione >= '2026-01-01' GROUP BY 1 ORDER BY 2 DESC;
```

Serve a capire se distingue davvero i documenti automatici da quelli scritti da
una persona. Se non lo fa, dimmelo: il conteggio per utente andrà qualificato in
altro modo, non lasciato ambiguo.

> [!warning] Il numero di documenti non è produttività
> Lo avevi già scritto tu nell'esito del 5 settembre e vale la pena ripeterlo qui,
> perché finirà in un cruscotto: **il conteggio misura volume amministrativo**.
> Una bolla con trenta righe e una con una riga contano uguale, le rettifiche e
> gli annullamenti contano come lavoro nuovo, e i documenti generati dal
> gestionale non li ha scritti nessuno. Il dataset porta il dato grezzo; la
> qualificazione la facciamo a valle e la scriviamo accanto al numero.
>
> Nota separata, non tecnica: è un dato **sul personale**, nominativo. Lo dico una
> volta e poi non ci torno — l'azienda lo fa già su `ordinato` e
> `preventivi_aperti`, quindi il precedente esiste; è però il committente che
> decide se e come mostrarlo, non la pipeline.

---

## 3. Tracciato definitivo — 68 colonne

Le 62 già validate, **nello stesso ordine**, più le sei nuove **in coda**.
Aggiungerle in fondo e non in mezzo significa che il file di ieri e quello di
domani restano confrontabili colonna per colonna.

```
 1 id_documento              24 destinazione_codificata    47 vettore_codice
 2 direzione                 25 dest_indirizzo_cod         48 vettore
 3 tipo_registro             26 dest_cap_cod               49 num_colli
 4 codice_profilo            27 dest_localita_cod          50 num_pallet
 5 descrizione_profilo       28 dest_provincia_cod         51 peso_netto
 6 numero_progressivo        29 dest_rag_soc               52 peso_lordo
 7 numero_documento          30 dest_indirizzo             53 volume
 8 data_documento            31 dest_cap                   54 id_unita_misura_peso
 9 data_registrazione        32 dest_localita              55 um_peso
10 data_creazione            33 dest_provincia             56 id_unita_misura_volume
11 stampato                  34 provincia_destinazione     57 um_volume
12 contabilizzato            35 zona_cap                   58 val_spese
13 sospeso                   36 zona_provincia             59 data_trasporto
14 bloccato                  37 fonte_zona                 60 data_prev_consegna
15 id_sog_commerciale        38 id_tipo_trasporto          61 data_consegna_cliente
16 codice_soggetto           39 tipo_trasporto_codice      62 note_spedizione
17 soggetto                  40 tipo_trasporto             ── nuove ──
18 soggetto_piva             41 id_caus_trasporto          63 id_utente_crea
19 soggetto_indirizzo        42 causale_trasporto_codice   64 codice_utente_creatore
20 soggetto_cap              43 causale_trasporto          65 utente_creatore
21 soggetto_localita         44 tras_mezzo                 66 id_utente_modifica
22 soggetto_provincia        45 asp_beni                   67 data_modifica
23 id_destinazione           46 id_sog_commerciale_vettore 68 generato_da
```

Frammento per `config.json`, da inserire **solo dopo il collaudo del §6**:

```json
{
  "SqlFile": "TRASPORTI_DOCUMENTI.sql",
  "OutputFile": "trasporti_documenti.csv",
  "Dataset": "trasporti_documenti",
  "ExpectedColumns": 68,
  "Profilo": "trasporti",
  "HeaderPattern": "^id_documento$"
}
```

### Regole di formato, invariate rispetto al laboratorio

- decimali con il **punto**, date `YYYY-MM-DD` senza orario;
- `note_spedizione` ripulita da `;` e ritorni a capo, tagliata a 200 caratteri;
- `ORDER BY data_registrazione, id_documento` — deterministico;
- NULL come campo vuoto, **mai zero**;
- `WITH COLUMN NAMES`, che nel tuo pacchetto ha funzionato.

---

## 4. Finestra mobile e caricamento

Le bolle sono a **sola aggiunta**, come `consegnato` e `fatturato`: una bolla
emessa non cambia più. L'eccezione sono le correzioni tardive, che esistono ma
sono poche — per quelle serve `upsert`, non `append`.

- **Backfill una tantum**: `data_registrazione >= '2025-01-01'`. Serve lo storico
  per il cruscotto della trattativa e per l'import dei fogli 2026.
- **Notturno**: `data_registrazione >= current_date - 90`. Novanta giorni coprono
  le correzioni tardive con abbondanza e tengono il file sotto il mezzo mega.
- **Chiave di upsert**: `id_documento`. È stabile e non si riusa.
- **Orario**: un task suo, non l'01:30 del commerciale. Due estrazioni pesanti in
  parallelo sullo stesso SQL Anywhere non convengono, e il `pipeline.lock`
  serializza ma non ottimizza.

---

## 5. La tabella di destinazione la creo io

Non serve che tu scriva DDL: la tabella arriva con la migration `090` del repo,
e questo è il contratto a cui il loader deve consegnare.

```sql
create table bi.trasporti_documenti (
  id_documento            integer primary key,
  direzione               text,
  tipo_registro           text,
  codice_profilo          text,
  -- ... le 62 colonne del tracciato, tipi come dal dizionario ...
  id_utente_crea          integer,
  codice_utente_creatore  text,
  utente_creatore         text,
  id_utente_modifica      integer,
  data_modifica           timestamptz,
  generato_da             text,
  ultimo_visto_run        text not null,
  aggiornato_il           timestamptz not null default now()
);
```

> [!info] La normalizzazione del numero di bolla la faccio a valle, non tu
> Il portale aggancia le righe di fattura alle bolle su un numero normalizzato —
> maiuscolo, senza punteggiatura, senza zeri iniziali, con i segnaposto `0` e
> `XXX` trattati come «riferimento assente». Quella regola esiste già in
> `src/lib/portali/vettori/fatture/testo.ts` ed è coperta da test.
> **Il CSV deve portare il valore grezzo, esattamente come sta nel gestionale.**
> Due normalizzazioni scritte in due posti divergono, e quando divergono
> l'aggancio smette di funzionare senza che niente lo dica.

---

## 6. Collaudo, in questo ordine

```powershell
# a) il commerciale deve comportarsi ESATTAMENTE come prima — il punto più importante
.\Invoke-BIPipeline.ps1 -Profilo commerciale -ValidateOnly -SkipUpload

# b) trasporti, sola validazione
.\Invoke-BIPipeline.ps1 -Profilo trasporti -ValidateOnly -SkipUpload

# c) estrazione reale, ancora senza invio
.\Invoke-BIPipeline.ps1 -Profilo trasporti -SkipUpload

# d) run completo
.\Invoke-BIPipeline.ps1 -Profilo trasporti
```

Al punto (a) N deve restare **7**. Se cambia, fermarsi e ripristinare il backup.

**Prima del punto (d) mandami il CSV.** Voglio guardare le sei colonne nuove sui
dati veri prima che entrino in un cruscotto: in particolare quanti documenti
hanno `id_utente_crea` valorizzato e che aspetto hanno i valori di `generato_da`.

---

## 7. Cosa consegnare

1. L'output della query su `generato_da` del §2.
2. Il file `TRASPORTI_DOCUMENTI.sql` definitivo a 68 colonne.
3. Il CSV del backfill 2025 e quello della finestra a 90 giorni.
4. Conteggio righe per profilo e per anno, e **copertura di `id_utente_crea`**
   distinta fra `BC` e `BF`.
5. Il frammento di `config.json` e il comando del task pianificato, non applicati.

Se una query pesa troppo sul server, dillo e restringiamo il periodo: non
lanciarla in parallelo al run commerciale.
