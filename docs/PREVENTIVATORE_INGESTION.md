# Preventivatore — Ingestion V2 e architettura RAG

Documentazione operativa per chi deve mantenere o estendere lo script di ingestion (`ingest-preventivi-v2.cjs`) e l'archivio dei preventivi SICS.

## 1. Panoramica

L'archivio preventivi vive nello **schema Postgres `preventivatore`** su Supabase. Lo script di ingestion legge file Word + Excel da una cartella sorgente, ne estrae struttura e totali, e popola:

- `documenti` — un record per cartella `S_YY_NNN`
- `chunks` — testo + embedding vettoriale (Gemini 3072 dim) per RAG
- `righe_distinta` — voci materiali strutturate
- `blocchi` — totalizzatori per fogli senza distinta analitica

L'AI del preventivatore (`/api/portali/preventivatore/chat`) usa questi dati tramite **9 tool** (vedi `src/lib/portali/preventivatore/chat/tool-definitions.ts`).

## 2. Flusso ingestion

```
Cartella sorgente (Word + Excel)
       ↓
[scan-preventivi-anomalies.cjs]  →  preventivi_file_anomali.csv
       ↓                              (annotazione manuale)
[build-ingestion-decisions.cjs]  →  preventivi_ingestion_decisions.json
       ↓                              (manifest skip/include/blocks_total_only)
[ingest-preventivi-v2.cjs --dry] →  audit JSON/CSV (anteprima)
       ↓
[ingest-preventivi-v2.cjs --commit --force]
       ↓
DB Supabase: documenti, chunks (+embedding), righe_distinta, blocchi
       ↓
[forensic-anomalies.cjs] + [fix-anomalies-db.cjs]  →  correzioni mirate
```

## 3. Configurazione richiesta (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
GEMINI_API_KEY=AIza...           # embedding + chat AI
OPENROUTER_API_KEY=sk-or-...     # fallback embedding + chat AI
```

## 4. Comandi essenziali

```bash
# Dry-run su un singolo doc (no scrittura DB, solo audit)
node ingest-preventivi-v2.cjs --dry --only S_24_130 --audit-json audit.json

# Dry-run su tutto un anno
node ingest-preventivi-v2.cjs --dry --year 2025 --audit-json audit-2025.json

# Commit reale (richiede --commit + opzionalmente --force per re-ingest)
node ingest-preventivi-v2.cjs --commit --year 2025 --allow-openrouter-fallback

