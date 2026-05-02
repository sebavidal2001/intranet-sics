# Setup Supabase

## Problema risolto: Login redirect loop

Il problema era che l'utente creato in Supabase Auth (`auth.users`) non aveva un record corrispondente nella tabella `utenti` personalizzata.

## Soluzione: Applica le migrazioni

### 1. Applica le migrazioni SQL

Vai su **Supabase Dashboard** > **SQL Editor** ed esegui nell'ordine:

1. `supabase/migrations/001_initial_schema.sql`
2. `supabase/migrations/002_fix_utenti_auth.sql`

### 2. Inserisci l'utente admin esistente

Se hai già creato un utente admin in Supabase Auth, devi inserirlo anche nella tabella `utenti`:

#### Step A: Trova l'ID dell'utente admin

Esegui nel SQL Editor:

```sql
SELECT id, email FROM auth.users;
```

Copia l'`id` dell'utente admin.

#### Step B: Inserisci il record nella tabella utenti

Apri il file `supabase/scripts/insert_admin_user.sql`, **sostituisci** `'your-auth-user-id'` con l'ID copiato, e modifica email/nome/cognome.

Poi esegui lo script nel SQL Editor.

### 3. Verifica

Esegui nel SQL Editor:

```sql
SELECT u.id, u.email, u.ruolo, au.email as auth_email
FROM utenti u
JOIN auth.users au ON u.id = au.id
WHERE u.ruolo = 'admin';
```

Dovresti vedere il tuo utente admin con gli ID corrispondenti.

### 4. Login

Ora puoi fare login con le credenziali admin e dovresti essere rediretto correttamente al dashboard!

## Utenti futuri

Grazie al trigger creato in `002_fix_utenti_auth.sql`, quando crei nuovi utenti tramite l'interfaccia admin dell'applicazione, il record nella tabella `utenti` verrà creato automaticamente.

## Alternativa rapida via Supabase CLI (se installato)

Se hai Supabase CLI installato:

```bash
supabase db reset
```

Questo applica tutte le migrazioni automaticamente.
