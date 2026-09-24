# BI — Ordini di acquisto e valutazione dell'ufficio acquisti

Stato: **da iniziare** (24/09/2026). Decisioni prese con Sebastiano:

1. La valutazione è **anche per singolo buyer**, se il gestionale registra chi
   emette l'ordine fornitore.
2. Si vede come **pagina del Cruscotto** (`/bi/cruscotto`, componente
   `cruscotto-view.tsx`: `type Vista`, array `VISTE`, blocco `{vista === "acquisti" && ...}`),
   non come dashboard di sistema.
3. Il flusso è un **profilo `acquisti` separato**, sullo schema del profilo `costi`:
   un suo guasto non deve fermare cruscotto articoli e Preventivatore.

## Flusso

```
SRVWOA 192.168.1.110 (Impresa, SQL Anywhere 11, datasource airfluid90)
  attività pianificata (LogonType=Password, DMNAIRFLUID\adm.varas)
    → Invoke-BIPipeline.ps1 -ConfigPath ... profilo "acquisti"
    → dbisql ACQUISTI.sql (senza BOM) → acquisti.csv
    → HTTPS POST https://intranet.s-ics.com/api/v1/bi-ingest
srv-intranet 192.168.1.21
  receiver.py → processed-acquisti/ → impresa-bi-acquisti.path/.service
    → acquisti-ingest.sh → bi.acquisti_righe   (upsert per riga)
    → public.bi_acquisti                        (vista, VERSIONATA in migration)
BI
  sorgente.ts: dataset "acquisti" → semantico.ts: metriche
  → scheda Acquisti nel Cruscotto → rilevatori famiglia acquisti nel briefing
```

## Fase 0 — Esplorazione del gestionale (serve la VPN)

Da fare via WinRM su SRVWOA con `Start-Process` e file SQL senza BOM
(vedi memoria "Accesso SRVWOA e VM"). Domande a cui rispondere, con la query:

| # | Domanda | Dove guardare |
|---|---|---|
| 1 | Quali profili documento sono ordini a fornitore? | `dba.documento` raggruppato per profilo/tipo, con conteggi per anno; confrontare con `DA` (DDT acquisto, 61.487) e `IA` (fatture acquisto, 39.212) |
| 2 | Date: ordine, consegna richiesta, consegna confermata dal fornitore | colonne data di testata e riga dell'ordine fornitore |
| 3 | Legame ordine → arrivo | riferimenti di evasione riga ordine ↔ riga `DA` (come per ordini cliente ↔ DDT) |
| 4 | Chi emette l'ordine | `utente_creazione` / operatore in testata; tabella utenti del gestionale |
| 5 | Prezzo ordinato vs fatturato | prezzo netto riga ordine vs riga `IA` collegata |
| 6 | Ordine fornitore legato a un ordine cliente? | riferimento commessa/ordine cliente sulla riga |

> [!warning] `data_creazione` e `data_modifica` di `dba.documento` non sono indicizzate
> Estrarre per finestra su `id_documento` (unico indice), come già fatto per i costi.

## Fase 1 — Estrazione e caricamento

- `ACQUISTI.sql`: righe ordine fornitore con fornitore, articolo, quantità,
  prezzo, date, operatore, stato evasione, e riga `DA` collegata (data arrivo, quantità).
- Voce nuova in `scripts/bi-bridge/config.json` con `"Profilo": "acquisti"`.
- Migration: `bi.acquisti_righe` (chiave = id riga ordine) + vista
  `public.bi_acquisti`, con GRANT a `powerbi_reader`.
- Receiver e unità systemd sul modello di `costi-ingest.sh` /
  `impresa-bi-costi.path`.

## Fase 2 — Indicatori

| Indicatore | Per fornitore | Per buyer |
|---|---|---|
| Puntualità: arrivo `DA` entro la data confermata | ✓ | ✓ |
| Tempo di consegna reale (ordine → arrivo) | ✓ | |
| Ordini scaduti e non arrivati (valore, giorni) | ✓ | ✓ |
| Variazione prezzi d'acquisto (dallo storico costi già caricato) | ✓ | |
| Prezzo ordinato vs fatturato | ✓ | ✓ |
| Scoperti coperti in tempo da un ordine | | ✓ |
| Ordini urgenti: emessi a ridosso della consegna al cliente | | ✓ |

## Fase 3 — Cruscotto e briefing

- Scheda **Acquisti** in `CruscottoView`.
- Rilevatori nuovi (famiglia da aggiungere a `FAMIGLIE_RILEVATORI` in `tipi.ts`):
  fornitori in ritardo crescente, ordini scaduti, differenze di prezzo.
  La famiglia `costi_acquisto` esiste già (dal 24/09/2026).

## Collegato a

- `docs/bi/PIANO-MARGINALITA.md` — lo stesso percorso fatto per lo storico costi
- `docs/bi/REFERTO-costo-alla-vendita-20260917.md` — catena listino UC, `DA`/`IA`
