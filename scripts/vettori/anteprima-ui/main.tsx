import React from 'react';
import { createRoot } from 'react-dom/client';
import { FattureView } from '../../../src/components/portali/vettori/fatture-view';
import { StoricoView } from '../../../src/components/portali/vettori/storico-view';
import '../../../src/styles/globals.css';

// Collaudo dell'interfaccia con dati inventati, senza autenticazione né
// database. Si sceglie la schermata dal frammento dell'indirizzo:
//   #fatture  (predefinito)   #storico
const schermata = location.hash.replace('#', '') || 'fatture';

const riga=(n:number,dir:string)=>({riga_numero:n,data:'2026-07-01',riferimento:`B${n}`,controparte:n===1?'Fornitore dimostrativo con denominazione estesa':'Cliente dimostrativo',direzione:dir,totale:24,peso:3,abbinamento:'numero',motivo_abbinamento:'Bolla trovata',controllo:{esito:'anomalia',atteso_totale:20,atteso_nolo:18,atteso_carburante:2,atteso_adeguamento:0,peso_reale:3,peso_volumetrico:5,peso_tassabile:5,scostamento:.2,avvertenze:['Fonte peso volumetrico: misure di magazzino.']}});

/* ---------------------------- storico ---------------------------- */

const CONTROPARTI = [
  ['CLIENTE ALFA SPA', 'MI'], ['ROSSI & BIANCHI SNC', 'TO'],
  ['OFFICINE MERIDIONALI SRL', 'NA'], ['COSTRUZIONI VENETE SPA', 'VR'],
  ['IMPIANTI LOMBARDI SRL', 'BG'], ['TECNOSUD SPA', 'BA'],
];
const FORNITORI = [
  ['FORNITORE GAMMA SRL', 'BO'], ['PARKER HANNIFIN ITALY', 'MI'],
  ['SAF CARBONAT CO', 'RE'], ['COMPONENTI NORD SPA', 'VI'],
];
const VETTORI = [['gls', 'GLS'], ['tnt', 'TNT'], ['trading_post', 'Trading Post'], ['fedex', 'FedEx']];

function rigaStorico(i: number, direzione: 'uscita' | 'entrata') {
  const fonte = direzione === 'uscita' ? CONTROPARTI : FORNITORI;
  const [nome, prov] = fonte[i % fonte.length];
  const [codice, vettore] = VETTORI[i % VETTORI.length];
  const atteso = 40 + ((i * 37) % 160);
  // Un quinto delle righe scarta parecchio, il resto poco: serve a vedere in
  // pagina la differenza fra un elenco pieno di rosso e uno leggibile.
  const scarto = i % 5 === 0 ? 0.18 + (i % 3) * 0.11 : (i % 7) * 0.006 - 0.01;
  const fatturato = Math.round(atteso * (1 + scarto) * 100) / 100;
  const esito = scarto > 0.15 ? 'anomalia' : scarto > 0.05 ? 'da_verificare' : 'in_linea';
  const giorno = String(1 + (i % 28)).padStart(2, '0');
  return {
    id: `${direzione}-${i}`, fattura_id: 'f1', direzione,
    vettore_codice: codice, vettore_nome: vettore,
    fattura_numero: `PC/${1200 + (i % 4)}`, data_fattura: '2026-07-31',
    anno: 2026, mese: 7, stato_fattura: i === 3 ? 'bozza' : 'confermata',
    riga_numero: i, data_spedizione: `2026-07-${giorno}`,
    numero_spedizione: `SP${9000 + i}`,
    riferimento: i % 11 === 0 ? null : `2026/00${4500 + i}`,
    controparte: nome, controparte_codice: `CP${i}`,
    provincia: prov, cap: null, porto_descrizione: direzione === 'uscita' ? 'F.CO ADDEB.FT' : 'ASSEGNATO',
    a_nostro_carico: true, colli: 1 + (i % 4), peso: 40 + (i % 90),
    peso_volumetrico: 60 + (i % 150), peso_tassato: 60 + (i % 150),
    nolo: Math.round(fatturato * 0.8 * 100) / 100,
    supplementi: Math.round(fatturato * 0.08 * 100) / 100,
    adeguamento: Math.round(fatturato * 0.05 * 100) / 100,
    carburante: Math.round(fatturato * 0.07 * 100) / 100,
    fatturato, atteso, scostamento: Math.round(scarto * 1000) / 1000,
    esito, abbinamento: i % 11 === 0 ? 'nessuno' : 'numero',
    listino: 'Tariffe nazionali 2026', zona: 'IT', peso_applicato: 'volumetrico',
    avvertenze: i % 5 === 0 ? ['Peso volumetrico non verificabile: misure assenti.'] : [],
    anomalie: esito === 'anomalia' ? 1 : 0,
    anomalie_aperte: esito === 'anomalia' ? 1 : 0,
  };
}

