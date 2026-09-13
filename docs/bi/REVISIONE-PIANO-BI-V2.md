# Revisione del piano Pipeline BI V2

> Destinatario: Codex. Risponde alle correzioni richieste dopo il Referto V2.
> Stato: **revisione da approvare**. Nessuna migration, cancellazione, `VACUUM`,
> deploy o restart è stato eseguito o è autorizzato da questo documento.
> Data: 29 agosto 2026 · repo `intranet-sics` @ `06b2408`

Sostituisce le sezioni 5–9 del Referto V2. Tutto il resto resta valido (§8).

---

## 1. Le nove correzioni

| # | Correzione | Esito |
|---|---|---|
| 1 | Retention a 3 run, non 7 | **Accolta** → §3. Proiezione a 36 mesi da ~624 a ~527 MB |
| 2 | Il loader non salta l'header | **Corroborata**: sulla VM esiste `supabase_loader.py.before-header-fix-20260726-182633` — il nome del backup conferma la correzione descritta |
| 3 | Visite come snapshot integrale con marcatura logica | **Accolta** → §5 |
| 4 | Tkinter locale come interfaccia definitiva | **Presa d'atto** → §6 |
| 5 | `filiera_righe` a 7 colonne con `tipo_registro` | **Errore mio** → §2 |
| 6 | Classificazione su `tipo_registro`, non su profili ipotetici | **Errore mio** → §2 |
| 7 | `importo_visita` non aggregabile | **Accolta** → §5 |
| 8 | Accesso PBIX a raw da certificare prima di revocare | **Accolta**: resta al passo 9 del rollout |
| 9 | Nessuna autorizzazione a retention, `VACUUM FULL`, migration, deploy | **Rispettata** |

### Sui punti 5 e 6 — avevo torto, e l'errore era peggiore di una svista

Avevo scritto `profilo_documento in ('FT','FTA')` e `= 'DDT'` **inventando codici
plausibili invece di verificarli**. I dati reali dicono `BC` / `DV` per i DDT e
`FC` / `IV` per le fatture.

Non è una correzione cosmetica: la query di §4.9 del referto, eseguita così com'era,
**avrebbe restituito zero righe**, e la copertura della filiera sarebbe sembrata
un problema di dati anziché un errore di chi ha scritto la query.

`tipo_registro` diventa il classificatore primario; il profilo si conserva come dato.

---

## 2. Filiera — DDL e query corrette

```sql
-- Bozza. NON applicare.
create table bi.filiera_righe (
  id_riga_documento   integer primary key,
  id_documento        integer not null,
  codice_profilo      text    not null,   -- PC, PCA, OC, OCA, OCB, BC, FC, ...
  tipo_registro       text,               -- DV = doc. di vendita, IV = fattura, ...
  numero_documento    text,
  data_documento      date,
  id_riga_provenienza integer,            -- null = radice della catena
  ultimo_visto_run    text not null,
  aggiornato_il       timestamptz not null default now()
);

create index filiera_prov_idx on bi.filiera_righe (id_riga_provenienza)
  where id_riga_provenienza is not null;
create index filiera_reg_idx  on bi.filiera_righe (tipo_registro, data_documento desc);
create index filiera_doc_idx  on bi.filiera_righe (id_documento);
```

Le 7 colonne del contratto CSV, più due di servizio scritte dal caricamento e non
dal gestionale.

### Categoria documentale — da tabella, non da costanti nel codice

Dato che i codici veri non erano indovinabili, la mappatura non va scritta dentro
le query: va in una tabellina, così una categoria nuova è una riga e non una
migration.

```sql
-- Bozza. NON applicare. Popolare con i codici REALI verificati sul gestionale.
create table bi.categorie_documento (
  tipo_registro  text,
  codice_profilo text,
  categoria      text not null,   -- preventivo | ordine | ddt | fattura | nota_credito | altro
  livello_atteso smallint,        -- ordinamento logico della filiera
  primary key (tipo_registro, codice_profilo)
);
-- Esempi dai dati osservati; l'elenco completo va estratto dal gestionale:
--   ('DV','BC','ddt',3)  ('IV','FC','fattura',4)
--   (null,'PC','preventivo',1)  (null,'OC','ordine',2)
```

### Query tipo — fattura → DDT → ordine → preventivo

