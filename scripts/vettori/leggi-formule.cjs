const XLSX = require('xlsx');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(require('node:os').tmpdir(), 'sics-vettori-excel');
for (const file of fs.readdirSync(dir)) {
  const w = XLSX.readFile(path.join(dir,file), { cellFormula:true });
  console.log('\nFILE',file,'FOGLI',w.SheetNames);
  for (const name of w.SheetNames) {
    const s=w.Sheets[name];
    const labels=Object.entries(s).filter(([k,c])=>!k.startsWith('!') && typeof c.v==='string' && /volum|misur|lung|larg|altezz|arriv|invi|partenz/i.test(c.v));
    if (!labels.length) continue;
    console.log('FOGLIO',name,'ETICHETTE',labels.slice(0,25).map(([k,c])=>[k,c.v]));
    const formulas=Object.entries(s).filter(([k,c])=>c.f);
    console.log('FORMULE',formulas.slice(0,24).map(([k,c])=>[k,c.f,c.v]));
    console.log('PRIME RIGHE',XLSX.utils.sheet_to_json(s,{header:1,range:0,blankrows:false}).slice(0,6));
  }
}
