# Fase 4 — Receiver a profili e ingest automatico del Cruscotto

Installazione sulla VM Linux `srv-intranet` (192.168.1.21). Tutti i comandi
richiedono `sudo`: l'utente `intra-adm` non appartiene al gruppo `impresa-bi`.

> [!warning] Tre punti che romperebbero la pipeline commerciale
> **1. Tutti i dataset sono obbligatori.** `receiver.py` verifica
> `set(by_dataset) != set(EXPECTED_DATASETS)`: aggiungere `cruscotto_articoli`
> a `config.json` e basta farebbe fallire **ogni** completamento commerciale,
> perché nel manifest delle sette query il Cruscotto mancherebbe.
>
> **2. Intestazione non riconosciuta.** `validate_csv` salta la prima riga solo
> se il primo campo è `Codice Gruppo` o `gruppo_codice`. Nel Cruscotto è
> `codice`: l'header verrebbe contato come riga dati e il conteggio del manifest
> non tornerebbe mai.
>
> **3. Le path unit sono cieche ai profili.** `impresa-bi-daily.path` e
> `impresa-bi-loader.path` monitorano entrambe `/var/lib/impresa-bi/ready`. Un
> run Cruscotto depositato lì farebbe partire il loader commerciale **e** il
> forecast giornaliero.
>
> La patch risolve tutti e tre introducendo il **profilo di run**.

## Cosa fa la patch

- Ogni dataset può dichiarare `profile` (default `commerciale`) e
  `header_first_field`. I sette dataset esistenti **non vanno toccati**: senza
  il campo ricadono nel profilo commerciale e si comportano come prima.
- `/complete` deduce il profilo dai dataset del manifest e pretende esattamente
  quelli di quel profilo. Un manifest che mescola profili viene rifiutato.
- I run non commerciali atterrano in `ready-<profilo>/`, mai in `ready/`.

## File

| File | Destinazione |
|---|---|
| `patch-receiver-profili.py` | eseguito una volta, modifica `/opt/impresa-bi/receiver.py` |
| `test-receiver-profili.py` | collaudo isolato, non tocca nulla di reale |
| `cruscotto-ingest.sh` | `/opt/impresa-bi/cruscotto-ingest.sh` |
| `impresa-bi-cruscotto.path` | `/etc/systemd/system/` |
| `impresa-bi-cruscotto.service` | `/etc/systemd/system/` |

Lo script di ingest vero e proprio (`bi-ingest-cruscotto.mjs`) arriva con il
deploy di intranet-sics in `/opt/intranet-sics/scripts/`.

---

## Installazione rapida

I file sono già stati copiati in `/tmp/fase4` sulla VM. Prima il deploy
dell'app (gli script di ingest arrivano da lì), poi un comando solo:

```bash
ssh intra-adm@192.168.1.21 'cd /opt/intranet-sics && ./deploy.sh'
```

```bash
ssh -t intra-adm@192.168.1.21 'sudo bash /tmp/fase4/installa.sh --check'
```

```bash
ssh -t intra-adm@192.168.1.21 'sudo bash /tmp/fase4/installa.sh'
```

`--check` verifica prerequisiti, corrispondenza della patch e collaudo su copia
isolata, senza scrivere nulla. L'installazione vera riesegue le stesse verifiche
prima di toccare il sistema e si ferma al primo problema.

La procedura passo per passo qui sotto resta valida se preferisci controllare
ogni singolo passaggio.

---

## Installazione passo per passo

### 0. Copiare i file sulla VM

Dalla postazione Windows, nella cartella del repo:

```bash
scp -r docs/bi/fase4 intra-adm@192.168.1.21:/tmp/fase4
```

### 1. Verificare le variabili Supabase

Il servizio legge `/etc/impresa-bi/supabase.env`. Servono un URL e la service
role key. Questo comando mostra **solo i nomi**, mai i valori:

```bash
sudo grep -oE '^[A-Z_]+' /etc/impresa-bi/supabase.env | sort
```

Devono comparire `SUPABASE_URL` (oppure `NEXT_PUBLIC_SUPABASE_URL`) e
`SUPABASE_SERVICE_ROLE_KEY` (oppure `SUPABASE_SERVICE_KEY`): lo script accetta
entrambe le forme. Se mancano, aggiungerle prima di proseguire.

### 2. Collaudare la patch senza applicarla

```bash
sudo python3 /tmp/fase4/patch-receiver-profili.py --check
```

Deve rispondere che le 13 sostituzioni combaciano e il risultato compila. Se
dice che il file non corrisponde alla versione attesa, **fermarsi**: significa
che `receiver.py` è stato modificato nel frattempo.

### 3. Provare il receiver patchato in isolamento

Prima di toccare quello in esercizio:

```bash
cp /opt/impresa-bi/receiver.py /tmp/receiver-prova.py
sudo python3 /tmp/fase4/patch-receiver-profili.py --file /tmp/receiver-prova.py
python3 /tmp/fase4/test-receiver-profili.py --receiver /tmp/receiver-prova.py
```

Attese 11 verifiche su 11. Il test avvia un'istanza su porta libera con storage
in una directory temporanea: non tocca né la configurazione né i dati reali.

### 4. Applicare la patch

```bash
sudo python3 /tmp/fase4/patch-receiver-profili.py
```

Crea da sé un backup `receiver.py.before-profili-<data>`. Rieseguirlo non fa
danni: si accorge di aver già lavorato e si ferma.

### 5. Aggiungere il dataset alla configurazione

