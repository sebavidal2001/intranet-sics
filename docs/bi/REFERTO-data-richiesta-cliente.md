# Referto — `data_richiesta_cliente` in `preventivi_aperti`

> Destinatario: Codex.
> **Nessuna modifica applicata.** Valutazione d'impatto eseguita sulla VM Linux
> e sul PostgreSQL locale il 29 agosto 2026, leggendo codice e schema reali.
> Verdetto: **compatibile, con tre avvertenze** — una delle quali riguarda un
> nome che si incrocia con uno esistente.

---

## 1. Verdetto e le tre avvertenze

Il contratto a 32 colonne è applicabile. L'impatto è contenuto e localizzato.
Tre cose però vanno decise prima, non dopo.

### ⚠ A. Il nome si incrocia con una colonna che già esiste

Nella tabella raw, `data_documento` **non è** la data del documento: è la data
di **registrazione**. Viene dall'alias `data_registrazione` delle query
Windows, che il loader mappa su `"Data Documento"` e poi sulla colonna
`data_documento`.

Il campo nuovo viene invece da `dba.documento.data_documento` — cioè proprio da
quella colonna di SQL Anywhere che oggi *non* stiamo importando.

Quindi in tabella si troverebbero, una accanto all'altra:

| Colonna raw | Origine SQL Anywhere | Significato |
|---|---|---|
| `data_documento` | `documento.data_registrazione` | quando **noi** abbiamo registrato |
| `data_richiesta_cliente` | `documento.data_documento` | quando **il cliente** ha chiesto |

I due nomi si scambiano di posto rispetto alla sorgente. Chi un domani aprirà
`bi_documenti_raw` senza questo referto sotto mano leggerà `data_documento` e
penserà di avere la data del documento del gestionale — e sbaglierà.

**Il nome `data_richiesta_cliente` resta quello giusto**, perché descrive il
significato e non la provenienza. Ma va accompagnato da un `COMMENT ON COLUMN`
su entrambe, e la vista deve esporre `data_registrazione` con quel nome, non
con «Data Documento». Proposta in §5.

### ⚠ B. Esiste una terza copia della lista delle intestazioni

Oltre a quelle che ho appena unificato in `schemi_dataset.py`, in
`costruisci_storico.py` (righe 72-83) c'è `COL_PREVENTIVI`: 23 nomi, usata
**solo** per leggere lo storico 2013-2024.

```python
df_ps = read_csv_safe(F_PREVENTIVI_STO, sep=";", header=None, names=COL_PREVENTIVI)
```

**Non va unificata con il modulo condiviso.** Descrive un file che resterà a 23
colonne per sempre; il modulo descrive il CSV *corrente*, che diventerà 32. Se
qualcuno «completasse il refactoring» sostituendola con l'import, pandas
applicherebbe 32 nomi a 23 colonne e lo storico si romperebbe — o peggio, si
disallineerebbe in silenzio.

Aggiungerò un commento esplicito sopra `COL_PREVENTIVI` che dice perché resta
separata. È il tipo di trappola che si disinnesca solo scrivendola.

### ⚠ C. Il rollback su Supabase si rompe, se la DDL va solo sul locale

Se `bi_documenti_raw` guadagna la colonna **solo** sul PostgreSQL locale e poi
si torna a Supabase con `commuta-pipeline.sh supabase`, il loader riceverà CSV a
32 colonne e tenterà una `INSERT` su una tabella che ne ha 26: fallimento a ogni
run.

Due strade, da scegliere ora:

1. **Applicare la stessa `ALTER TABLE` anche su Supabase.** Costa una riga, tiene
   il rollback davvero disponibile. È quella che consiglio finché Supabase è la
   riserva dichiarata.
2. Accettare che il rollback comporti **anche** il ripristino della query
   Windows a 23 colonne. Più economico oggi, più fragile nel momento in cui
   servirà.

---

## 2. Componenti da aggiornare

Il numero di colonne è verificato in **quattro** punti indipendenti, e il numero
di righe in **due** ulteriori. Devono concordare tutti, o il run si ferma.