```sql
with recursive catena as (
  select f.id_riga_documento as riga_foglia,
         f.id_riga_documento, f.id_riga_provenienza,
         f.codice_profilo, f.tipo_registro, f.numero_documento, f.data_documento,
         0 as livello,
         array[f.id_riga_documento] as visitati
    from bi.filiera_righe f
    join bi.categorie_documento c
      on c.tipo_registro is not distinct from f.tipo_registro
     and c.codice_profilo = f.codice_profilo
   where c.categoria = 'fattura'
  union all
  select c.riga_foglia,
         p.id_riga_documento, p.id_riga_provenienza,
         p.codice_profilo, p.tipo_registro, p.numero_documento, p.data_documento,
         c.livello + 1,
         c.visitati || p.id_riga_documento
    from catena c
    join bi.filiera_righe p on p.id_riga_documento = c.id_riga_provenienza
   where c.livello < 6                                -- guardia di profondita'
     and not (p.id_riga_documento = any(c.visitati))  -- protezione dai cicli
)
select ca.riga_foglia,
       max(case when cat.categoria='preventivo' then ca.numero_documento end) as preventivo,
       max(case when cat.categoria='preventivo' then ca.data_documento   end) as data_preventivo,
       max(case when cat.categoria='ordine'     then ca.numero_documento end) as ordine,
       max(case when cat.categoria='ddt'        then ca.numero_documento end) as ddt,
       max(ca.livello) as passaggi
  from catena ca
  join bi.categorie_documento cat
    on cat.tipo_registro is not distinct from ca.tipo_registro
   and cat.codice_profilo = ca.codice_profilo
 group by ca.riga_foglia;
```

Due differenze oltre ai codici:

- `is not distinct from` perché `tipo_registro` è **nullo** per preventivi e ordini;
- l'array `visitati` rende la protezione dai cicli effettiva invece che solo
  dichiarata — la sola guardia di profondità limita il danno, non lo evita.

Il 3,6% fuori filiera (acconti, note di credito) entra con
`id_riga_provenienza is null`: **non è un'eccezione da classificare, è la radice
di una catena lunga uno.**

---

## 3. Retention a 3 run — anteprima reale

Anteprima eseguita **in sola lettura** sul database di produzione il 29/08/2026.
È l'elenco esatto richiesto prima di autorizzare qualunque cancellazione.

| Misura | Valore |
|---|---:|
| Run conservati | **3** |
| Run da eliminare | **26** |
| Righe conservate | 197.789 |
| Righe eliminate | **1.689.491** |
| Pagine liberate | ~530 MB |

### Run conservati e perché

| `run_id` | Stato | Ricevuto | Protetto da | Righe |
|---|---|---|---|---:|
| `20260829_013001` | current | 2026-08-28 | `bi_runs.current` + puntatore daily + fra i 3 più recenti | 66.068 |
| `20260828_013001` | archived | 2026-08-27 | **puntatore forecast** + fra i 3 più recenti | 65.963 |
| `20260827_013001` | archived | 2026-08-26 | fra i 3 più recenti | 65.758 |

I 26 da eliminare vanno da `20260826_013001` a `20260726_194620`, tutti
`archived`, 63.013–65.635 righe ciascuno, **nessun puntatore che li referenzi**.

> [!warning] Il puntatore forecast è già oggi il caso limite
> `current_forecast_run_id` punta a `20260828_013001`: oggi rientra fra i tre più
> recenti **per caso**, perché il forecast è girato giovedì notte. Ma il timer è
> settimanale — il giovedì successivo quel puntatore avrà sei giorni e sarebbe
> fuori dai primi tre. Una retention basata solo sull'anzianità **cancellerebbe
> il run su cui poggia il forecast pubblicato**. La query qui sotto lo impedisce
> per costruzione.

### Query di anteprima — read-only, da rieseguire e allegare ogni volta

