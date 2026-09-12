# BI Direzionale — dal prototipo alla produzione

> Documento di piano. Redatto il **12/09/2026** dopo l'approvazione del progetto.
> Sostituisce operativamente `prototipo-bi/NON-IN-PRODUZIONE.md`, che resta valido
> fino alla Fase 0 compresa.

## Decisioni prese

| Tema | Decisione |
|---|---|
| Perimetro utenti | **Potenzialmente tutti, con limitazioni** per livello |
| Power BI | **Convivono per un periodo**: il nuovo è additivo, il PBIX non si spegne |
| AI | **SQL libero solo alla direzione**; per tutti gli altri solo spec certificate |
| Infrastruttura | **Sulla VM, dentro l'attuale processo Next.js** |

## 1. Perché queste decisioni si tengono a vicenda

Il problema più difficile del passaggio in produzione era questo: **come si impone
un perimetro di riga a una query SQL che ha scritto un'intelligenza artificiale?**
La risposta onesta è che non si può, non in modo affidabile. Iniettare un `WHERE`
dentro una `SELECT` arbitraria con CTE, subquery e funzioni finestra è un esercizio
che si può quasi sempre aggirare, e "quasi sempre" non è una misura di sicurezza.

Le due decisioni prese eliminano il problema invece di affrontarlo:

- chi ha un perimetro ristretto **non ha accesso all'SQL libero**;
- chi ha accesso all'SQL libero (la direzione) **non ha un perimetro da imporre**.

Restano due strade separate e ciascuna è difendibile da sola. Questo è il cardine
architetturale di tutto il resto del documento.

## 2. Modello permessi

Si segue il pattern già collaudato sul Preventivatore: **due assi separati**, mai
collassati su uno solo.

### Asse 1 — livello di portale (*se* vedi il BI)

Nuovo portale `bi` in `public.portali`, con i livelli già esistenti letti da
`get_portale_livello(user_id, 'bi')`:

| Livello | Significato nel BI |
|---|---|
| `superadmin` / `admin` | **Direzione.** Vede tutto, SQL libero, configura budget e BEP |
| `exporter` | **Responsabile.** Vede il proprio perimetro, esporta, niente SQL libero |
| `viewer` | **Operativo.** Vede il proprio perimetro, niente export, niente SQL libero |
| `null` | Non accede |

### Asse 2 — perimetro dei dati (*cosa* vedi)

Tabella nuova `bi_direzionale.perimetro_utente`, una riga per utente:

```
utente_id     uuid    pk -> public.utenti(id)
tipo          text    'tutto' | 'business_unit' | 'agente'
valori        text[]  codici agente o nomi BU; ignorato se tipo='tutto'
```

Assenza di riga = **nessun dato**, non "tutti i dati". La lezione dei NULL di
`permessi_utente` vale qui: il default silenzioso deve essere restrittivo, e ogni
lettura passa da `coalesce`.

> [!warning] I GRANT sono il vero gate, non le RLS
> Come sullo schema `preventivatore`: i privilegi di tabella verso `anon` e
> `authenticated` sullo schema `bi_direzionale` vanno revocati. Tutto passa dal service role
> lato server, quindi **ogni route deve applicare lo scope da sé**. Le policy RLS
> si scrivono comunque, ma come seconda cintura, non come prima.

## 3. Dove si impone il perimetro

Oggi `AccessoBi.agenteScope` esiste nel tipo ma è usato **solo** in
`briefing/route.ts:33` e `esporta/route.ts:103`. Le due API che contano —
`/query` e `/sql` — lo ignorano. Questo va chiuso prima di qualunque altra cosa.