| # | Componente | File / oggetto | Cosa cambia | Chi |
|---|---|---|---|---|
| 1 | Query di produzione | `PREVENTIVI_APERTI.sql` su `SRVWOA` | +9 colonne, alias quotati | Codex |
| 2 | Manifest | `Get-CsvValidation` → `columns: 32` | automatico se la query cambia | Codex |
| 3 | **Configurazione receiver** | `/etc/impresa-bi/config.json` | `preventivi_aperti.columns` **23 → 32** | **Claude** |
| 4 | **Contratto canonico** | `/opt/impresa-bi/schemi_dataset.py` | `PREVENTIVI_HEADERS` 23 → 32 voci | **Claude** |
| 5 | **Loader** | `supabase_loader.py` → `row_to_record` | 9 nuove voci, con `.get()` | **Claude** |
| 6 | **Tabella raw** | `public.bi_documenti_raw` | `ALTER TABLE ADD COLUMN` ×9 | **Claude** |
| 7 | Viste BI | `powerbi.bi_preventivi_aperti` | **nessuna modifica** | — |
| 8 | Viste nuove | `powerbi.bi_preventivi_tempi` | da creare | **Claude** |
| 9 | `prepare_current.py` | — | **nessuna**, eredita dal modulo | — |
| 10 | `costruisci_storico.py` | — | **nessuna** (vedi §3) | — |
| 11 | `publish_complete_run.py` | — | **nessuna**, riusa `read_dataset` | — |
| 12 | `aggiorna_forecast.py` | — | **nessuna**, legge solo aggregati | — |

### Dove il numero di colonne viene controllato

| Punto | File | Riga | Controllo |
|---|---|---|---|
| Windows | `Invoke-BIPipeline.ps1` | — | dichiara `columns` nel manifest |
| Receiver | `receiver.py` | 144, 429 | `len(fields) != expected_columns` e `columns != definition["columns"]` |
| Loader | `supabase_loader.py` | 156 | `len(values) != len(expected_headers)` |
| Preparazione | `prepare_current.py` | 87 | `len(row) != len(headers)` |

### Dove il numero di righe viene controllato

| Punto | Oggetto | Controllo |
|---|---|---|
| Database | `bi_activate_run` | conteggio manifest ↔ righe in `bi_documenti_raw` |
| Linux | `publish_complete_run.py` righe 248-251 | rilegge i CSV e confronta col manifest |

Nota su `publish_complete_run.py`: rilegge i CSV **solo per verificare i
conteggi**, non per inserirli. Eredita quindi automaticamente le modifiche al
loader: non va toccato.

---

## 3. Perché `costruisci_storico.py` non va toccato

`carica_pipeline()` fa:

```python
df_ps = read_csv_safe(F_PREVENTIVI_STO, sep=";", header=None, names=COL_PREVENTIVI)  # 23 col
df_pc = read_csv_safe(F_PREVENTIVI_COR, sep=";", header=0)                            # 32 col
df_prev = pd.concat([df_ps, df_pc], ignore_index=True)
```

Il `concat` produce l'unione delle colonne, con `NaN` nelle nove che lo storico
non ha. Poi usa **solo cinque colonne**, tutte per nome e tutte presenti in
entrambi: `"Data Documento"`, `"Importo Inevaso"`, `"Importo Evaso"`,
`"Causale Magazzino Descrizione"`, `"Gruppo Descrizione"`.

Le colonne nuove vengono lette e ignorate. Nessuna modifica necessaria — a
condizione che `COL_PREVENTIVI` resti a 23 (§1.B).

---

## 4. Tipo PostgreSQL consigliato

**`timestamp without time zone`, nullable, senza `CHECK`.**

| Motivo | Dettaglio |
|---|---|
| Coerenza | Le altre tre colonne data della tabella (`data_documento`, `data_consegna_richiesta`, `data_consegna_confermata`) sono già `timestamp without time zone` |
| Fedeltà | La sorgente è `timestamp`. Dichiararla `date` significherebbe **troncare al caricamento** — cioè correggere il valore sorgente, che hai escluso al punto 6 |
| Robustezza | «Normalmente contiene solo la data» è un'osservazione sui dati di oggi, non una garanzia del gestionale. Con `date`, il giorno che arriva un orario lo si perde senza accorgersene |
| Anomalie | **Verificato**: `'2202-05-13'::timestamp` è accettato senza errore. L'intervallo di PostgreSQL arriva al 294276 d.C. |

**Nessun vincolo di intervallo.** Un `CHECK (data_richiesta_cliente > '2000-01-01')`
farebbe fallire l'intero caricamento sulla riga con l'anno 2202 — e il tuo punto
6 dice l'opposto: le anomalie si segnalano, non si respingono. Restano dati
grezzi; è la vista a giudicarli.

Le altre otto colonne, per completezza:

```sql
id_utente_creatore       integer
codice_utente_creatore   text
utente_creatore          text
data_creazione_documento timestamp without time zone
id_sog_commerciale       integer
id_destinazione          integer
id_documento             integer
id_riga_documento        integer
```

Tutte **nullable**: la tabella è condivisa fra i sette dataset, e gli altri sei
non le valorizzeranno.

> [!info] Costo in spazio: trascurabile
> La mappa a bit dei null passa da 26 a 35 attributi, cioè da 4 a 5 byte —
> assorbiti dall'allineamento a 8 dell'intestazione di riga. **I dataset che non
> usano le colonne nuove non pagano nulla.** Per `preventivi_aperti` (~6.500
> righe per run) il costo è ~90 byte per riga, cioè **0,6 MB per run**.

---

## 5. Vista per Power BI

Il calcolo è per `id_documento`, non per riga: un preventivo con dodici articoli
conta **una volta**.

```sql
-- Bozza. NON applicata.
create view powerbi.bi_preventivi_tempi with (security_invoker = true) as
with per_documento as (
    -- Un preventivo ha N righe articolo, ma data di richiesta e di
    -- registrazione sono attributi della TESTATA: identiche su tutte le righe.
    -- distinct on prende la prima riga di ogni documento senza aggregare.
    select distinct on (d.id_documento)
           d.id_documento,
           d.numero_documento,
           d.profilo_documento,
           d.data_documento          as data_registrazione,
           d.data_richiesta_cliente,
           d.codice_cliente,
           d.nome_cliente,
           d.codice_agente,
           d.agente,
           d.utente_creatore
      from public.bi_documenti_raw d
      join public.bi_runs r using (run_id)
     where r.status = 'current'
       and d.dataset = 'preventivi_aperti'
       and d.id_documento is not null
     order by d.id_documento, d.row_number
),
classificata as (
    select p.*,
           case
             when p.data_richiesta_cliente is null              then 'assente'
             when p.data_richiesta_cliente <  timestamp '2000-01-01'
               or p.data_richiesta_cliente >  now() + interval '1 year'
                                                                then 'fuori_intervallo'
             when p.data_registrazione is null                  then 'registrazione_assente'
             when p.data_richiesta_cliente > p.data_registrazione
                                                                then 'successiva_alla_registrazione'
             else 'valida'
           end as esito_controllo
      from per_documento p
)
select
    id_documento,
    numero_documento                            as "Numero Doc.",
    profilo_documento                           as "Profilo Documento",
    codice_cliente                              as "Codice Cliente",
    nome_cliente                                as "Nome Cliente",
    codice_agente                               as "Codice Agente",
    agente                                      as "Agente",
    utente_creatore                             as "Creato da",

    -- Valori sorgente, mai modificati.
    data_richiesta_cliente                      as "Data Richiesta Cliente",
    data_registrazione                          as "Data Registrazione",

    -- Giorni fra la richiesta del cliente e la nostra registrazione.
    -- NULL quando la data non e' attendibile: un preventivo datato 2202
    -- produrrebbe -64.000 giorni e avvelenerebbe qualsiasi media. Le date
    -- grezze restano comunque esposte qui sopra.
    case when esito_controllo = 'valida'
         then (data_registrazione::date - data_richiesta_cliente::date)
    end                                         as "Giorni Risposta",

    (esito_controllo = 'valida')                as "Data Richiesta Valida",
    (esito_controllo in ('fuori_intervallo',
                         'successiva_alla_registrazione'))
                                                as "Data Richiesta Anomala",
    esito_controllo                             as "Esito Controllo Data"
  from classificata;

grant select on powerbi.bi_preventivi_tempi to powerbi_reader;
```

### Perché `esito_controllo` e non due soli booleani

I due flag che hai chiesto ci sono. Ma «anomala» mette insieme casi diversi:
una data del 2202 è un errore di battitura, una richiesta *successiva* alla
registrazione può essere una prassi legittima che non conosciamo ancora.

`esito_controllo` distingue i quattro casi senza costringere nessuno a
indovinare, e Power BI può filtrarci sopra. Se preferisci solo i due booleani,
si toglie una riga.

### Corrispondenza con le tue evidenze

Il campione che hai misurato dovrebbe distribuirsi così:

| Tuo dato | `esito_controllo` atteso |
|---|---|
| 424 senza `data_documento` | `assente` |
| 2.627 uguali alla registrazione | `valida`, «Giorni Risposta» = 0 |
| 243 precedenti alla registrazione | `valida`, «Giorni Risposta» > 0 |
| 121 successive alla registrazione | `successiva_alla_registrazione` |
| anno 2202 | `fuori_intervallo` |

