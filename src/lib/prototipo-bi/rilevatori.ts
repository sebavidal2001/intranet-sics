/**
 *
 * STADIO 1 e 2 dell'analista: RILEVAMENTO e RILEVANZA.
 *
 * Qui non entra l'AI. I rilevatori sono deterministici, riproducibili e
 * testabili: se cercasse le anomalie il modello, ne troverebbe sempre, anche
 * quando non ce ne sono. L'AI interviene solo dopo, per spiegare i segnali
 * sopravvissuti (stadio 3) e scriverli (stadio 4).
 *
 * Due lezioni imparate dai dati reali SICS, cablate qui dentro:
 *
 *  · CHIUSURE — nel 2026 dal 10 al 23 agosto non c'è un solo ordine. Un
 *    rilevatore ingenuo urlerebbe "ordinato azzerato" per due mattine.
 *    Le settimane senza giorni lavorativi vengono ESCLUSE dalle serie.
 *
 *  · CONCENTRAZIONE — la settimana 3–9 agosto è +2,2σ, ma il 72% viene da
 *    due clienti (CURTI 48%, IMA 24%). La notizia non è "il mercato cresce",
 *    è "è arrivato l'ordine CURTI". Ogni scostamento viene scomposto prima
 *    di essere raccontato.
 */

import { esegui, quantitaOrientata } from "./semantico";
import {
  budgetProgressivoAl,
  distribuisci,
} from "./budget";
import { costruisciCalendario, dataDaIso, iso, settimanaIso } from "./calendario";
import { chiusureEffettive } from "./chiusure-dedotte";
import { fattoreNovita } from "./selezione-briefing";
import type {
  ConfigurazioneAnno,
  DistribuzioneBudget,
  RigaFatto,
  Segnale,
  Snapshot,
  SpecQuery,
} from "./tipi";

// ─────────────────────────────────────────────────────────────────────────────
// Soglie — deliberatamente ALTE. Si abbassano dopo, si rialzano mai.
// ─────────────────────────────────────────────────────────────────────────────

export const SOGLIE = {
  /** Sotto questa cifra non è una notizia, per quanto grande sia la %. */
  magnitudineMinimaEuro: 15_000,
  /** Scostamento dal budget oltre il quale si segnala. */
  scostamentoBudgetPct: 10,
  /** Deviazioni standard oltre cui una settimana è "fuori serie". */
  zSettimana: 2.0,
  /** Giorni di silenzio oltre cui un cliente è dormiente. */
  giorniDormiente: 120,
  /** Quota oltre la quale un singolo cliente "è" il periodo. */
  concentrazionePct: 40,
  /** Giorni oltre cui un preventivo aperto è considerato invecchiato. */
  giorniPreventivoVecchio: 90,
  /** Ore oltre cui il run dati è considerato in ritardo. */
  oreRunInRitardo: 30,

  // Famiglie con una scala propria. Misurate sui dati 2025-2026: con la soglia
  // unica di 15.000 € margine e clienti ritornati non sarebbero MAI usciti (il
  // calo di margine del cliente piu' colpito valeva 3.000 € a trimestre), e il
  // briefing avrebbe continuato a parlare solo di budget e dormienti.

  /** Margine: punti persi dal cliente e margine perso minimo, totale e per cliente. */
  marginePuntiPersi: 3,
  margineMinimoEuro: 3_000,
  margineMinimoClienteEuro: 500,
  /** Clienti ritornati: silenzio che rende "ritorno" un ordine, e valore minimo. */
  giorniSilenzioRitorno: 180,
  giorniFinestraRitorni: 45,
  ritorniMinimoEuro: 5_000,
  /** Consegne: quota del valore confermata oltre la data chiesta, o peggioramento. */
  consegneQuotaPct: 25,
  consegnePeggioramentoPunti: 5,
  /** Costi d'acquisto: rincaro minimo per articolo e impatto minimo totale. */
  costoRincaroPct: 5,
  costiImpattoMinimoEuro: 10_000,
  /** Un articolo conta solo se venduto in almeno tanti documenti: esclude le commesse. */
  costoDocumentiMinimi: 3,
};

function arr(n: number) {
  return Math.round(n * 100) / 100;
}

function pct(parte: number, totale: number) {
  if (!totale) return 0;
  return arr((parte / totale) * 100);
}

