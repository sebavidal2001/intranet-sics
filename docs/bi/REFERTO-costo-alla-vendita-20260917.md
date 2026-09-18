# Il costo al momento della vendita esiste nel gestionale — referto 17/09/2026

> [!success] Risposta breve
> **Sì, si può.** Il gestionale conserva lo storico completo del listino "Ultimo
> Costo" dal **1999**: 6.681 variazioni, **402.175 righe di prezzo**. Il costo
> valido alla data di vendita si ottiene prendendo, per ogni articolo, la
> variazione con `data_inizio` più recente **precedente o uguale** alla data di
> registrazione del documento. Copertura misurata: **97,9–99,6% del valore
> fatturato** in ogni anno dal 2022 al 2026.

Analisi condotta in sola lettura su `SRVWOA` (`192.168.1.110`, Impresa /
SQL Anywhere 11, datasource `airfluid90`). Nessuna modifica al gestionale;
la cartella di lavoro `C:\Impresa\Viste_BI\_adhoc` è stata rimossa a fine analisi.

## Dove sta il costo storico

| Oggetto | Ruolo |
|---|---|
| `dba.listino` **id 331**, codice `UC`, "UC Listino Ultimo Costo", valuta EURO | il listino dei costi di acquisto |
| `dba.par_sistema.id_listino_ultimo_costo` | punta a 331 (tabella a **riga singola**) |
| `dba.variazione` (`id_listino`, `data_inizio`, `data_fine`) | la versione del listino: una variazione ≈ per giorno lavorativo, ~250/anno |
| `dba.prezzo` (`id_variazione`, `id_unita_confezione`, `prezzo`) | il costo dell'articolo **in quella versione** |
| `dba.unita_confezione` con `unita_base = 'S'` | l'unità a cui il costo è agganciato |

La vista `dba.vs_listino_ultimo_costo` — quella che alimenta oggi
`cruscotto_articoli.csv` → `preventivatore.prodotti.ult_costo` — **non è altro
che questa catena filtrata su `getdate()`**:

```sql
where variazione.data_inizio = (select max(a.data_inizio) ...
       and a.data_inizio <= convert(datetime, convert(char(10), getdate(), 102)) ...)
```

> [!info] Il punto
> Il costo storico non va ricostruito: **c'è già**. Si sta buttando via ogni
> notte, sostituendo `getdate()` alla data del documento. Basta non farlo.

`data_fine` è **sempre NULL** su questo listino: il versionamento è per sola
`data_inizio`, quindi "costo valido a una data" = ultima `data_inizio` ≤ data.

## Le strade che NON funzionano (verificate, non dedotte)

| Candidato | Esito |
|---|---|
| `riga_documento.costo_margine`, `costo_1/2/3`, `costo_produzione` | **tutte a zero** su 58.302 righe di fattura 2022–2026. Campi previsti dal gestionale ma mai compilati. |
| `riga_doc_magazzino.ult_costo` / `data_ult_costo` | **mai valorizzati** (0 righe su 46.417). |
| `riga_doc_magazzino.val_scaricato` (valorizzazione dello scarico) | 14 righe in cinque anni, 1.028 € totali. Il magazzino non è valorizzato. |
| `dba.st_listino`, `st_listino_articolo`, `st_val_listino` (tabelle di storico dedicate) | **vuote**. |
| `bi.costi_storico` (rilevazione nostra, lato Postgres) | parte dal 02/08/2026: niente storia prima. |

## Quanto cambia il numero

Fatturato (`tipo_registro = 'IV'`, `cat_esposizione <> '99'`), costo per riga
× quantità, righe senza costo escluse da entrambe le colonne.

| Anno | Valore coperto | Margine **a costo alla vendita** | Margine **a ultimo costo** (metodo attuale) | Errore del metodo attuale |
|---|---:|---:|---:|---:|
| 2022 | 3.189.389 € | **34,53 %** | 28,97 % | **−5,55 pt** (−177.158 €) |
| 2023 | 3.762.638 € | **34,40 %** | 32,73 % | −1,67 pt (−62.868 €) |
| 2024 | 3.588.756 € | **38,02 %** | 36,09 % | −1,93 pt (−69.348 €) |
| 2025 | 3.666.902 € | **35,40 %** | 34,03 % | −1,37 pt (−50.174 €) |
| 2026 | 2.702.944 € | **32,57 %** | 33,99 % | +1,42 pt (+38.268 €) |

