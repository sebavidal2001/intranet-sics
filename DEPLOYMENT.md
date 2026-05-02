# Deploy su server aziendale (VM)

Next.js è configurato con `output: "standalone"` — genera un bundle self-contained senza dipendere da node_modules sul server.

## Requisiti server
- Node.js 18+
- PM2 (`npm install -g pm2`)
- Nginx

## Build e avvio

```bash
# 1. Build
npm run build

# 2. Il bundle standalone si trova in .next/standalone
# Copia public e .next/static dentro standalone
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

# 3. Avvia con PM2
cd .next/standalone
pm2 start server.js --name sics-intranet

# 4. Salva configurazione PM2 per riavvio automatico
pm2 save
pm2 startup
```

## Variabili d'ambiente
Crea `.env.local` nella root prima del build (o imposta variabili di sistema):

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
RESEND_API_KEY=re_...
```

## Nginx — reverse proxy

```nginx
server {
    listen 80;
    server_name intranet.sics.it;  # sostituisci con dominio/IP aziendale

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Database — applicare le migrazioni

```bash
# Con Supabase CLI
supabase db push

# Oppure esegui manualmente in ordine:
# supabase/migrations/001_initial_schema.sql
# supabase/migrations/002_fix_utenti_auth.sql
# supabase/migrations/003_fix_rls_recursion.sql
# supabase/migrations/004_intranet_schema.sql
```

## Primo utente superadmin

> **Ordine importante**: esegui le migrazioni SQL PRIMA di creare l'utente.

1. Applica tutte le migrazioni (vedi sezione sopra)
2. Supabase Dashboard → Authentication → Users → Add user
   - Email: `superadmin@sics.interno`
   - Password: (scegli)
3. Il trigger crea automaticamente la riga in `utenti`. Aggiornala con:
```sql
UPDATE utenti
SET
  nome     = 'Super',
  cognome  = 'Admin',
  ruolo    = 'superadmin',
  username = 'superadmin'
WHERE email = 'superadmin@sics.interno';
```
Il login sulla piattaforma sarà: username `superadmin`, password scelta al punto 2.

## Sviluppo locale

`npm run dev` funziona normalmente — `output: standalone` si attiva solo con `npm run build`.