```sql
-- SOLO LETTURA. Da rieseguire prima di ogni cancellazione.
with protetti as (
  select run_id, 'bi_runs.current' as motivo
    from public.bi_runs where status = 'current'
  union select current_daily_run_id,    'puntatore daily'
    from public.bi_publication_state where current_daily_run_id    is not null
  union select current_forecast_run_id, 'puntatore forecast'
    from public.bi_publication_state where current_forecast_run_id is not null
  union select run_id, 'fra i 3 piu recenti'
    from (select run_id from public.bi_runs order by received_at desc limit 3) t
), agg as (
  select run_id, string_agg(distinct motivo, ' + ') as motivi
    from protetti group by run_id
)
select r.run_id, r.status, r.received_at::date as ricevuto,
       coalesce(a.motivi, '--') as protetto_da,
       case when a.run_id is null then 'ELIMINA' else 'TIENI' end as esito,
       (select count(*) from public.bi_documenti_raw d where d.run_id = r.run_id) as righe_raw
  from public.bi_runs r
  left join agg a using (run_id)
 order by r.received_at desc;
```

Quando arriverà il puntatore per dataset (D3), la CTE `protetti` guadagna un ramo
su `bi_dataset_pubblicato` e nient'altro cambia.

> [!warning] La funzione di retention deve chiamare **questa stessa CTE**, non
> riscriverla. Due definizioni della stessa regola divergono, ed è il tipo di
> divergenza che si scopre cancellando qualcosa che serviva.

### Backup logico dei metadati, prima della cancellazione

Manifest, stato e metadati dei run eliminati pesano pochi kB e vanno salvati
**prima**, in una tabella che la retention non tocca:

```sql
-- Bozza. NON applicare.
create table public.bi_runs_storico (
  run_id text primary key, source text, source_completed_at timestamp,
  received_at timestamptz, activated_at timestamptz, status text,
  manifest jsonb, daily_manifest jsonb, forecast_manifest jsonb,
  righe_per_dataset jsonb,        -- conteggi al momento della cancellazione
  eliminato_il timestamptz not null default now()
);
```

Resta la storia di cosa è stato pubblicato e quando, senza i 20 MB di righe per
run. I dati non tornano; la loro tracciabilità sì.

### Ordine dei DELETE

```sql
-- Bozza. NON applicare. L'ordine rispetta le FK verso bi_runs, che restano RESTRICT.
delete from public.bi_documenti_raw        where run_id = any($1);
delete from public.bi_aggregati_mensili    where run_id = any($1);
delete from public.bi_forecast_righe       where run_id = any($1);
delete from public.bi_forecast_cv          where run_id = any($1);
delete from public.bi_processing_manifests where run_id = any($1);
delete from public.bi_runs                 where run_id = any($1);
```

**Prima esecuzione a lotti**, qualche run per volta, con il conteggio verificato
dopo ognuno: 1,69 milioni di righe in una transazione sola generano molto WAL e
tengono lock a lungo su un'istanza condivisa. A regime, dentro il run notturno,
sarà un run per volta e la questione non si pone.

---

## 4. Recuperare lo spazio fisico — procedura separata

> [!info] Il DELETE da solo trasforma una crescita in un tetto
> Cancellare non restituisce i file al sistema, ma libera ~530 MB di **pagine
> dentro la tabella**, che autovacuum rende riutilizzabili. I run successivi
> (~24 MB al giorno) le riempiono invece di allungare il file. Con la retention
> attiva a regime, ogni giorno se ne libera uno e se ne scrive uno: **il file
> resta a 700 MB e non cresce più**.
>
> Il DELETE ferma l'emorragia da solo. Il `VACUUM FULL` serve a **rientrare**
> sotto i 500 MB, non a smettere di sfondarli — ed è una differenza che cambia la
> fretta con cui va fatto.

### Vincoli reali su Supabase gestito

- **`VACUUM FULL` non può girare dentro una transazione.** Non può stare in un
  file di migration né passare da strumenti che avvolgono tutto in un `BEGIN`.
  Serve una sessione autonoma: `psql` via **Session Pooler**, non Transaction
  Pooler.
- **`ACCESS EXCLUSIVE` per tutta la durata**: blocca anche le viste Power BI e la
  pipeline. Su ~170 MB residui sono minuti, non ore, ma vanno presi in una
  finestra dichiarata — non fra le 01:30 e le 03:00.
- **Spazio temporaneo** pari alla tabella risultante (~170 MB), non a quella
  attuale. Con 836 MB già occupati su un'istanza free, il picco va verificato.
- **`pg_repack` non è disponibile** sul piano free: l'alternativa a lock breve
  non c'è.
- Reindicizzare a parte è inutile: `VACUUM FULL` ricostruisce già gli indici.

### La terza strada