**Da confermare dopo il primo run reale**: se i numeri non tornano, la soglia o
la classificazione vanno riviste — non i dati.

> [!warning] Una decisione che tocca a te, non al codice
> I 121 «successivi alla registrazione» sono un errore di inserimento o una
> pratica reale (per esempio la data di consegna desiderata usata al posto della
> data di richiesta)? La vista li segnala e basta. Se scoprissi che sono
> legittimi, cambia la classificazione, non il dato.

---

## 6. Compatibilità con locale e Supabase

| Aspetto | Locale (primario) | Supabase (riserva) |
|---|---|---|
| `ALTER TABLE ADD COLUMN` nullable | istantanea, non riscrive la tabella (PG 17) | idem |
| Viste esistenti | **intatte**: elencano colonne esplicite, mai `SELECT *` | idem |
| Policy RLS `powerbi_current_documents` su raw | non toccata: filtra per `run_id`, non per colonna | idem |
| `bi_activate_run` | non guarda le colonne, solo i conteggi di riga | idem |
| Rollback della pipeline | **funziona solo se la DDL è su entrambi** — §1.C | — |

Verificato sul locale: tutte le viste `powerbi.*` e `public.bi_*` proiettano
liste esplicite di colonne. Aggiungere colonne alla tabella sottostante è
invisibile ai PBIX esistenti.

---

## 7. Ordine di rilascio e rollback

Ogni passo è reversibile da solo, e nessuno rompe quello prima.

| # | Passo | Rollback |
|---|---|---|
| 1 | `ALTER TABLE` sul **locale** e su **Supabase** — 9 colonne nullable | `DROP COLUMN`; nessun dato perso, sono vuote |
| 2 | `COMMENT ON COLUMN` su `data_documento` e `data_richiesta_cliente` (§1.A) | irrilevante |
| 3 | `schemi_dataset.py`: `PREVENTIVI_HEADERS` a 32 | file di backup accanto |
| 4 | `supabase_loader.py`: 9 voci in `row_to_record`, tutte con `.get()` | idem |
| 5 | Commento su `COL_PREVENTIVI` (§1.B) | irrilevante |
| 6 | `config.json`: `preventivi_aperti.columns` 23 → 32 + reload receiver | valore precedente |
| 7 | Query Windows a 32 colonne | ripristino della query |
| 8 | **Un run controllato**, conteggi confrontati con il cloud | i passi 3-7 tornano indietro insieme |
| 9 | Vista `powerbi.bi_preventivi_tempi` | `DROP VIEW` |

> [!warning] I passi 3-4-6-7 vanno insieme
> Sono i quattro punti che controllano il numero di colonne. Applicarne tre su
> quattro produce un fallimento netto al primo run — rumoroso, quindi non
> pericoloso, ma è una notte di dati persa. **Non separarli fra due giornate.**

Il passo 1 può precedere di giorni: nove colonne nullable e vuote non disturbano
nessuno, e averle già in tabella riduce la finestra in cui tutto deve combaciare.

---

## 8. Riepilogo per la tua parte

**Confermo il contratto a 32 colonne**, con l'ordine che hai definito: 23
storiche → `data_richiesta_cliente` → 4 creatore → 4 chiavi tecniche.

Concordo sulla rimozione delle cinque colonne di provenienza dai preventivi: il
preventivo è la radice della filiera, e portarsi dietro un `id_riga_provenienza`
sempre nullo sarebbe peso senza informazione. Resteranno in `filiera_righe`, dove
hanno senso.

Ricordo i tre nomi che fanno fallire il confronto se sbagliati di un carattere —
`"Quantità"` con l'accento, `"Numero Doc."` col punto, `"Descrizione articolo"`
con la minuscola — e aggiungo che l'alias della colonna nuova deve essere
esattamente `"Data Richiesta Cliente"` se vuoi che il tracciato resti leggibile
come gli altri. Dimmi tu il nome esatto: è il tuo contratto, io lo recepisco.

Resto in attesa della tua approvazione prima di applicare qualunque passo.

---

## Collegato a

- [`PROMPT-CODEX-windows-v2-e-backup.md`](PROMPT-CODEX-windows-v2-e-backup.md)
- [`REVISIONE-PIANO-BI-V2.md`](REVISIONE-PIANO-BI-V2.md)
- [`../db-migrazione/OPERATIVITA-DB-VM.md`](../db-migrazione/OPERATIVITA-DB-VM.md)
