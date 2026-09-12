/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * Motore Budget / BEP.
 *
 * Sostituisce i tre Excel oggi mantenuti a mano:
 *   BUDGET-BEP.xlsx, BUDGET-BEP_GIORNALIERO.xlsx (5.845 righe),
 *   BUDGET-BEP_GIORNALIERO_COMMERCIALI.xlsx (4 fogli disallineati).
 *
 * Si inseriscono DUE numeri per anno (budget e BEP), le chiusure aziendali,
 * l'incidenza delle business unit e la quota dei commerciali. Tutto il resto
 * — le migliaia di righe giornaliere — viene generato.
 *
 * La distribuzione avviene sui GIORNI LAVORATIVI, non sui giorni di calendario:
 * così agosto, che nel 2026 è chiuso dal 10 al 23, riceve automaticamente un
 * budget più basso e non genera un falso allarme di crollo.
 */

import {
  costruisciCalendario,
  giorniLavorativiPerMese,
  type GiornoCalendario,
} from "./calendario";
import type {
  ConfigurazioneAnno,
  DistribuzioneBudget,
  RigaBudgetDimensione,
  RigaBudgetGiorno,
} from "./tipi";

/** Arrotonda a 2 decimali evitando gli strascichi binari. */
function arr(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Distribuisce un totale su N slot in modo che la somma torni ESATTA.
 * L'ultimo slot assorbe il residuo di arrotondamento: senza questo, 5.845
 * righe da due decimali fanno divergere il totale di qualche euro e qualcuno
 * in riunione se ne accorge.
 */
function distribuisciEsatto(totale: number, n: number): number[] {
  if (n <= 0) return [];
  const quota = arr(totale / n);
  const out = new Array<number>(n).fill(quota);
  const somma = arr(quota * n);
  out[n - 1] = arr(out[n - 1] + (totale - somma));
  return out;
}

export function configurazioneVuota(anno: number): ConfigurazioneAnno {
  return {
    anno,
    budgetAnnuo: 0,
    bepAnnuo: 0,
    modalita: "giorni_lavorativi",
    escludiWeekend: true,
    chiusure: [],
    incidenzeBU: [],
    commerciali: [],
    aggiornatoIl: new Date().toISOString(),
  };
}

/** Controlli di coerenza mostrati all'utente prima di salvare. */
export function validaConfigurazione(config: ConfigurazioneAnno): string[] {
  const avvisi: string[] = [];

  if (config.budgetAnnuo <= 0) avvisi.push("Il budget annuo non è stato impostato.");
  if (config.bepAnnuo <= 0) avvisi.push("Il BEP annuo non è stato impostato.");
  if (config.bepAnnuo > config.budgetAnnuo && config.budgetAnnuo > 0) {
    avvisi.push(
      "Il BEP è superiore al budget: di norma il punto di pareggio sta sotto l'obiettivo."
    );
  }

  if (config.incidenzeBU.length > 0) {
    const somma = arr(config.incidenzeBU.reduce((s, i) => s + i.pesoPct, 0));
    if (Math.abs(somma - 100) > 0.01) {
      avvisi.push(
        `Le incidenze delle business unit sommano a ${somma}% invece di 100%.`
      );
    }
  }

  if (config.commerciali.length > 0) {
    const conQuota = config.commerciali.filter(
      (c) => c.importoAnnuo === null || c.importoAnnuo === undefined
    );
    const sommaQuote = arr(conQuota.reduce((s, c) => s + c.quotaPct, 0));
    const sommaImporti = arr(
      config.commerciali.reduce((s, c) => s + (c.importoAnnuo ?? 0), 0)
    );
    const budgetResiduo = arr(config.budgetAnnuo - sommaImporti);

    if (sommaImporti > config.budgetAnnuo) {
      avvisi.push(
        "Gli importi assegnati ai commerciali superano il budget annuo totale."
      );
    }
    if (conQuota.length > 0 && Math.abs(sommaQuote - 100) > 0.01) {
      avvisi.push(
        `Le quote percentuali dei commerciali sommano a ${sommaQuote}% invece di 100%` +
          (sommaImporti > 0 ? ` (sul residuo di ${budgetResiduo.toLocaleString("it-IT")} €).` : ".")
      );
    }
  }

  for (const c of config.chiusure) {
    if (c.dal > c.al) {
      avvisi.push(`Chiusura "${c.descrizione}": la data di inizio è successiva alla fine.`);
    }
  }

  return avvisi;
}

/** Giorni su cui distribuire, secondo la modalità scelta. */
function giorniDistribuzione(
  calendario: GiornoCalendario[],
  modalita: ConfigurazioneAnno["modalita"]
): GiornoCalendario[] {
  if (modalita === "giorni_lavorativi") {
    return calendario.filter((g) => g.lavorativo);
  }
  // lineare_mese: si distribuisce comunque sui lavorativi, ma il totale è
  // ripartito in dodicesimi uguali PRIMA di scendere al giorno. Serve a chi
  // ragiona per mesi ("un dodicesimo al mese") invece che per ritmo produttivo.
  return calendario.filter((g) => g.lavorativo);
}

/**
 * Genera la distribuzione completa: giorni, business unit e commerciali.
 */
export function distribuisci(config: ConfigurazioneAnno): DistribuzioneBudget {
  const calendario = costruisciCalendario(
    config.anno,
    config.chiusure,
    config.escludiWeekend
  );
  const lavorativi = giorniDistribuzione(calendario, config.modalita);
  const avvisi = validaConfigurazione(config);

  if (lavorativi.length === 0) {
    return {
      anno: config.anno,
      giorniLavorativi: 0,
      budgetGiornaliero: 0,
      bepGiornaliero: 0,
      giorni: [],
      perBU: [],
      perAgente: [],
      avvisi: [...avvisi, "Nessun giorno lavorativo: controllare chiusure e weekend."],
    };
  }

  // ── Serie giornaliera totale ──────────────────────────────────────────────
  let budgetPerGiorno: number[];
  let bepPerGiorno: number[];

  if (config.modalita === "lineare_mese") {
    // Un dodicesimo per mese, poi diviso sui lavorativi di quel mese.
    const perMese = giorniLavorativiPerMese(calendario);
    const budgetMese = distribuisciEsatto(config.budgetAnnuo, 12);
    const bepMese = distribuisciEsatto(config.bepAnnuo, 12);
    const mappaBudget = new Map<string, number>();
    const mappaBep = new Map<string, number>();

    for (let m = 1; m <= 12; m++) {
      const giorniMese = lavorativi.filter((g) => g.mese === m);
      if (giorniMese.length === 0) continue;
      const bq = distribuisciEsatto(budgetMese[m - 1], perMese[m] ?? giorniMese.length);
      const eq = distribuisciEsatto(bepMese[m - 1], perMese[m] ?? giorniMese.length);
      giorniMese.forEach((g, i) => {
        mappaBudget.set(g.data, bq[i] ?? 0);
        mappaBep.set(g.data, eq[i] ?? 0);
      });
    }
    budgetPerGiorno = lavorativi.map((g) => mappaBudget.get(g.data) ?? 0);
    bepPerGiorno = lavorativi.map((g) => mappaBep.get(g.data) ?? 0);
  } else {
    budgetPerGiorno = distribuisciEsatto(config.budgetAnnuo, lavorativi.length);
    bepPerGiorno = distribuisciEsatto(config.bepAnnuo, lavorativi.length);
  }

  const indiceLavorativo = new Map<string, number>();
  lavorativi.forEach((g, i) => indiceLavorativo.set(g.data, i));

  const giorni: RigaBudgetGiorno[] = calendario.map((g) => {
    const i = indiceLavorativo.get(g.data);
    return {
      data: g.data,
      anno: g.anno,
      mese: g.mese,
      settimanaIso: g.settimanaIso,
      lavorativo: g.lavorativo,
      budget: i === undefined ? 0 : budgetPerGiorno[i],
      bep: i === undefined ? 0 : bepPerGiorno[i],
    };
  });

  // ── Ripartizione per business unit ────────────────────────────────────────
  const perBU: RigaBudgetDimensione[] = [];
  for (const inc of config.incidenzeBU) {
    if (inc.pesoPct <= 0) continue;
    const quota = inc.pesoPct / 100;
    for (const g of giorni) {
      if (!g.lavorativo) continue;
      perBU.push({
        data: g.data,
        chiave: inc.bu,
        budget: arr(g.budget * quota),
        bep: arr(g.bep * quota),
      });
    }
  }

  // ── Ripartizione per commerciale ──────────────────────────────────────────
  // Chi ha un importo annuo esplicito lo usa; gli altri si dividono il residuo
  // secondo le quote percentuali.
  const sommaImporti = config.commerciali.reduce(
    (s, c) => s + (c.importoAnnuo ?? 0),
    0
  );
  const residuo = Math.max(0, config.budgetAnnuo - sommaImporti);
  const conQuota = config.commerciali.filter(
    (c) => c.importoAnnuo === null || c.importoAnnuo === undefined
  );
  const sommaQuote = conQuota.reduce((s, c) => s + c.quotaPct, 0);

  const perAgente: RigaBudgetDimensione[] = [];
  for (const c of config.commerciali) {
    const annuo =
      c.importoAnnuo ??
      (sommaQuote > 0 ? (residuo * c.quotaPct) / sommaQuote : 0);
    if (annuo <= 0) continue;

    // Il BEP del commerciale mantiene lo stesso rapporto BEP/budget aziendale.
    const rapportoBep =
      config.budgetAnnuo > 0 ? config.bepAnnuo / config.budgetAnnuo : 0;
    const quotaBudget = annuo / (config.budgetAnnuo || 1);

    for (const g of giorni) {
      if (!g.lavorativo) continue;
      perAgente.push({
        data: g.data,
        chiave: c.agente,
        budget: arr(g.budget * quotaBudget),
        bep: arr(g.budget * quotaBudget * rapportoBep),
      });
    }
  }

  return {
    anno: config.anno,
    giorniLavorativi: lavorativi.length,
    budgetGiornaliero: arr(config.budgetAnnuo / lavorativi.length),
    bepGiornaliero: arr(config.bepAnnuo / lavorativi.length),
    giorni,
    perBU,
    perAgente,
    avvisi,
  };
}

/** Aggregazioni pronte per i grafici e per i rilevatori. */
export function budgetPerMese(d: DistribuzioneBudget) {
  const out = new Map<number, { budget: number; bep: number; giorni: number }>();
  for (const g of d.giorni) {
    if (!g.lavorativo) continue;
    const cur = out.get(g.mese) ?? { budget: 0, bep: 0, giorni: 0 };
    cur.budget = arr(cur.budget + g.budget);
    cur.bep = arr(cur.bep + g.bep);
    cur.giorni += 1;
    out.set(g.mese, cur);
  }
  return out;
}

export function budgetPerSettimana(d: DistribuzioneBudget) {
  const out = new Map<string, { budget: number; bep: number }>();
  for (const g of d.giorni) {
    if (!g.lavorativo) continue;
    const cur = out.get(g.settimanaIso) ?? { budget: 0, bep: 0 };
    cur.budget = arr(cur.budget + g.budget);
    cur.bep = arr(cur.bep + g.bep);
    out.set(g.settimanaIso, cur);
  }
  return out;
}

/** Budget cumulato fino alla data indicata (inclusa) — il "progressivo". */
export function budgetProgressivoAl(
  d: DistribuzioneBudget,
  data: string
): { budget: number; bep: number; giorniTrascorsi: number } {
  let budget = 0;
  let bep = 0;
  let giorniTrascorsi = 0;
  for (const g of d.giorni) {
    if (g.data > data) break;
    if (!g.lavorativo) continue;
    budget = arr(budget + g.budget);
    bep = arr(bep + g.bep);
    giorniTrascorsi += 1;
  }
  return { budget, bep, giorniTrascorsi };
}
