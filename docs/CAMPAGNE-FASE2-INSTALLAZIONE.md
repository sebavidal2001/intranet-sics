# Campagne Marketing — Fase 2: installazione

Il controllo contro Impresa **non ha un'estrazione propria**: legge i dati che la pipeline BI
carica già ogni notte (`public.bi_ordinato`, `bi_portafoglio`, `bi_consegnato`). Di nuovo ci sono
una migration, il codice dell'app e un timer che alle 03:30 lancia il controllo.

> Niente di tutto questo è stato eseguito: i file sono nel repo, l'installazione è una decisione
> di chi gestisce la VM. Ogni passo qui sotto si può controllare prima e annullare dopo.

## 0. Prerequisiti

| Cosa | Perché |
|---|---|
| Migration `131_portale_campagne.sql` applicata | La 132 si ferma con un messaggio se manca `campagne.invii` |
| Viste `public.bi_ordinato`, `bi_portafoglio`, `bi_consegnato` e tabella `bi_runs` | Le crea il loader della pipeline sulla VM, **non** una migration: la 132 si applica solo dove ci sono (la VM sì; il Supabase di sviluppo, fermo dal 29/08, va verificato) |
| Schema `campagne` in `pgrst.db_schemas` | Altrimenti ogni query torna vuota senza errore. Vedi la 131 |
| Le tre campagne con storico e destinatari importati e **poi** attivate | Il controllo adotta le buste "X" importate dall'Excel solo se la campagna ha i dati |

## 1. Migration

Sulla VM, come per le altre (sudo senza password sull'utente `intra-adm`):

```bash
scp supabase/migrations/131_portale_campagne.sql supabase/migrations/132_campagne_controllo_impresa.sql intra-adm@192.168.1.21:/tmp/
ssh intra-adm@192.168.1.21 'sudo -n -u postgres psql -d intranet -v ON_ERROR_STOP=1 -f /tmp/131_portale_campagne.sql -f /tmp/132_campagne_controllo_impresa.sql'
```

Verifica (sola lettura): i numeri devono tornare con quelli misurati il 3 ottobre 2026.

```sql
SELECT count(*) AS righe, count(*) FILTER (WHERE aperta) AS aperte
  FROM campagne.impresa_righe(ARRAY['DOCUMENTAZIONE']);          -- ~475 e ~29
SELECT count(*) FROM campagne.impresa_ddt(ARRAY['DOCUMENTAZIONE']);   -- ~449
SELECT campagne.impresa_aggiornato_il();                              -- ~01:31 di stanotte
```

## 2. Token del controllo notturno

Il timer chiama l'app con un token Bearer. Il server lo rifiuta se la variabile manca (503) o è
più corta di 24 caratteri (401).

```bash
# un token casuale
openssl rand -base64 36
```

1. In `/opt/intranet-sics/.env.local`: `CAMPAGNE_CONTROLLO_TOKEN=<token>`
2. In un file solo per il servizio:

```bash
sudo install -d -m 0750 -o root -g impresa-bi /etc/intranet-sics
printf '%s' '<token>' | sudo tee /etc/intranet-sics/campagne-controllo.token >/dev/null
sudo chown root:impresa-bi /etc/intranet-sics/campagne-controllo.token
sudo chmod 0640 /etc/intranet-sics/campagne-controllo.token
```

## 3. Deploy dell'app

```bash
ssh intra-adm@192.168.1.21 'cd /opt/intranet-sics && ./deploy.sh'
```

`deploy.sh` fa `git reset --hard origin/main`: le modifiche vanno **pushate su `main`**, e il
riavvio di pm2 rilegge `.env.local`.

## 4. Il timer

```bash
sudo cp /opt/intranet-sics/scripts/campagne/intranet-campagne-controllo.service /etc/systemd/system/
sudo cp /opt/intranet-sics/scripts/campagne/intranet-campagne-controllo.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now intranet-campagne-controllo.timer
systemctl list-timers intranet-campagne-controllo.timer      # prossima esecuzione: 03:30 Europe/Rome
```

## 5. Prima esecuzione, a mano

```bash
sudo systemctl start intranet-campagne-controllo.service
journalctl -u intranet-campagne-controllo.service -n 20 --no-pager
```

Esito atteso: `Controllo eseguito: {"controllo":{...}}`. Poi:

```sql
SELECT iniziato_il, esito, dati_del, invii_controllati, invii_aggiornati, anomalie_aperte, errore
  FROM campagne.controlli ORDER BY iniziato_il DESC LIMIT 3;
SELECT tipo, count(*) FROM campagne.anomalie WHERE stato = 'aperta' GROUP BY 1;
```

| Esito dello script | Significa |
|---|---|
| `0` con «Controllo eseguito» | Tutto a posto |
| `0` con «gia' in corso» | Un altro controllo (anche manuale dal portale) era attivo: non è un guasto |
| `2` | Token mancante, non leggibile o rifiutato: rileggere il punto 2 |
| `1` | Errore dell'app: guardare `campagne.controlli.errore` e `pm2 logs intranet-sics` |

## Come si legge un guasto

- `controlli.esito = 'errore'`: la lettura delle viste `bi_*` è fallita. Quasi sempre significa che la
  pipeline BI non ha caricato (guardare `public.bi_runs`).
- `invii_controllati = 0` con invii in lavorazione: le campagne non hanno articolo, o gli invii sono
  tutti consegnati.
- Un controllo `in_corso` da più di 15 minuti viene chiuso come «Interrotto» al controllo successivo.

## Rollback

```sql
DROP FUNCTION IF EXISTS campagne.riassegna_ordini(jsonb), campagne.ordini_aperti_cliente(text, integer),
  campagne.da_preparare(integer), campagne.impresa_ddt(text[], text[]), campagne.impresa_ordini(text[]),
  campagne.impresa_righe(text[], text[], boolean), campagne.impresa_aggiornato_il(), campagne.norm_numero(text);
DROP TABLE IF EXISTS campagne.controlli, campagne.anomalie;
ALTER TABLE campagne.invii
  DROP COLUMN IF EXISTS ordine_profilo, DROP COLUMN IF EXISTS ordine_data, DROP COLUMN IF EXISTS ordine_data_consegna,
  DROP COLUMN IF EXISTS riga_vista_il, DROP COLUMN IF EXISTS ddt_numero, DROP COLUMN IF EXISTS ddt_metodo,
  DROP COLUMN IF EXISTS ultimo_controllo_il, DROP COLUMN IF EXISTS controllo_esito;
```

```bash
sudo systemctl disable --now intranet-campagne-controllo.timer
sudo rm /etc/systemd/system/intranet-campagne-controllo.{service,timer}
```

Il codice dell'app tollera l'assenza della 132: scheda e home funzionano senza ordini aperti,
anomalie e «da preparare».