Se il database si sposta sulla VM nelle prossime settimane, **il `VACUUM FULL`
diventa lavoro sprecato**: un `pg_dump` dei soli 3 run conservati, ripristinato
sulla macchina nuova, produce una tabella compatta per costruzione — senza lock,
senza finestra, senza rischio.

**Ordine consigliato:** DELETE ora (ferma la crescita, nessun lock lungo), poi
decidere sul `VACUUM FULL` in base a quanto è vicina la migrazione. Se è a mesi,
si fa. Se è a settimane, si aspetta.

---

## 5. Contratto CSV aggiornato

| Dataset | Gruppo | Col. | Composizione | Caricamento |
|---|---|---:|---|---|
| `ordinato` | commerciale | **25** | 17 legacy + 4 creatore + 4 identità | Snapshot per run |
| `preventivi_aperti` | commerciale | **31** | 23 legacy + 4 creatore + 4 identità | Snapshot per run |
| `fatturato` | commerciale | **21** | 17 legacy + 4 identità | Snapshot per run |
| `consegnato` | commerciale | **21** | 17 legacy + 4 identità | Snapshot per run |
| `consegnato_futuro_per_mese` | commerciale | 17 | invariato (aggregato) | Snapshot per run |
| `controllo_banco` | commerciale | 17 | invariato | Snapshot per run |
| `portafoglio` | commerciale | 17 | invariato (aggregato) | Snapshot per run |
| `filiera_righe` | **filiera** | **7** | con `tipo_registro` | Upsert su tabella corrente |
| `clienti_destinazioni` | **crm** | 13 | invariato | Upsert + marcatura assenti |
| `visite` | **crm** | 11 | storico integrale, nessun filtro data | Upsert + marcatura assenti |
| `utenti_gestionale` | **crm** | 4 | invariato | Upsert |
| `cruscotto_articoli` | cruscotto | 40 | invariato | Staging + ingest atomico |

**Colonne d'identità** (sui quattro fatti documentali):
`id_sog_commerciale`, `id_destinazione`, `id_documento`, `id_riga_documento`.

**Colonne creatore** (solo `ordinato` e `preventivi_aperti`):
`id_utente_creatore`, `codice_utente_creatore`, `utente_creatore`,
`data_creazione_documento`.

Le quattro `*_origine` sono rimosse dal contratto: derivabili risalendo la filiera.

### Test da rifare

Il test TOP 20 già superato va ripetuto su 25 e 31 colonne, e aggiunto per
`filiera_righe`, `fatturato` e `consegnato`.

> [!warning] Il test che conta più degli altri
> **Un CSV senza header la cui prima riga dati ha `gruppo_codice` nel primo campo
> dev'essere caricata come dato.** È l'unico test che distingue il confronto
> sull'intera riga da quello sul primo campo — cioè la regola corretta da quella
> fragile.

### Visite — snapshot integrale

```sql
-- Bozza. NON applicare.
create table bi.visite (
  id_visita           integer primary key,
  id_sog_commerciale  integer not null,
  id_destinazione     integer,
  data_visita         date not null,
  codice_grado_visita text,
  grado_visita        text,
  settimana_ripasso   integer,
  mese_ripasso        integer,
  anno_ripasso        integer,
  importo_visita      numeric,   -- SIGNIFICATO DA CONFERMARE: non aggregare
  note_azienda        text,
  ultimo_visto_run    text not null,
  assente_dal_run     text,      -- valorizzato quando sparisce dalla sorgente
  aggiornato_il       timestamptz not null default now()
);

comment on column bi.visite.importo_visita is
  'Campo grezzo dba.visita.importo. Significato funzionale NON confermato:
   non sommare, non mediare, non usare in KPI. Solo dettaglio.';

create index visite_cliente_data_idx on bi.visite (id_sog_commerciale, data_visita desc)
  where assente_dal_run is null;
```

- La **marcatura di assenza avviene dopo** la conclusione atomica del run, mai
  durante: un run interrotto a metà marcherebbe come sparite le visite che non ha
  ancora letto.
- Le viste Power BI ordinarie filtrano `assente_dal_run is null`; una vista
  separata le espone per chi deve indagare le cancellazioni.
- **Nessun hard-delete** prima di aver definito il significato delle cancellazioni
  nel gestionale.