const PARTENZE = Array.from({ length: 24 }, (_, i) => rigaStorico(i, 'uscita'));
const ARRIVI = Array.from({ length: 9 }, (_, i) => rigaStorico(i, 'entrata'));

function totali(righe: ReturnType<typeof rigaStorico>[]) {
  const valide = righe.filter((r) => r.stato_fattura !== 'bozza');
  const somma = (f: (r: (typeof valide)[number]) => number) =>
    Math.round(valide.reduce((a, r) => a + f(r), 0) * 100) / 100;
  return {
    righe: righe.length, righe_valide: valide.length,
    righe_bozza: righe.length - valide.length,
    colli: somma((r) => r.colli), kg: somma((r) => r.peso_tassato),
    fatturato: somma((r) => r.fatturato), atteso: somma((r) => r.atteso),
    anomalie: righe.filter((r) => r.esito === 'anomalia').length,
    con_anomalie_aperte: righe.filter((r) => r.anomalie_aperte > 0).length,
  };
}

const perDirezione = { uscita: PARTENZE.length, entrata: ARRIVI.length };

/* --------------------------- montaggio --------------------------- */

if (schermata === 'storico') {
  // Il filtro lato server è simulato qui in modo grossolano: serve a vedere che
  // la pagina reagisca, non a ricontrollare la SQL (quella è collaudata sul DB).
  window.fetch = (async (_url: string, opzioni: RequestInit) => {
    const f = JSON.parse(String(opzioni?.body ?? '{}'));
    let righe = f.direzione === 'entrata' ? ARRIVI : PARTENZE;
    if (f.cerca) {
      const q = String(f.cerca).toLowerCase();
      righe = righe.filter((r) =>
        [r.controparte, r.riferimento, r.numero_spedizione, r.fattura_numero]
          .some((v) => String(v ?? '').toLowerCase().includes(q))
      );
    }
    if (f.vettori?.length) righe = righe.filter((r) => f.vettori.includes(r.vettore_codice));
    if (f.esiti?.length) righe = righe.filter((r) => f.esiti.includes(r.esito));
    if (f.province?.length) righe = righe.filter((r) => f.province.includes(r.provincia));
    if (f.soloAnomalie) righe = righe.filter((r) => r.anomalie_aperte > 0);
    return new Response(
      JSON.stringify({ righe, totali: totali(righe), per_direzione: perDirezione, pagina: 1, per_pagina: 100 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof window.fetch;

  createRoot(document.getElementById('root')!).render(
    <main style={{ padding: '24px', background: '#f6f8fb', minHeight: '100vh' }}>
      <p style={{ fontSize: 12, color: '#64748b' }}>Dati dimostrativi per collaudo interfaccia</p>
      <StoricoView
        iniziali={{ righe: PARTENZE, totali: totali(PARTENZE), per_direzione: perDirezione, pagina: 1, per_pagina: 100 } as never}
        valori={{
          vettori: VETTORI.map(([codice, nome]) => ({ codice, nome })),
          province: [...new Set([...PARTENZE, ...ARRIVI].map((r) => r.provincia))],
          periodi: [{ anno: 2026, mese: 7 }],
          anni: [2026],
        }}
      />
    </main>
  );
} else {
  window.fetch=async()=>new Response(JSON.stringify({fattura:{vettore:'gls',numero:'ESEMPIO',data:'2026-07-31',avvertenze:[],righeNonLette:[]},quadratura:{ok:true,confronti:[],note:[]},righe:[riga(1,'entrata'),riga(2,'uscita')]}),{status:200,headers:{'Content-Type':'application/json'}});
  createRoot(document.getElementById('root')!).render(<main style={{padding:'24px'}}><p>Dati dimostrativi per collaudo interfaccia</p><FattureView/></main>);
  setTimeout(()=>{const input=document.querySelector<HTMLInputElement>('input[type=file]');if(input){const dt=new DataTransfer();dt.items.add(new File(['demo'],'demo.pdf',{type:'application/pdf'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));}},1000);
}