> [!warning] Il metodo attuale non sbaglia "di poco e a caso"
> Sbaglia **in modo sistematico e crescente andando indietro nel tempo**, perché
> confronta ricavi del 2022 con costi del 2026. Sul 2022 schiaccia il margine di
> oltre cinque punti e mezzo. E cambia da solo: lo stesso report rieseguito fra
> un mese dà numeri diversi sulla stessa storia.

Copertura del valore con costo storico disponibile: 98,71% (2022), 99,57%
(2023), 97,91% (2024), 97,94% (2025), 97,94% (2026) — **migliore** di quella
odierna a ultimo costo (97,4% misurato il 14/09).

Che i costi si muovano davvero, sui primi articoli per fatturato 2022–2026:

| Articolo | Fatturato | N. costi dal 2022 | Costo min | Costo max | Costo attuale |
|---|---:|---:|---:|---:|---:|
| `D.V50000001270` | 407.681 € | 37 | 222,01 | 311,67 | 309,45 |
| `TA72-31` | 242.330 € | 19 | 43,00 | 85,92 | 51,00 |
| `AFD.00.1.10609.0` | 131.845 € | 10 | 3.772,83 | 5.700,98 | 4.595,44 |
| `AFD.00.1.10608.0` | 124.495 € | 11 | 4.064,38 | 6.591,64 | 4.536,46 |

Applicare 4.595 € a una vendita del 2022 fatta a 3.772 € di costo non è un
arrotondamento: è il 22% del costo di quella riga.

## Come portarlo nel BI

**Strada consigliata: lo storico costi come dataset a sé**, non il costo
incollato sulla riga di vendita. Motivi: serve anche a `ordinato`, `consegnato`
e `preventivi_aperti`; rende il margine **riproducibile** (stessa domanda,
stessa risposta, per sempre); ed è incrementale — ogni notte solo le variazioni
nuove.

Estrazione da installare in `C:\Impresa\Viste_BI\STORICO_COSTI.sql` e da
aggiungere a `Queries` in `scripts/bi-bridge/config.json`:

```sql
SELECT a.codice                        AS codice_articolo,
       CAST(v.data_inizio AS DATE)     AS valido_dal,
       p.prezzo                        AS costo
FROM dba.prezzo p
  JOIN dba.variazione v        ON p.id_variazione = v.id_variazione
  JOIN dba.par_sistema ps      ON v.id_listino = ps.id_listino_ultimo_costo
  JOIN dba.unita_confezione uc ON uc.id_unita_confezione = p.id_unita_confezione
                              AND uc.unita_base = 'S'
  JOIN dba.articolo a          ON a.id_articolo = uc.id_articolo
WHERE v.data_inizio >= '2022-01-01'
  AND p.prezzo > 0
ORDER BY a.codice, v.data_inizio;
```

Volume: **~77.000 righe** dal 2022 (207.762 dal 2015, 402.175 dall'origine).
Pochi MB: il pieno ogni notte si può fare senza incrementale, almeno all'inizio.

Lato intranet: una tabella `bi.costi_listino_storico (codice_articolo,
valido_dal, costo)` con indice `(codice_articolo, valido_dal DESC)`, e in
`sorgente.ts` la mappa `codice → [(data, costo)]` al posto dell'attuale
`codice → costo`, risolta riga per riga con la data del documento.

> [!todo] Cosa cambia in `src/lib/prototipo-bi/`
> - `sorgente.ts:231` `caricaCostiArticoli()` — da un costo per articolo a una serie per articolo; la risoluzione per riga usa la data della riga.
> - `tipi.ts:46` `costoUnitario` resta, cambia solo come viene riempito. `dataCosto` diventa la data **della versione applicata**, non l'ultima nota.
> - `sorgente.ts:208-225` — il commento sulle due avvertenze va riscritto: cadono entrambe.
> - `semantico.ts:270` — "margine a costo corrente" diventa "margine a costo alla vendita"; `copertura_costi_pct` resta e resta necessaria.
> - **`Snapshot.versioneForma` va incrementata**: lo snapshot in cache 6 ore contiene i vecchi costi e non darebbe errore, darebbe numeri vecchi.

> [!warning] Due cose da non dimenticare
> 1. **Riga senza costo = `null`, mai zero** — vale identico a oggi.
> 2. Restano fuori le righe senza articolo a listino (~2% del valore): anticipi,
>    voci descrittive, lavorazioni. La metrica `copertura_costi_pct` continua a
>    dirlo, e va continuata a mostrare accanto al margine.

## Quello che questo metodo NON è: il costo dei pezzi venduti

> [!warning] Compro a 10 il 12/10, l'UC passa a 12, vendo i pezzi del lotto da 10: viene registrato **12**
> Non 10. Il listino UC non è una valorizzazione di magazzino: è **l'ultimo
> prezzo pagato**, una riga per articolo, senza legame con i pezzi fisicamente
> a scaffale. Il costo reale di quei pezzi (10) **non è registrato da nessuna
> parte** e non è ricostruibile.

Verificato sull'articolo `11403421025` (41 fatture di acquisto dal 2024):

| Data | Evento | Valore |
|---|---|---:|
| 2025-12-15 | costo UC | 8,99 |
| 2025-12-31 | fattura acquisto, 20 pz | 8,99 |
| **2026-01-19** | **costo UC** | **11,69** |
| 2026-01-31 | fattura acquisto, 20 pz | 11,69 |

L'UC insegue il prezzo d'acquisto **esattamente** (8,995 → 8,99 → 11,69) e si
muove **all'arrivo della merce**, prima della fattura (che qui è un riepilogo
di fine mese: la data buona per gli acquisti è il DDT `DA`, non la fattura `IA`).
Quindi i pezzi comprati a 8,99 in dicembre e venduti a febbraio entrano nel
calcolo a **11,69**: margine sottostimato di 2,70 € al pezzo, il 30% del costo.