- **Sul join: 801 visite su 820 non hanno destinazione.** La chiave verso i clienti
  è `id_sog_commerciale` **da solo**. Usare la coppia con la destinazione farebbe
  agganciare il 2% delle visite, e sembrerebbe un problema di dati.
- Indicatori derivati (numero visite, ultima visita, giorni) **solo in vista**.
  `clienti_master.visite_n` e `visite_n_meno_1` sono l'anti-pattern da ritirare.

---

## 6. Interfaccia manuale — nota tecnica

Presa d'atto: Tkinter locale, avviato da `.bat`, niente pagina intranet.

> [!warning] La selezione fine dipende da D3, non dalla GUI
> La richiesta «solo `ordinato` e `portafoglio`» oggi è **impossibile a valle**, e
> non per limiti dell'interfaccia: `bi_activate_run` pretende 7 dataset e archivia
> il run precedente per intero, quindi un parziale renderebbe **vuote** le altre
> cinque viste.
>
> Finché il puntatore per dataset non è in produzione, le caselle selezionabili
> restano due — commerciale e Cruscotto. Conviene **costruire la GUI dopo D3**, o
> costruirla subito con due caselle e aggiungere le altre quando il database le
> supporta. Costruirla ora con sette caselle che non funzionano è il modo peggiore.

Nota minore ma da mettere nel disegno: la GUI deve rispettare `pipeline.lock`
sulla VM Windows e `daily.lock` / `weekly.lock` su Linux — **tre lock diversi su
due macchine**. L'interfaccia deve saper dire *quale* dei tre l'ha fermata, o
l'utente vedrà solo «non è partito».

---

## 7. Ricognizione VM — fatto e mancante

Con la VPN attiva, `srv-intranet` è stata ispezionata il 29/08/2026.

### Confermato leggendo la macchina

| Punto | Evidenza |
|---|---|
| La patch profili Fase 4 **è in produzione** | `receiver.py:156` → `fields[0] in set(header_fields or HEADER_FIELDS_DEFAULT)`; `receiver.py:90` → `HEADER_FIELDS_DEFAULT = ("Codice Gruppo", "gruppo_codice")` |
| Il receiver legge già **difensivamente il BOM** | `receiver.py:140` → `encoding="utf-8-sig"`. Un pezzo in meno da aggiungere |
| Timer forecast corretto | `OnCalendar=Fri *-*-* 03:30:00 Europe/Rome`, `Persistent=true`. Prossimo 4 set, ultimo 28 ago. **Il fuso è dichiarato nella unit**, quindi non slitta al cambio ora legale anche se il sistema è su UTC |
| Sequenza giornaliera | `impresa-bi-daily.path` su `/var/lib/impresa-bi/ready` → `daily.service` → `run_daily.py`, utente `impresa-bi`, `TimeoutStartSec=45min`, unit irrobustita (`ProtectHome`, `PrivateTmp`, `NoNewPrivileges`) |
| La correzione header del loader **è avvenuta** | Esiste `supabase_loader.py.before-header-fix-20260726-182633` |
| Code di lavoro vuote | `incoming`, `ready`, `processed`, `failed` e varianti Cruscotto: 0 elementi. Nessun run bloccato |
| **Nessuna retention pianificata** | `crontab -l` vuoto per `intra-adm`; `/etc/cron.d` contiene solo `e2scrub_all` e `sysstat`. Confermato il sospetto del referto |
| Capacità | 2 vCPU, 7,8 GB RAM (5,9 disponibili), 182 GB liberi su 204, load 0,18, uptime 25 giorni |

### Perché la ricognizione è incompleta

`supabase_loader.py` è `-rwxr-x--- root:impresa-bi` e `/opt/impresa-bi/forecasting/`
è `drwxr-x--- root:impresa-bi`. L'utente `intra-adm` è nel gruppo `sudo` ma
**`sudo` richiede la password**. Gli script Python e `config.json` restano non letti.

### I comandi che restano da eseguire — tutti in sola lettura

Da lanciare su `srv-intranet` con `sudo`. Nessuno scrive, nessuno riavvia,
nessuno mostra segreti: i comandi 5 e 9 stampano **solo i nomi** delle chiavi.