**Sullo snapshot, non sulla query** *(realizzato il 12/09/2026 — questa parte del
piano è cambiata in corso d'opera, in meglio)*. L'idea iniziale era iniettare un
filtro implicito nella `SpecQuery`. Scartata: `esegui()` è chiamata da **65 punti**
— rilevatori, briefing, documenti, export, analista — e ognuno sarebbe stato
un'occasione per dimenticarsene; per giunta l'analista AI compone le proprie query,
quindi il filtro avrebbe dovuto difendersi da qualcosa che scrive query da solo.

Si filtra invece lo **snapshot**, una volta sola, all'ingresso della richiesta
(`applicaPerimetro` in `perimetro.ts`, esposto alle route da `snapshotPerimetrato`).
Chi riceve lo snapshot non può leggere righe fuori perimetro perché quelle righe non
esistono nell'oggetto che ha in mano: non c'è un controllo da aggirare, c'è un dato
che non c'è. Con perimetro aperto non viene fatta nessuna copia, quindi per la
direzione il costo è zero.

> [!warning] Il buco che questo approccio ha fatto emergere
> `cacheQuery` è un singleton di modulo condiviso da tutte le richieste del processo,
> e la sua chiave non conteneva il perimetro. La direzione eseguiva una spec, il
> risultato completo finiva in cache, e il primo utente ristretto che chiedeva la
> stessa spec **riceveva quel risultato**: il filtro sullo snapshot non veniva mai
> raggiunto, perché la risposta arrivava dalla cache prima. La chiave ora è
> `run | perimetro | spec`. Vale la pena ricordarlo ogni volta che si aggiunge una
> cache condivisa: il perimetro fa parte dell'identità della domanda.

**SQL libero** — nessuna iniezione. La route `/sql` verifica
`livello in ('superadmin','admin')` e rifiuta tutti gli altri con 403. Un solo
controllo, in un solo punto, verificabile a occhio.

**Audit** — tabella `bi_direzionale.registro_query`: utente, momento, spec o SQL, righe
restituite, millisecondi, esito. Vale per entrambe le strade. Senza questo non
si può dire a nessuno cosa ha visto chi, ed è la prima domanda che arriva il
giorno in cui un numero esce dall'azienda.

## 4. Il dato che esce dall'azienda

Va messo agli atti perché finora non era un problema e in produzione lo diventa:
**l'analista manda a OpenRouter porzioni di dati reali** — nomi cliente,
fatturati, margini — dentro il prompt. Il prototipo gira su un PC e la cosa è
irrilevante; la produzione su dati direzionali è un'altra faccenda.

Tre opzioni, da decidere prima della Fase 3:

1. **Accettare**, con OpenRouter configurato per non conservare i prompt e la cosa
   scritta nel Vault. È la strada più rapida.
2. **Pseudonimizzare**: i nomi cliente diventano `Cliente 1..N` nel prompt e si
   ritraducono nella risposta. Costa poco, protegge la parte più sensibile.
3. **Modello in casa** sulla VM: con 2 vCPU e 7,8 GB non è realistico oggi.

Raccomandazione: **(2)**. Il modello non ha bisogno del nome vero per dire che un
cliente pesa il 48% della settimana.

## 5. Persistenza

Lo schema `prototipo-bi/sql/001_schema.sql` è già scritto e va applicato con tre
correzioni:

- **rinumerare**: il numero `086` è un buco non committato (085 e 087 sono
  tracciati, 086 no). Le migration del BI partono da **102**;
- **applicare sul PostgreSQL 17 della VM**, non su Supabase, che è fermo dal 29/08;
- **scrivere le policy RLS**, che nel file sono volutamente assenti.

Quattro migration, **applicate il 12/09/2026 su entrambi i database** (VM di produzione e Supabase di sviluppo):

| Nº | Contenuto |
|---|---|
| 102 | Schema `bi_direzionale`: configurazione, chiusure, incidenze, budget commerciali, obiettivi visite, serie budget, briefing, riscontri. RLS, GRANT revocati, scrittura atomica della configurazione, esposizione PostgREST |
| 103 | `perimetro_utente`, `utente_agente`, vista `perimetro_effettivo`, `registro_query`, portale `bi` in `public.portali` |
| 104 | Motore SQL sola lettura (l'ex 086) + `analisi`, `dashboard`, `dashboard_analisi` per la Fase 3 |
| 105 | `public.bi_preventivi_backoffice`, **che sulla VM non esisteva** |

> [!warning] La vista dei preventivi mancava in produzione
> Risultava «applicata in produzione il 29/08», e lo era: **su Supabase**. La
> migrazione verso la VM è avvenuta lo stesso giorno e la vista è rimasta di là.
> Delle 13 viste che servono al BI, dodici c'erano sulla VM e questa no — e senza
> di lei mancano tasso di conversione, carico back office, giorni di risposta e
> anzianità della pipeline, su 6,6 milioni di preventivato. Non l'aveva notato
> nessuno per due settimane: è il motivo per cui le viste vanno versionate.

> [!info] Il motore SQL vive in `bi_direzionale`, non in `public`
> `ALTER FUNCTION ... OWNER TO` richiede che il **nuovo** proprietario abbia
> `CREATE` sullo schema. `powerbi_reader` non ha CREATE su `public` — giustamente,
> è di sola lettura — e su Supabase `public` appartiene a `pg_database_owner`,
> quindi nemmeno chi applica le migration può concederglielo. Spostare la funzione
> nello schema del BI risolve, ed è più coerente. Il `CREATE` su `bi_direzionale`
> viene concesso solo il tempo di cedere la proprietà, poi revocato.

> [!warning] Lo schema si chiama `bi_direzionale`, non `bi`
> Correzione al piano: **`bi` è già occupato** dalla pipeline di ingest —
> `cruscotto_runs`, `costi_storico`, `giacenze_storico` (073, 075, 076),
> `trasporti_documenti`, `trasporti_runs` (090, 099). Ci scrivono processi
> automatici. Qui va l'opposto: configurazione scritta da persone, con altro ciclo
> di vita e altri permessi. Nello stesso schema avrebbero condiviso una sola
> superficie di GRANT.

> [!info] Cosa NON è andato in database
> La cache dello snapshot (~66.000 righe riscritte ogni sei ore) e i documenti
> Word/Excel dell'analista **restano file**. In Postgres lo snapshot sarebbe un
> jsonb da decine di MB riscritto per intero a ogni giro, per un dato derivato e
> ricostruibile in tre secondi.

Poi `archivio.ts` passa da file JSON a Postgres. L'interfaccia pubblica è già
identica, quindi è una sostituzione di implementazione, non una riscrittura.

> [!info] Il motore SQL è già disegnato bene
> `powerbi_reader` è un ruolo NOLOGIN con solo `SELECT` su 13 viste. Anche bucando
> le regex di validazione non c'è privilegio di scrittura da rubare. La difesa in
> profondità regge: si aggiunge l'audit, non si riscrive.

## 6. Il costruttore manuale — il pezzo che manca

Oggi non esiste. Quattro schermate a schede fisse più l'analista conversazionale;
nessun modo per un utente di comporre un grafico proprio, salvarlo o riusarlo.

L'appiglio c'è già: `GET /api/prototipo-bi/query` **espone il vocabolario** —
metriche, dimensioni, modificatori, unità. L'editor si costruisce su quello.

### Il principio: una strada sola, due modi di imboccarla

L'oggetto che l'utente compone a mano è **lo stesso** `SpecQuery` che produce
l'AI. Questo ha tre conseguenze che valgono da sole il disegno:

- ogni grafico fatto dall'AI si **apre nell'editor** e si modifica a mano;
- ogni grafico fatto a mano si **passa all'AI** ("e se guardassi per agente?");
- c'è un solo motore da mettere in sicurezza, non due.

### Le quattro scelte dell'utente

```
  Cosa guardo      -> metrica            (ordinato, margine, conversione…)
  Come lo spezzo   -> dimensioni         (BU, agente, cliente, mese…)
  Quando           -> periodo + confronto (anno precedente, progressivo)
  Solo dove        -> filtri
```

Sotto, in tempo reale, il risultato e il grafico proposto. Nessun passaggio di
conferma, nessuna modale: si cambia una scelta e il grafico cambia.

### Il grafico giusto proposto da solo

La regola non la sceglie l'utente al primo colpo: la propone il sistema leggendo
la **forma** del risultato, e l'utente la cambia se vuole.

| Forma del risultato | Proposta |
|---|---|
| Serie temporale, 1 misura | Linee, con confronto AP tratteggiato |
| Serie temporale, più misure | Combo o aree impilate |
| Categorie ≤ 8, quota di un totale | Torta o anelli |
| Categorie 9–30 | Barre orizzontali ordinate |
| Categorie > 30, concentrazione | Pareto |
| Consuntivo contro obiettivo | Bullet |
| Variazione fra due periodi | Waterfall |
| Due dimensioni incrociate | Heatmap o pivot |
| Due misure, stessi soggetti | Quadranti |
| Stadi di un processo | Imbuto |
| Gerarchia a due livelli | Treemap |

**Regola dura**: una serie temporale non finisce mai in una torta, e una
percentuale non finisce mai in un asse che non arriva a 100. Il sistema non lo
propone nemmeno.

### Salvare e condividere

- `bi_direzionale.analisi` — la spec, il tipo di grafico scelto, il titolo, l'autore;
- `bi_direzionale.dashboard` — una griglia di analisi, con filtro incrociato comune;
- visibilità: privata, oppure condivisa con chi ha almeno il proprio livello.

Un'analisi condivisa **non porta con sé i dati**: porta la spec. Chi la apre la
esegue con il proprio perimetro e vede i propri numeri. È il modo per far girare
lo stesso cruscotto fra direzione e agenti senza duplicare niente.

## 7. La libreria dei grafici

Ce ne sono già **19**, e sono fatti bene: waterfall, pareto, bullet, heatmap,
quadranti, sparkline, small multiples, barre di scostamento, imbuto, radiale,
treemap, calendario attività, aree impilate, anelli, barre, linee, combo, torta,
KPI eroe. Non serve rifarli.

Ne mancano sei che in un BI commerciale si sentono:

| Tipo | A cosa serve qui |
|---|---|
| **Pivot / matrice** | BU × mese in una griglia sola. È la cosa che gli utenti Excel chiedono per prima |
| **Slope chart** | Due periodi, una retta per soggetto: chi è salito e chi è sceso, letto in un colpo |
| **Box plot** | Dispersione dei margini e dei giorni di risposta. La media da sola nasconde i casi che contano |
| **Bump chart** | Come cambia la classifica dei clienti nel tempo |
| **Sankey a stadi** | Preventivo → ordine → consegna → fattura, con le dispersioni visibili |
| **Istogramma a fasce** | Distribuzione degli importi: dove sta davvero il grosso degli ordini |

**Su "belli"**: i grafici esistenti usano già la palette del design system e il
font `tenorite` per i numeri. La coerenza si mantiene con tre regole — nessun
grafico introduce colori propri; ogni grafico sa dire da quale spec viene
(`BadgeCertificata` esiste già); animazione all'ingresso e mai al cambio filtro,
perché un numero che si rianima a ogni click smette di essere leggibile.

## 8. Infrastruttura

Il BI gira **dentro il processo Next.js dell'intranet** sulla VM (2 vCPU, 7,8 GB).
Prima di attivarlo va misurata una cosa sola, ma va misurata sul serio:

> **Quanto pesa lo snapshot in memoria** (~66.000 righe su 7 dataset) e cosa
> succede con 5–10 utenti in parallelo, con la cache query a 500 voci.

Se il consumo è sostenibile si resta così. Se non lo è, la via d'uscita è già
chiara e non richiede riscritture: **secondo processo pm2** sulla stessa macchina,
con la sua memoria. La decisione si prende con il numero in mano, non prima.

Altri punti operativi:

- la guardia `PROTO_BI_CONSENTI_PRODUZIONE` **non si rimuove**: diventa il flag di
  rollout, che si apre per gruppi di utenti invece che per ambiente;
- i banner rossi si tolgono solo all'ultimo passo, quando i numeri sono stati
  confrontati con il PBIX;
- il branch: oggi si lavora su `main-deploy`, ma `deploy.sh` fa
  `git reset --hard origin/main`. Il BI arriva in produzione **solo** passando da
  `main`;
- `.git/info/exclude` va ripulito dei cinque percorsi del prototipo, e i nomi
  `prototipo-bi` vanno rinominati in `bi` — un modulo in produzione non si chiama
  prototipo.

## 8-bis. Come sono state applicate (12/09/2026)

Eseguite **su due database**: il PostgreSQL della VM (produzione, via
`ssh` + `sudo -u postgres psql -1 -v ON_ERROR_STOP=1`) e il Supabase di sviluppo
(via Management API, che esegue in transazione). Esito verificato con gli stessi
controlli su entrambi:

| Controllo | VM | Supabase |
|---|---|---|
| Tabelle in `bi_direzionale` | 14 | 14 |
| RLS attiva | 14/14 | 14/14 |
| Proprietario del motore SQL | `powerbi_reader` | `powerbi_reader` |
| `CREATE` di powerbi_reader sullo schema (atteso false) | false | false |
| Privilegi di scrittura di powerbi_reader (atteso 0) | 0 | 0 |
| Privilegi di anon/authenticated (atteso 0) | 0 | 0 |
| Motore SQL interrogato sui dati veri | risponde | risponde |

**Le difese provate sul database vero**, non affermate: `delete from
bi_documenti_raw` respinta dal filtro testuale; `select * from public.utenti` —
che è una SELECT legittima e **supera** il filtro — respinta dal ruolo con
`permission denied for table utenti`. È la difesa in profondità che fa il suo
lavoro su una query reale.

Ordine e verifiche, per la prossima volta:

1. **Prima la 102**, poi 103, poi 104: la 103 e la 104 creano tabelle dentro lo
   schema della 102.
2. **Controllare i NOTICE e i WARNING**, non solo l'assenza di errori. Tre cose
   parlano solo così:
   - la 102 dice se ha aggiunto `bi_direzionale` a `pgrst.db_schemas` o se c'era già;
   - la 104 **avvisa** (senza fallire) sulle viste `bi_*` che non trova, e quelle
     sono le sorgenti del motore SQL;
   - la 104 **fallisce di proposito** se manca il ruolo `powerbi_reader`, con un
     messaggio che dice come crearlo.
3. **Su Supabase gestito**, verificare anche Settings → API → Exposed schemas:
   l'interfaccia web e il comando SQL si sovrascrivono a vicenda. Se dopo le
   migration le pagine del BI si svuotano senza errori, guardare lì per primo.
4. **Verifica finale**, con l'app avviata: se in console non compare
   `[bi] perimetro per utente non attivo`, l'infrastruttura è stata riconosciuta e
   il perimetro è realmente in vigore.
5. Dopo l'applicazione si possono cancellare `supabase/migrations/086_prototipo_bi_sql_sola_lettura.sql`
   (mai applicato, contenuto confluito nella 104) e `prototipo-bi/sql/001_schema.sql`
   (sostituito dalla 102).

> [!todo] Le viste `public.bi_*` non sono versionate
> Le sette viste che alimentano il BI vivono nel database e in nessuna migration
> (`bi_preventivi_backoffice` è stata applicata a mano il 29/08). Se il database
> venisse ricostruito dalle migration, il BI resterebbe senza sorgenti. Da sanare,
> non in questa fase.

## 9. Fasi

| Fase | Contenuto | Esito verificabile |
|---|---|---|
| **0** | Misura della memoria; conferma decisione AI sui dati verso OpenRouter | Un numero e una decisione scritta |
| **1** ✅ | Migration 102–105 **applicate su VM e Supabase**; `archivio.ts` e `registro.ts` su Postgres; perimetro da `perimetro_effettivo` | 14 tabelle, RLS su tutte, zero privilegi ad anon/authenticated, motore SQL verificato sui dati veri |
| **2** ✅ | ~~Perimetro imposto in `/query`; `/sql` chiuso ai non-direzione; audit attivo~~ **Fatta il 12/09/2026** | 19 test in `prototipo-bi/perimetro.test.ts`. Resta da accendere `PERIMETRO_PER_UTENTE_DISPONIBILE` alla Fase 1, quando esisterà dove configurare i perimetri |
| **3** | Costruttore manuale + selezione automatica del grafico + salvataggio | Un utente compone e salva un'analisi senza aiuto |
| **4** | I sei grafici mancanti; dashboard personali | La galleria è completa |
| **5** | Confronto numero per numero con il PBIX; rollout a gruppi | Le cifre coincidono; i banner si tolgono |

Power BI resta acceso per tutta la durata. Si spegne, se si spegne, dopo la Fase 5
e con una decisione separata.

## Collegato a

[[Prototipo BI Direzionale]] · [[Schema DB - Intranet SICS]] · [[Operatività VM]] ·
[[Modello permessi Preventivatore]] · [[Portale Vettori]]