**Perché il costo vero non è ricuperabile:**

| Via | Stato |
|---|---|
| Valorizzazione di magazzino (FIFO/LIFO/medio) | `riga_doc_magazzino.val_scaricato`: **14 righe in cinque anni**. Non si usa. |
| Lotti | `dba.lotto`: **23 righe**, `mov_lotto`: **34**. Non si usa. |
| Matricole | 3.579 righe, ma **nessuna colonna di costo**. |
| Chiusure di inventario | `chius_inventario`: **vuota**. |

> [!info] Come va chiamata la metrica, allora
> **Margine a costo di ricostituzione alla data di vendita**: "con il prezzo a
> cui avrei ricomprato quella merce quel giorno, quanto ho guadagnato". Per il
> presidio commerciale (listini, sconti, pricing) è la domanda giusta. **Non è
> il COGS contabile** e non va presentata come tale.
>
> Resta comunque **un salto di qualità netto** rispetto a oggi: l'errore passa
> dall'essere *anacronistico e crescente* (costi 2026 su ricavi 2022, −5,55 pt
> sul 2022) all'essere *limitato alla rotazione di magazzino* — settimane o
> pochi mesi, non anni. E diventa riproducibile.

**Se un giorno servisse il costo vero**: le righe di acquisto ci sono dal 1999
(`IA` 39.212 documenti, `DA` 61.487) con quantità e prezzo netto. Da lì si
ricostruisce un **medio ponderato mobile** per articolo. Manca però la
giacenza iniziale valorizzata, quindi la media parte sbilanciata e converge
solo dopo un paio di rotazioni: è un progetto a sé, da valutare solo se la
marginalità di primo livello non basta.

## Verifiche di contorno già fatte

- `riga_documento.quantita` coincide con `qta_un_base` su **tutte** le 56.651
  righe 2022–2026: il costo per unità base si moltiplica direttamente per la
  quantità di riga, senza conversioni.
- Solo **3 righe** (2022) hanno un'unità di confezione diversa dalla base.
- Listino 331 in **EURO**: nessuna conversione valuta.
- Nessun prezzo nullo o ≤ 0 nel listino dal 2022.

## Nota operativa su dbisql

Le query ad hoc via WinRM vanno lanciate con `SET TEMPORARY OPTION on_error =
'exit';` come prima riga: senza, un errore di sintassi apre il prompt
`1. Stop / 2. Continue` e il processo resta appeso finché non lo si uccide
(già visto il 12/09 con il BOM). Con quella riga l'errore torna su stderr in
frazioni di secondo.

La vista `dba.vs_listino_ultimo_costo` è **costosa** (sottoquery correlata su
tutto il listino): joinarla riga per riga a 12.000 righe di fattura non
termina. Risolvere il costo con un `SELECT TOP 1 ... ORDER BY v.data_inizio
DESC` correlato costa invece ~6 ms a riga (72 s per un anno intero di fatturato).

## Collegato a

- `docs/bi/RIPRESA-margine-e-bep.md`
- `src/lib/prototipo-bi/sorgente.ts`, `src/lib/prototipo-bi/semantico.ts`
- `scripts/bi-bridge/config.json`, `scripts/bi-bridge/Invoke-BIPipeline.ps1`
- `docs/bi/fase5/CRUSCOTTO_ARTICOLI.sql`
