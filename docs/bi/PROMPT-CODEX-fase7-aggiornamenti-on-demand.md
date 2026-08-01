# Prompt per Codex — Aggiornamento dati su richiesta (Fase 7)

> Copia tutto il testo sotto la linea e passalo a Codex.

---

## Contesto

Lavori sul repository `intranet-sics` (Next.js App Router + Supabase, italiano).
Esiste una pipeline BI che porta dati dal gestionale aziendale a Supabase. Va
capita prima di scrivere codice, perché il lavoro richiesto si innesta esattamente
nei suoi punti di giunzione.

### Le tre macchine

| Macchina | Cosa ci gira | Chi ci accede |
|---|---|---|
| `SRVWOA` (192.168.1.110), Windows Server, PowerShell 4.0 | SQL Anywhere + `C:\impresa\BI_Bridge\Invoke-BIPipeline.ps1` | Solo l'utente umano, via Desktop Remoto |
| `srv-intranet` (192.168.1.21), Linux | Receiver HTTP `/opt/impresa-bi/receiver.py`, unit systemd, e l'app Next.js in `/opt/intranet-sics` | SSH; `sudo` richiede password |
| Supabase (progetto `sowzewrfkoxernnvhzgg`) | PostgreSQL, schemi `public`, `preventivatore`, `bi`, `service`, `powerbi` | Via API |

### Come funziona oggi

1. Un'attività pianificata sul server Windows esegue `Invoke-BIPipeline.ps1`, che
   estrae dati da SQL Anywhere in CSV e li spedisce via HTTP al receiver Linux
   con un token (`X-Bridge-Token`).
2. Lo script accetta `-Profilo commerciale|cruscotto|tutti`. **Il profilo
   determina quali query eseguire e quali dataset finiscono nel manifest.**
3. Il receiver valida i CSV e deposita il run in
   `/var/lib/impresa-bi/ready/` (commerciale) o `ready-cruscotto/` (cruscotto).
4. Una unit `.path` di systemd si sveglia e carica i dati su Supabase.

### Vincolo architetturale da capire bene

Il profilo **non** è un'etichetta cosmetica. `/complete` del receiver pretende
esattamente i dataset di un solo profilo: un manifest che mescola profili viene
rifiutato con 422, e un manifest commerciale incompleto pure. Questo esiste
perché la pubblicazione commerciale richiede **tutti e sette** i dataset
insieme, mentre il Cruscotto è uno solo e indipendente.

**Conseguenza per il tuo lavoro:** una richiesta di aggiornamento riguarda **un
solo profilo**. Se l'utente vuole aggiornare sia `fatturato` (commerciale) sia
`cruscotto_articoli`, sono **due richieste distinte**, che generano due run
separati. Non provare a unirle.

### I dataset esistenti

Profilo `commerciale` (sette, sempre tutti insieme):
`consegnato`, `consegnato_futuro_per_mese`, `controllo_banco`, `fatturato`,
`ordinato`, `portafoglio`, `preventivi_aperti`

Profilo `cruscotto` (uno):
`cruscotto_articoli`

### Tempi reali misurati

| Operazione | Durata |
|---|---|
| Estrazione commerciale (7 query) | pochi minuti |
| Estrazione `cruscotto_articoli` | **~21 minuti** (1.246 s misurati) |
| Ingest del Cruscotto su Supabase | 33 s al primo run, molto meno dopo |

Ventun minuti sono un dato di progetto, non un dettaglio: l'interfaccia deve
dirlo all'utente **prima** che confermi, e il sistema deve impedire che si
accodino dieci richieste identiche.

---

## Cosa devi costruire

Un modo per chiedere un aggiornamento dati **fuori dagli orari pianificati**,
scegliendo quali query eseguire.

### Perché il modello è "pull" e non "push"

Il server Windows non espone servizi di rete e non deve iniziare a farlo: ci
girano le credenziali di SQL Anywhere. Né Supabase né la VM Linux possono
innescarlo dall'esterno.

Quindi: **è il server Windows a interrogare periodicamente una coda**. Quando
trova una richiesta in attesa la prende in carico, esegue l'estrazione e ne
riporta l'esito.

### I quattro pezzi

**1. Coda su Supabase (schema `bi`)**

Una tabella delle richieste. Campi che servono davvero:

- identificativo
- `profilo` (`commerciale` | `cruscotto`) — vincolato, non testo libero
- `datasets` — quali dataset sono stati chiesti. Per il profilo commerciale
  sono comunque tutti e sette (la pipeline non sa fare diversamente): tienilo
  per tracciabilità, ma non illudere l'utente che possa scegliere un
  sottoinsieme del commerciale. Spiega questo limite nell'interfaccia.
- `stato`: `in_attesa` | `in_esecuzione` | `completata` | `fallita` | `scaduta`
- chi ha richiesto (id utente), quando
- quando è stata presa in carico e da quale worker
- quando è finita, con esito e messaggio di errore
- `run_id` prodotto dalla pipeline, per collegare la richiesta al run reale in
  `bi.cruscotto_runs` o negli analoghi commerciali

Requisiti non negoziabili:

- **Presa in carico atomica.** Due poller (o due esecuzioni sovrapposte dello
  stesso) non devono mai prendere la stessa richiesta. Usa
  `for update skip locked` dentro una funzione, non una select seguita da un
  update.
- **Una sola richiesta attiva per profilo.** Con estrazioni da venti minuti,
  accodarne cinque identiche è solo danno. Impedisci a livello di database
  (indice univoco parziale sugli stati non terminali), non solo nell'interfaccia.
- **Scadenza.** Una richiesta `in_esecuzione` da più di due ore è quasi certamente
  orfana (server riavviato, task ucciso): va marcata `scaduta` e non deve bloccare
  le successive per sempre.

Segui le convenzioni già presenti nello schema `bi` (guarda le migration
`073`–`077` in `supabase/migrations/`): commenti in italiano che spiegano il
*perché*, `revoke` da `public`/`anon`/`authenticated` e `grant` esplicito al
solo `service_role`.

**2. Wrapper in `public` per l'accesso**

Lo schema `bi` **non è esposto via PostgREST** ed è una scelta deliberata:
esporlo pubblicherebbe staging, storici e run. Segui il pattern già usato:
funzioni `public.bi_*` in `SECURITY DEFINER`, concesse al solo `service_role`.
Vedi `075` (`public.bi_cruscotto_run_start`, `_staging_load`, `_valida`,
`_ingest`, `_run_fail`) e `076` (`public.bi_cruscotto_health`, `_retention`).

Attenzione a una trappola già incontrata: `revoke ... from public` toglie il
privilegio **anche a `service_role`**, che lo eredita da PUBLIC. Servono `grant`
espliciti dopo ogni revoke.

**3. Interfaccia nell'intranet**

Pagina admin nel portale Preventivatore. Il posto naturale è accanto alla
sezione BI esistente:
`src/app/(intranet)/(portale-preventivatore)/preventivatore/bi/`

Deve permettere di:

- scegliere il profilo e vedere quali dataset comporta
- **dire chiaramente quanto ci vorrà** (~21 minuti per il Cruscotto) prima di
  confermare
