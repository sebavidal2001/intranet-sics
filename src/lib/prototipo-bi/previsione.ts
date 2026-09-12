/**
 * ⛔ PROTOTIPO BI DIREZIONALE — NON IN PRODUZIONE
 *
 * PREVISIONE — la matematica la fa il codice, non il modello.
 *
 * Chiedere a un modello linguistico «quanto chiuderemo l'anno?» produce un
 * numero plausibile ottenuto a occhio: nessuno può rifarlo e nessuno sa da
 * dove viene. Qui la stima è calcolata da funzioni deterministiche, e l'AI si
 * limita a sceglierne una, a leggerne il risultato e a spiegarlo.
 *
 * Tre metodi, apposta diversi fra loro: se convergono la stima è solida, se
 * divergono lo scarto è esso stesso l'informazione utile.
 */

import { costruisciCalendario, type GiornoCalendario } from "./calendario";
import type { Chiusura, RigaRisultato } from "./tipi";

export type MetodoPrevisione = "ritmo" | "stagionale" | "tendenza";

export interface EsitoMetodo {
  metodo: MetodoPrevisione;
  nome: string;
  stima: number;
  /** Come funziona, in una riga, per chi legge il risultato. */
  spiegazione: string;
  /** Vero se il metodo non era applicabile ai dati disponibili. */
  nonApplicabile?: string;
}

export interface Previsione {
  anno: number;
  consuntivoAlGiorno: number;
  giornoLimite: string;
  metodi: EsitoMetodo[];
  /** Media dei metodi applicabili. */
  stimaCentrale: number;
  minimo: number;
  massimo: number;
  /** Ampiezza dell'intervallo in percentuale sulla stima centrale. */
  incertezzaPct: number;
  avvisi: string[];
}