```bash
# 1 — Come il loader legge i CSV (il punto che decide la compatibilita' V2)
sudo grep -n "read_csv\|header\|names=\|utf-8\|delimiter\|sep=\|BOM" \
     /opt/impresa-bi/supabase_loader.py

# 2 — Quali funzioni DB chiama, e in che ordine
sudo grep -n "rpc(\|bi_activate\|post(\|/rest/v1" \
     /opt/impresa-bi/supabase_loader.py

# 3 — Le stesse letture negli script del forecasting
sudo grep -n "read_csv\|header=\|names=\|encoding" \
     /opt/impresa-bi/forecasting/prepare_current.py \
     /opt/impresa-bi/forecasting/costruisci_storico.py

# 4 — Sequenza e lock effettivi del giornaliero
sudo grep -n "flock\|daily.lock\|prepare_current\|costruisci_storico\|publish_complete\|json" \
     /opt/impresa-bi/forecasting/run_daily.py

# 5 — Dataset configurati: SOLO nomi e colonne attese, nessun token
sudo python3 -c "import json;d=json.load(open('/etc/impresa-bi/config.json'))['datasets'];\
[print(k, v.get('columns'), v.get('profile','commerciale'), v.get('header_first_field')) \
 for k,v in sorted(d.items())]"

# 6 — Retention sui file: quanto e' rimasto indietro
sudo du -sh /var/lib/impresa-bi/* 2>/dev/null
sudo ls /var/lib/impresa-bi/forecasting/runs | wc -l
sudo du -sh /var/lib/impresa-bi/forecasting/runs /var/lib/impresa-bi/forecasting/storici

# 7 — Gli storici 2013-2024: ci sono e quanto pesano
sudo ls -la /var/lib/impresa-bi/forecasting/storici/

# 8 — Log: crescita e rotazione
sudo journalctl -u impresa-bi-daily --since "7 days ago" --no-pager | tail -40
journalctl --disk-usage

# 9 — Nomi delle variabili d'ambiente, MAI i valori
sudo grep -oE '^[A-Z_]+' /etc/impresa-bi/supabase.env | sort

# 10 — Nessun'altra pianificazione nascosta
sudo crontab -l; sudo ls -la /etc/cron.*/ ; systemctl list-timers --all --no-pager
```

Con gli output di **1, 3 e 4** si chiude definitivamente la compatibilità duale
header/no-header; con **6, 7 e 8** la retention sui file Linux, l'ultimo punto
rimasto «non verificato» nel referto.

---

## 8. Cosa resta invariato dal Referto V2

- **Il piano di rollout in 9 passi**, con la doppia scrittura di `bi_runs.status`
  ai passi 3–9. Il passo 1 diventa l'esecuzione dei dieci comandi di §7.
- **Tabelle separate per `clienti_destinazioni`** e divieto di sincronizzare
  `clienti_master`.
- **Le 4 colonne d'identità nei fatti** e la rimozione delle `*_origine`.
- **Puntatore per dataset + gruppi transazionali** per i run parziali, con la
  trappola della retention che ora la query di §3 gestisce.
- **`bi.utenti_gestionale`** separata da `public.utenti`.
- **I 12 test di accettazione**, con l'aggiunta del test sui codici reali
  `BC`/`DV` e `FC`/`IV` al posto di quelli inventati.

> [!info] Una decisione che il contesto ha cambiato
> Il vincolo «zero euro, niente Pro» rendeva la proiezione a 36 mesi il problema
> aperto del referto. Con la migrazione del database sulla VM sul tavolo — 182 GB
> liberi, nessuna quota — **quel problema si scioglie per un'altra via**. Se la
> migrazione procede, la scelta fra 3 e 7 run smette di essere dettata dallo
> spazio e torna a essere dettata da quanti rollback si vogliono avere. Vale la
> pena rileggerla allora, non ora: **oggi 3 è la scelta giusta**.

---

## Collegato a

- [`docs/db-migrazione/PIANO-MIGRAZIONE-DB-VM.md`](../db-migrazione/PIANO-MIGRAZIONE-DB-VM.md)
- [`docs/bi/fase4/README.md`](fase4/README.md) — receiver a profili
- [`docs/bi/fase5/README.md`](fase5/README.md) — pacchetto server Windows
- [`docs/bi/PROMPT-CODEX-fase7-aggiornamenti-on-demand.md`](PROMPT-CODEX-fase7-aggiornamenti-on-demand.md)
