/**
 * Analisi delle campagne (Fase 3, solo admin). Logica pura: i numeri per cliente
 * arrivano da `campagne.analisi_clienti` (migration 134) e qui si sommano.
 *
 * Una regola decide tutto il resto: si confrontano SOLO i clienti per cui la
 * finestra «prima» e la finestra «dopo» stanno entrambe dentro lo storico di
 * fatturato. Un cliente che ha ricevuto la busta un mese fa non ha ancora sei
 * mesi di «dopo»: contarlo come zero acquisti farebbe sembrare ogni campagna
 * recente un disastro.
 */

export const FINESTRE = [3, 6, 12] as const;
export type Finestra = (typeof FINESTRE)[number];

export function finestraValida(v: unknown): Finestra {
  const n = Number(v);
  return (FINESTRE as readonly number[]).includes(n) ? (n as Finestra) : 6;
}

export interface RigaAnalisi {
  codice_cliente: string;
  ragione_sociale: string | null;
  agente_nome: string | null;
  data_invio: string;
  prima_tot: number;
  dopo_tot: number;
  /** null = articoli promossi non configurati nella campagna. */
  prima_prom: number | null;
  dopo_prom: number | null;
  mai_prima_prom: boolean | null;
  prima_completa: boolean;
  dopo_completa: boolean;
}

export interface RiepilogoAnalisi {
  mesi: number;
  ricevuti: number;
  /** Con entrambe le finestre dentro lo storico: gli unici confrontati. */
  confrontabili: number;
  senza_prima: number;
  senza_dopo: number;
  prima: number;
  dopo: number;
  /** (dopo - prima) / prima; null se prima = 0. */
  variazione: number | null;
  in_aumento: number;
  in_calo: number;
  invariati: number;
  /** Solo se la campagna ha articoli promossi. */
  promossi: null | {
    prima: number;
    dopo: number;
    /** Hanno comprato un articolo promosso nella finestra «dopo» (confrontabili). */
    acquirenti_dopo: number;
    /** Fra chi ha la finestra «dopo» completa: mai comprato un promosso prima, e lo compra dopo. */
    nuovi_acquirenti: number;
    /** Fra chi ha la finestra «dopo» completa: nessun promosso comprato prima dell'invio. */
    mai_acquistato_prima: number;
    con_dopo_completa: number;
  };
}

const arrotonda = (n: number) => Math.round(n * 100) / 100;

export const confrontabile = (r: RigaAnalisi) => r.prima_completa && r.dopo_completa;

export function riassumi(righe: RigaAnalisi[], mesi: number, promossiConfigurati: boolean): RiepilogoAnalisi {
  const conf = righe.filter(confrontabile);
  const prima = conf.reduce((s, r) => s + r.prima_tot, 0);
  const dopo = conf.reduce((s, r) => s + r.dopo_tot, 0);

  let promossi: RiepilogoAnalisi["promossi"] = null;
  if (promossiConfigurati) {
    const conDopo = righe.filter((r) => r.dopo_completa);
    promossi = {
      prima: arrotonda(conf.reduce((s, r) => s + (r.prima_prom ?? 0), 0)),
      dopo: arrotonda(conf.reduce((s, r) => s + (r.dopo_prom ?? 0), 0)),
      acquirenti_dopo: conf.filter((r) => (r.dopo_prom ?? 0) > 0).length,
      nuovi_acquirenti: conDopo.filter((r) => r.mai_prima_prom === true && (r.dopo_prom ?? 0) > 0).length,
      mai_acquistato_prima: conDopo.filter((r) => r.mai_prima_prom === true).length,
      con_dopo_completa: conDopo.length,
    };
  }

  return {
    mesi,
    ricevuti: righe.length,
    confrontabili: conf.length,
    senza_prima: righe.filter((r) => !r.prima_completa).length,
    senza_dopo: righe.filter((r) => !r.dopo_completa).length,
    prima: arrotonda(prima),
    dopo: arrotonda(dopo),
    variazione: prima > 0 ? (dopo - prima) / prima : null,
    in_aumento: conf.filter((r) => r.dopo_tot > r.prima_tot).length,
    in_calo: conf.filter((r) => r.dopo_tot < r.prima_tot).length,
    invariati: conf.filter((r) => r.dopo_tot === r.prima_tot).length,
    promossi,
  };
}

export type OrdineAnalisi = "nome" | "aumento" | "calo";

export function ordineValido(v: unknown): OrdineAnalisi {
  return v === "aumento" || v === "calo" ? v : "nome";
}

/** Aumento/calo: prima i confrontabili (gli altri non hanno una differenza vera). */
export function ordina(righe: RigaAnalisi[], ordine: OrdineAnalisi): RigaAnalisi[] {
  const copia = [...righe];
  if (ordine === "nome") return copia;
  const delta = (r: RigaAnalisi) => r.dopo_tot - r.prima_tot;
  const segno = ordine === "aumento" ? -1 : 1;
  return copia.sort((a, b) => {
    const ca = confrontabile(a);
    const cb = confrontabile(b);
    if (ca !== cb) return ca ? -1 : 1;
    return segno * (delta(a) - delta(b));
  });
}

/** Una nota in chiaro sul perché una riga non è confrontata. */
export function motivoEsclusione(r: RigaAnalisi, mesi: number): string | null {
  if (confrontabile(r)) return null;
  if (!r.dopo_completa && !r.prima_completa) return "storico troppo corto prima e dopo";
  if (!r.dopo_completa) return `meno di ${mesi} mesi dall'invio`;
  return `fatturato disponibile da meno di ${mesi} mesi prima dell'invio`;
}
