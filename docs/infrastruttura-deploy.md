# Infrastruttura & Deploy — SICS Platform

> Documento di riferimento per sistemisti e sviluppatori. Generato da conversazione tecnica del 2026-04-01.
> Da aggiornare ad ogni nuovo portale aggiunto alla piattaforma.

---

## Stack tecnologico

| Componente | Tecnologia | Versione | Ruolo |
|---|---|---|---|
| Frontend / Backend | Next.js (full-stack SSR) | 14.x | Unica applicazione che serve pagine e logica |
| Runtime | Node.js | ≥ 20 LTS | Motore di esecuzione di Next.js sul server |
| Database + Auth | Supabase Cloud | — | DB, autenticazione, storage, RLS |
| Process manager | PM2 | — | Mantiene Next.js attivo e lo riavvia se crasha |
| Reverse proxy | Nginx | — | Gestisce HTTPS, smista traffico a Next.js |

**Decisione definitiva: Supabase Cloud (datacenter Francoforte, EU).**
Motivazione: semplicità operativa, SLA garantito, conformità GDPR UE. Self-hosted valutabile in futuro solo se arriva un requisito normativo esplicito di residenza dati on-premise.

---

## Architettura

```
Utente (browser)
      │ HTTPS :443
   [Nginx]          ← reverse proxy, TLS termination
      │ HTTP :3000 (solo locale)
  [Next.js]         ← app server, gestito da PM2
      │ HTTPS :443 (uscita)
 [Supabase Cloud]   ← PostgreSQL + Auth + Storage (Francoforte)
      │ SMTP :587 (uscita)
 [Server SMTP]      ← email notifiche
```

Next.js è compilato in **modalità standalone** (`output: 'standalone'` in `next.config.mjs`): bundle self-contained, sul server serve solo Node.js.

---

## Requisiti hardware VM

| Risorsa | Minimo | Consigliato |
|---|---|---|
| CPU | 2 vCPU | 4 vCPU |
| RAM | 2 GB | 4 GB |
| Disco | 20 GB | 40 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |

Nessun disco aggiuntivo per il database (Supabase è esterno).

---

## Software da installare sulla VM

```
Node.js 20 LTS      (via nvm o NodeSource)
PM2                 (npm install -g pm2)
Nginx
```

---

## Porte e firewall

### Porte attive sulla VM

| Servizio | Porta | Esposta | Note |
|---|---|---|---|
| Nginx HTTPS | 443 | Sì | Unico ingresso utenti |
| Nginx HTTP | 80 | Sì | Solo redirect a 443 |
| Next.js | 3000 | **No** | Solo locale (127.0.0.1) — non aprire sul firewall |
| Supabase Cloud | 443 | — | Connessione in uscita dalla VM, nessuna porta in entrata |

### Regole firewall

| Direzione | Porta | Da/Verso | Motivo |
|---|---|---|---|
| In entrata | 443 | Rete aziendale | Traffico utenti HTTPS |
| In entrata | 80 | Rete aziendale | Redirect a 443 |
| In entrata | 22 | Solo IP IT aziendale | SSH manutenzione |
| In uscita | 443 | `*.supabase.co` | Connessione DB Cloud |
| In uscita | 587 | Server SMTP aziendale | Email notifiche |
| Tutto il resto | — | — | **Bloccare** |

---

## Variabili d'ambiente (.env.local)

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # MAI esporre al client — solo server

# Email
SMTP_HOST=smtp.azienda.it
SMTP_PORT=587
SMTP_USER=noreply@azienda.it
SMTP_PASS=...
SMTP_FROM=noreply@azienda.it

# App
NEXT_PUBLIC_APP_URL=https://intranet.azienda.it
```

> `SUPABASE_SERVICE_ROLE_KEY` bypassa tutti i controlli di accesso al DB. Non deve mai finire nel codice o nel repository Git.

---

## Procedura di deploy

```bash
# 1. Build (in locale o su CI)
npm ci
npm run build

# 2. Copiare sul server
.next/standalone/
.next/static/
public/

# 3. Avviare con PM2
pm2 start .next/standalone/server.js --name sics-platform
pm2 save
pm2 startup

# 4. Nginx: proxy pass da :443 a :3000
```

---

## Sicurezza

### Già attivo nel codice
- **RLS (Row Level Security)**: ogni utente vede solo i propri dati, implementato nelle migrazioni SQL.
- **Service Role Key solo server**: la chiave admin non è mai esposta al browser.

### Da configurare su Supabase (pannello → Settings → Network)
- **IP Allowlist**: consentire solo l'IP pubblico della VM aziendale.
- **MFA sull'account Supabase**: obbligatorio per l'account admin del pannello.
- **Backup automatici + PITR**: attivi su piano Pro (retention 7 giorni).

### Da configurare sull'infrastruttura
- Certificato TLS: Let's Encrypt (se IP pubblico) o CA aziendale (se rete interna).
- Rotazione chiavi API: ogni 6-12 mesi o immediatamente in caso di compromissione sospetta.
- Variabili d'ambiente mai nel repository Git (`.env.local` è in `.gitignore`).

---

## GDPR

### Base giuridica per portale

| Portale | Dati trattati | Base giuridica |
|---|---|---|
| Valutazioni | Dipendenti (valutazioni, competenze) | Contratto di lavoro |
| Preventivi | Clienti B2B (nome, email, P.IVA) | Legittimo interesse contrattuale |
| Preventivi | Clienti B2C (privati) | Consenso esplicito obbligatorio |
| Preventivi | Articoli / listino | Non dati personali — nessun obbligo |

### Adempimenti obbligatori

| Cosa | Quando |
|---|---|
| Informativa privacy dipendenti | Prima del go-live portale valutazioni |
| DPA con Supabase (dal pannello) | Prima del go-live qualsiasi portale |
| Privacy policy per clienti | Prima del go-live portale preventivi |
| Registro delle attività di trattamento | Obbligatorio se >250 dipendenti, consigliato sempre |

> Per gli aspetti legali GDPR consultare un consulente privacy o DPO.

### Supabase come responsabile del trattamento
Supabase è certificato SOC 2 Type 2, datacenter Francoforte (eu-central-1), crittografia AES-256 at rest + TLS in transit. Va inserito nel Registro dei trattamenti come "responsabile esterno".

---

## Portali pianificati

| Portale | Stato | Dati sensibili | Note |
|---|---|---|---|
| Valutazioni dipendenti | In sviluppo | Dati personali interni | Schema DB in `supabase/migrations/` (001–018) |
| Builder preventivi | Pianificato | Dati clienti + commerciali | Stessa infrastruttura, tabelle separate con RLS dedicata |

### Note per nuovi portali
- Ogni nuovo portale aggiunge tabelle su **stesso Supabase** — nessuna infrastruttura aggiuntiva.
- Ogni portale ha la propria RLS per isolare i dati.
- Se il portale tratta dati di terzi (clienti, fornitori), aggiornare il Registro dei trattamenti e verificare la base giuridica prima del go-live.
- IP Allowlist su Supabase diventa critica appena entrano dati di clienti nel DB.

---

## Contatti e riferimenti

| Risorsa | Link |
|---|---|
| Supabase dashboard | https://supabase.com/dashboard |
| Supabase self-hosting docs | https://supabase.com/docs/guides/self-hosting |
| DPA Supabase | Disponibile nel pannello Settings → Legal |
| PM2 docs | https://pm2.keymetrics.io/docs |
