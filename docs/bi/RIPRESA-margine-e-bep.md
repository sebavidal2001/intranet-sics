# Ripresa — BEP/Budget corretti e marginalità aggiunta

**Sessione del 14/09/2026 pomeriggio. Tutto NON committato: sta nel working tree.**

## Stato

| File | Cosa c'è dentro |
|---|---|
| `src/lib/prototipo-bi/tipi.ts` | `Snapshot.serieBudget`, `Snapshot.versioneForma`, `RigaFatto.costoUnitario`/`.dataCosto`, 4 chiavi metrica nuove |
| `src/app/api/bi/_comune.ts` | `snapshotPerimetrato()` aggancia le serie budget (cache 10 min) |
| `src/lib/prototipo-bi/semantico.ts` | `esegui()` devia `budget`/`bep` su `risolviBudget()`; 4 metriche di margine; avvisi di copertura |
| `src/lib/prototipo-bi/sorgente.ts` | `caricaCostiArticoli()` da `preventivatore.prodotti`; `VERSIONE_FORMA = 2` |
| `src/lib/prototipo-bi/tassonomia.ts` | tipologia `margine` |
| `src/lib/prototipo-bi/documenti/genera.ts` | colonne Word con nome reale della metrica + riga di provenienza |
| `src/app/api/bi/query/route.ts` | rimosso il routing budget duplicato |
| `src/tests/prototipo-bi-budget-metrica.test.ts` | 3 test (nuovo) |
| `src/tests/prototipo-bi-margine.test.ts` | 5 test (nuovo) |
| `src/tests/prototipo-bi-report-word.test.ts` | 4 test (nuovo): genera il .docx e ne rilegge le tabelle |

`npm run type-check` pulito. `npx vitest run`: 746 passati, 1 skipped.

> [!warning] Un'altra sessione ha committato (`637daf9`) mentre questo lavoro era
> in corso. Prima di toccare il repo stasera: `git status --porcelain -- src/` e
> verificare che i 7 file modificati + 2 test nuovi ci siano ancora.

## Cosa è stato corretto

1. **`esegui()` restituiva l'ordinato al posto di BEP e budget.** La deviazione
   verso `risolviBudget()` esisteva solo in `api/bi/query`. Report del 12/09:
   copertura BEP «100,0% ogni mese»; la verità è **89,9%**, 337.057 € sotto il
   pareggio.
2. **Marginalità aggiunta**: `margine`, `margine_pct`, `costo_venduto`,
   `copertura_costi_pct`. Copertura 97,4% del valore, margine 30–35%.

## Fatto la sera del 14/09

**Tabelle di confronto nel report Word** (era il punto 3). I blocchi con la
stessa forma finiscono in UNA tabella, una colonna per metrica:

- chiave di raggruppamento = granularità + dimensioni + periodo + **filtri**.
  I filtri ci stanno perché «Ordinato SISTEMI» e «Ordinato COSTRUITO» hanno la
  stessa forma ma non sono confrontabili riga per riga: due colonne intitolate
  entrambe `Ordinato (€)` con dentro cose diverse. Restano separate.
- righe = unione delle etichette di tutti i blocchi; una voce presente in una
  sola metrica compare con `—`, non viene saltata.
- stessa metrica due volte nello stesso gruppo → colonna dedupata.
- blocchi senza granularità né raggruppamento (un numero solo) restano a sé.

Verificato generando il documento vero: i quattro blocchi del report del 12/09
escono come una tabella `Mese | Ordinato | Fatturato | BEP | Budget`, con totali
`3.008.831 / 2.696.425 / 3.345.888 / 3.625.104` — i primi due combaciano con il
report di stamattina, gli altri due ora sono davvero BEP e budget.

## Da fare, in ordine

1. **Decidere se committare** (non ancora fatto: nessuno l'ha chiesto).
2. **Provare l'assistente sulla stessa domanda del test di stamattina** e
   confrontare i numeri con la tabella qui sotto. È la verifica che conta e
   richiede l'app avviata.
3. Il briefing direzionale finisce in ogni report Word anche fuori tema.
4. Margine solo su `fatturato`: decidere se ha senso anche su `ordinato`.
5. Colonna di **scostamento** (ordinato − BEP, e %) nelle tabelle di confronto:
   oggi il lettore la deve fare a mente.

> [!warning] La suite completa NON è verde, e non per colpa di questo lavoro
> Gli 8 file in `prototipo-bi/` che leggono il DB vero falliscono con
> `upstream request timeout`: otto file di test costruiscono ognuno uno snapshot
> completo in parallelo e saturano PostgREST. **Verificato con A/B**: falliscono
> identici anche riportando `sorgente.ts` a HEAD, quindi non è il caricamento
> dei costi. Passano se eseguiti da soli (`_perf.test.ts` da solo: 32s, verde).
> Di pomeriggio passavano tutti: dipende da quanto è veloce la connessione.
>
> `src/tests/` (41 file, 464 test) è verde, `npm run type-check` pulito.

## Numeri di riferimento (VM, dati all'11/09)

| Mese | Ordinato | BEP reale | Copertura |
|---|---:|---:|---:|
| 2026-01 | 331.700 | 358.488 | 92,5% |
| 2026-02 | 337.256 | 398.320 | 84,7% |
| 2026-03 | 377.844 | 438.152 | 86,2% |
| 2026-04 | 445.406 | 438.152 | 101,7% |
| 2026-05 | 304.201 | 418.236 | 72,7% |
| 2026-06 | 320.791 | 438.152 | 73,2% |
| 2026-07 | 442.351 | 458.068 | 96,6% |
| 2026-08 | 280.999 | 219.076 | 128,3% |
| 2026-09 | 168.283 | 179.244 | 93,9% |
| **Totale** | **3.008.831** | **3.345.888** | **89,9%** |

Dettaglio completo: `Vault/Moduli/intranet-sics - Prototipo BI Direzionale.md`,
sezioni «BEP e Budget non erano il BEP e il Budget» e «La marginalità si calcola».
