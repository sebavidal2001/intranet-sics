# Configurazione SMTP Zoho Mail

Guida per configurare Nodemailer con Zoho Mail per l'invio automatico delle email.

---

## 📧 Setup Account Zoho Mail

### 1. Crea Account Zoho (se non hai già)

1. Vai su [zoho.com/mail](https://www.zoho.com/mail/)
2. **Sign Up** → Scegli piano (Free per uso base)
3. Verifica email

### 2. Aggiungi Dominio Custom (Opzionale ma consigliato)

**Per Produzione:**

1. **Zoho Mail** → **Control Panel** → **Domains**
2. **Add Domain** → Inserisci `tuodominio.it`
3. Verifica dominio tramite DNS:
   ```
   TXT @ zb12345678  (valore fornito da Zoho)
   MX  @ mx.zoho.eu   Priority: 10
   MX  @ mx2.zoho.eu  Priority: 20
   MX  @ mx3.zoho.eu  Priority: 50
   ```
4. Attendi verifica (~1-48h)
5. Crea account email: `noreply@tuodominio.it`

**Per Sviluppo/Test:**

Puoi usare il tuo account Zoho personale (es. `tuonome@zohomail.eu`)

---

## 🔐 Genera App-Specific Password (Consigliato)

Zoho richiede password specifica per app terze (più sicuro che usare la password principale).

### Passi:

1. Accedi a [accounts.zoho.eu](https://accounts.zoho.eu) (o .com per US)
2. **Security** → **App Passwords**
3. **Generate New Password**
4. Nome: `SICS Valutazione Platform`
5. **Generate**
6. **Copia la password** (16 caratteri, es. `abcd efgh ijkl mnop`)
7. **IMPORTANTE:** Salvala subito, non sarà più visibile!

---

## ⚙️ Configurazione Variabili Ambiente

### File `.env.local` (Sviluppo)

```bash
# SMTP Zoho
SMTP_HOST=smtp.zoho.eu
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=tuoemail@tuodominio.it
SMTP_PASSWORD=abcd efgh ijkl mnop
SMTP_FROM_NAME=SICS Valutazione

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Vercel (Produzione)

**Settings** → **Environment Variables**:

```
SMTP_HOST          smtp.zoho.eu
SMTP_PORT          465
SMTP_SECURE        true
SMTP_USER          noreply@tuodominio.it
SMTP_PASSWORD      <app-specific-password>
SMTP_FROM_NAME     SICS Valutazione
```

---

## 🌍 Differenze Regionali

### Europa (Italia, Germania, Francia, ecc.)
```bash
SMTP_HOST=smtp.zoho.eu
```

### USA / International
```bash
SMTP_HOST=smtp.zoho.com
```

### India
```bash
SMTP_HOST=smtp.zoho.in
```

**Come verificare:** Controlla la URL quando accedi a Zoho Mail:
- `mail.zoho.eu` → usa `smtp.zoho.eu`
- `mail.zoho.com` → usa `smtp.zoho.com`

---

## 🔌 Configurazione Porte SMTP

### Port 465 (SSL/TLS) - **Consigliato**
```bash
SMTP_PORT=465
SMTP_SECURE=true
```

### Port 587 (STARTTLS) - Alternativa
```bash
SMTP_PORT=587
SMTP_SECURE=false
```

**Nota:** La porta 465 è più sicura e consigliata da Zoho.

---

## ✅ Test Configurazione

### Test Locale

1. Avvia il server:
   ```bash
   npm run dev
   ```

2. Crea test API route (temporaneo):
   ```bash
   curl -X POST http://localhost:3000/api/test-email
   ```

3. Oppure nel browser console (da pagina admin):
   ```javascript
   fetch('/api/sessioni/sblocca', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ sessioneId: 'xxx', isAperta: true })
   })
   ```

4. Controlla:
   - Console Node.js: `✓ Email inviata: <message-id>`
   - Inbox destinatario
   - Zoho Mail → **Sent Items**

---

## 🚨 Troubleshooting

### Errore: "Invalid login"

**Cause possibili:**
- Password sbagliata → Verifica `.env.local`
- SMTP_USER non corrisponde all'account → Deve essere email completa
- Account non verificato → Verifica email Zoho
- App Password non generata → Genera da Security settings

**Soluzione:**
```bash
# Verifica credenziali
SMTP_USER=email-corretta@zoho.eu  # NON solo "email-corretta"
SMTP_PASSWORD=app-specific-password  # NON la tua password normale
```

### Errore: "Connection timeout"

**Cause:**
- Porta bloccata dal firewall
- SMTP_HOST sbagliato (zoho.eu vs zoho.com)

**Soluzione:**
```bash
# Prova porta alternativa
SMTP_PORT=587
SMTP_SECURE=false
```

### Errore: "Self signed certificate"

**Soluzione (solo sviluppo, NON produzione):**
```typescript
// src/lib/email/nodemailer.ts
const transporter = nodemailer.createTransport({
  // ... altre config
  tls: {
    rejectUnauthorized: false  // SOLO per test locale
  }
});
```

### Email in Spam

**Soluzioni:**
1. Verifica dominio su Zoho (aggiungi SPF/DKIM)
2. Aggiungi record DNS:
   ```
   TXT @ v=spf1 include:zoho.eu ~all
   ```
3. Configura DKIM da Zoho Control Panel
4. Evita parole spam nell'oggetto ("Free", "Urgent", ecc.)

---

## 📊 Limiti Zoho Mail

### Piano Free
- **250 email/giorno**
- 5 GB storage
- Max 25 MB allegati

### Piano Mail Lite (€1/utente/mese)
- **500 email/giorno**
- 10 GB storage
- Max 250 MB allegati

**Per la piattaforma SICS:**
- ~100 utenti × 1 email/anno (sblocco sessione) = **100 email/anno** ✅
- Ampiamente sotto il limite free

---

## 🔒 Best Practices Sicurezza

1. ✅ **Usa App-Specific Password** (non password principale)
2. ✅ **NON committare `.env.local`** su Git (già in .gitignore)
3. ✅ **Usa SMTP_SECURE=true** (port 465)
4. ✅ **Abilita 2FA** su account Zoho
5. ✅ **Dominio verificato** per produzione
6. ✅ **DKIM/SPF configurati** per evitare spam

---

## 📝 Checklist Setup

- [ ] Account Zoho creato e verificato
- [ ] Dominio aggiunto (produzione) o email Zoho pronta (dev)
- [ ] App-Specific Password generata
- [ ] Variabili SMTP aggiunte a `.env.local`
- [ ] `npm install` eseguito (nodemailer installato)
- [ ] Test invio email funzionante
- [ ] Email ricevuta in inbox (non spam)
- [ ] Variabili aggiunte su Vercel (produzione)

---

## 🆘 Supporto

**Documentazione Zoho:**
- [SMTP Configuration](https://www.zoho.com/mail/help/zoho-smtp.html)
- [App Passwords](https://www.zoho.com/mail/help/app-passwords.html)

**Nodemailer:**
- [Docs](https://nodemailer.com/about/)
- [SMTP Transport](https://nodemailer.com/smtp/)

**Verifica configurazione SMTP:**
```bash
# Test connessione (da terminale)
telnet smtp.zoho.eu 465
```

---

**Setup completato! 📧**
