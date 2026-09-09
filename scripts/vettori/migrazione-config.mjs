import nextEnv from '@next/env';
import { readFileSync } from 'node:fs';
nextEnv.loadEnvConfig(process.cwd());
const progetto = process.env.SUPABASE_PROJECT_ID;
const sql = readFileSync('supabase/migrations/093_vettori_listini_configurabili.sql', 'utf8');
const applica = process.argv.includes('--applica');
const collaudo = process.argv.includes('--collauda') ? readFileSync('scripts/vettori/collaudo-versione.sql', 'utf8') : '';
const query = applica ? sql : `BEGIN; ${sql} ${collaudo} ROLLBACK;`;
const res = await fetch(`https://api.supabase.com/v1/projects/${progetto}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query }),
});
if (!res.ok) { console.error(res.status, await res.text()); process.exitCode = 1; }
else console.log(applica ? 'Migrazione 093 applicata al database di sviluppo.' : 'Migrazione 093 valida: transazione annullata.', await res.json());