# Re-ingest singolo doc con preservazione campi manuali
node ingest-preventivi-v2.cjs --commit --force --only S_24_136
```

## 5. Flag importanti

| Flag | Comportamento |
|---|---|
| `--commit` | Scrive nel DB (senza, è solo audit) |
| `--force` | Cancella chunks/righe esistenti e ricostruisce. Preserva stato commerciale (stato, motivo_rifiuto_id, importo_ordinato) e correzioni manuali (importo_source='prezzo_finale_manuale') |
| `--overwrite-manual` | Override anche valori editati a mano. Default: preserva |
| `--include-subfolders` | Includi anche file in sottocartelle (default: solo livello superiore) |
| `--allow-openrouter-fallback` | Abilita il fallback a OpenRouter quando Gemini va in quota 429 |
| `--only S_XX_YYY` | Filtra un solo doc |
| `--year YYYY` | Filtra per anno |
| `--limit N` | Process al massimo N doc |
| `--audit-json file.json` | Output audit JSON dettagliato |
| `--audit-csv file.csv` | Output audit CSV tabulare |

## 6. Logica chiave del parser

### Multi-distinta (riconoscimento strutturale)

Per ogni foglio Excel, lo script cerca **tutti** i pattern `CODICE + DESCRIZIONE + Q.TA + COSTO` come header tabella distinta. Se ne trova ≥2 → crea **N chunks separati** (uno per distinta), riconoscendo il tipo:

- **`fornitore`** se l'header ha colonne `qt.à catena`/`qt.à guida` (layout acquisto fornitore) o se >60% codici matcha `FM*/FS*/FAS*/FAC*`
- **`sics`** se >60% codici matcha `AFD.*/PRA.*/COM.*/codici numerici`
- **`mista`** o **`altro`** altrimenti

### `summarizeDoc` — fonte dell'importo del documento

Priorità per determinare `importo_preventivo` a livello documento (vedi `summarizeDoc` in `ingest-preventivi-v2.cjs:1132`):

1. **`prezzo_finale_sum`**: somma dei `prezzo_finale` di tutti i chunks Excel
2. **`totale_sum`**: somma dei `totale` se nessun `prezzo_finale`
3. **`componenti_sum`**: somma di `totale_costi + variabili_progettuali` o, in mancanza, dei singoli componenti (materiale + manodopera + accessori)
4. **`blocks_sum`**: somma per `blocks_total_only`
5. **`word_only`**: NULL se solo Word disponibile
6. **`prezzo_finale_manuale`**: valore editato dall'utente via UI "Correggi totali" (mai sovrascritto da --force)

### `extractTotals` — riconoscimento label

Le label riconosciute (vedi `totalsLabels` array nello script):
- `totale_materiale`, `totale_manodopera`, `imballo`, `tempi_accessori`, `spese_generali`
- `variabili_progettuali` (aggiunta nel V2.2)
- `totale_costi`, `totale`, `prezzo_finale`, `margine_trattativa`

### Convenzione ricarico SICS

`prezzo_vendita = costo_puro / coefficiente_ricarico`

Esempi:
- coeff 0.5 → prezzo = costo × 2 (50% del prezzo è costo)
- coeff 0.65 → prezzo = costo × 1.538

## 7. Strategia embedding (Gemini + fallback OpenRouter)

Lo script usa `gemini-embedding-2` (3072 dim). Quando Gemini ritorna 429 (quota esaurita), bypassa silenziosamente a OpenRouter con `google/gemini-embedding-2-preview` (stesso modello). Boot check valida entrambi i provider prima di iniziare.

Limiti free tier Gemini:
- **100 RPM**, 30k TPM, **1000 RPD**

Per ingestion di ~1000 chunks su 360 doc serve spalmare su 2 giorni o abilitare il fallback OpenRouter (costo stimato $0.08 totali).

## 8. Casi anomali noti

| Tipo | Conteggio | Trattamento |
|---|---:|---|
| Preventivi solo `APPUNTI.docx` (non quotati) | 20 (di cui 16 classificati) | `importo_preventivo` NULL + nota in `stato_note: [forensic] non quotato` |
| Layout fornitore con seconda distinta SICS | 27 in 2024 | Multi-distinta automatica via riconoscimento `qt.à catena` |
| `tipo_prodotto='altro'` non classificabile dal foldername | ~15 residui | Da correggere manualmente via UI o `fix-anomalies-db.cjs` |
| Totals catturati male (cella sbagliata) | Caso S_24_165 | UI "Correggi totali" salva backup in `totals_originale` |

## 9. Audit e tracciabilità

- **`chunks.metadata.totals_originale`** — backup dei totals catturati automaticamente prima di qualsiasi correzione manuale
- **`chunks.metadata.totals_correzione_manuale`** — `{ corretto_il, corretto_da }` dell'ultima modifica via UI
- **`documenti.stato_note`** — log testuale append-only di tutte le modifiche (formato `[YYYY-MM-DD HH:MM] descrizione`)
- **`documenti.importo_source`** — origine dell'importo (`prezzo_finale` | `prezzo_finale_sum` | `totale_sum` | `componenti_sum` | `blocks_sum` | `word_only` | **`prezzo_finale_manuale`**)
- **`documenti.versione_ingest`** — `v2` per tutti i doc V2; mantenuto in storia
- **`bi_dashboard_log`** — audit delle modifiche dashboard BI (chi/quando/cosa)

## 10. Tool AI disponibili (9)

| Tool | Quando usarlo |
|---|---|
| `list_preventivi` | Liste filtrate per cliente/stato/anno/categoria/importo; supporta `count_only` per "quanti…" |
| `cerca_simili` | Ricerca semantica via embedding (similarity vettoriale) |
| `cerca_articolo` | Ricerca testuale nei chunks (ilike su `contenuto`) |
| `aggrega_preventivi` | Aggregazioni group by stato/cliente/categoria/anno/mese con filtri importo |
| `top_articoli` | Codici articolo più frequenti |
| `query_righe_distinta` | Query strutturate sulla tabella `righe_distinta` |
| `dettaglio_preventivo` | Recupera contenuto completo di UN preventivo |
| `analisi_preventivi_sql` | RPC SQL preconfigurate (statistiche, top, qualità dati) |
| `cerca_anomalie_importi` | Z-score vs media cliente+categoria, classificazione molto_alto/alto/molto_basso/basso |

## 11. Schema DB rilevante (migrations 021–029)

| Migration | Cosa |
|---|---|
| 021 | Schema base preventivatore (documenti, chunks, ai_config) |
| 022 | chat_sessioni + chat_messaggi |
| 023 | righe_distinta |
| 025 | ai_usage_events (consumo token AI) |
| 026 | Dashboard RPCs |
| 027 | V2 metadata (anno, tipo_prodotto, importo_finale_raw, importo_source, versione_ingest, blocchi) |
| 028 | bi_dashboard_log + unique constraint dashboards |
| 029 | v_anomalie_importi (vista z-score) |

## 12. UI / Pagine

- `/preventivatore` — homepage
- `/preventivatore/archivio` — lista preventivi con filtri + AI semantic search
- `/preventivatore/archivio/[id]` — scheda dettaglio (chunks Word + blocchi Excel con righe distinta, lavorazioni, totali, riassumi AI, Apri documento Word, **Correggi totali**)
- `/preventivatore/nuovo` — builder nuovo preventivo (blocchi + chat AI a fianco)
- `/preventivatore/bi` — dashboard BI personalizzabile (scope user/team, drag/resize widget, filtri globali, AI propose widget)
- `/preventivatore/impostazioni` — config AI, modelli, system prompt

## 13. Permessi (livelli portale_utenti)

| Livello | Cosa può fare |
|---|---|
| `viewer` | Leggere archivio, usare chat AI, leggere dashboard BI personale |
| `exporter` | Sopra + modifica dashboard team + export PDF/CSV + Correggi totali |
| `admin` | Sopra + creare/modificare config AI + impostazioni portale |
| `superadmin` | Sopra + gestione utenti/portali |

## 14. File di lavoro fuori repo

Cartella `C:\Users\sebav\Downloads\Viste_BI\`:
- `ingest-preventivi-v2.cjs` — script principale
- `forensic-anomalies.cjs` — apre file anomali + analisi
- `fix-anomalies-db.cjs` — genera SQL correzioni
- `backup-preventivatore.cjs` — backup tabelle in JSON
- `check-embedding-limits.cjs` — verifica quota/modelli Gemini
