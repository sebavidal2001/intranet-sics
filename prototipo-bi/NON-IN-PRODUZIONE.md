# BI Direzionale — stato del passaggio in produzione

> Questo file conteneva il divieto di portare il modulo in produzione, deciso il
> **28/08/2026** in attesa dell'approvazione di un preventivo.
> **Il progetto è stato approvato: il divieto è revocato dal 12/09/2026.**
> Il piano completo è in [`docs/bi/PIANO-PRODUZIONE-BI.md`](../docs/bi/PIANO-PRODUZIONE-BI.md).

## Dov'è arrivato

| Fase | Stato |
|---|---|
| **1 — Persistenza e permessi in database** | ✅ migration 102–105 applicate su VM e Supabase |
| **2 — Perimetro dei dati e audit** | ✅ perimetro sullo snapshot, SQL libero alla sola direzione, registro attivo |
| 3 — Costruttore manuale delle analisi | da fare |
| 4 — I sei grafici mancanti e le dashboard | da fare |
| 5 — Confronto con il PBIX e rollout a gruppi | da fare |

## Le barriere: cosa è caduto e cosa no

Le tre barriere originali **non si smontano tutte insieme**. Oggi:

- **Git** — l'esclusione in `.git/info/exclude` è revocata: il codice sta su `main`.
  Restano fuori solo `prototipo-bi/dati/` (36 MB di cache dello snapshot, derivata
  e ricostruibile) e la configurazione, che ora vive in `bi_direzionale`.

- **Guardia a runtime** — `src/lib/prototipo-bi/guardia.ts` **è ancora attiva** e
  non va rimossa: diventa il flag di rollout. In produzione il modulo risponde
  `503` finché non si imposta `PROTO_BI_CONSENTI_PRODUZIONE=1`.

- **Portale spento** — `portali.slug = 'bi'` nasce con `is_attivo = false`. Si
  accende alla Fase 5, quando i numeri saranno stati confrontati con il PBIX.

- **Banner rossi** — restano fino alla Fase 5, per la stessa ragione: finché i
  numeri non sono verificati, uno screenshot non deve poter essere scambiato per
  l'applicazione definitiva.

## Cosa tocca il database, adesso

Non è più vero che «non scrive nulla». Dal 12/09/2026 il modulo **scrive** nello
schema `bi_direzionale`: configurazione, budget, chiusure, briefing, riscontri,
analisi salvate e il registro degli accessi.

Resta vero — ed è il punto che non cambia — che **sui dati aziendali legge e
basta**: le viste `public.bi_*` e `powerbi.*` sono interrogate in sola lettura,
e il motore SQL gira come `powerbi_reader`, che non ha alcun privilegio di
scrittura su niente. Verificato sul database di produzione.

## Power BI

Resta acceso in parallelo per tutto il rollout. Si spegne, se si spegne, dopo la
Fase 5 e con una decisione separata.

## Come si prova in locale

Vedere `README.md` in questa cartella.
