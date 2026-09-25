/**
 * Ordini di acquisto: indicatori per l'ufficio acquisti, per buyer e per
 * fornitore.
 *
 * La fonte e' `public.bi_acquisti` (migration 118): una riga per ogni riga
 * d'ordine a fornitore (OF/OFT/OFR) dal 2024, con gli arrivi aggregati dai DDT
 * d'acquisto collegati nel gestionale. Piano: docs/bi/PIANO-ACQUISTI.md.
 *
 * Tre definizioni, usate ovunque (cruscotto, rilevatori, analista):
 *
 *  · PROMESSA  = data confermata dal fornitore, o la prevista se manca
 *                (confermata c'e' sul 97% delle righe).
 *  · PUNTUALE  = primo arrivo entro la promessa. L'arrivo e' la data del DDT
 *                del fornitore, cioe' quando la merce e' partita: un arrivo
 *                "puntuale" di un giorno puo' essere entrato in magazzino il
 *                giorno dopo.
 *  · SCADUTA   = riga non evasa, non chiusa a forza, con meno quantita'
 *                arrivata dell'ordinata e promessa gia' passata.
 *
 * Non e' collegata agli ordini cliente: il gestionale non lega le righe OF a
 * un OC, quindi "ordine urgente per un cliente" non si ricava da qui.
 */

import type { RigaFatto, Snapshot } from "./tipi";

export interface RigaAcquisto {
  idRiga: number;
  profilo: string;
  numeroOrdine: number | null;
  dataOrdine: string;
  codiceFornitore: string;
  fornitore: string;
  buyerUtente: string;
  buyer: string;
  articolo: string;
  descrizione: string;
  gruppoArticoli: string;
  quantita: number;
  qtaArrivata: number;
  valore: number;
  dataPrevista: string | null;
  dataConfermata: string | null;
  rigaEvasa: boolean;
  chiusaForzata: boolean;
  primoArrivo: string | null;
}

/** Data a cui il fornitore si e' impegnato. */
export function promessa(r: RigaAcquisto): string | null {
  return r.dataConfermata ?? r.dataPrevista;
}

