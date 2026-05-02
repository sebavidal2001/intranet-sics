# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Development server (Next.js)
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint
npm run type-check   # TypeScript check without emitting (tsc --noEmit)
npm run test         # Vitest - run test suite
npm run test:watch   # Vitest - watch mode
```

Test suite: Vitest + jsdom + @testing-library/react. Test files in `src/tests/`.

## Architecture

### Route groups
```
src/app/
├── (intranet)/                        — Shell intranet (auth required)
│   ├── page.tsx                       — Homepage /
│   └── (portale-valutazioni)/         — Portale Valutazioni (URL invariati: /admin, /analisi, ecc.)
├── (superadmin)/                      — Gestione multi-tenant (solo ruolo superadmin)
├── api/
│   ├── ping/, ruoli-config/           — API condivise intranet
│   └── portali/valutazioni/           — API Portale Valutazioni
└── auth/                              — Login / cambio password (pubbliche)
```

### Authentication & authorization layers

1. **Middleware** (`src/middleware.ts`): Refresh cookie di sessione Supabase su ogni request. Redirect a `/auth/login` se non autenticato. Guard `/superadmin/*` → verifica `ruolo = 'superadmin'` nel DB. Tutte le altre protezioni sono **nelle singole pagine**.

2. **Portale access** (`src/lib/auth/portale.ts`): Sistema a livelli `superadmin > admin > exporter > viewer`. La funzione chiave è `getPortaleAccesso(supabase, userId, portaleSlug)` che chiama la RPC `get_portale_livello` (migration 012). Usare `getPortaliUtente()` (batch RPC, migration 014) quando servono tutti i portali di un utente.

3. **Admin check** (`src/lib/auth/valutazioni-admin.ts`): `isValutazioniAdmin()` → wrapper di `canAdminPortale(supabase, userId, "valutazioni")`. Usata in quasi tutti i server action/route handler admin.

4. **RLS Supabase**: Attivo su tutte le tabelle. Il client utente (`createClient()` da `src/lib/supabase/server.ts`) rispetta RLS. Il client admin (`createAdminClient()` da `src/lib/supabase/admin.ts`) usa la service role key e bypassa RLS — usarlo **solo lato server** dopo aver verificato i permessi manualmente.

### Server actions pattern
Ogni sezione admin ha il proprio `actions.ts` con `"use server"` in cima. Pattern standard:
```ts
async function getAdminClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Non autenticato");
  const isAdmin = await isValutazioniAdmin(supabase, user.id);
  if (!isAdmin) throw new Error("Accesso negato");
  return supabase; // client normale (RLS attivo) o adminClient se serve
}
```
Le action restituiscono `{ error?: string }` oppure `{ data, error }`. Non usano `revalidatePath` nei casi dove il client gestisce lo stato localmente.

### Database (Supabase)
Tabelle principali (schema aggiornato — ignora il vecchio elenco):
- `utenti` — con `ruolo` (testo, validato da `ruoli_config`), `ruoli_aggiuntivi jsonb`, `stato`, `data_assunzione`
- `ruoli_config` — ruoli dinamici del portale (nome, slug, colore)
- `portali` — portali (es. "valutazioni"), con slug e permessi
- `portali_utenti` — join utente↔portale con `livello` (admin/exporter/viewer)
- `sessioni_utente` — sessioni di valutazione per singolo dipendente, con `ordine_profili jsonb`
- `risposte_valutazione` — risposte (autovalutazione o responsabile), con `tipo`
- `ruoli_professionali` → `mansioni` → `skills` — gerarchia profili professionali
- `utente_mansioni` — mansioni assegnate a ogni utente per la sessione
- `certificato_config` — configurazione PDF certificato, con `titoli_scheda jsonb`
- `scale_valutazione`, `parametri_radar`, `kpi_config` — configurabili da admin

Migrazioni SQL numerate in `supabase/migrations/` (001–017). Da eseguire manualmente nel Supabase SQL Editor.

### Ruoli utente
Definiti in `ruoli_config` (DB dinamico). Slug standard: `superadmin`, `amministratore`, `responsabile`, `responsabile_intermedio`, `collaboratore`. Il campo `utente.ruolo` è testo libero corrispondente a uno slug. `hasRole()` in `src/lib/types/index.ts` controlla anche `ruoli_aggiuntivi`.

### Tipi
Tutti in `src/lib/types/index.ts`. No `any` — usare i tipi definiti. `src/lib/types/database.ts` è auto-generato da Supabase.

## Design System

### Colori CSS custom (da usare nelle classi Tailwind via `text-primary`, `bg-bg-page`, ecc.)
```
--color-primary: #00a1be  (azzurro SICS)
--color-primary-dark: #007a91
--color-bg: #ffffff
--color-bg-page: #f8fafc
--color-border: #e2e8f0
--color-text: #1a202c
--color-text-muted: #64748b
--color-success: #22c55e
--color-warning: #f59e0b
--color-danger: #ef4444
--color-storico: #b0b0b0  (parametri storici radar, tratteggiati)
```

### Font
`font-tenorite` per titoli, label importanti, numeri KPI. `system-ui` per il corpo. Definiti in `src/styles/fonts.css`.

### Animazioni standard
- Transizioni pagina: Framer Motion `AnimatePresence`, 200ms ease-out, fade + slide Y 8px→0
- Hover card: `translateY(-2px)`, `box-shadow 0 8px 24px rgba(0,161,190,0.12)`, 150ms
- Focus input: bordo `--color-primary`, 120ms

## Convenzioni

- File: kebab-case. Componenti: PascalCase.
- Server Components di default. `"use client"` solo se necessario (interattività, hooks, browser API).
- `'use server'` in cima ai file `actions.ts`, non nelle singole funzioni.
- Validazione form/input con Zod. Nessun raw SQL (sempre Supabase SDK).
- Ogni route admin fa il proprio check con `isValutazioniAdmin()` — non affidarsi solo al middleware.

## API Routes

**Condivise intranet** (`src/app/api/`):
| Route | Descrizione |
|-------|-------------|
| `GET /api/ruoli-config` | Elenco ruoli da `ruoli_config` DB |

**Portale Valutazioni** (`src/app/api/portali/valutazioni/`):
| Route | Descrizione |
|-------|-------------|
| `GET/POST /api/portali/valutazioni/certificato-config` | Configurazione template PDF |
| `GET /api/portali/valutazioni/certificato/[id]` | Genera PDF certificato per sessione |
| `GET /api/portali/valutazioni/certificato/preview` | Anteprima PDF con dati mock |
| `GET /api/portali/valutazioni/export/powerbi` | Export dati flat per Power BI |
| `POST /api/portali/valutazioni/mansionari/import` | Import CSV/XLSX profili professionali |
| `POST /api/portali/valutazioni/sessioni/sblocca` | Sblocca sessione e invia email |
| `GET /api/portali/valutazioni/sessione-precedente/[id]` | Dati sessione anno precedente |

Tutti i route handler verificano l'autenticazione e i permessi. I PDF sono generati con `@react-pdf/renderer` lato server (logo come base64 data URI per compatibilità path).

## Flusso valutazione

1. Admin crea sessione in `/admin/config/sessioni/[id]/domande` → assegna dipendenti, mansioni, scala, data
2. Admin sblocca → `/api/portali/valutazioni/sessioni/sblocca` → email automatica ai valutatori
3. Responsabile compila in `/valutazioni/responsabile/[id]`
4. Dipendente compila in `/valutazioni/auto/[id]`
5. Admin certifica → genera certificato PDF
6. Analisi disponibile in `/analisi` (utente) e `/analisi/admin` (admin)

Le form di valutazione (`autovalutazione-form.tsx`, `valutazione-form.tsx`) sono generate dinamicamente da mansioni/skills assegnate, ordinate per `ordine_profili` configurato per dipendente.

## Struttura componenti e librerie

```
src/components/
├── ui/                          — Design system primitivi (condivisi)
├── layout/                      — Navbar, sidebar, dashboard layout
├── intranet/                    — Homepage intranet (hero, portal-grid, ecc.)
├── superadmin/                  — Componenti area superadmin
└── portali/
    └── valutazioni/             — Componenti esclusivi Portale Valutazioni
        ├── analisi/             — RadarChart, TrendChart, StoricoTrendChart, DeltaBadge
        ├── forms/               — ValutazioneForm (shared tra auto/responsabile)
        └── mansionari/          — ImportMansionari

src/lib/
├── auth/                        — session.ts, portale.ts, valutazioni-admin.ts, username.ts
├── supabase/                    — client.ts, server.ts, admin.ts
├── types/                       — index.ts, database.ts (auto-generato)
├── email/                       — nodemailer.ts
└── portali/
    └── valutazioni/             — Lib esclusiva Portale Valutazioni
        ├── pdf/                 — certificato.tsx (generazione PDF)
        └── services/            — radar-service.ts
```

Per aggiungere un nuovo portale (es. Preventivatore): crea `(portale-preventivatore)/` in `(intranet)/`, `portali/preventivatore/` in components e lib, `api/portali/preventivatore/` per le API.