- vedere lo stato delle richieste recenti, con orari e esito
- capire, quando una richiesta è rifiutata, *perché* (ce n'è già una in corso)

Convenzioni del progetto da rispettare:

- Server Component di default; `"use client"` solo dove serve interattività
- API route in `src/app/api/portali/preventivatore/`, con
  `requirePreventivatore()` da `@/lib/portali/preventivatore/api-guard`
  (vedi `src/app/api/portali/preventivatore/prodotti/route.ts` come modello)
- validazione input con Zod, nessun `any`, tipi in `src/lib/types/index.ts`
- design system: `text-primary`, `bg-bg-page`, `font-tenorite` per titoli e
  numeri; colori e animazioni sono descritti in `CLAUDE.md`
- file kebab-case, componenti PascalCase, testi in italiano

**4. Poller sul server Windows**

Uno script PowerShell che gira come attività pianificata ogni N minuti (proponi
tu N, motivandolo), che:

- chiede se c'è una richiesta in attesa e la prende in carico
- esegue `Invoke-BIPipeline.ps1 -Profilo <profilo>`
- riporta l'esito (riuscita/fallita, messaggio, `run_id`)
- non fa nulla e termina in silenzio se la coda è vuota

Vincoli:

- **PowerShell 4.0.** Niente `Expand-Archive`, niente operatori ternari, niente
  `??`, niente `&&`/`||` fra comandi. Verifica ogni cmdlet che usi.
- **La service role key di Supabase non deve finire sul server Windows.**
  Là ci sono già le credenziali di SQL Anywhere e il token del bridge: non
  aggiungere un terzo segreto, e soprattutto non uno che dà accesso completo al
  database.
  *Raccomandazione:* il poller parla con la VM Linux, non con Supabase. Le due
  macchine già comunicano e condividono `linux-bridge.token`. Valuta se estendere
  il receiver (`/opt/impresa-bi/receiver.py`) con endpoint dedicati, oppure se
  esporre route sull'app Next.js con un token separato. Scegli e **motiva la
  scelta**, tenendo conto che il receiver ha già autenticazione a token,
  validazione degli input e un servizio systemd che lo tiene su.
- Un solo poller alla volta: usa un lock su file, come fa già
  `Invoke-BIPipeline.ps1` con `pipeline.lock`.
- Il poller non deve mai sovrapporsi alla pipeline notturna. Lo script
  principale ha già un lock globale: verifica che il tuo comportamento sia
  corretto quando lo trova occupato (deve rinunciare, non aspettare all'infinito).

---

## Vincoli generali

- **Non rompere la pipeline notturna.** È in esercizio e gira ogni notte. Se una
  tua modifica tocca `Invoke-BIPipeline.ps1`, il receiver o le unit systemd, deve
  essere additiva e reversibile, con backup e istruzioni di rollback.
- **Non modificare** `bi.ingest_cruscotto`, `bi.valida_cruscotto_staging`,
  `bi_activate_cruscotto`, `bi_activate_run` né le tabelle storiche
  `bi.costi_storico` / `bi.giacenze_storico`. Sono in esercizio e contengono già
  dati reali (24.083 costi e 35.919 giacenze aperti).
- **Le foreign key verso `bi.cruscotto_runs` sono `ON DELETE RESTRICT`** di
  proposito: cancellare un run non deve poter cancellare lo storico che ha
  prodotto. Non cambiarle.
- **Niente segreti nei commit**: né token, né chiavi, né connection string, né
  CSV aziendali.
- **`.gitattributes` esiste e conta**: gli script destinati a Linux devono
  restare LF, i `.ps1` CRLF. Non aggirarlo — un `\r` di troppo rende uno script
  bash non eseguibile.
- **Non puoi installare nulla sul server Windows**: non è raggiungibile
  dall'ambiente di sviluppo. Consegna script, patch idempotenti con backup,
  istruzioni passo per passo e procedura di rollback. Prevedi sempre una
  modalità di sola verifica (`-Check` o equivalente) che non scriva nulla.
- Migration numerate progressivamente in `supabase/migrations/` (l'ultima è
  `077`), da applicare manualmente.
- **Aggiorna il Vault**: `C:\Users\sebav\Desktop\Vault\`, in particolare
  `Moduli/Preventivatore - Cruscotto Articoli.md`, dove è documentata tutta la
  pipeline. Regole in `CLAUDE.md`: italiano, nomi reali di tabelle e route,
  callout, link `[[Pagina]]`, frontmatter `aggiornato:`.

---

## Come procedere

1. **Prima leggi**, poi progetta: `CLAUDE.md`, le migration `073`–`077`,
   `docs/bi/fase4/README.md`, `docs/bi/fase5/README.md`,
   `scripts/bi-ingest-cruscotto.mjs`, `scripts/bi-cruscotto-stato.mjs`.
2. **Esponi il progetto prima di implementarlo**: schema della coda, contratto
   delle funzioni, flusso completo di una richiesta dal clic all'esito, e come
   il poller parla con Linux. Aspetta conferma.
3. Implementa a strati verificabili: database, poi API, poi interfaccia, poi
   poller.
4. **Verifica quello che scrivi.** Il database è raggiungibile: prova le funzioni
   dentro una transazione con rollback finale, così non lasci residui. Non dire
   "dovrebbe funzionare" — provalo e riporta i numeri.

## Cosa chiedere prima di partire

Se qualcuna di queste risposte ti serve e non la trovi nel repository, chiedila
invece di indovinare:

- ogni quanto ha senso interrogare la coda, dato che l'estrazione dura venti
  minuti e le richieste saranno rare
- chi può richiedere un aggiornamento: qualsiasi utente del portale
  Preventivatore o solo gli amministratori
- se serve una notifica a fine elaborazione (email, o basta la pagina)
- se le richieste vanno conservate a lungo o basta uno storico breve
- se il poller deve poter essere disattivato senza rimuovere l'attività
  pianificata