export function giorniFra(da: string, a: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${da}T00:00:00Z`)) / 86_400_000);
}

export function spostaGiorni(data: string, giorni: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + giorni);
  return d.toISOString().slice(0, 10);
}

export function aperta(r: RigaAcquisto): boolean {
  return !r.rigaEvasa && !r.chiusaForzata && r.qtaArrivata < r.quantita;
}

export function scaduta(r: RigaAcquisto, oggi: string): boolean {
  const p = promessa(r);
  return aperta(r) && p !== null && p < oggi;
}

/** Valore ancora da ricevere, in proporzione alla quantita' mancante. */
export function valoreResiduo(r: RigaAcquisto): number {
  if (r.quantita <= 0) return 0;
  return (r.valore * Math.max(0, r.quantita - r.qtaArrivata)) / r.quantita;
}

export function puntuale(r: RigaAcquisto): boolean | null {
  const p = promessa(r);
  if (!r.primoArrivo || !p) return null;
  return r.primoArrivo <= p;
}

/** Nome da mostrare per il buyer: l'utente condiviso resta riconoscibile. */
export function nomeBuyer(r: RigaAcquisto): string {
  return r.buyer || r.buyerUtente || "(sconosciuto)";
}

function arr(n: number, decimali = 1): number {
  const f = 10 ** decimali;
  return Math.round(n * f) / f;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lettura dalla riga della vista
// ─────────────────────────────────────────────────────────────────────────────

type Grezza = Record<string, unknown>;

function testo(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim();
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function dataOpz(v: unknown): string | null {
  const t = testo(v);
  return t ? t.slice(0, 10) : null;
}

export function daVista(g: Grezza): RigaAcquisto {
  return {
    idRiga: num(g.id_riga),
    profilo: testo(g.profilo),
    numeroOrdine: g.numero_ordine == null ? null : num(g.numero_ordine),
    dataOrdine: testo(g.data_ordine).slice(0, 10),
    codiceFornitore: testo(g.codice_fornitore),
    fornitore: testo(g.fornitore) || "(senza fornitore)",
    buyerUtente: testo(g.buyer_utente),
    buyer: testo(g.buyer),
    articolo: testo(g.codice_articolo),
    descrizione: testo(g.descrizione),
    gruppoArticoli: testo(g.gruppo_articoli),
    quantita: num(g.quantita),
    qtaArrivata: num(g.qta_arrivata),
    valore: num(g.valore),
    dataPrevista: dataOpz(g.data_prevista),
    dataConfermata: dataOpz(g.data_confermata),
    rigaEvasa: g.riga_evasa === true,
    chiusaForzata: g.chiusa_forzata === true,
    primoArrivo: dataOpz(g.primo_arrivo),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cruscotto
// ─────────────────────────────────────────────────────────────────────────────

export interface IndicatoriGruppo {
  nome: string;
  ordini: number;
  righe: number;
  valore: number;
  /** % di righe arrivate nel periodo entro la promessa. null = nessun arrivo. */
  puntualitaPct: number | null;
  righeArrivate: number;
  /** Giorni medi di ritardo delle sole righe arrivate in ritardo. */
  ritardoMedioGiorni: number | null;
  /** Giorni medi fra ordine e primo arrivo. */
  tempoConsegnaGiorni: number | null;
  righeAperte: number;
  righeScadute: number;
  valoreScaduto: number;
}

export interface CruscottoAcquisti {
  periodo: { dal: string; al: string };
  oggi: string;
  totale: IndicatoriGruppo;
  perBuyer: (IndicatoriGruppo & { quotaRighePct: number })[];
  perFornitore: (IndicatoriGruppo & { puntualitaPrimaPct: number | null })[];
  /** Righe emesse per settimana e buyer, ultime 26 settimane fino a `oggi`. */
  caricoSettimanale: { settimana: string; perBuyer: Record<string, number>; totale: number }[];
  /** Righe emesse per mese (YYYY-MM) e buyer, nel periodo: per il Back office. */
  caricoMensile: { mese: string; perBuyer: Record<string, number> }[];
  scadute: {
    ordine: number | null;
    dataOrdine: string;
    fornitore: string;
    buyer: string;
    articolo: string;
    descrizione: string;
    promessa: string;
    giorniRitardo: number;
    valoreResiduo: number;
  }[];
  avvisi: string[];
}

function indicatori(
  nome: string,
  emesse: RigaAcquisto[],
  arrivate: RigaAcquisto[],
  aperteOra: RigaAcquisto[],
  oggi: string
): IndicatoriGruppo {
  const conEsito = arrivate.filter((r) => puntuale(r) !== null);
  const inRitardo = conEsito.filter((r) => puntuale(r) === false);
  const scad = aperteOra.filter((r) => scaduta(r, oggi));
  return {
    nome,
    ordini: new Set(emesse.map((r) => `${r.profilo}-${r.dataOrdine.slice(0, 4)}-${r.numeroOrdine}`)).size,
    righe: emesse.length,
    valore: arr(emesse.reduce((t, r) => t + r.valore, 0), 2),
    puntualitaPct: conEsito.length
      ? arr((100 * (conEsito.length - inRitardo.length)) / conEsito.length)
      : null,
    righeArrivate: conEsito.length,
    ritardoMedioGiorni: inRitardo.length
      ? arr(inRitardo.reduce((t, r) => t + giorniFra(promessa(r)!, r.primoArrivo!), 0) / inRitardo.length)
      : null,
    tempoConsegnaGiorni: conEsito.length
      ? arr(conEsito.reduce((t, r) => t + giorniFra(r.dataOrdine, r.primoArrivo!), 0) / conEsito.length)
      : null,
    righeAperte: aperteOra.length,
    righeScadute: scad.length,
    valoreScaduto: arr(scad.reduce((t, r) => t + valoreResiduo(r), 0), 2),
  };
}

function raggruppa<T>(righe: T[], chiave: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of righe) {
    const k = chiave(r);
    const l = m.get(k);
    if (l) l.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** Lunedi' della settimana ISO di una data. */
export function inizioSettimana(data: string): string {
  const d = new Date(`${data}T00:00:00Z`);
  const giorno = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - giorno);
  return d.toISOString().slice(0, 10);
}

export function calcolaCruscottoAcquisti(
  righe: RigaAcquisto[],
  opzioni: { dal: string; al: string; oggi: string }
): CruscottoAcquisti {
  const { dal, al, oggi } = opzioni;
  const avvisi: string[] = [];

  // Emesse = ordinate nel periodo. Arrivate = con primo arrivo nel periodo:
  // la puntualita' di settembre e' quella delle consegne di settembre, anche
  // se l'ordine e' di luglio.
  const emesse = righe.filter((r) => r.dataOrdine >= dal && r.dataOrdine <= al);
  const arrivate = righe.filter((r) => r.primoArrivo && r.primoArrivo >= dal && r.primoArrivo <= al);
  const aperteOra = righe.filter(aperta);

  const totale = indicatori("Totale", emesse, arrivate, aperteOra, oggi);

  const emessePerBuyer = raggruppa(emesse, nomeBuyer);
  const arrivatePerBuyer = raggruppa(arrivate, nomeBuyer);
  const apertePerBuyer = raggruppa(aperteOra, nomeBuyer);
  const buyers = new Set([...emessePerBuyer.keys(), ...apertePerBuyer.keys()]);
  const perBuyer = [...buyers]
    .map((b) => ({
      ...indicatori(b, emessePerBuyer.get(b) ?? [], arrivatePerBuyer.get(b) ?? [], apertePerBuyer.get(b) ?? [], oggi),
      quotaRighePct: emesse.length ? arr((100 * (emessePerBuyer.get(b)?.length ?? 0)) / emesse.length) : 0,
    }))
    .sort((a, b) => b.righe - a.righe || b.righeAperte - a.righeAperte);

  // Puntualita' "di prima" per fornitore: i 12 mesi precedenti al periodo,
  // cosi' la tabella dice se sta peggiorando, non solo com'e'.
  const primaDal = spostaGiorni(dal, -365);
  const arrivatePrima = righe.filter((r) => r.primoArrivo && r.primoArrivo >= primaDal && r.primoArrivo < dal);
  const primaPerFornitore = raggruppa(arrivatePrima, (r) => r.fornitore);

  const emessePerFornitore = raggruppa(emesse, (r) => r.fornitore);
  const arrivatePerFornitore = raggruppa(arrivate, (r) => r.fornitore);
  const apertePerFornitore = raggruppa(aperteOra, (r) => r.fornitore);
  const fornitori = new Set([...emessePerFornitore.keys(), ...arrivatePerFornitore.keys()]);
  const perFornitore = [...fornitori]
    .map((f) => {
      const prima = (primaPerFornitore.get(f) ?? []).filter((r) => puntuale(r) !== null);
      return {
        ...indicatori(
          f,
          emessePerFornitore.get(f) ?? [],
          arrivatePerFornitore.get(f) ?? [],
          apertePerFornitore.get(f) ?? [],
          oggi
        ),
        puntualitaPrimaPct: prima.length >= 10
          ? arr((100 * prima.filter((r) => puntuale(r)).length) / prima.length)
          : null,
      };
    })
    .sort((a, b) => b.valore - a.valore);

  // Carico: ultime 26 settimane intere fino a oggi, per buyer.
  const ultimaSettimana = inizioSettimana(oggi);
  const primaSettimana = spostaGiorni(ultimaSettimana, -7 * 25);
  const settimane: string[] = [];
  for (let s = primaSettimana; s <= ultimaSettimana; s = spostaGiorni(s, 7)) settimane.push(s);
  const perSettimana = new Map(settimane.map((s) => [s, {} as Record<string, number>]));
  for (const r of righe) {
    if (r.dataOrdine < primaSettimana || r.dataOrdine > oggi) continue;
    const s = perSettimana.get(inizioSettimana(r.dataOrdine));
    if (!s) continue;
    const b = nomeBuyer(r);
    s[b] = (s[b] ?? 0) + 1;
  }
  const caricoSettimanale = settimane.map((settimana) => {
    const perBuyerSett = perSettimana.get(settimana)!;
    return {
      settimana,
      perBuyer: perBuyerSett,
      totale: Object.values(perBuyerSett).reduce((t, n) => t + n, 0),
    };
  });

  const perMese = new Map<string, Record<string, number>>();
  for (const r of emesse) {
    const mese = r.dataOrdine.slice(0, 7);
    const m = perMese.get(mese) ?? {};
    m[nomeBuyer(r)] = (m[nomeBuyer(r)] ?? 0) + 1;
    perMese.set(mese, m);
  }
  const caricoMensile = [...perMese.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mese, perBuyerMese]) => ({ mese, perBuyer: perBuyerMese }));

  const scadute = aperteOra
    .filter((r) => scaduta(r, oggi))
    .map((r) => ({
      ordine: r.numeroOrdine,
      dataOrdine: r.dataOrdine,
      fornitore: r.fornitore,
      buyer: nomeBuyer(r),
      articolo: r.articolo,
      descrizione: r.descrizione,
      promessa: promessa(r)!,
      giorniRitardo: giorniFra(promessa(r)!, oggi),
      valoreResiduo: arr(valoreResiduo(r), 2),
    }))
    .sort((a, b) => b.giorniRitardo * b.valoreResiduo - a.giorniRitardo * a.valoreResiduo)
    .slice(0, 50);

  if (righe.length === 0) {
    avvisi.push("Nessuna riga d'ordine a fornitore: la vista bi_acquisti è vuota o non raggiungibile.");
  }
  if (righe.some((r) => r.buyerUtente === "acquisti")) {
    avvisi.push("«acquisti» è un utente condiviso del gestionale: le sue righe non si possono attribuire a una persona.");
  }

  return { periodo: { dal, al }, oggi, totale, perBuyer, perFornitore, caricoSettimanale, caricoMensile, scadute, avvisi };
}

/**
 * Il giorno a cui si giudica cosa e' scaduto: quello dell'estrazione degli
 * acquisti, non l'ultima vendita. Lo stato degli arrivi e' di quel giorno.
 */
export function oggiAcquisti(snapshot: Snapshot): string {
  return snapshot.acquistiAl ?? snapshot.dataMassima ?? new Date().toISOString().slice(0, 10);
}

/** Le righe acquisti dello snapshot, o un elenco vuoto se non caricate. */
export function righeAcquisti(snapshot: Snapshot): RigaAcquisto[] {
  return snapshot.acquisti ?? [];
}

/**
 * Le righe d'ordine viste come fatti del motore semantico: cosi' gli acquisti
 * entrano nelle analisi, nelle dashboard e nell'analista con le stesse regole
 * delle vendite. Agente, cliente e business unit restano vuoti — non esistono
 * sugli ordini a fornitore — e un perimetro per agente li esclude tutti.
 */
export function comeFatti(righe: RigaAcquisto[], oggi: string): RigaFatto[] {
  return righe.map((r) => {
    const p = promessa(r);
    return {
      data: r.dataOrdine,
      importo: r.valore,
      bu: "",
      categoria: r.gruppoArticoli || "-",
      agente: "",
      codiceAgente: "",
      cliente: "",
      codiceCliente: "",
      documento: `${r.profilo} ${r.numeroOrdine ?? "?"}/${r.dataOrdine.slice(0, 4)}`,
      articolo: r.articolo,
      descrizioneArticolo: r.descrizione,
      quantita: r.quantita,
      fornitore: r.fornitore,
      buyer: nomeBuyer(r),
      promessa: p,
      dataArrivo: r.primoArrivo,
      puntuale: puntuale(r),
      scaduta: scaduta(r, oggi),
      valoreResiduo: valoreResiduo(r),
      giorniConsegna: r.primoArrivo ? giorniFra(r.dataOrdine, r.primoArrivo) : null,
    };
  });
}
