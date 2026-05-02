# Template Email - Piattaforma SICS

Documentazione dei template email utilizzati dalla piattaforma.

---

## 📧 Template Disponibili

### 1. Sessione Valutazione Aperta

**File:** `src/lib/email/nodemailer.ts` → `getSessioneApertainEmailTemplate()`

**Quando viene inviata:**
- Admin sblocca sessione (is_aperta = true)
- Inviata a tutti gli utenti (esclusi admin)

**Parametri:**
- `nomeUtente`: Nome completo utente
- `anno`: Anno della sessione
- `urlPiattaforma`: URL base (es. https://valutazione.sics.it)

**Oggetto:**
```
Sessione Valutazione {anno} - Aperta
```

**Contenuto:**
- Header branded SICS (gradient #00a1be)
- Saluto personalizzato
- Notifica apertura sessione
- Istruzioni step-by-step
- CTA button "Accedi alla Piattaforma"
- Footer con disclaimer

**Preview:**
```
┌─────────────────────────────────────┐
│  SICS - Valutazione Personale       │  (gradient blu)
│  Create to Solve                    │
├─────────────────────────────────────┤
│                                     │
│  Ciao Mario Rossi,                  │
│                                     │
│  La sessione di valutazione 2026    │
│  è stata aperta!                    │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ Cosa fare:                  │   │
│  │ 1. Accedi alla piattaforma  │   │
│  │ 2. Vai in "Valutazioni"     │   │
│  │ 3. Compila autovalutazione  │   │
│  └─────────────────────────────┘   │
│                                     │
│     [Accedi alla Piattaforma]       │  (button blu)
│                                     │
│  Se hai domande, contatta il tuo    │
│  responsabile...                    │
│                                     │
│  ────────────────────────────────   │
│  © 2026 SICS - Create to Solve      │
└─────────────────────────────────────┘
```

---

## ➕ Aggiungere Nuovi Template

### 1. Crea Funzione Template

In `src/lib/email/nodemailer.ts`:

```typescript
export function getNuovoTemplate(
  param1: string,
  param2: number
): string {
  return `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Titolo Email</title>
</head>
<body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <!-- Header SICS -->
  <div style="background: linear-gradient(135deg, #00a1be 0%, #007a91 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">SICS - Valutazione Personale</h1>
    <p style="color: #e6f7fb; margin: 10px 0 0 0;">Create to Solve</p>
  </div>

  <!-- Contenuto -->
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
    <h2 style="color: #00a1be;">Titolo</h2>
    <p>Contenuto...</p>

    <!-- CTA Button -->
    <div style="text-align: center; margin: 30px 0;">
      <a href="URL"
         style="display: inline-block; background: #00a1be; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600;">
        Testo Button
      </a>
    </div>

    <!-- Footer -->
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
    <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">
      © ${new Date().getFullYear()} SICS - Create to Solve<br>
      Questa è una email automatica, si prega di non rispondere.
    </p>
  </div>
</body>
</html>
  `.trim();
}
```

### 2. Usa il Template

```typescript
import { sendEmail, getNuovoTemplate } from "@/lib/email/nodemailer";

await sendEmail({
  to: "utente@example.com",
  subject: "Oggetto Email",
  html: getNuovoTemplate("valore1", 123),
  text: "Versione testo plain (fallback)",
});
```

---

## 🎨 Design Guidelines

### Colori Brand SICS

```css
--primary: #00a1be
--primary-dark: #007a91
--primary-light: #e6f7fb
--text: #1a202c
--text-muted: #64748b
--border: #e2e8f0
--success: #22c55e
--warning: #f59e0b
--danger: #ef4444
```

### Tipografia

- **Font family**: `system-ui, -apple-system, sans-serif`
- **Titoli H1**: 24px, bold, white (su gradient)
- **Titoli H2**: 20px, bold, #00a1be
- **Corpo**: 16px, regular, #1a202c
- **Small**: 14px, #64748b
- **Footer**: 12px, #64748b

### Layout

- **Max width**: 600px (ottimale per email)
- **Padding**: 20-30px
- **Border radius**: 8px (card), 6px (button)
- **Line height**: 1.6

### Button CTA

```html
<a href="URL" style="display: inline-block; background: #00a1be; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">
  Testo Button
</a>
```

### Info Box (con bordo laterale)

```html
<div style="background: #f8fafc; border-left: 4px solid #00a1be; padding: 15px; margin: 25px 0;">
  <p style="margin: 0; color: #64748b; font-size: 14px;">
    <strong>Titolo:</strong> Contenuto...
  </p>
</div>
```

---

## 📱 Responsive Design

Le email sono già responsive grazie a:
- `max-width: 600px` sul body
- `<meta name="viewport" content="width=device-width, initial-scale=1.0">`
- Padding adattivo (usa % invece di px quando necessario)

**Test su:**
- Desktop (Outlook, Gmail, Thunderbird)
- Mobile (Gmail app, iOS Mail)
- Webmail (Gmail web, Outlook web)

---

## ✅ Best Practices

1. **Inline CSS**: Sempre usare inline styles (no `<style>` tag)
2. **Tabelle per layout**: Alcuni client email non supportano flexbox/grid
3. **Alt text**: Aggiungi sempre `alt=""` alle immagini
4. **Plain text**: Fornisci sempre versione text (parametro `text`)
5. **Link assoluti**: Usa URL completi (https://...)
6. **Test invio**: Test su account reale prima di production

---

## 🧪 Test Template

### 1. Test Visivo

Usa strumenti online:
- [Litmus](https://litmus.com/) - Test multi-client
- [Email on Acid](https://www.emailonacid.com/)
- [Mailtrap](https://mailtrap.io/) - Sandbox SMTP

### 2. Test Locale

```typescript
// src/app/api/test-email/route.ts
import { sendEmail, getSessioneApertainEmailTemplate } from "@/lib/email/nodemailer";

export async function GET() {
  await sendEmail({
    to: "tuo-email@test.com",
    subject: "TEST - Sessione Aperta",
    html: getSessioneApertainEmailTemplate(
      "Mario Rossi",
      2026,
      "http://localhost:3000"
    ),
  });

  return Response.json({ ok: true });
}
```

Poi apri: `http://localhost:3000/api/test-email`

---

## 📊 Tracking (Opzionale)

Per tracciare aperture/click, aggiungi:

### Pixel tracking
```html
<img src="https://tuodominio.it/api/track?id=xxx" width="1" height="1" style="display: none;" />
```

### Link tracking
```html
<a href="https://tuodominio.it/r?url=encoded-url&id=xxx">Link</a>
```

**Nota:** Richiede implementazione API `/api/track` e `/r`

---

## 🔒 Privacy & GDPR

- ✅ Disclaimer "email automatica, non rispondere"
- ✅ Link diretto alla piattaforma (no tracking invasivo)
- ✅ Dati personali minimi (solo nome utente)
- ❌ NO marketing o contenuti promozionali
- ❌ NO vendita/condivisione dati

---

**Ultimo aggiornamento:** 2026-03-21