function giorniTra(a: string, b: string) {
  return Math.round((dataDaIso(b).getTime() - dataDaIso(a).getTime()) / 86400000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Contesto passato ai rilevatori
// ─────────────────────────────────────────────────────────────────────────────

export interface ContestoRilevatori {
  snapshot: Snapshot;
  config: ConfigurazioneAnno | null;
  distribuzione: DistribuzioneBudget | null;
  /** Data di riferimento: l'ultimo giorno coperto dai dati. */
  oggi: string;
  /** Filtro di scope: se valorizzato, il briefing è di un singolo agente. */
  agente?: string | null;
}

export function costruisciContesto(
  snapshot: Snapshot,
  config: ConfigurazioneAnno | null,
  agente?: string | null
): ContestoRilevatori {
  const oggi = snapshot.dataMassima ?? iso(new Date());
  return {
    snapshot,
    config,
    distribuzione: config ? distribuisci(config) : null,
    oggi,
    agente: agente ?? null,
  };
}

function filtriScope(ctx: ContestoRilevatori): SpecQuery["filtri"] {
  return ctx.agente ? [{ campo: "agente", op: "eq", valore: ctx.agente }] : [];
}

function righeScope(ctx: ContestoRilevatori, righe: RigaFatto[]): RigaFatto[] {
  return ctx.agente ? righe.filter((r) => r.agente === ctx.agente) : righe;
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 1 — Scostamento dal budget (progressivo, normalizzato)
// ─────────────────────────────────────────────────────────────────────────────

function rilevaScostamentoBudget(ctx: ContestoRilevatori): Segnale[] {
  if (!ctx.distribuzione || !ctx.config) return [];
  const anno = Number(ctx.oggi.slice(0, 4));
  if (anno !== ctx.config.anno) return [];

  const segnali: Segnale[] = [];
  const prog = budgetProgressivoAl(ctx.distribuzione, ctx.oggi);
  if (prog.budget <= 0) return [];

  for (const metrica of ["ordinato", "fatturato"] as const) {
    const spec: SpecQuery = {
      metrica,
      modificatore: "progressivo",
      periodo: { dal: `${anno}-01-01`, al: ctx.oggi },
      filtri: filtriScope(ctx),
    };
    const res = esegui(spec, ctx.snapshot);
    const effettivo = res.totale;

    // Se il briefing è di un agente, il budget di confronto è il suo.
    let budgetRif = prog.budget;
    if (ctx.agente) {
      const suo = ctx.distribuzione.perAgente
        .filter((r) => r.chiave === ctx.agente && r.data <= ctx.oggi)
        .reduce((s, r) => s + r.budget, 0);
      if (suo <= 0) continue;
      budgetRif = arr(suo);
    }

    const delta = arr(effettivo - budgetRif);
    const deltaPct = pct(delta, budgetRif);
    if (Math.abs(deltaPct) < SOGLIE.scostamentoBudgetPct) continue;
    if (Math.abs(delta) < SOGLIE.magnitudineMinimaEuro) continue;

    const bepProg = ctx.agente ? null : prog.bep;
    const sottoBep = bepProg !== null && effettivo < bepProg;

    segnali.push({
      id: `budget-${metrica}`,
      famiglia: "scostamento_budget",
      titolo: `${metrica === "ordinato" ? "Ordinato" : "Fatturato"} progressivo ${
        delta >= 0 ? "sopra" : "sotto"
      } budget del ${Math.abs(deltaPct)}%`,
      descrizione:
        `Progressivo ${anno} al ${ctx.oggi}: ${arr(effettivo)} € contro un budget ` +
        `progressivo di ${budgetRif} € (${delta >= 0 ? "+" : ""}${delta} €, ` +
        `${deltaPct >= 0 ? "+" : ""}${deltaPct}%). ` +
        `Giorni lavorativi trascorsi: ${prog.giorniTrascorsi} su ${ctx.distribuzione.giorniLavorativi}.` +
        (sottoBep ? ` Il progressivo è anche sotto il BEP (${bepProg} €).` : ""),
      magnitudineEuro: Math.abs(delta),
      persistenza: 0.9, // il progressivo è per costruzione persistente
      azionabilita: sottoBep ? 0.9 : 0.6,
      direzione: delta >= 0 ? "positivo" : "negativo",
      punteggio: 0,
      prove: [
        { descrizione: `${metrica} progressivo ${anno} al ${ctx.oggi}`, spec },
      ],
      dettaglio: {
        effettivo: arr(effettivo),
        budget: budgetRif,
        bep: bepProg,
        delta,
        deltaPct,
        giorniTrascorsi: prog.giorniTrascorsi,
        giorniTotali: ctx.distribuzione.giorniLavorativi,
        sottoBep,
      },
    });
  }

  return segnali;
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 2 — Rottura di serie settimanale (con esclusione delle chiusure)
// ─────────────────────────────────────────────────────────────────────────────

interface PuntoSettimana {
  settimana: string;
  valore: number;
  lavorativi: number;
}

function serieSettimanale(
  ctx: ContestoRilevatori,
  metrica: "ordinato" | "fatturato" | "consegnato"
): PuntoSettimana[] {
  const anno = Number(ctx.oggi.slice(0, 4));
  const spec: SpecQuery = {
    metrica,
    granularita: "settimana",
    periodo: { dal: `${anno - 1}-01-01`, al: ctx.oggi },
    filtri: filtriScope(ctx),
    ordina: "etichetta",
  };
  const res = esegui(spec, ctx.snapshot);

  // Giorni lavorativi per settimana: serve a scartare le settimane di chiusura
  // invece di leggerle come crolli.
  const lavorativiPerSettimana = new Map<string, number>();
  for (const a of [anno - 1, anno]) {
    const cal = costruisciCalendario(
      a,
      // Se il calendario aziendale non e' compilato, le chiusure si deducono
      // dai dati: senza, le due settimane di agosto senza un solo documento
      // diventerebbero una rottura di serie da annunciare in briefing.
      chiusureEffettive(ctx.config?.chiusure, ctx.snapshot, a).chiusure,
      ctx.config?.escludiWeekend ?? true
    );
    for (const g of cal) {
      if (!g.lavorativo) continue;
      lavorativiPerSettimana.set(
        g.settimanaIso,
        (lavorativiPerSettimana.get(g.settimanaIso) ?? 0) + 1
      );
    }
  }

  return res.righe.map((r) => ({
    settimana: r.etichetta,
    valore: r.valore,
    lavorativi: lavorativiPerSettimana.get(r.etichetta) ?? 0,
  }));
}

function rilevaRotturaSerie(ctx: ContestoRilevatori): Segnale[] {
  const segnali: Segnale[] = [];
  const settimanaCorrente = settimanaIso(dataDaIso(ctx.oggi));

  for (const metrica of ["ordinato", "fatturato"] as const) {
    const serie = serieSettimanale(ctx, metrica).filter((p) => p.lavorativi >= 3);
    if (serie.length < 10) continue;

    // Si valuta l'ultima settimana COMPLETA, non quella in corso.
    const indiceUltima = serie.findIndex((p) => p.settimana === settimanaCorrente);
    const fine = indiceUltima >= 0 ? indiceUltima : serie.length;
    const ultima = serie[fine - 1];
    if (!ultima) continue;

    const storico = serie.slice(Math.max(0, fine - 9), fine - 1);
    if (storico.length < 6) continue;

    // Normalizzazione per giorno lavorativo: settimane da 3 e da 5 giorni
    // non sono confrontabili in valore assoluto.
    const perGiorno = (p: PuntoSettimana) => (p.lavorativi ? p.valore / p.lavorativi : 0);
    const valori = storico.map(perGiorno);
    const media = valori.reduce((s, v) => s + v, 0) / valori.length;
    const varianza =
      valori.reduce((s, v) => s + (v - media) ** 2, 0) / (valori.length - 1);
    const sd = Math.sqrt(varianza);
    if (sd <= 0) continue;

    const z = (perGiorno(ultima) - media) / sd;
    if (Math.abs(z) < SOGLIE.zSettimana) continue;

    const delta = arr(ultima.valore - media * ultima.lavorativi);
    if (Math.abs(delta) < SOGLIE.magnitudineMinimaEuro) continue;

    // Scomposizione obbligatoria: chi genera lo scostamento.
    const lunedi = dataDaIso(`${ultima.settimana.slice(0, 4)}-01-04`);
    const specClienti: SpecQuery = {
      metrica,
      raggruppa: ["cliente"],
      periodo: settimanaAPeriodo(ultima.settimana),
      filtri: filtriScope(ctx),
      ordina: "valore_desc",
      limite: 5,
    };
    void lunedi;
    const clienti = esegui(specClienti, ctx.snapshot);
    const totaleSettimana = clienti.totale;
    const primi = clienti.righe.map((r) => ({
      cliente: r.etichetta,
      importo: r.valore,
      quotaPct: pct(r.valore, totaleSettimana),
    }));
    const quotaPrimiDue = arr(primi.slice(0, 2).reduce((s, c) => s + c.quotaPct, 0));

    segnali.push({
      id: `serie-${metrica}-${ultima.settimana}`,
      famiglia: "rottura_serie",
      titolo: `${metrica === "ordinato" ? "Ordinato" : "Fatturato"} della settimana ${
        ultima.settimana
      } fuori dalla norma (${z > 0 ? "+" : ""}${arr(z)}σ)`,
      descrizione:
        `Settimana ${ultima.settimana}: ${arr(ultima.valore)} € su ${ultima.lavorativi} ` +
        `giorni lavorativi, contro una media delle 8 settimane precedenti di ` +
        `${arr(media * ultima.lavorativi)} € a parità di giorni (${delta >= 0 ? "+" : ""}${delta} €). ` +
        `I primi due clienti pesano il ${quotaPrimiDue}% della settimana.`,
      magnitudineEuro: Math.abs(delta),
      persistenza: 0.3, // una settimana sola è debole per definizione
      azionabilita: 0.5,
      direzione: z > 0 ? "positivo" : "negativo",
      punteggio: 0,
      prove: [
        { descrizione: `${metrica} per cliente, settimana ${ultima.settimana}`, spec: specClienti },
      ],
      dettaglio: {
        settimana: ultima.settimana,
        valore: arr(ultima.valore),
        mediaAttesa: arr(media * ultima.lavorativi),
        z: arr(z),
        giorniLavorativi: ultima.lavorativi,
        primiClienti: primi,
        quotaPrimiDue,
      },
    });
  }

  return segnali;
}

/** Da `2026-W35` all'intervallo di date lunedì–domenica. */
function settimanaAPeriodo(sett: string): { dal: string; al: string } {
  const [annoStr, wStr] = sett.split("-W");
  const anno = Number(annoStr);
  const settimana = Number(wStr);
  // Il 4 gennaio sta sempre nella settimana ISO 1.
  const quattroGen = new Date(Date.UTC(anno, 0, 4));
  const giornoSett = quattroGen.getUTCDay() || 7;
  const lunedi1 = new Date(quattroGen.getTime() - (giornoSett - 1) * 86400000);
  const lunedi = new Date(lunedi1.getTime() + (settimana - 1) * 7 * 86400000);
  const domenica = new Date(lunedi.getTime() + 6 * 86400000);
  return { dal: iso(lunedi), al: iso(domenica) };
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 3 — Clienti dormienti
// ─────────────────────────────────────────────────────────────────────────────

function rilevaClientiDormienti(ctx: ContestoRilevatori): Segnale[] {
  const righe = righeScope(ctx, ctx.snapshot.dataset.ordinato);
  const perCliente = new Map<
    string,
    { ultima: string; totale: number; agente: string; ordini: Set<string> }
  >();

  for (const r of righe) {
    if (!r.data) continue;
    const c = perCliente.get(r.cliente) ?? {
      ultima: r.data,
      totale: 0,
      agente: r.agente,
      ordini: new Set<string>(),
    };
    if (r.data > c.ultima) {
      c.ultima = r.data;
      c.agente = r.agente;
    }
    c.totale += r.importo;
    if (r.documento) c.ordini.add(r.documento);
    perCliente.set(r.cliente, c);
  }

  const dormienti = [...perCliente.entries()]
    .map(([cliente, c]) => ({
      cliente,
      agente: c.agente,
      ultima: c.ultima,
      giorni: giorniTra(c.ultima, ctx.oggi),
      totaleStorico: arr(c.totale),
      ordini: c.ordini.size,
    }))
    // Solo clienti che erano davvero attivi: almeno 2 ordini e un valore reale.
    .filter(
      (c) =>
        c.giorni >= SOGLIE.giorniDormiente &&
        c.ordini >= 2 &&
        c.totaleStorico >= 5_000
    )
    .sort((a, b) => b.totaleStorico - a.totaleStorico);

  if (dormienti.length === 0) return [];

  const valoreTotale = arr(dormienti.reduce((s, c) => s + c.totaleStorico, 0));
  if (valoreTotale < SOGLIE.magnitudineMinimaEuro) return [];

  // Concentrazione per agente: rende il segnale azionabile da qualcuno.
  const perAgente = new Map<string, number>();
  for (const c of dormienti) perAgente.set(c.agente, (perAgente.get(c.agente) ?? 0) + 1);
  const agentePrincipale = [...perAgente.entries()].sort((a, b) => b[1] - a[1])[0];

  return [
    {
      id: "dormienti",
      famiglia: "clienti_dormienti",
      titolo: `${dormienti.length} clienti non ordinano da oltre ${SOGLIE.giorniDormiente} giorni`,
      descrizione:
        `${dormienti.length} clienti con almeno 2 ordini storici non acquistano da più di ` +
        `${SOGLIE.giorniDormiente} giorni. Valore storico complessivo: ${valoreTotale} €. ` +
        (agentePrincipale
          ? `Il portafoglio più colpito è quello di ${agentePrincipale[0]} (${agentePrincipale[1]} clienti).`
          : ""),
      magnitudineEuro: valoreTotale,
      persistenza: 1,
      azionabilita: 1, // c'è una lista di nomi da chiamare: massima azionabilità
      direzione: "negativo",
      punteggio: 0,
      prove: [
        {
          descrizione: "Ordinato storico per cliente",
          spec: {
            metrica: "ordinato",
            raggruppa: ["cliente"],
            filtri: filtriScope(ctx),
            ordina: "valore_desc",
            limite: 50,
          },
        },
      ],
      dettaglio: { clienti: dormienti.slice(0, 25), totale: dormienti.length, valoreTotale },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 4 — Concentrazione
// ─────────────────────────────────────────────────────────────────────────────

function rilevaConcentrazione(ctx: ContestoRilevatori): Segnale[] {
  const mese = ctx.oggi.slice(0, 7);
  const spec: SpecQuery = {
    metrica: "ordinato",
    raggruppa: ["cliente"],
    periodo: { dal: `${mese}-01`, al: ctx.oggi },
    filtri: filtriScope(ctx),
    ordina: "valore_desc",
    limite: 10,
  };
  const res = esegui(spec, ctx.snapshot);
  if (res.righe.length === 0 || res.totale < SOGLIE.magnitudineMinimaEuro) return [];

  const primo = res.righe[0];
  const quota = pct(primo.valore, res.totale);
  if (quota < SOGLIE.concentrazionePct) return [];

  return [
    {
      id: `concentrazione-${mese}`,
      famiglia: "concentrazione",
      titolo: `${primo.etichetta} vale il ${quota}% dell'ordinato del mese`,
      descrizione:
        `Nel mese ${mese} l'ordinato è ${arr(res.totale)} €, di cui ${arr(primo.valore)} € ` +
        `da ${primo.etichetta} (${quota}%). La lettura del mese dipende da un solo cliente.`,
      magnitudineEuro: primo.valore,
      persistenza: 0.5,
      azionabilita: 0.7,
      direzione: "neutro",
      punteggio: 0,
      prove: [{ descrizione: `Ordinato per cliente, mese ${mese}`, spec }],
      dettaglio: {
        mese,
        totaleMese: arr(res.totale),
        primi: res.righe.slice(0, 5).map((r) => ({
          cliente: r.etichetta,
          importo: r.valore,
          quotaPct: pct(r.valore, res.totale),
        })),
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 5 — Pipeline preventivi che invecchia
// ─────────────────────────────────────────────────────────────────────────────

function rilevaPipeline(ctx: ContestoRilevatori): Segnale[] {
  const righe = righeScope(ctx, ctx.snapshot.dataset.preventivi_aperti);
  if (righe.length === 0) return [];

  const vecchi = righe.filter(
    (r) => r.data && giorniTra(r.data, ctx.oggi) > SOGLIE.giorniPreventivoVecchio
  );
  const valoreVecchi = arr(vecchi.reduce((s, r) => s + r.importo, 0));
  const valoreTotale = arr(righe.reduce((s, r) => s + r.importo, 0));
  if (valoreVecchi < SOGLIE.magnitudineMinimaEuro) return [];

  const quota = pct(valoreVecchi, valoreTotale);
  const documentiVecchi = new Set(vecchi.map((r) => r.documento).filter(Boolean)).size;

  const perAgente = new Map<string, number>();
  for (const r of vecchi) perAgente.set(r.agente, (perAgente.get(r.agente) ?? 0) + r.importo);
  const classifica = [...perAgente.entries()]
    .map(([agente, importo]) => ({ agente, importo: arr(importo) }))
    .sort((a, b) => b.importo - a.importo)
    .slice(0, 5);

  return [
    {
      id: "pipeline-vecchi",
      famiglia: "pipeline",
      titolo: `${documentiVecchi} preventivi aperti da oltre ${SOGLIE.giorniPreventivoVecchio} giorni`,
      descrizione:
        `${documentiVecchi} preventivi ancora aperti hanno più di ` +
        `${SOGLIE.giorniPreventivoVecchio} giorni, per ${valoreVecchi} € di inevaso ` +
        `(${quota}% del totale preventivi aperti, ${valoreTotale} €).`,
      magnitudineEuro: valoreVecchi,
      persistenza: 0.8,
      azionabilita: 0.9,
      direzione: "negativo",
      punteggio: 0,
      prove: [
        {
          descrizione: "Preventivi aperti per agente",
          spec: {
            metrica: "preventivi_aperti",
            raggruppa: ["agente"],
            filtri: filtriScope(ctx),
            ordina: "valore_desc",
          },
        },
      ],
      dettaglio: { documentiVecchi, valoreVecchi, valoreTotale, quota, perAgente: classifica },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 6 — Portafoglio che si accumula su un mese
// ─────────────────────────────────────────────────────────────────────────────

function rilevaPortafoglio(ctx: ContestoRilevatori): Segnale[] {
  const spec: SpecQuery = {
    metrica: "consegnato_futuro",
    granularita: "mese",
    filtri: filtriScope(ctx),
    ordina: "etichetta",
  };
  const res = esegui(spec, ctx.snapshot);
  const futuri = res.righe.filter((r) => r.etichetta >= ctx.oggi.slice(0, 7));
  if (futuri.length < 2) return [];

  const totale = arr(futuri.reduce((s, r) => s + r.valore, 0));
  if (totale < SOGLIE.magnitudineMinimaEuro) return [];

  const massimo = futuri.reduce((a, b) => (b.valore > a.valore ? b : a));
  const quota = pct(massimo.valore, totale);
  const media = totale / futuri.length;
  if (massimo.valore < media * 1.8) return [];

  return [
    {
      id: `portafoglio-picco-${massimo.etichetta}`,
      famiglia: "portafoglio",
      titolo: `Il portafoglio si concentra su ${massimo.etichetta} (${quota}%)`,
      descrizione:
        `Le consegne future previste valgono ${totale} € su ${futuri.length} mesi. ` +
        `Il mese ${massimo.etichetta} da solo pesa ${arr(massimo.valore)} € (${quota}%), ` +
        `contro una media mensile di ${arr(media)} €.`,
      magnitudineEuro: massimo.valore,
      persistenza: 0.7,
      azionabilita: 0.8,
      direzione: "neutro",
      punteggio: 0,
      prove: [{ descrizione: "Portafoglio per mese di consegna", spec }],
      dettaglio: {
        mesePicco: massimo.etichetta,
        valorePicco: arr(massimo.valore),
        mediaMensile: arr(media),
        quota,
        serie: futuri.map((r) => ({ mese: r.etichetta, valore: r.valore })),
      },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 7 — Qualità del dato
// Se il dato è rotto, l'analista lo dice invece di commentarlo.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaQualitaDato(ctx: ContestoRilevatori): Segnale[] {
  const segnali: Segnale[] = [];
  const s = ctx.snapshot;

  if (s.runRicevutoIl) {
    const ore = (Date.now() - new Date(s.runRicevutoIl).getTime()) / 3_600_000;
    if (ore > SOGLIE.oreRunInRitardo) {
      segnali.push({
        id: `qualita-run-${s.runCorrente}`,
        famiglia: "qualita_dato",
        titolo: `Il caricamento dati è fermo da ${Math.round(ore)} ore`,
        descrizione:
          `L'ultimo run pubblicato è ${s.runCorrente ?? "sconosciuto"}, ricevuto il ` +
          `${s.runRicevutoIl}. Il ciclo normale è giornaliero: i numeri di questo ` +
          `briefing potrebbero non essere aggiornati.`,
        magnitudineEuro: Number.MAX_SAFE_INTEGER / 2, // priorità assoluta
        persistenza: 1,
        azionabilita: 1,
        direzione: "negativo",
        punteggio: 0,
        prove: [],
        dettaglio: { run: s.runCorrente, ricevutoIl: s.runRicevutoIl, ore: Math.round(ore) },
      });
    }
  }

  // Quota di righe senza business unit assegnata.
  const ordinato = ctx.snapshot.dataset.ordinato;
  const anno = ctx.oggi.slice(0, 4);
  const annoCorrente = ordinato.filter((r) => r.data.startsWith(anno));
  const nonAssegnate = annoCorrente.filter((r) => r.bu === "(non assegnata)");
  const valoreNA = arr(nonAssegnate.reduce((s2, r) => s2 + r.importo, 0));
  const valoreTot = arr(annoCorrente.reduce((s2, r) => s2 + r.importo, 0));
  const quotaNA = pct(valoreNA, valoreTot);

  if (quotaNA >= 5 && valoreNA >= SOGLIE.magnitudineMinimaEuro) {
    segnali.push({
      id: `qualita-bu-${anno}`,
      famiglia: "qualita_dato",
      titolo: `Il ${quotaNA}% dell'ordinato ${anno} non ha business unit`,
      descrizione:
        `${valoreNA} € di ordinato ${anno} arrivano da righe con gruppo "-" nel ` +
        `gestionale, quindi non attribuibili a una business unit. ` +
        `Le ripartizioni per BU sono incomplete di altrettanto.`,
      magnitudineEuro: valoreNA,
      persistenza: 1,
      azionabilita: 0.7,
      direzione: "negativo",
      punteggio: 0,
      prove: [
        {
          descrizione: `Ordinato ${anno} per business unit`,
          spec: {
            metrica: "ordinato",
            raggruppa: ["bu"],
            periodo: { anno: Number(anno) },
            ordina: "valore_desc",
          },
        },
      ],
      dettaglio: { valoreNonAssegnato: valoreNA, valoreTotale: valoreTot, quota: quotaNA },
    });
  }

  return segnali;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilita' per i rilevatori con finestre mobili
// ─────────────────────────────────────────────────────────────────────────────

/** Data ISO spostata di `giorni` (negativi = indietro). */
function spostaGiorni(data: string, giorni: number): string {
  const d = dataDaIso(data);
  d.setUTCDate(d.getUTCDate() + giorni);
  return iso(d);
}

function chiaveCliente(r: RigaFatto): string {
  return r.codiceCliente || r.cliente;
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 8 — Margine in calo per cliente
// Ultimi 90 giorni contro i 12 mesi precedenti, sulle sole righe con costo
// noto. Il margine perso e' quello che il cliente avrebbe dato con la
// percentuale di prima sul fatturato di adesso: una cifra in euro, non punti.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaMargine(ctx: ContestoRilevatori): Segnale[] {
  const inizioRecente = spostaGiorni(ctx.oggi, -90);
  const inizioBase = spostaGiorni(ctx.oggi, -455);

  const perCliente = new Map<
    string,
    { cliente: string; agente: string; fr: number; mr: number; fp: number; mp: number }
  >();
  for (const r of righeScope(ctx, ctx.snapshot.dataset.fatturato)) {
    if (r.costoUnitario == null || !r.data || r.data <= inizioBase || r.data > ctx.oggi) continue;
    const margine = r.importo - quantitaOrientata(r) * r.costoUnitario;
    const c = perCliente.get(chiaveCliente(r)) ?? {
      cliente: r.cliente,
      agente: r.agente,
      fr: 0,
      mr: 0,
      fp: 0,
      mp: 0,
    };
    if (r.data > inizioRecente) {
      c.fr += r.importo;
      c.mr += margine;
      c.agente = r.agente;
    } else {
      c.fp += r.importo;
      c.mp += margine;
    }
    perCliente.set(chiaveCliente(r), c);
  }

  const inCalo = [...perCliente.values()]
    .filter((c) => c.fr >= 5_000 && c.fp >= 10_000)
    .map((c) => ({
      cliente: c.cliente,
      agente: c.agente,
      fatturato90g: arr(c.fr),
      marginePct90g: pct(c.mr, c.fr),
      marginePctPrima: pct(c.mp, c.fp),
      marginePerso: arr(c.fr * (c.mp / c.fp) - c.mr),
    }))
    .filter(
      (c) =>
        c.marginePctPrima - c.marginePct90g >= SOGLIE.marginePuntiPersi &&
        c.marginePerso >= SOGLIE.margineMinimoClienteEuro
    )
    .sort((a, b) => b.marginePerso - a.marginePerso);

  const perso = arr(inCalo.reduce((t, c) => t + c.marginePerso, 0));
  if (inCalo.length === 0 || perso < SOGLIE.margineMinimoEuro) return [];

  const primi = inCalo.slice(0, 5);
  return [
    {
      id: "margine-clienti",
      famiglia: "margine",
      titolo: `Margine in calo su ${inCalo.length} clienti: ${perso} € persi in 90 giorni`,
      descrizione:
        `Negli ultimi 90 giorni ${inCalo.length} clienti hanno reso almeno ` +
        `${SOGLIE.marginePuntiPersi} punti di margine in meno rispetto ai 12 mesi precedenti, ` +
        `per ${perso} € di margine in meno sul fatturato del periodo. I principali: ` +
        primi
          .map((c) => `${c.cliente} ${c.marginePctPrima}% → ${c.marginePct90g}% (${c.marginePerso} €)`)
          .join("; ") +
        `. Margine al costo valido alla data di vendita, sulle sole righe con costo noto.`,
      magnitudineEuro: perso,
      persistenza: 0.7,
      azionabilita: 0.8,
      direzione: "negativo",
      punteggio: 0,
      prove: [
        {
          descrizione: "Margine % per cliente, ultimi 90 giorni",
          spec: {
            metrica: "margine_pct",
            raggruppa: ["cliente"],
            periodo: { dal: spostaGiorni(inizioRecente, 1), al: ctx.oggi },
            filtri: filtriScope(ctx),
            ordina: "valore_desc",
          },
        },
      ],
      dettaglio: { clienti: primi, totaleClienti: inCalo.length, marginePerso: perso },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 9 — Clienti ritornati (e nuovi)
// La notizia buona: chi ha ordinato di nuovo dopo almeno sei mesi di silenzio.
// "Nuovo" si dice solo se lo storico e' abbastanza lungo da escludere che il
// cliente ordinasse gia' prima dell'inizio dei dati.
// ─────────────────────────────────────────────────────────────────────────────

interface EventoCliente {
  cliente: string;
  agente: string;
  tipo: "ritorno" | "nuovo";
  giorniSilenzio: number | null;
  valore: number;
}

function rilevaClientiRitornati(ctx: ContestoRilevatori): Segnale[] {
  const righe = righeScope(ctx, ctx.snapshot.dataset.ordinato).filter(
    (r) => r.data && r.data <= ctx.oggi
  );
  if (righe.length === 0) return [];
  const primaData = righe.reduce((m, r) => (r.data < m ? r.data : m), righe[0].data);
  const inizioFinestra = spostaGiorni(ctx.oggi, -SOGLIE.giorniFinestraRitorni);
  const storicoSufficiente =
    giorniTra(primaData, inizioFinestra) >= SOGLIE.giorniSilenzioRitorno;

  const perCliente = new Map<
    string,
    { cliente: string; agente: string; date: Set<string>; recente: number }
  >();
  for (const r of righe) {
    const c = perCliente.get(chiaveCliente(r)) ?? {
      cliente: r.cliente,
      agente: r.agente,
      date: new Set<string>(),
      recente: 0,
    };
    c.date.add(r.data);
    if (r.data > inizioFinestra) {
      c.recente += r.importo;
      c.agente = r.agente;
    }
    perCliente.set(chiaveCliente(r), c);
  }

  const eventi: EventoCliente[] = [];
  for (const c of perCliente.values()) {
    if (c.recente <= 0) continue;
    const date = [...c.date].sort();
    const primaRecente = date.find((d) => d > inizioFinestra);
    if (!primaRecente) continue;
    const precedenti = date.filter((d) => d < primaRecente);
    if (precedenti.length === 0) {
      if (storicoSufficiente) {
        eventi.push({ cliente: c.cliente, agente: c.agente, tipo: "nuovo", giorniSilenzio: null, valore: arr(c.recente) });
      }
      continue;
    }
    const silenzio = giorniTra(precedenti[precedenti.length - 1], primaRecente);
    if (silenzio >= SOGLIE.giorniSilenzioRitorno) {
      eventi.push({ cliente: c.cliente, agente: c.agente, tipo: "ritorno", giorniSilenzio: silenzio, valore: arr(c.recente) });
    }
  }

  const valore = arr(eventi.reduce((t, e) => t + e.valore, 0));
  if (eventi.length === 0 || valore < SOGLIE.ritorniMinimoEuro) return [];

  eventi.sort((a, b) => b.valore - a.valore);
  const ritorni = eventi.filter((e) => e.tipo === "ritorno").length;
  const nuovi = eventi.length - ritorni;
  return [
    {
      id: "clienti-ritornati",
      famiglia: "clienti_ritornati",
      titolo: `${eventi.length} clienti tornati o nuovi negli ultimi ${SOGLIE.giorniFinestraRitorni} giorni`,
      descrizione:
        `Negli ultimi ${SOGLIE.giorniFinestraRitorni} giorni hanno ordinato ${ritorni} clienti ` +
        `fermi da almeno ${SOGLIE.giorniSilenzioRitorno} giorni` +
        (nuovi > 0 ? ` e ${nuovi} clienti mai visti prima` : "") +
        `, per ${valore} € di ordinato. I principali: ` +
        eventi
          .slice(0, 5)
          .map(
            (e) =>
              `${e.cliente} ${e.valore} € (${
                e.tipo === "nuovo" ? "nuovo" : `fermo da ${e.giorniSilenzio} giorni`
              }, ${e.agente})`
          )
          .join("; ") +
        ".",
      magnitudineEuro: valore,
      persistenza: 0.5,
      azionabilita: 0.8,
      direzione: "positivo",
      punteggio: 0,
      prove: [
        {
          descrizione: `Ordinato per cliente, ultimi ${SOGLIE.giorniFinestraRitorni} giorni`,
          spec: {
            metrica: "ordinato",
            raggruppa: ["cliente"],
            periodo: { dal: spostaGiorni(inizioFinestra, 1), al: ctx.oggi },
            filtri: filtriScope(ctx),
            ordina: "valore_desc",
          },
        },
      ],
      dettaglio: { clienti: eventi.slice(0, 15), ritorni, nuovi, valore },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 10 — Consegne confermate oltre la data chiesta
// Ordini degli ultimi 60 giorni contro i 12 mesi precedenti. E' una promessa
// fatta al cliente gia' spostata in avanti al momento della conferma.
// ─────────────────────────────────────────────────────────────────────────────

function rilevaConsegne(ctx: ContestoRilevatori): Segnale[] {
  const inizioRecente = spostaGiorni(ctx.oggi, -60);
  const inizioBase = spostaGiorni(inizioRecente, -365);

  const conDate = righeScope(ctx, ctx.snapshot.dataset.ordinato).filter(
    (r) =>
      r.importo > 0 &&
      r.data > inizioBase &&
      r.data <= ctx.oggi &&
      Boolean(r.dataConsegnaRichiesta) &&
      Boolean(r.dataConsegnaConfermata)
  );
  const recenti = conDate.filter((r) => r.data > inizioRecente);
  const base = conDate.filter((r) => r.data <= inizioRecente);
  if (recenti.length === 0) return [];

  const ritardo = (r: RigaFatto) =>
    giorniTra(r.dataConsegnaRichiesta as string, r.dataConsegnaConfermata as string);
  const misura = (righe: RigaFatto[]) => {
    const tardive = righe.filter((r) => ritardo(r) > 0);
    const valore = righe.reduce((t, r) => t + r.importo, 0);
    const valoreTardivo = tardive.reduce((t, r) => t + r.importo, 0);
    const giorni =
      valoreTardivo > 0
        ? tardive.reduce((t, r) => t + ritardo(r) * r.importo, 0) / valoreTardivo
        : 0;
    return { quota: pct(valoreTardivo, valore), valoreTardivo: arr(valoreTardivo), giorniMedi: arr(giorni) };
  };
  const ora = misura(recenti);
  const prima = base.length > 0 ? misura(base) : null;
  const peggioramento = prima ? arr(ora.quota - prima.quota) : 0;

  if (ora.valoreTardivo < SOGLIE.magnitudineMinimaEuro) return [];
  if (ora.quota < SOGLIE.consegneQuotaPct && peggioramento < SOGLIE.consegnePeggioramentoPunti) {
    return [];
  }

  const perCliente = new Map<string, { cliente: string; valore: number; giorni: number }>();
  for (const r of recenti) {
    const g = ritardo(r);
    if (g <= 0) continue;
    const c = perCliente.get(chiaveCliente(r)) ?? { cliente: r.cliente, valore: 0, giorni: 0 };
    c.valore += r.importo;
    c.giorni = Math.max(c.giorni, g);
    perCliente.set(chiaveCliente(r), c);
  }
  const primi = [...perCliente.values()]
    .sort((a, b) => b.valore - a.valore)
    .slice(0, 5)
    .map((c) => ({ cliente: c.cliente, valore: arr(c.valore), ritardoMassimoGiorni: c.giorni }));

  const peggiora = peggioramento >= SOGLIE.consegnePeggioramentoPunti;
  return [
    {
      id: "consegne-ritardo",
      famiglia: "consegne",
      titolo: `Il ${ora.quota}% dell'ordinato recente è confermato oltre la data chiesta`,
      descrizione:
        `Negli ordini degli ultimi 60 giorni ${ora.valoreTardivo} € (${ora.quota}% del valore con ` +
        `entrambe le date) hanno una consegna confermata dopo quella chiesta dal cliente, ` +
        `in media di ${ora.giorniMedi} giorni` +
        (prima ? ` (nei 12 mesi precedenti: ${prima.quota}%, ${prima.giorniMedi} giorni)` : "") +
        `. Clienti con più valore spostato: ` +
        primi
          .map((c) => `${c.cliente} ${c.valore} € (fino a ${c.ritardoMassimoGiorni} giorni)`)
          .join("; ") +
        ".",
      magnitudineEuro: ora.valoreTardivo,
      persistenza: peggiora ? 0.8 : 0.5,
      azionabilita: 0.7,
      direzione: peggiora ? "negativo" : "neutro",
      punteggio: 0,
      prove: [
        {
          descrizione: "Ordinato per cliente, ultimi 60 giorni",
          spec: {
            metrica: "ordinato",
            raggruppa: ["cliente"],
            periodo: { dal: spostaGiorni(inizioRecente, 1), al: ctx.oggi },
            filtri: filtriScope(ctx),
            ordina: "valore_desc",
          },
        },
      ],
      dettaglio: { ora, prima, peggioramentoPunti: peggioramento, clienti: primi },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// RILEVATORE 11 — Costi d'acquisto in salita
// Per ogni articolo venduto sia negli ultimi 90 giorni sia un anno prima, il
// costo alla data delle vendite recenti contro quello di allora. L'impatto e'
// il rincaro per la quantita' venduta negli ultimi 12 mesi: quanto margine si
// perde a volumi costanti se i prezzi di vendita restano fermi.
// ─────────────────────────────────────────────────────────────────────────────

interface Rincaro {
  articolo: string;
  descrizione: string;
  costoPrima: number;
  costoOra: number;
  variazionePct: number;
  impatto: number;
}

function rilevaCostiAcquisto(ctx: ContestoRilevatori): Segnale[] {
  const inizioRecente = spostaGiorni(ctx.oggi, -90);
  const inizioAnno = spostaGiorni(ctx.oggi, -365);
  // "Un anno fa": le vendite fra 15 e 9 mesi prima di oggi.
  const baseDal = spostaGiorni(ctx.oggi, -455);
  const baseAl = spostaGiorni(ctx.oggi, -275);

  const perArticolo = new Map<
    string,
    {
      descrizione: string;
      recente: { data: string; costo: number } | null;
      base: { data: string; costo: number } | null;
      quantita: number;
      documenti: Set<string>;
    }
  >();
  for (const r of righeScope(ctx, ctx.snapshot.dataset.fatturato)) {
    if (r.costoUnitario == null || !r.articolo || !r.data || r.data > ctx.oggi) continue;
    const a = perArticolo.get(r.articolo) ?? {
      descrizione: r.descrizioneArticolo,
      recente: null,
      base: null,
      quantita: 0,
      documenti: new Set<string>(),
    };
    if (r.data > inizioAnno) {
      a.quantita += quantitaOrientata(r);
      if (r.documento) a.documenti.add(r.documento);
    }
    if (r.data > inizioRecente && (!a.recente || r.data > a.recente.data)) {
      a.recente = { data: r.data, costo: r.costoUnitario };
    }
    if (r.data > baseDal && r.data <= baseAl && (!a.base || r.data > a.base.data)) {
      a.base = { data: r.data, costo: r.costoUnitario };
    }
    perArticolo.set(r.articolo, a);
  }

  const rincari: Rincaro[] = [];
  let ribassi = 0;
  for (const [articolo, a] of perArticolo) {
    if (!a.recente || !a.base || a.base.costo <= 0 || a.quantita <= 0) continue;
    if (a.documenti.size < SOGLIE.costoDocumentiMinimi) continue;
    const variazione = pct(a.recente.costo - a.base.costo, a.base.costo);
    if (variazione <= -SOGLIE.costoRincaroPct) ribassi += 1;
    if (variazione < SOGLIE.costoRincaroPct) continue;
    rincari.push({
      articolo,
      descrizione: a.descrizione.slice(0, 60),
      costoPrima: arr(a.base.costo),
      costoOra: arr(a.recente.costo),
      variazionePct: variazione,
      impatto: arr((a.recente.costo - a.base.costo) * a.quantita),
    });
  }

  const impatto = arr(rincari.reduce((t, r) => t + r.impatto, 0));
  if (rincari.length === 0 || impatto < SOGLIE.costiImpattoMinimoEuro) return [];
  rincari.sort((a, b) => b.impatto - a.impatto);

  return [
    {
      id: "costi-acquisto",
      famiglia: "costi_acquisto",
      titolo: `${rincari.length} articoli costano oltre il ${SOGLIE.costoRincaroPct}% in più di un anno fa`,
      descrizione:
        `Fra gli articoli venduti con continuità, ${rincari.length} hanno un costo d'acquisto ` +
        `salito di almeno il ${SOGLIE.costoRincaroPct}% rispetto a un anno fa` +
        (ribassi > 0 ? ` (${ribassi} sono invece scesi)` : "") +
        `. Sui volumi degli ultimi 12 mesi il rincaro vale ${impatto} € di margine. I più pesanti: ` +
        rincari
          .slice(0, 5)
          .map(
            (r) =>
              `${r.descrizione} ${r.costoPrima} → ${r.costoOra} € (+${r.variazionePct}%, ${r.impatto} €)`
          )
          .join("; ") +
        ".",
      magnitudineEuro: impatto,
      persistenza: 0.8,
      azionabilita: 0.7,
      direzione: "negativo",
      punteggio: 0,
      prove: [
        {
          descrizione: "Costo del venduto per articolo, ultimi 12 mesi",
          spec: {
            metrica: "costo_venduto",
            raggruppa: ["articolo"],
            periodo: { dal: spostaGiorni(inizioAnno, 1), al: ctx.oggi },
            filtri: filtriScope(ctx),
            ordina: "valore_desc",
            limite: 50,
          },
        },
      ],
      dettaglio: { articoli: rincari.slice(0, 15), totaleArticoli: rincari.length, ribassi, impatto },
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// STADIO 2 — Rilevanza
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Punteggio = magnitudine (log, in euro) × persistenza × azionabilità × novità
 *             × peso appreso dai riscontri.
 *
 * La magnitudine è in EURO, mai in percentuale: un +300% su un cliente da
 * 400 € è rumore matematicamente ineccepibile.
 */
export function calcolaPunteggi(
  segnali: Segnale[],
  opzioni: {
    idGiaVisti?: Set<string>;
    /** Giorni dall'ultima uscita di ogni segnale: raffreddamento graduale. */
    giorniDallUltima?: Map<string, number>;
    pesiFamiglia?: Record<string, number>;
  } = {}
): Segnale[] {
  const { idGiaVisti = new Set(), giorniDallUltima, pesiFamiglia = {} } = opzioni;

  return segnali
    .map((s) => {
      const magnitudine = Math.log10(Math.max(1, Math.min(s.magnitudineEuro, 1e9)));
      // La qualita' del dato non si raffredda: finche' il dato e' rotto va detto.
      const novita =
        s.famiglia === "qualita_dato"
          ? 1
          : giorniDallUltima
            ? fattoreNovita(giorniDallUltima.get(s.id))
            : idGiaVisti.has(s.id)
              ? 0.25
              : 1;
      const peso = pesiFamiglia[s.famiglia] ?? 1;
      const punteggio =
        magnitudine * (0.4 + 0.6 * s.persistenza) * (0.4 + 0.6 * s.azionabilita) * novita * peso;
      return { ...s, punteggio: arr(punteggio) };
    })
    .sort((a, b) => b.punteggio - a.punteggio);
}

/** Esegue tutti i rilevatori. */
export function rilevaTutto(ctx: ContestoRilevatori): Segnale[] {
  const rilevatori = [
    rilevaQualitaDato,
    rilevaScostamentoBudget,
    rilevaRotturaSerie,
    rilevaClientiDormienti,
    rilevaConcentrazione,
    rilevaPipeline,
    rilevaPortafoglio,
    rilevaMargine,
    rilevaClientiRitornati,
    rilevaConsegne,
    rilevaCostiAcquisto,
  ];

  const out: Segnale[] = [];
  for (const r of rilevatori) {
    try {
      out.push(...r(ctx));
    } catch (e) {
      // Un rilevatore che esplode non deve far saltare il briefing.
      out.push({
        id: `errore-${r.name}`,
        famiglia: "qualita_dato",
        titolo: `Rilevatore ${r.name} non ha potuto girare`,
        descrizione: e instanceof Error ? e.message : String(e),
        magnitudineEuro: 0,
        persistenza: 0,
        azionabilita: 0,
        direzione: "neutro",
        punteggio: 0,
        prove: [],
      });
    }
  }
  return out;
}
