import nextEnv from '@next/env';
nextEnv.loadEnvConfig(process.cwd());
const query = `select v.codice as vettore,l.valido_dal,s.codice,s.valore,s.tipo_calcolo,s.condizione,s.base_nolo from vettori.listini_supplementi s join vettori.listini l on l.id=s.listino_id join vettori.vettori v on v.id=l.vettore_id order by v.codice,l.valido_dal,s.ordine`;
const res=await fetch(`https://api.supabase.com/v1/projects/${process.env.SUPABASE_PROJECT_ID}/database/query`,{method:'POST',headers:{Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query})});
if(!res.ok)throw new Error(`Verifica fallita ${res.status}`); console.log(JSON.stringify(await res.json()));
