# Collaudo delle migration del Portale Controllo Vettori

Applica le migration **087, 088 e 089** su un PostgreSQL vuoto e usa e getta, e
verifica che facciano quello che dicono. Nessun database di produzione viene
toccato: il cluster nasce in `.pg/`, vive il tempo del collaudo e si cancella.

```bash
pip install pgserver
python scripts/collaudo-vettori/collauda.py
```

## Cosa verifica

| | |
|---|---|
| **0. Prima installazione** | impalcatura + le tre migration su database vuoto |
| **1. Idempotenza** | rieseguirle non rompe e non duplica |
| **2. Dati seminati** | 4 vettori, 6 zone, 48 province, 56 fasce, 17 supplementi, carburante, riaddebito |
| **3. I vincoli mordono** | dieci scritture sbagliate che il database **deve** rifiutare, più una giusta che deve passare |
| **4. Permessi** | `get_vettori_context` sui tre profili; `authenticated` senza accesso diretto; RLS ovunque |
| **5. Estrazione listino** | la stessa query che usa l'applicazione, e ne rigenera la fixture |

Il punto 3 è quello che conta. Una tabella che accetta tutto non protegge
niente, e un collaudo che non prova a rompere le cose non sta collaudando.

## Percorso da zero contro percorso incrementale

Se `.pg/` esiste già, lo script collauda il percorso **incrementale**: migration
su uno schema che c'è già. Per collaudare la **prima installazione** — che è
quella che si eseguirà in produzione — va cancellato prima:

```bash
rm -rf scripts/collaudo-vettori/.pg
python scripts/collaudo-vettori/collauda.py
```

Su Windows la cancellazione fallisce se un `postgres.exe` regge ancora la
cartella. In quel caso, prima:

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | Where-Object { $_.ExecutablePath -like '*pgserver\pginstall*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
```

## La fixture rigenerata

In coda lo script riscrive `src/tests/fixtures/vettori-listini-dal-db.json`:
l'estrazione letterale dei listini dal database, nella stessa forma che il
servizio `risolviListino` costruisce a runtime. Ci gira sopra
`src/tests/vettori-listini-db.test.ts`, che verifica i numeri delle fatture vere
partendo dai dati **seminati**, non da fixture scritte a mano.

> [!warning] Chi cambia una tariffa nella 088 deve rilanciare questo script.
> Altrimenti quel test resta verde ma sta verificando i listini di ieri.

## Che cosa NON verifica

- **La versione**: qui gira PostgreSQL 16, la produzione è la 17. Nessuna delle
  migration usa costrutti specifici della 17, ma la differenza esiste.
- **L'impalcatura non è l'intranet.** `00_impalcatura.sql` ricrea solo gli
  oggetti che le migration toccano — `portali`, `permessi_portale`,
  `permessi_utente`, `utenti`, `auth.users`, `get_portale_livello` — copiati
  dalle definizioni reali di 004 e 012. Un conflitto con un pezzo di intranet
  che l'impalcatura non riproduce qui non si vedrebbe.
- **Le pagine**: questo collauda il database, non l'interfaccia.
