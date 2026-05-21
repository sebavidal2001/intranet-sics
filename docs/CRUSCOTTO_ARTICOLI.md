# Cruscotto articoli — anagrafica e giacenze multi‑magazzino

Sistema di gestione dell'anagrafica articoli SICS, importata periodicamente dal
gestionale (file "Cruscotto articoli") e consultata dal builder preventivi.

## Architettura DB (migration 033)

| Tabella | Cardinalità | Scopo |
|---|---|---|
| `preventivatore.prodotti` | 1 riga per `codice` | Anagrafica (descrizione, prezzo, categoria, ecc.) |
| `preventivatore.prodotti_giacenze` | 1 riga per `(codice, magazzino)` | Giacenze. **Assenza riga = non registrato in quel magazzino**. Riga con `esistenza=0` = registrato a zero. |
| `preventivatore.prodotti_import_log` | 1 riga per ogni esecuzione import | Audit + statistiche |
| `preventivatore.v_prodotti_completo` | view | Anagrafica + aggregati giacenze (per UI/builder) |

### Funzione di ricerca

```sql
preventivatore.search_prodotti(q text, limite int DEFAULT 20)
```

Cerca su `codice` (esatto/prefisso), `codice_norm` (no `./-_/*?`), `descrizione`
(trigram). Restituisce score, `n_magazzini`, `prezzo_stale` (true se prezzo > 1 anno).

Usata dall'endpoint `GET /api/portali/preventivatore/prodotti?q=<testo>` →
autocomplete del builder (`SearchArticoli` in `blocco-card.tsx`).

## Import script

`scripts/import-cruscotto.mjs` — esegue import idempotente da Excel o CSV.

```bash
# Dry-run (parsing + statistiche, niente DB)
node scripts/import-cruscotto.mjs --file=<path> --dry-run --verbose

# Import reale
node scripts/import-cruscotto.mjs --file=<path>

# CSV (target VM)
node scripts/import-cruscotto.mjs --file=/opt/.../cruscotto.csv --csv
```

### Env richieste (`scripts/.env`)

```
SUPABASE_URL=https://sowzewrfkoxernnvhzgg.supabase.co
SUPABASE_SERVICE_KEY=<service-role-key>
```

### Logica

1. **Hash MD5 del file**: se identico all'ultimo import OK → skip totale, log con esito `skip_hash_uguale`.
2. **Parse**: 1 riga per `(codice, magazzino)`. Anagrafica dedotta dalla prima riga del magazzino "1" (più affidabile).
3. **Anagrafica upsert**:
   - Confronta `hash_riga` (md5 dei campi anagrafici).
   - Hash uguale → **zero scritture**.
   - Hash diverso o nuovo → upsert.
4. **Soft delete**: codici in DB ma non più nel file → `attivo = false` (non DROP, per integrità con `righe_distinta` storiche).
5. **Giacenze sync**:
   - DELETE righe `(codice, magazzino)` non più nel file → "non più registrato in quel magazzino".
   - UPSERT `(codice, magazzino)` del file → INSERT se mancante, UPDATE solo se cambiano `esistenza`/`disponibilita`.
6. **Log** finale in `prodotti_import_log` con conteggi e durata.

### Performance osservata (primo import)

- File: 4 MB Excel, 21.360 righe, 19.959 codici univoci
- Durata: **71 secondi** (primo import, 100% nuovo)
- Idempotenza: **~2 secondi** (re-run con file uguale, skip via MD5)

Per i run successivi con poche modifiche la durata sarà tra **5 e 30 secondi**
(dominata dal confronto SELECT iniziale, non dalle write).

## Cron VM (target)

Su `srv-intranet` (`192.168.1.21`, utente `intra-adm`).

### Setup

```bash
sudo mkdir -p /opt/intranet-sics/imports/cruscotto/IN
sudo mkdir -p /opt/intranet-sics/imports/cruscotto/PROCESSED
sudo chown -R intra-adm:intra-adm /opt/intranet-sics/imports
```

`scripts/` deployato sotto `/opt/intranet-sics/scripts/` con `.env` separato
contenente solo `SUPABASE_URL` e `SUPABASE_SERVICE_KEY`.

### Crontab

```cron
# Import cruscotto: ogni notte alle 03:30
30 3 * * * cd /opt/intranet-sics/scripts && node import-cruscotto.mjs --file=/opt/intranet-sics/imports/cruscotto/IN/cruscotto.csv --csv >> /var/log/intranet/cruscotto.log 2>&1
```

### Pipeline completa

1. Gestionale aziendale → esporta CSV → posiziona su SMB/path condiviso
2. `rsync` o `cp` dal path condiviso a `/opt/intranet-sics/imports/cruscotto/IN/cruscotto.csv`
3. Cron lancia `import-cruscotto.mjs`
4. Su esito OK, `mv` del file in `PROCESSED/cruscotto_YYYYMMDD.csv`
5. (opzionale) email/alert se l'esito è `errore` (consultabile in `prodotti_import_log`)

### Monitoring

```sql
-- Ultimi 10 import
SELECT iniziato_il, esito, righe_lette,
       prodotti_nuovi, prodotti_aggiornati, prodotti_disattivati,
       giacenze_inserite, giacenze_aggiornate, giacenze_eliminate,
       durata_ms
FROM preventivatore.prodotti_import_log
ORDER BY iniziato_il DESC LIMIT 10;
```

## Integrazione builder

| File | Modifica |
|---|---|
| `src/app/api/portali/preventivatore/prodotti/route.ts` | Usa RPC `search_prodotti`. Mappa risposta sul tipo `Prodotto` esistente |
| `src/components/portali/preventivatore/nuovo-view-types.ts` | Aggiunti campi opzionali `categoria`, `n_magazzini`, `prezzo_stale` |
| `src/components/portali/preventivatore/blocco-card.tsx` | UI autocomplete mostra categoria, badge `?` se prezzo stale, badge stock+magazzini |

Il builder ora cerca direttamente sui **19.959 codici reali** dell'anagrafica
aziendale invece che sulla tabella vecchia vuota.

## Numeri primo import (snapshot)

| Metrica | Valore |
|---|---|
| Prodotti totali | 19.959 |
| Prodotti attivi | 19.959 |
| Prodotti con `ult_costo > 0` | 12.596 |
| Giacenze totali (righe per coppie codice/magazzino) | 21.360 |
| Magazzini distinti | 5 (`1`, `4`, `CLAVCL`, `CLAVFO`, `RIP`) |