function arr(n: number) {
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metodo 1 — Ritmo sui giorni lavorativi
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Proietta il consuntivo sui giorni lavorativi che restano.
 *
 * Usa il calendario aziendale, non i giorni di calendario: senza, agosto e
 * dicembre verrebbero proiettati come mesi pieni e la stima sarebbe gonfiata.
 * È il metodo più semplice e l'unico che ignora del tutto la stagionalità.
 */
function metodoRitmo(
  consuntivo: number,
  calendario: GiornoCalendario[],
  giornoLimite: string
): EsitoMetodo {
  const lavorativi = calendario.filter((g) => g.lavorativo);
  const trascorsi = lavorativi.filter((g) => g.data <= giornoLimite).length;
  const totali = lavorativi.length;

  if (trascorsi === 0) {
    return {
      metodo: "ritmo",
      nome: "Ritmo sui giorni lavorativi",
      stima: 0,
      spiegazione: "",
      nonApplicabile: "Nessun giorno lavorativo trascorso nel periodo.",
    };
  }

  const stima = (consuntivo / trascorsi) * totali;
  return {
    metodo: "ritmo",
    nome: "Ritmo sui giorni lavorativi",
    stima: arr(stima),
    spiegazione:
      `Media giornaliera sui ${trascorsi} giorni lavorativi trascorsi, estesa ai ` +
      `${totali} dell'anno. Non tiene conto della stagionalità: se il periodo ` +
      `già passato è più forte o più debole della media, la stima è distorta.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Metodo 2 — Stagionale sull'anno precedente
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applica al consuntivo la stessa forma stagionale dell'anno prima.
 *
 * Se l'anno scorso a fine agosto avevamo fatto il 62% del totale annuo, si
 * assume che quest'anno valga la stessa proporzione. È il metodo più adatto a
 * un'azienda con chiusure fisse e un ciclo commerciale stabile.
 */
function metodoStagionale(
  consuntivo: number,
  precedenteAlGiorno: number,
  precedenteIntero: number
): EsitoMetodo {
  if (precedenteAlGiorno <= 0 || precedenteIntero <= 0) {
    return {
      metodo: "stagionale",
      nome: "Stagionalità dell'anno precedente",
      stima: 0,
      spiegazione: "",
      nonApplicabile:
        "Serve un anno precedente completo: con i dati disponibili non è calcolabile.",
    };
  }

  const quota = precedenteAlGiorno / precedenteIntero;
  const stima = consuntivo / quota;
  return {
    metodo: "stagionale",
    nome: "Stagionalità dell'anno precedente",
    stima: arr(stima),
    spiegazione:
      `L'anno prima, alla stessa data, era stato raggiunto il ${(quota * 100).toFixed(1)}% ` +
      `del totale annuo. La stima applica la stessa proporzione al consuntivo di ` +
      `quest'anno. Presuppone che la stagionalità si ripeta.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Metodo 3 — Tendenza sui mesi
// ─────────────────────────────────────────────────────────────────────────────

/** Regressione lineare semplice: restituisce pendenza e intercetta. */
function regressione(punti: { x: number; y: number }[]) {
  const n = punti.length;
  const sx = punti.reduce((s, p) => s + p.x, 0);
  const sy = punti.reduce((s, p) => s + p.y, 0);
  const sxy = punti.reduce((s, p) => s + p.x * p.y, 0);
  const sxx = punti.reduce((s, p) => s + p.x * p.x, 0);
  const den = n * sxx - sx * sx;
  if (den === 0) return { pendenza: 0, intercetta: sy / n };
  const pendenza = (n * sxy - sx * sy) / den;
  return { pendenza, intercetta: (sy - pendenza * sx) / n };
}

/**
 * Estende la tendenza dei mesi già chiusi ai mesi mancanti.
 *
 * I mesi con pochi giorni lavorativi (agosto, dicembre) vengono normalizzati
 * prima di stimare la retta e ri-scalati dopo: senza, la chiusura estiva
 * verrebbe letta come un calo della tendenza.
 */
function metodoTendenza(
  serieMensile: RigaRisultato[],
  calendario: GiornoCalendario[],
  giornoLimite: string,
  consuntivo: number
): EsitoMetodo {
  const lavorativiPerMese = new Map<number, number>();
  for (const g of calendario) {
    if (!g.lavorativo) continue;
    lavorativiPerMese.set(g.mese, (lavorativiPerMese.get(g.mese) ?? 0) + 1);
  }

  const meseLimite = Number(giornoLimite.slice(5, 7));
  // Solo i mesi interamente trascorsi: quello in corso è parziale e
  // abbasserebbe artificialmente la tendenza.
  const completi = serieMensile
    .map((r) => ({ mese: Number(r.etichetta.slice(5, 7)), valore: r.valore }))
    .filter((r) => r.mese > 0 && r.mese < meseLimite)
    .sort((a, b) => a.mese - b.mese);

  if (completi.length < 4) {
    return {
      metodo: "tendenza",
      nome: "Tendenza dei mesi chiusi",
      stima: 0,
      spiegazione: "",
      nonApplicabile: `Servono almeno 4 mesi completi, ce ne sono ${completi.length}.`,
    };
  }

  const punti = completi.map((r) => ({
    x: r.mese,
    y: r.valore / (lavorativiPerMese.get(r.mese) || 1),
  }));
  const { pendenza, intercetta } = regressione(punti);

  let restante = 0;
  for (let m = meseLimite; m <= 12; m++) {
    const giorni = lavorativiPerMese.get(m) ?? 0;
    const perGiorno = Math.max(0, intercetta + pendenza * m);
    if (m === meseLimite) {
      // Il mese in corso è già dentro il consuntivo per la parte trascorsa:
      // si aggiungono solo i giorni lavorativi che restano.
      const rimasti = calendario.filter(
        (g) => g.lavorativo && g.mese === m && g.data > giornoLimite
      ).length;
      restante += perGiorno * rimasti;
    } else {
      restante += perGiorno * giorni;
    }
  }

  const direzione = pendenza >= 0 ? "in crescita" : "in calo";
  return {
    metodo: "tendenza",
    nome: "Tendenza dei mesi chiusi",
    stima: arr(consuntivo + restante),
    spiegazione:
      `Retta di tendenza sui ${completi.length} mesi completi, normalizzata per ` +
      `giorni lavorativi (${direzione}), estesa ai mesi mancanti. È il metodo ` +
      `più sensibile agli ultimi mesi: un mese anomalo sposta la stima.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Composizione
// ─────────────────────────────────────────────────────────────────────────────

export interface DatiPrevisione {
  anno: number;
  giornoLimite: string;
  consuntivoAlGiorno: number;
  precedenteAlGiorno: number;
  precedenteIntero: number;
  serieMensile: RigaRisultato[];
  chiusure: Chiusura[];
  escludiWeekend: boolean;
}

export function calcolaPrevisione(d: DatiPrevisione): Previsione {
  const calendario = costruisciCalendario(d.anno, d.chiusure, d.escludiWeekend);
  const avvisi: string[] = [];

  if (d.chiusure.length === 0) {
    avvisi.push(
      "Nessuna chiusura aziendale configurata per quest'anno: le proiezioni trattano agosto e dicembre come mesi pieni."
    );
  }

  const metodi = [
    metodoRitmo(d.consuntivoAlGiorno, calendario, d.giornoLimite),
    metodoStagionale(d.consuntivoAlGiorno, d.precedenteAlGiorno, d.precedenteIntero),
    metodoTendenza(d.serieMensile, calendario, d.giornoLimite, d.consuntivoAlGiorno),
  ];

  const validi = metodi.filter((m) => !m.nonApplicabile).map((m) => m.stima);
  for (const m of metodi) {
    if (m.nonApplicabile) avvisi.push(`${m.nome}: ${m.nonApplicabile}`);
  }

  if (validi.length === 0) {
    return {
      anno: d.anno,
      consuntivoAlGiorno: d.consuntivoAlGiorno,
      giornoLimite: d.giornoLimite,
      metodi,
      stimaCentrale: 0,
      minimo: 0,
      massimo: 0,
      incertezzaPct: 0,
      avvisi: [...avvisi, "Nessun metodo applicabile: la previsione non è calcolabile."],
    };
  }

  const centrale = validi.reduce((s, v) => s + v, 0) / validi.length;
  const minimo = Math.min(...validi);
  const massimo = Math.max(...validi);
  const incertezza = centrale > 0 ? ((massimo - minimo) / centrale) * 100 : 0;

  if (incertezza > 15) {
    avvisi.push(
      `I metodi divergono del ${incertezza.toFixed(0)}%: la stima va presa come intervallo, non come numero. Lo scarto indica che l'andamento dell'anno non è regolare.`
    );
  }

  return {
    anno: d.anno,
    consuntivoAlGiorno: arr(d.consuntivoAlGiorno),
    giornoLimite: d.giornoLimite,
    metodi,
    stimaCentrale: arr(centrale),
    minimo: arr(minimo),
    massimo: arr(massimo),
    incertezzaPct: Math.round(incertezza * 10) / 10,
    avvisi,
  };
}