```bash
sudo jq '.datasets.cruscotto_articoli = {"columns": 40, "profile": "cruscotto", "header_first_field": "codice"}' \
  /etc/impresa-bi/config.json > /tmp/config-nuovo.json \
  && sudo install -o root -g root -m 640 /tmp/config-nuovo.json /etc/impresa-bi/config.json \
  && rm -f /tmp/config-nuovo.json \
  && sudo jq '.datasets | keys' /etc/impresa-bi/config.json
```

L'ultimo comando elenca i dataset: devono essere gli otto attesi. Se `jq` non
c'è: `sudo apt install -y jq`.

### 6. Riavviare il receiver

```bash
sudo systemctl restart impresa-bi-ingest && sleep 2 && curl -s localhost:8765/health
```

Deve rispondere `{"ok":true,"service":"bi-ingest"}`. Se non riparte:

```bash
sudo journalctl -u impresa-bi-ingest -n 40 --no-pager
```

### 7. Installare runner e unit

```bash
sudo install -o root -g root -m 755 /tmp/fase4/cruscotto-ingest.sh /opt/impresa-bi/cruscotto-ingest.sh
sudo install -o root -g root -m 644 /tmp/fase4/impresa-bi-cruscotto.service /etc/systemd/system/
sudo install -o root -g root -m 644 /tmp/fase4/impresa-bi-cruscotto.path /etc/systemd/system/
sudo install -d -o impresa-bi -g impresa-bi -m 750 \
  /var/lib/impresa-bi/ready-cruscotto \
  /var/lib/impresa-bi/processed-cruscotto \
  /var/lib/impresa-bi/failed-cruscotto
sudo systemctl daemon-reload
sudo systemctl enable --now impresa-bi-cruscotto.path
sudo systemctl status impresa-bi-cruscotto.path --no-pager
```

### 8. Prova a vuoto dell'ingest

Con un CSV Cruscotto reale già sulla VM:

```bash
sudo -u impresa-bi env $(sudo cat /etc/impresa-bi/supabase.env | grep -v '^#' | xargs) \
  node /opt/intranet-sics/scripts/bi-ingest-cruscotto.mjs --file=/percorso/al/cruscotto.csv --dry-run
```

Carica, valida, ripulisce e non tocca la produzione. Un campione parziale viene
correttamente **rifiutato**: è il comportamento voluto, non un errore.

---

## Verifica finale

Dopo il primo run reale spedito dal server Windows:

```bash
# Il run è arrivato ed è stato consumato
ls -la /var/lib/impresa-bi/ready-cruscotto/ /var/lib/impresa-bi/processed-cruscotto/

# Esito dell'ingest
sudo journalctl -u impresa-bi-cruscotto -n 60 --no-pager

# La pipeline commerciale non è stata disturbata
sudo journalctl -u impresa-bi-loader -n 20 --no-pager
sudo systemctl status impresa-bi-daily.path --no-pager
```

Lato database:

```sql
select run_id, status, row_count, articoli_count, published_at
  from bi.cruscotto_runs order by received_at desc limit 5;
```

---

## Ritentare un run fallito

I run che falliscono finiscono in `/var/lib/impresa-bi/failed-cruscotto/<run_id>/`,
con il motivo registrato in `bi.cruscotto_runs.error_message`. Il `run_id` è già
occupato, quindi il retry vuole un identificativo nuovo:

```bash
sudo -u impresa-bi env $(sudo cat /etc/impresa-bi/supabase.env | grep -v '^#' | xargs) \
  node /opt/intranet-sics/scripts/bi-ingest-cruscotto.mjs \
  --file=/var/lib/impresa-bi/failed-cruscotto/<run_id>/cruscotto_articoli.csv \
  --run-id=<run_id>-retry1
```

Rimettere la directory in `ready-cruscotto/` senza cambiare `run_id` non
funziona: l'inserimento in `bi.cruscotto_runs` fallisce per chiave duplicata.
È voluto — evita che un run già valutato venga ricaricato di nascosto.

---

## Rollback

Ordine inverso, ogni passo indipendente dagli altri:

```bash
# 1. Fermare l'automazione del Cruscotto
sudo systemctl disable --now impresa-bi-cruscotto.path
sudo rm -f /etc/systemd/system/impresa-bi-cruscotto.{path,service}
sudo systemctl daemon-reload

# 2. Togliere il dataset dalla configurazione
sudo jq 'del(.datasets.cruscotto_articoli)' /etc/impresa-bi/config.json > /tmp/config-rb.json \
  && sudo install -o root -g root -m 640 /tmp/config-rb.json /etc/impresa-bi/config.json \
  && rm -f /tmp/config-rb.json

# 3. Ripristinare il receiver (sostituire con il backup effettivo)
ls -la /opt/impresa-bi/receiver.py.before-profili-*
sudo python3 /tmp/fase4/patch-receiver-profili.py --restore /opt/impresa-bi/receiver.py.before-profili-<data>
sudo systemctl restart impresa-bi-ingest
```

Il passo 3 da solo basta a tornare al comportamento precedente. I dati già
caricati su Supabase restano: per annullarli serve un intervento separato sul
database, non su questa pipeline.

> [!note] Perché non un receiver separato
> Un secondo processo avrebbe significato duplicare autenticazione, verifica
> SHA256, scrittura atomica e gestione degli upload interrotti — cioè le parti
> in cui gli errori costano di più. La patch riusa tutto e aggiunge solo la
> nozione di profilo.
