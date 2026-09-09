import nextEnv from '@next/env';
import { readFileSync } from 'node:fs';
nextEnv.loadEnvConfig(process.cwd());
const sql = readFileSync('supabase/migrations/094_vettori_outlook.sql', 'utf8');
const test = `DO $$ DECLARE d jsonb; BEGIN
  PERFORM vettori.prepara_bozza_outlook(repeat('a',64), '{"oggetto":"Collaudo","corpo":"Bozza di prova","destinatari":["test@example.invalid"],"cc":[]}', NULL);
  d := vettori.ritira_bozza_outlook(repeat('a',64));
  IF d->>'oggetto' <> 'Collaudo' THEN RAISE EXCEPTION 'Contenuto perso'; END IF;
  IF vettori.ritira_bozza_outlook(repeat('a',64)) IS NOT NULL THEN RAISE EXCEPTION 'Token riutilizzabile'; END IF;
  PERFORM vettori.prepara_bozza_outlook(repeat('b',64), '{}', NULL);
  UPDATE vettori.bozze_outlook SET scade_il=now()-interval '1 minute' WHERE token_hash=repeat('b',64);
  IF vettori.ritira_bozza_outlook(repeat('b',64)) IS NOT NULL THEN RAISE EXCEPTION 'Token scaduto accettato'; END IF;
  IF has_function_privilege('authenticated','vettori.ritira_bozza_outlook(text)','EXECUTE') THEN RAISE EXCEPTION 'Permessi aperti'; END IF;
END $$;`;
const applica = process.argv.includes('--applica');
const res = await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_ID}/database/query`, { method:'POST', headers:{ Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type':'application/json' }, body:JSON.stringify({query: applica ? sql : `BEGIN; ${sql} ${test} ROLLBACK;`}) });
if (!res.ok) { console.error(res.status,await res.text()); process.exitCode=1; } else console.log(applica ? 'Migration 094 applicata in sviluppo.' : 'Token monouso, scadenza e permessi verificati; rollback completato.');
