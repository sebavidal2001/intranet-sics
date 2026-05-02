# Piattaforma di Valutazione del Personale - SICS

Sistema di valutazione e analisi del personale basato su Next.js 14 e Supabase.

## Stack Tecnologico

- **Framework**: Next.js 14 (App Router)
- **Database**: Supabase (PostgreSQL + Auth + Storage)
- **Styling**: Tailwind CSS + shadcn/ui
- **Charts**: Recharts
- **Email**: Nodemailer + SMTP (Zoho Mail)
- **Deploy**: Vercel + Supabase

## Prerequisiti

- Node.js 18+
- Account Supabase
- Account Zoho Mail (per email SMTP)

## Setup

1. **Clona il repository**
   ```bash
   git clone <repository-url>
   cd valutazione-platform
   ```

2. **Installa le dipendenze**
   ```bash
   npm install
   ```

3. **Configura le variabili d'ambiente**

   Crea un file `.env.local` basandoti su `.env.local.example`:
   ```bash
   cp .env.local.example .env.local
   ```

   Compila le variabili:
   - `NEXT_PUBLIC_SUPABASE_URL`: URL del progetto Supabase
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Anon key di Supabase
   - `SMTP_HOST`: smtp.zoho.eu (o smtp.zoho.com per US)
   - `SMTP_PORT`: 465
   - `SMTP_SECURE`: true
   - `SMTP_USER`: tua-email@tuodominio.com
   - `SMTP_PASSWORD`: App-specific password di Zoho
   - `SMTP_FROM_NAME`: SICS Valutazione

   **Vedi [docs/SMTP-ZOHO-SETUP.md](docs/SMTP-ZOHO-SETUP.md) per configurazione dettagliata Zoho Mail**

4. **Setup database Supabase**

   Esegui le migration SQL in Supabase Dashboard (vedi `/supabase/migrations/`)

5. **Avvia il server di sviluppo**
   ```bash
   npm run dev
   ```

6. **Apri il browser**

   Vai su [http://localhost:3000](http://localhost:3000)

## Ruoli Utente

- **Admin**: Accesso totale, configura scala, parametri radar, KPI
- **Direttore**: Valuta addetti, vede analisi reparto
- **Addetto**: Compila autovalutazione, vede risultati e trend

## Design System

### Colori
- Primary: `#00a1be`
- Secondary: `#747373`
- Success: `#22c55e`
- Warning: `#f59e0b`
- Danger: `#ef4444`

### Tipografia
- **Titoli/Label**: Tenorite
- **Corpo**: system-ui

## Struttura Progetto

```
src/
├── app/              # Route Next.js 14 (App Router)
├── components/       # Componenti React
│   ├── ui/          # Componenti UI base (shadcn/ui)
│   └── layout/      # Layout (navbar, sidebar)
├── lib/             # Utility e configurazioni
│   ├── supabase/    # Client Supabase
│   ├── types/       # TypeScript types
│   └── utils.ts     # Utility functions
└── styles/          # CSS globale
```

## Scripts

- `npm run dev` - Avvia server sviluppo
- `npm run build` - Build per produzione
- `npm start` - Avvia server produzione
- `npm run lint` - Lint del codice
- `npm run type-check` - Controllo TypeScript

## Deploy

### Vercel

1. Collega il repository a Vercel
2. Configura le variabili d'ambiente
3. Deploy automatico ad ogni push su `main`

### Supabase

1. Crea progetto su Supabase
2. Esegui le migration SQL
3. Configura RLS (Row Level Security)

## Licenza

Proprietario - SICS © 2026
