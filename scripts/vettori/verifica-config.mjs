import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
nextEnv.loadEnvConfig(process.cwd());
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
for (const table of ['vettori', 'listini', 'listini_fasce', 'carburante']) {
  const { data, error } = await db.schema('vettori').from(table).select('*');
  console.log(table, error ? { code: error.code, message: error.message } : table === 'listini_fasce' ? { righe: data.length } : data);
}
